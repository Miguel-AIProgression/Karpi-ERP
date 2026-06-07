-- Migratie 324: generieke rauwe-payload-audit voor inkomende berichten
--
-- Aanleiding:
--   Bij verwerkingsfouten (bv. Shopify-orders waarvan de productregels niet op
--   een artikel matchen) konden we de OORSPRONKELIJKE payload niet meer terugzien
--   — die werd na verwerking weggegooid. EDI bewaart de rauwe payload al in
--   edi_berichten.payload_raw; Shopify, e-mail en de webshop-kanalen niet.
--
-- Oplossing:
--   Eén append-only audit-tabel `inkomende_payloads`, kanaal-onafhankelijk, die
--   de letterlijke body wegschrijft op het moment van ontvangst (vóór verwerking)
--   zodat zelfs een crash/parse-fout een spoor achterlaat. Bedoeld als
--   diagnose-/herleidbaarheidsvangnet, NIET als verwerkings-queue (dat blijft
--   orders / edi_berichten). EDI blijft z'n eigen rijke tabel gebruiken.
--
-- Slice 1 (deze migratie + sync-shopify-order): alleen Shopify schrijft weg.
-- Overige kanalen (sync-webshop-order, import-lightspeed-orders,
-- poll-email-orders) volgen als aparte slices via dezelfde RPC's.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION.

-- ============================================================================
-- 1. Tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS inkomende_payloads (
  id            BIGSERIAL PRIMARY KEY,
  kanaal        TEXT        NOT NULL,                 -- 'shopify' | 'edi' | 'email' | 'lightspeed' | 'webshop'
  bron          TEXT,                                 -- shop-domein / systeem-identifier
  externe_id    TEXT,                                 -- externe order-/transactie-/message-id (traceer + idempotentie-zoeken)
  richting      TEXT        NOT NULL DEFAULT 'in',
  content_type  TEXT,
  headers       JSONB,                                -- relevante request-headers
  payload_raw   TEXT        NOT NULL,                 -- letterlijke body — niets gaat verloren
  payload_json  JSONB,                                -- geparset gemak (optioneel; NULL bij niet-JSON of parse-fout)
  order_id      BIGINT      REFERENCES orders(id) ON DELETE SET NULL,
  status        TEXT        NOT NULL DEFAULT 'ontvangen',  -- 'ontvangen' | 'verwerkt' | 'fout'
  fout          TEXT,
  ontvangen_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
  verwerkt_op   TIMESTAMPTZ
);

COMMENT ON TABLE inkomende_payloads IS
  'Append-only audit van rauwe inkomende berichten per kanaal (mig 324). Bewaart '
  'de oorspronkelijke payload zodat verwerkingsfouten altijd herleidbaar zijn. '
  'Geen verwerkings-queue — dat blijft orders/edi_berichten. EDI heeft z''n eigen '
  'payload_raw in edi_berichten; dit kanaal-onafhankelijke vangnet bedient '
  'Shopify (slice 1) en later e-mail/webshop/lightspeed.';

COMMENT ON COLUMN inkomende_payloads.externe_id IS
  'Externe identifier (Shopify order-id, EDI transactie-id, e-mail message-id). '
  'Geen UNIQUE: append-only, dus een resend levert een extra rij (volledige '
  'audit van élke ontvangst). Dedup van de order zelf gebeurt downstream.';

COMMENT ON COLUMN inkomende_payloads.status IS
  '''ontvangen'' bij insert, daarna ''verwerkt'' of ''fout'' via '
  'markeer_inkomende_payload_verwerkt. Best-effort — logging mag de '
  'order-verwerking nooit blokkeren.';

-- ============================================================================
-- 2. Indexen
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_inkomende_payloads_kanaal_extern
  ON inkomende_payloads (kanaal, externe_id);
CREATE INDEX IF NOT EXISTS idx_inkomende_payloads_order
  ON inkomende_payloads (order_id);
CREATE INDEX IF NOT EXISTS idx_inkomende_payloads_ontvangen
  ON inkomende_payloads (ontvangen_op DESC);
-- Snel de probleemgevallen vinden.
CREATE INDEX IF NOT EXISTS idx_inkomende_payloads_fout
  ON inkomende_payloads (ontvangen_op DESC) WHERE status = 'fout';

-- ============================================================================
-- 3. RPC: payload loggen bij ontvangst → geeft id terug
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO inkomende_payloads (
    kanaal, bron, externe_id, content_type, headers, payload_raw, payload_json
  ) VALUES (
    p_kanaal, p_bron, p_externe_id, p_content_type, p_headers, p_payload_raw, p_payload_json
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION log_inkomende_payload IS
  'Schrijft een rauwe inkomende payload weg (status ''ontvangen'') en geeft de '
  'id terug. Aanroepen vóór verwerking. Mig 324.';

-- ============================================================================
-- 4. RPC: payload-status bijwerken na verwerking
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_inkomende_payload_verwerkt(
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
  UPDATE inkomende_payloads
     SET status      = p_status,
         order_id    = COALESCE(p_order_id, order_id),
         fout        = p_fout,
         verwerkt_op = now()
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION markeer_inkomende_payload_verwerkt IS
  'Werkt status (verwerkt/fout), order_id en fout-melding van een eerder '
  'gelogde inkomende payload bij. Best-effort. Mig 324.';

GRANT EXECUTE ON FUNCTION log_inkomende_payload(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION markeer_inkomende_payload_verwerkt(BIGINT, TEXT, BIGINT, TEXT)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
