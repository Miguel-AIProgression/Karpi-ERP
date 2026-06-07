-- Migratie 325: rauwe-payload-audit uitbreiden naar UITGAAND carrier-verkeer
--
-- Aanleiding:
--   Mig 324 introduceerde `inkomende_payloads` als append-only vangnet voor
--   inkomende berichten (Shopify slice 1). Uitgaand vervoerder-verkeer (HST)
--   bewaart z'n request/response wél op `hst_transportorders`, maar dat is ÉÉN
--   rij die bij elke retry OVERSCHREVEN wordt (markeer_hst_fout, mig 171) — en
--   bij succes wordt error_msg op NULL gezet. Daardoor gaat de fout-historie van
--   eerdere pogingen verloren, precies wat je bij diagnose nodig hebt.
--
-- Oplossing:
--   1. Hernoem `inkomende_payloads` → `externe_payloads`. De tabel had al een
--      `richting`-kolom ('in'/'out'); de oude naam suggereerde ten onrechte
--      alleen inbound. Eén centrale plek voor álle externe payloads.
--   2. Neutrale RPC's `log_externe_payload` / `markeer_externe_payload_verwerkt`
--      met `p_richting` + `p_order_id` + `p_status`, zodat een carrier-call in
--      één insert (richting='out', order_id, eindstatus) kan worden vastgelegd.
--   3. De oude RPC-namen blijven als DEPRECATED wrappers bestaan zodat de
--      reeds-gedeployde sync-shopify-order (mig 324) blijft werken tot de
--      herdeploy. Nieuwe callers gebruiken de neutrale namen.
--
-- Carrier-logging zelf (HST) gebeurt best-effort vanuit de edge function
-- hst-send: één rij per verstuur-poging (request + gestripte response), zodat de
-- volledige retry-/fout-historie bewaard blijft naast hst_transportorders.
--
-- Idempotent: guarded rename, ALTER ... IF EXISTS, CREATE OR REPLACE.

-- ============================================================================
-- 1. Tabel hernoemen (guarded → re-runnable)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'inkomende_payloads')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'externe_payloads') THEN
    ALTER TABLE inkomende_payloads RENAME TO externe_payloads;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_inkomende_payloads_kanaal_extern RENAME TO idx_externe_payloads_kanaal_extern;
ALTER INDEX IF EXISTS idx_inkomende_payloads_order          RENAME TO idx_externe_payloads_order;
ALTER INDEX IF EXISTS idx_inkomende_payloads_ontvangen      RENAME TO idx_externe_payloads_ontvangen;
ALTER INDEX IF EXISTS idx_inkomende_payloads_fout           RENAME TO idx_externe_payloads_fout;

-- Snel uitgaand carrier-verkeer per richting/kanaal terugvinden.
CREATE INDEX IF NOT EXISTS idx_externe_payloads_richting_kanaal
  ON externe_payloads (richting, kanaal, ontvangen_op DESC);

COMMENT ON TABLE externe_payloads IS
  'Append-only audit van rauwe externe payloads, in- én uitgaand (mig 324/325). '
  'Inbound: Shopify/e-mail/webshop/lightspeed (richting=''in''). Outbound: '
  'vervoerders zoals HST (richting=''out''), één rij per verstuur-poging zodat de '
  'volledige retry-/fout-historie bewaard blijft. Diagnose-vangnet, GEEN '
  'verwerkings-queue (dat blijft orders / edi_berichten / hst_transportorders). '
  'EDI houdt z''n eigen payload_raw in edi_berichten.';

COMMENT ON COLUMN externe_payloads.externe_id IS
  'Externe identifier (Shopify order-id, EDI transactie-id, HST OrderNumber / '
  'zending_nr). Geen UNIQUE: append-only, dus een resend/retry levert een extra '
  'rij (volledige audit van élke uitwisseling).';

