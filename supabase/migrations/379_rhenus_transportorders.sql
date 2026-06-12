-- Migratie 379: rhenus_transportorders + RPC's + rhenus-dispatch + monitor
-- Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
-- ADR-0032. Spiegelt het Verhoek-adapterpatroon (mig 375 <- 171/337/338).
-- Verschil met Verhoek: geen track_trace_id — het RHE-formaat kent geen
-- T&T-slot (statusterugkoppeling via Rhenus' /out-map staat op de V2-backlog).
--
-- Idempotent. Vereist mig 375 (sftp-tak in de dispatch) en mig 378 (vervoerder).

-- ============================================================================
-- 1. Status-enum + tabel
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE rhenus_transportorder_status AS ENUM (
    'Wachtrij', 'Bezig', 'Verstuurd', 'Fout', 'Geannuleerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rhenus_transportorders (
  id               BIGSERIAL PRIMARY KEY,
  zending_id       BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  debiteur_nr      INTEGER REFERENCES debiteuren(debiteur_nr),
  status           rhenus_transportorder_status NOT NULL DEFAULT 'Wachtrij',
  -- Correlatie: bestandsnaam op de SFTP; entityIdentification=zending_nr is
  -- de zoeksleutel richting Rhenus customer service.
  bestandsnaam     TEXT,
  xml_storage_path TEXT,            -- kopie in storage (order-documenten/rhenus-xml/)
  request_xml      TEXT,            -- laatste verstuurde XML (volledige historie: externe_payloads)
  retry_count      INTEGER NOT NULL DEFAULT 0,
  error_msg        TEXT,
  is_test          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rhenus_to_status  ON rhenus_transportorders (status);
CREATE INDEX IF NOT EXISTS idx_rhenus_to_zending ON rhenus_transportorders (zending_id);

-- Idempotentie: één actieve transportorder per zending (mig 171-patroon).
CREATE UNIQUE INDEX IF NOT EXISTS uk_rhenus_to_zending_actief
  ON rhenus_transportorders (zending_id)
  WHERE status NOT IN ('Fout', 'Geannuleerd');

COMMENT ON TABLE rhenus_transportorders IS
  'Rhenus-adapter: één rij per GS1-XML-bestand dat via SFTP naar Rhenus is/wordt '
  'verstuurd (ADR-0032). Spiegelt verhoek_transportorders. Historie van pogingen: '
  'externe_payloads kanaal=''rhenus''.';

CREATE OR REPLACE FUNCTION set_rhenus_to_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rhenus_to_updated_at ON rhenus_transportorders;
CREATE TRIGGER trg_rhenus_to_updated_at
  BEFORE UPDATE ON rhenus_transportorders
  FOR EACH ROW EXECUTE FUNCTION set_rhenus_to_updated_at();

ALTER TABLE rhenus_transportorders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rhenus_to_all ON rhenus_transportorders;
CREATE POLICY rhenus_to_all ON rhenus_transportorders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- 2. Adapter-RPC's (spiegel mig 375)
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_rhenus_transportorder(
  p_zending_id  BIGINT,
  p_debiteur_nr INTEGER,
  p_is_test     BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO rhenus_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_rhenus_transportorder(BIGINT, INTEGER, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION claim_volgende_rhenus_transportorder()
RETURNS rhenus_transportorders AS $$
DECLARE
  v_row rhenus_transportorders;
BEGIN
  UPDATE rhenus_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM rhenus_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_rhenus_transportorder() TO authenticated;

CREATE OR REPLACE FUNCTION markeer_rhenus_verstuurd(
  p_id               BIGINT,
  p_bestandsnaam     TEXT,
  p_xml_storage_path TEXT,
  p_request_xml      TEXT
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE rhenus_transportorders
     SET status           = 'Verstuurd',
         bestandsnaam     = p_bestandsnaam,
         xml_storage_path = p_xml_storage_path,
         request_xml      = p_request_xml,
         sent_at          = now(),
         error_msg        = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Status doorzetten naar zending (mig 171-patroon). Geen track_trace:
  -- het RHE-formaat kent geen T&T-slot.
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_rhenus_verstuurd(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION markeer_rhenus_fout(
  p_id          BIGINT,
  p_error       TEXT,
  p_request_xml TEXT DEFAULT NULL,
  p_max_retries INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM rhenus_transportorders WHERE id = p_id;

  UPDATE rhenus_transportorders
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         request_xml = COALESCE(p_request_xml, request_xml),
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::rhenus_transportorder_status
           ELSE 'Wachtrij'::rhenus_transportorder_status
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_rhenus_fout(BIGINT, TEXT, TEXT, INTEGER) TO authenticated;

-- Self-healing reaper (spiegel mig 337).
CREATE OR REPLACE FUNCTION herstel_vastgelopen_rhenus(p_minuten INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE rhenus_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_rhenus(INTEGER) TO authenticated;

-- ============================================================================
-- 3. Dispatch: rhenus_sftp-case in de 'sftp'-tak van
--    enqueue_zending_naar_vervoerder. Volledige body = mig 375-versie +
--    WHEN 'rhenus_sftp'. Géén andere wijzigingen.
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
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

  SELECT actief, type INTO v_actief, v_type
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'sftp' THEN
      CASE v_vervoerder_code
        WHEN 'verhoek_sftp' THEN
          PERFORM enqueue_verhoek_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_verhoek';
        WHEN 'rhenus_sftp' THEN
          PERFORM enqueue_rhenus_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_rhenus';
        ELSE
          RAISE NOTICE 'SFTP-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter van de gekozen vervoerder. '
  'Sinds mig 379: rhenus_sftp-case in de sftp-tak (ADR-0032), naast verhoek_sftp '
  '(mig 375, ADR-0031). Verder identiek aan mig 210 (regel-evaluator, print-tak, '
  'afhalen-skip).';

-- ============================================================================
-- 4. Monitor-view (spiegel mig 338/375) — UI-paneel volgt in een later plan.
-- ============================================================================
CREATE OR REPLACE VIEW rhenus_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::INT AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::INT                                       AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::INT                                   AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::INT                                      AS bezig,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60,
    0)::INT                                                                           AS oudste_wachtrij_minuten,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig'))) / 60,
    0)::INT                                                                           AS oudste_bezig_minuten
FROM rhenus_transportorders;

COMMENT ON VIEW rhenus_verzend_monitor IS
  'Cron-health Rhenus-verzending (spiegel verhoek_verzend_monitor, mig 375). '
  'oudste_wachtrij_minuten hoog = verzend-cron staat stil.';

GRANT SELECT ON rhenus_verzend_monitor TO authenticated;

NOTIFY pgrst, 'reload schema';
