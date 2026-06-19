-- Migratie 426: verzend_wachtrij — één wachtrij gediscrimineerd op vervoerder_code
-- ADR-0038 (data-as). Plan: docs/superpowers/plans/2026-06-18-verzend-wachtrij-data-as.md
--
-- Consolideert hst_transportorders (mig 171/304) + verhoek_transportorders (375)
-- + rhenus_transportorders (380) tot ÉÉN operationele wachtrij. De carrier-
-- verschillen (REST-JSON vs SFTP-XML, wel/geen T&T) waren puur storage-details;
-- de zware request/response-payload leeft al volledig in externe_payloads
-- (mig 324/325, één rij per poging) en wordt hier dus GESCHRAPT — de wachtrij
-- draagt alleen operationele state + een generieke correlatiesleutel.
--
-- COMPLEMENTEERT de capability-as (ADR-0034) en process-as (ADR-0035): na deze
-- migratie draagt de VerzendAdapter geen per-carrier RPC-namen meer.
--
-- DEPLOY: drain + crons gepauzeerd, atomisch venster (beslissing B). Deze migratie
-- + de 3 edge functions (slice 2) + de frontend (slice 3) gaan in één venster.
-- De OUDE tabellen + RPC's blijven staan als rollback-vangnet → drop = mig slice 5.
--
-- VOORWAARDE: mig 171/304/337/338/375/380/420 + 424 (vervoerder_eigen_vervoer)
-- toegepast — deze migratie CREATE OR REPLACE't enqueue_zending_naar_vervoerder en
-- neemt de WHEN 'eigen'-tak van mig 424 mee, dus draai ná 424.
-- Idempotent: enum-guard, IF NOT EXISTS, CREATE OR REPLACE, backfill-leeg-guard.
-- NB hernummerd 424→426 vlak vóór merge: 424/425 botsten met
-- 424_vervoerder_eigen_vervoer + 425_bug_melding_verwijderen op main (collisie-historie).