COMMENT ON COLUMN externe_payloads.status IS
  '''ontvangen'' bij two-step inbound-logging, daarna ''verwerkt''/''fout'' via '
  'markeer_externe_payload_verwerkt. Outbound carrier-calls schrijven de '
  'eindstatus direct mee. Best-effort — logging mag de verwerking nooit blokkeren.';

-- ============================================================================
-- 2. RPC: payload loggen → geeft id terug (in- én uitgaand)
-- ============================================================================
CREATE OR REPLACE FUNCTION log_externe_payload(
  p_kanaal       TEXT,
  p_payload_raw  TEXT,
  p_bron         TEXT   DEFAULT NULL,
  p_externe_id   TEXT   DEFAULT NULL,
  p_content_type TEXT   DEFAULT NULL,
  p_headers      JSONB  DEFAULT NULL,
  p_payload_json JSONB  DEFAULT NULL,
  p_richting     TEXT   DEFAULT 'in',
  p_order_id     BIGINT DEFAULT NULL,
  p_status       TEXT   DEFAULT 'ontvangen',
  p_fout         TEXT   DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO externe_payloads (
    kanaal, bron, externe_id, richting, content_type, headers,
    payload_raw, payload_json, order_id, status, fout,
    verwerkt_op
  ) VALUES (
    p_kanaal, p_bron, p_externe_id, COALESCE(p_richting, 'in'), p_content_type, p_headers,
    p_payload_raw, p_payload_json, p_order_id, COALESCE(p_status, 'ontvangen'), p_fout,
    -- Outbound calls leveren meteen een eindstatus → meteen verwerkt_op stempelen.
    CASE WHEN COALESCE(p_status, 'ontvangen') IN ('verwerkt', 'fout') THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION log_externe_payload IS
  'Schrijft een rauwe externe payload weg en geeft de id terug. Inbound: aanroepen '
  'vóór verwerking met status ''ontvangen'' (default). Outbound carrier-calls geven '
  'richting=''out'', order_id en de eindstatus (verwerkt/fout) direct mee. Mig 325.';

-- ============================================================================
-- 3. RPC: payload-status bijwerken na verwerking (two-step inbound)
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_externe_payload_verwerkt(
  p_id       BIGINT,
  p_status   TEXT   DEFAULT 'verwerkt',
  p_order_id BIGINT DEFAULT NULL,
  p_fout     TEXT   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE externe_payloads
     SET status      = p_status,
         order_id    = COALESCE(p_order_id, order_id),
         fout        = p_fout,
         verwerkt_op = now()
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION markeer_externe_payload_verwerkt IS
  'Werkt status (verwerkt/fout), order_id en fout-melding van een eerder gelogde '
  'externe payload bij. Best-effort. Mig 325.';

GRANT EXECUTE ON FUNCTION log_externe_payload(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT, TEXT)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION markeer_externe_payload_verwerkt(BIGINT, TEXT, BIGINT, TEXT)
  TO service_role, authenticated;

-- ============================================================================
-- 4. DEPRECATED wrappers — houden de gedeployde mig 324-callers (sync-shopify-
--    order) werkend tot de herdeploy. Nieuwe code gebruikt de neutrale namen.
-- ============================================================================
CREATE OR REPLACE FUNCTION log_inkomende_payload(
  p_kanaal       TEXT,
  p_payload_raw  TEXT,
  p_bron         TEXT  DEFAULT NULL,
  p_externe_id   TEXT  DEFAULT NULL,
  p_content_type TEXT  DEFAULT NULL,
  p_headers      JSONB DEFAULT NULL,
  p_payload_json JSONB DEFAULT NULL
) RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT log_externe_payload(
    p_kanaal, p_payload_raw, p_bron, p_externe_id, p_content_type, p_headers, p_payload_json
  );
$$;

COMMENT ON FUNCTION log_inkomende_payload IS
  'DEPRECATED (mig 325): delegeert naar log_externe_payload. Behouden zodat de '
  'reeds-gedeployde sync-shopify-order blijft werken. Verwijderen na herdeploy.';

CREATE OR REPLACE FUNCTION markeer_inkomende_payload_verwerkt(
  p_id       BIGINT,
  p_status   TEXT   DEFAULT 'verwerkt',
  p_order_id BIGINT DEFAULT NULL,
  p_fout     TEXT   DEFAULT NULL
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT markeer_externe_payload_verwerkt(p_id, p_status, p_order_id, p_fout);
$$;

COMMENT ON FUNCTION markeer_inkomende_payload_verwerkt IS
  'DEPRECATED (mig 325): delegeert naar markeer_externe_payload_verwerkt. '
  'Behouden voor de gedeployde sync-shopify-order. Verwijderen na herdeploy.';

GRANT EXECUTE ON FUNCTION log_inkomende_payload(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION markeer_inkomende_payload_verwerkt(BIGINT, TEXT, BIGINT, TEXT)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