-- ============================================================================
-- §1. Status-enum + tabel
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE verzend_status AS ENUM ('Wachtrij','Bezig','Verstuurd','Fout','Geannuleerd');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS verzend_wachtrij (
  id                BIGSERIAL PRIMARY KEY,
  zending_id        BIGINT  NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  debiteur_nr       INTEGER REFERENCES debiteuren(debiteur_nr),
  vervoerder_code   TEXT    NOT NULL,            -- discriminator: 'hst_api'|'verhoek_sftp'|'rhenus_sftp'|…
  status            verzend_status NOT NULL DEFAULT 'Wachtrij',
  -- Generieke operationele velden (subsumeren de carrier-kolommen):
  extern_referentie TEXT,        -- correlatiesleutel: HST transportOrderId | SFTP bestandsnaam
  track_trace       TEXT,        -- consument-T&T: HST trackingNumber | Verhoek zending_nr | NULL (Rhenus)
  document_pad      TEXT,        -- storage-pad artefact: PDF (HST) | XML (SFTP)
  -- State-machine:
  retry_count       INTEGER NOT NULL DEFAULT 0,
  error_msg         TEXT,
  is_test           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eén active-rij-invariant over ÁLLE carriers heen (was 3× uk_*_to_zending_actief).
-- Strikter en correcter: een zending heeft precies één vervoerder.
CREATE UNIQUE INDEX IF NOT EXISTS uk_verzend_wachtrij_zending_actief
  ON verzend_wachtrij (zending_id) WHERE status NOT IN ('Fout','Geannuleerd');

CREATE INDEX IF NOT EXISTS idx_verzend_wachtrij_claim
  ON verzend_wachtrij (vervoerder_code, status, created_at);
CREATE INDEX IF NOT EXISTS idx_verzend_wachtrij_zending
  ON verzend_wachtrij (zending_id);
CREATE INDEX IF NOT EXISTS idx_verzend_wachtrij_debiteur
  ON verzend_wachtrij (debiteur_nr, created_at DESC);

COMMENT ON TABLE verzend_wachtrij IS
  'Verzend-wachtrij (ADR-0038, data-as): één rij per zending die naar een '
  'vervoerder verstuurd moet worden, gediscrimineerd op vervoerder_code. '
  'Operationele state + correlatiesleutel; de rauwe payload leeft in '
  'externe_payloads (mig 325). Vervangt hst_/verhoek_/rhenus_transportorders.';
COMMENT ON COLUMN verzend_wachtrij.extern_referentie IS
  'Correlatiesleutel bij de vervoerder: HST transportOrderId | SFTP bestandsnaam.';
COMMENT ON COLUMN verzend_wachtrij.track_trace IS
  'Consument-T&T: HST trackingNumber | Verhoek zending_nr | NULL (Rhenus, geen T&T-slot).';
COMMENT ON COLUMN verzend_wachtrij.document_pad IS
  'Storage-pad van het verzendartefact: PDF-vrachtbrief (HST) | XML (Verhoek/Rhenus).';

CREATE OR REPLACE FUNCTION set_verzend_wachtrij_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verzend_wachtrij_updated_at ON verzend_wachtrij;
CREATE TRIGGER trg_verzend_wachtrij_updated_at
  BEFORE UPDATE ON verzend_wachtrij
  FOR EACH ROW EXECUTE FUNCTION set_verzend_wachtrij_updated_at();

ALTER TABLE verzend_wachtrij ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verzend_wachtrij_all ON verzend_wachtrij;
CREATE POLICY verzend_wachtrij_all ON verzend_wachtrij FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- §2. Backfill uit de drie oude tabellen (historie meegenomen voor monitor +
--     in-flight rijen). Leeg-guard maakt re-run idempotent. De combined
--     unique-active-index houdt op historische data (≤1 actieve rij/zending/
--     carrier, en één carrier per zending) — een conflict = échte anomalie die
--     de migratie terecht hard laat falen.
--     LET OP: vóór de order_documenten-trigger (§6) zodat de backfill 'm niet
--     N× vuurt (de PDF's staan al in order_documenten via mig 304).
-- ============================================================================
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM verzend_wachtrij) = 0 THEN
    -- HST: extern_referentie ← transport_order_id, track_trace ← tracking_number,
    --      document_pad ← pdf_path.
    INSERT INTO verzend_wachtrij
      (zending_id, debiteur_nr, vervoerder_code, status, extern_referentie,
       track_trace, document_pad, retry_count, error_msg, is_test,
       created_at, sent_at, updated_at)
    SELECT zending_id, debiteur_nr, 'hst_api', status::text::verzend_status,
           extern_transport_order_id, extern_tracking_number, pdf_path,
           retry_count, error_msg, is_test, created_at, sent_at, updated_at
      FROM hst_transportorders;

    -- Verhoek: extern_referentie ← bestandsnaam, track_trace ← track_trace_id,
    --          document_pad ← xml_storage_path.
    INSERT INTO verzend_wachtrij
      (zending_id, debiteur_nr, vervoerder_code, status, extern_referentie,
       track_trace, document_pad, retry_count, error_msg, is_test,
       created_at, sent_at, updated_at)
    SELECT zending_id, debiteur_nr, 'verhoek_sftp', status::text::verzend_status,
           bestandsnaam, track_trace_id, xml_storage_path,
           retry_count, error_msg, is_test, created_at, sent_at, updated_at
      FROM verhoek_transportorders;

    -- Rhenus: extern_referentie ← bestandsnaam, track_trace ← NULL (geen T&T),
    --         document_pad ← xml_storage_path.
    INSERT INTO verzend_wachtrij
      (zending_id, debiteur_nr, vervoerder_code, status, extern_referentie,
       track_trace, document_pad, retry_count, error_msg, is_test,
       created_at, sent_at, updated_at)
    SELECT zending_id, debiteur_nr, 'rhenus_sftp', status::text::verzend_status,
           bestandsnaam, NULL, xml_storage_path,
           retry_count, error_msg, is_test, created_at, sent_at, updated_at
      FROM rhenus_transportorders;

    RAISE NOTICE 'Mig 426 backfill: % rijen naar verzend_wachtrij',
      (SELECT COUNT(*) FROM verzend_wachtrij);
  ELSE
    RAISE NOTICE 'Mig 426 backfill overgeslagen — verzend_wachtrij is niet leeg.';
  END IF;
END $$;

-- ============================================================================
-- §3. Generieke RPC-set (de DB-seam). Vervangt 5×3 per-carrier RPC's.
-- ============================================================================

-- enqueue_transportorder: plaatst een zending op de wachtrij voor een vervoerder.
-- Idempotent via de unique-active-index (al een actieve rij → no-op). De
-- request-payload wordt PAS bij claim door de edge function gebouwd (vers).
CREATE OR REPLACE FUNCTION enqueue_transportorder(
  p_zending_id     BIGINT,
  p_debiteur_nr    INTEGER,
  p_vervoerder_code TEXT,
  p_is_test        BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO verzend_wachtrij (zending_id, debiteur_nr, vervoerder_code, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, p_vervoerder_code, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout','Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_transportorder(BIGINT, INTEGER, TEXT, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION enqueue_transportorder IS
  'ADR-0038: generieke enqueue (vervangt enqueue_{hst,verhoek,rhenus}_transportorder). '
  'Idempotent — actieve rij bestaat al → no-op.';

-- claim_volgende_transportorder: edge function claimt 1 rij voor zijn carrier.
-- FOR UPDATE SKIP LOCKED + vervoerder_code-filter → de drie crons pakken elkaars
-- rijen niet.
CREATE OR REPLACE FUNCTION claim_volgende_transportorder(p_vervoerder_code TEXT)
RETURNS verzend_wachtrij AS $$
DECLARE
  v_row verzend_wachtrij;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM verzend_wachtrij
      WHERE status = 'Wachtrij' AND vervoerder_code = p_vervoerder_code
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_transportorder(TEXT) TO authenticated, service_role;

-- markeer_transportorder_verstuurd: na succesvol transport. Generieke velden;
-- géén carrier-specifieke payload meer (die staat in externe_payloads).
-- track_trace-update op de zending alleen als p_track_trace IS NOT NULL (Rhenus
-- geeft NULL → géén T&T-update, exact als voorheen); de status-flip Klaar voor
-- verzending → Onderweg gebeurt voor álle carriers.
CREATE OR REPLACE FUNCTION markeer_transportorder_verstuurd(
  p_id                BIGINT,
  p_extern_referentie TEXT,
  p_track_trace       TEXT,
  p_document_pad      TEXT
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE verzend_wachtrij
     SET status            = 'Verstuurd',
         extern_referentie = p_extern_referentie,
         track_trace       = COALESCE(p_track_trace, track_trace),
         document_pad      = COALESCE(p_document_pad, document_pad),
         sent_at           = now(),
         error_msg         = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_track_trace, track_trace),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_transportorder_verstuurd(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION markeer_transportorder_verstuurd IS
  'ADR-0038: generieke markeer-verstuurd. track_trace alleen gezet als non-NULL '
  '(Rhenus → NULL → geen T&T); status-flip Klaar→Onderweg voor alle carriers. '
  'document_pad → order_documenten via trg_verzend_wachtrij_pdf (alleen hst_api).';

-- markeer_transportorder_fout: retry-cascade ongewijzigd (retry++ → Fout bij
-- ≥ max, anders terug naar Wachtrij). Geen payload-parameters meer.
CREATE OR REPLACE FUNCTION markeer_transportorder_fout(
  p_id          BIGINT,
  p_error       TEXT,
  p_max_retries INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM verzend_wachtrij WHERE id = p_id;

  UPDATE verzend_wachtrij
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::verzend_status
           ELSE 'Wachtrij'::verzend_status
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_transportorder_fout(BIGINT, TEXT, INTEGER) TO authenticated, service_role;

-- herstel_vastgelopen_verzending: self-healing reaper per carrier (spiegel mig 337).
CREATE OR REPLACE FUNCTION herstel_vastgelopen_verzending(
  p_vervoerder_code TEXT,
  p_minuten         INTEGER DEFAULT 10
) RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND vervoerder_code = p_vervoerder_code
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_verzending(TEXT, INTEGER) TO authenticated, service_role;

-- ============================================================================
-- §4. Dispatch: enqueue_zending_naar_vervoerder. Volledige body = mig 420 +
--     de geneste per-code-CASE collapst tot één enqueue_transportorder-call.
--     Een nieuwe api/sftp-vervoerder vereist nu NUL dispatch-edits.
-- ============================================================================
DROP FUNCTION IF EXISTS enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN);

CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT,
  p_handmatig  BOOLEAN DEFAULT FALSE
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_handmatig_verv  BOOLEAN;
  v_aantal_colli    INTEGER;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, handmatig_aanmelden INTO v_actief, v_type, v_handmatig_verv
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- HOLD-GUARD (colli-bundeling, mig 420): een handmatig-aanmelden-vervoerder
  -- houdt een >=2-colli-zending vast tot de operator vrijgeeft (p_handmatig=TRUE).
  IF NOT p_handmatig AND COALESCE(v_handmatig_verv, FALSE) THEN
    SELECT COUNT(*) INTO v_aantal_colli
      FROM zending_colli WHERE zending_id = p_zending_id AND bundel_colli_id IS NULL;
    IF v_aantal_colli >= 2 THEN
      RETURN 'held_handmatig';
    END IF;
  END IF;

  -- SWITCH-POINT (ADR-0038): de queue-gebaseerde carriers (api/sftp) gaan
  -- allemaal via één generieke enqueue, gediscrimineerd op de code. Géén
  -- per-code-CASE meer → nieuwe api/sftp-vervoerder = nul dispatch-edits.
  CASE v_type
    WHEN 'api', 'sftp' THEN
      PERFORM enqueue_transportorder(p_zending_id, v_debiteur_nr, v_vervoerder_code, v_is_test);
      RETURN 'enqueued_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    -- Eigen vervoer (mig 424): als 'print' qua flow (colli klaarzetten voor
    -- label/pakbon), GEEN externe dispatch. Meegenomen zodat deze CREATE OR
    -- REPLACE de 424-tak niet wegvaagt.
    WHEN 'eigen' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_eigen';

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT + hold-guard. Sinds mig 426 (ADR-0038): de api/sftp-takken '
  'collapsen tot één enqueue_transportorder(code) — geen per-code-CASE meer. '
  'Hold-guard (mig 420) + afhalen-skip + print-tak ongewijzigd.';

-- ============================================================================
-- §5. Monitor: generieke verzend_monitor + lees-shims voor de 3 oude views.
--     De oude views worden lees-shims over verzend_wachtrij (1-rij-aggregaat,
--     exact dezelfde 6 kolommen) zodat bestaande consumenten blijven werken
--     tot de frontend (slice 3) op verzend_monitor draait. Drop = slice 5.
-- ============================================================================
CREATE OR REPLACE VIEW verzend_monitor AS
SELECT vervoerder_code,
       COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::int AS verstuurd_vandaag,
       COUNT(*) FILTER (WHERE status = 'Fout')::int     AS fout_open,
       COUNT(*) FILTER (WHERE status = 'Wachtrij')::int AS wachtrij,
       COUNT(*) FILTER (WHERE status = 'Bezig')::int    AS bezig,
       COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60, 0)::int AS oudste_wachtrij_minuten,
       COALESCE(EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig')))  / 60, 0)::int AS oudste_bezig_minuten
FROM verzend_wachtrij
GROUP BY vervoerder_code;

COMMENT ON VIEW verzend_monitor IS
  'Cron-health per vervoerder (ADR-0038). oudste_wachtrij_minuten hoog = '
  'verzend-cron staat stil. Vervangt hst_/verhoek_/rhenus_verzend_monitor.';

GRANT SELECT ON verzend_monitor TO authenticated;

-- Lees-shims (1-rij-aggregaat zonder GROUP BY → altijd precies 1 rij, exact
-- de oude shape). Tijdelijk; dropped in slice 5.
CREATE OR REPLACE VIEW hst_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::int AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::int     AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::int AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::int    AS bezig,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60, 0)::int AS oudste_wachtrij_minuten,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig')))  / 60, 0)::int AS oudste_bezig_minuten
FROM verzend_wachtrij WHERE vervoerder_code = 'hst_api';

CREATE OR REPLACE VIEW verhoek_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::int AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::int     AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::int AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::int    AS bezig,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60, 0)::int AS oudste_wachtrij_minuten,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig')))  / 60, 0)::int AS oudste_bezig_minuten
FROM verzend_wachtrij WHERE vervoerder_code = 'verhoek_sftp';

CREATE OR REPLACE VIEW rhenus_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::int AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::int     AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::int AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::int    AS bezig,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60, 0)::int AS oudste_wachtrij_minuten,
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig')))  / 60, 0)::int AS oudste_bezig_minuten
FROM verzend_wachtrij WHERE vervoerder_code = 'rhenus_sftp';

-- ============================================================================
-- §6. order_documenten-spiegel (overgenomen uit mig 304, nu op verzend_wachtrij,
--     gegate op hst_api — alleen de HST-vrachtbrief-PDF hoort in DocumentenCompact;
--     SFTP-XML niet). Ná de backfill aangemaakt zodat backfill 'm niet vuurt.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_verzend_wachtrij_pdf_naar_order_documenten() RETURNS TRIGGER AS $$
DECLARE
  v_zending_nr       TEXT;
  v_primary_order_id BIGINT;
  v_filename         TEXT;
BEGIN
  -- Alleen de HST-vrachtbrief-PDF spiegelen (gedragsneutraal t.o.v. mig 304).
  IF NEW.vervoerder_code <> 'hst_api' THEN RETURN NEW; END IF;
  IF NEW.document_pad IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.document_pad IS NOT DISTINCT FROM NEW.document_pad THEN
    RETURN NEW;
  END IF;

  SELECT z.zending_nr, z.order_id INTO v_zending_nr, v_primary_order_id
    FROM zendingen z WHERE z.id = NEW.zending_id;
  IF v_zending_nr IS NULL OR v_primary_order_id IS NULL THEN
    RAISE NOTICE 'fn_verzend_wachtrij_pdf: zending % zonder nr/order_id, skip', NEW.zending_id;
    RETURN NEW;
  END IF;

  v_filename := 'HST-vrachtbrief-' || v_zending_nr || '.pdf';

  INSERT INTO order_documenten (
    order_id, bestandsnaam, storage_path, mime_type, omschrijving, geupload_op
  ) VALUES (
    v_primary_order_id, v_filename, NEW.document_pad, 'application/pdf',
    'HST vrachtbrief — OrderNumber ' || COALESCE(NEW.extern_referentie, '?'),
    COALESCE(NEW.sent_at, now())
  )
  ON CONFLICT (storage_path) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_verzend_wachtrij_pdf ON verzend_wachtrij;
CREATE TRIGGER trg_verzend_wachtrij_pdf
  AFTER INSERT OR UPDATE OF document_pad ON verzend_wachtrij
  FOR EACH ROW EXECUTE FUNCTION fn_verzend_wachtrij_pdf_naar_order_documenten();

COMMENT ON FUNCTION fn_verzend_wachtrij_pdf_naar_order_documenten() IS
  'ADR-0038 (overgenomen uit mig 304): spiegelt verzend_wachtrij.document_pad '
  'naar order_documenten voor de primaire order — alleen hst_api (PDF-vrachtbrief). '
  'Idempotent via ON CONFLICT (storage_path).';

-- ============================================================================
-- §7. Verifier-asserts (gedrag = oude per-carrier RPC's, op één rij geverifieerd
--     met een rollback-transactie zodat er geen testdata achterblijft).
-- ============================================================================
DO $$
DECLARE
  v_zending     BIGINT;
  v_id          BIGINT;
  v_status      verzend_status;
  v_retry       INTEGER;
  v_orig_status zending_status;
  v_orig_tt     TEXT;
BEGIN
  -- Pak een willekeurige bestaande zending (anders skip — lege DB/dev).
  SELECT id, status, track_trace INTO v_zending, v_orig_status, v_orig_tt
    FROM zendingen ORDER BY id LIMIT 1;
  IF v_zending IS NULL THEN
    RAISE NOTICE 'Mig 426 verifier overgeslagen — geen zendingen.';
    RETURN;
  END IF;

  -- De behavioural assert claimt de oudste hst_api-Wachtrij-rij; dat moet ÓNZE
  -- testrij zijn. Op een niet-gedrainde queue (dev/populated) zou claim een
  -- echte rij pakken → false failure. Daarom alleen op een schone hst_api-
  -- wachtrij (= de cutover-conditie, beslissing B); anders skippen.
  IF EXISTS (SELECT 1 FROM verzend_wachtrij
              WHERE vervoerder_code = 'hst_api' AND status IN ('Wachtrij','Bezig')) THEN
    RAISE NOTICE 'Mig 426 verifier: hst_api-wachtrij niet leeg — behavioural assert overgeslagen.';
    RETURN;
  END IF;

  -- enqueue → 1 Wachtrij-rij; tweede enqueue = no-op (idempotent).
  v_id := enqueue_transportorder(v_zending, NULL, 'hst_api', TRUE);
  IF v_id IS NULL THEN
    RAISE NOTICE 'Mig 426 verifier: zending % had al een actieve rij — skip behavioural assert.', v_zending;
    RETURN;
  END IF;
  IF enqueue_transportorder(v_zending, NULL, 'hst_api', TRUE) IS NOT NULL THEN
    RAISE EXCEPTION 'Mig 426: enqueue niet idempotent (tweede call gaf een id terug)';
  END IF;

  -- claim → Bezig.
  PERFORM claim_volgende_transportorder('hst_api');
  SELECT status INTO v_status FROM verzend_wachtrij WHERE id = v_id;
  IF v_status <> 'Bezig' THEN RAISE EXCEPTION 'Mig 426: claim zette status niet op Bezig (was %)', v_status; END IF;

  -- fout < max → terug naar Wachtrij + retry_count = 1.
  PERFORM markeer_transportorder_fout(v_id, 'test-fout', 3);
  SELECT status, retry_count INTO v_status, v_retry FROM verzend_wachtrij WHERE id = v_id;
  IF v_status <> 'Wachtrij' OR v_retry <> 1 THEN
    RAISE EXCEPTION 'Mig 426: fout<max gaf status=%/retry=% (verwacht Wachtrij/1)', v_status, v_retry;
  END IF;

  -- verstuurd zonder track_trace → Verstuurd, zending.track_trace ongemoeid
  -- (NULL-track_trace = Rhenus-gedrag). De status-flip Klaar→Onderweg kan de
  -- gekozen zending raken; we herstellen 'm hieronder volledig.
  PERFORM markeer_transportorder_verstuurd(v_id, 'TEST-REF', NULL, NULL);
  SELECT status INTO v_status FROM verzend_wachtrij WHERE id = v_id;
  IF v_status <> 'Verstuurd' THEN RAISE EXCEPTION 'Mig 426: verstuurd gaf status % (verwacht Verstuurd)', v_status; END IF;
  IF (SELECT track_trace FROM zendingen WHERE id = v_zending) IS DISTINCT FROM v_orig_tt THEN
    RAISE EXCEPTION 'Mig 426: NULL-track_trace wijzigde zending.track_trace (Rhenus-gedrag geschonden)';
  END IF;

  -- Net-nul opruimen: testrij weg + zending volledig terug (status kan geflipt zijn).
  DELETE FROM verzend_wachtrij WHERE id = v_id;
  UPDATE zendingen SET status = v_orig_status, track_trace = v_orig_tt WHERE id = v_zending;
  RAISE NOTICE 'Mig 426 verifier: enqueue/claim/fout/verstuurd OK (testrij + zending hersteld).';
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Handmatige verificatie na deploy (SQL Editor):
-- ============================================================================
-- 1. Backfill-telling klopt met de som van de oude tabellen:
--    SELECT
--      (SELECT count(*) FROM verzend_wachtrij) AS nieuw,
--      (SELECT count(*) FROM hst_transportorders)
--      + (SELECT count(*) FROM verhoek_transportorders)
--      + (SELECT count(*) FROM rhenus_transportorders) AS oud;
-- 2. Monitor toont per carrier:  SELECT * FROM verzend_monitor;
-- 3. Shim werkt:                 SELECT * FROM hst_verzend_monitor;
