-- Migratie 171: hst_transportorders + HST-specifieke RPC's
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
--
-- HST-adapter-implementatie. Bevat alleen wat HST nodig heeft:
-- request/response JSONB, HTTP-statuscode, HST extern transportOrderId, retry.
-- Géén berichttype-discriminator (alle rijen zijn transportorders).
-- Géén vervoerder_code (deze tabel ÍS HST).
-- Toekomstige Rhenus/Verhoek (EDI) hergebruiken bestaande edi_berichten met
-- berichttype='verzendbericht' — geen wijziging aan deze tabel.
--
-- Idempotent.

-- ============================================================================
-- Status-enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE hst_transportorder_status AS ENUM (
    'Wachtrij',     -- nog te versturen
    'Bezig',        -- claim_volgende_hst_transportorder heeft 'm gepakt
    'Verstuurd',    -- HST gaf 200 + transportOrderId
    'Fout',         -- retry_count >= max
    'Geannuleerd'   -- handmatig geblokkeerd
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Hoofdtabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS hst_transportorders (
  id                          BIGSERIAL PRIMARY KEY,
  -- Onze koppeling
  zending_id                  BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  debiteur_nr                 INTEGER REFERENCES debiteuren(debiteur_nr),
  -- Status
  status                      hst_transportorder_status NOT NULL DEFAULT 'Wachtrij',
  -- HST-specifieke externe correlatie
  extern_transport_order_id   TEXT,            -- HST.transportOrderId uit response
  extern_tracking_number      TEXT,            -- HST.trackingNumber uit response (mogelijk)
  -- Payloads
  request_payload             JSONB,           -- door builder gevuld bij claim of bij enqueue
  response_payload            JSONB,
  response_http_code          INTEGER,
  -- Foutbehandeling
  retry_count                 INTEGER NOT NULL DEFAULT 0,
  error_msg                   TEXT,
  -- Test-flag (acceptatie-omgeving)
  is_test                     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                     TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hst_to_status
  ON hst_transportorders (status);
CREATE INDEX IF NOT EXISTS idx_hst_to_zending
  ON hst_transportorders (zending_id);
CREATE INDEX IF NOT EXISTS idx_hst_to_debiteur
  ON hst_transportorders (debiteur_nr, created_at DESC);

-- Idempotentie: één actieve transportorder per zending.
-- Bij Fout/Geannuleerd valt de rij buiten de index — retry via verstuurZendingOpnieuw
-- moet de oude rij eerst op Geannuleerd zetten (zie verstuurZendingOpnieuw in Task 3.1).
CREATE UNIQUE INDEX IF NOT EXISTS uk_hst_to_zending_actief
  ON hst_transportorders (zending_id)
  WHERE status NOT IN ('Fout', 'Geannuleerd');

COMMENT ON TABLE hst_transportorders IS
  'HST-adapter: één rij per transportorder die naar HST is/wordt verstuurd. '
  'HST-specifiek (geen multi-vervoerder-abstractie). EDI-vervoerders gebruiken '
  'edi_berichten. Plan: 2026-05-01-logistiek-hst-api-koppeling.md.';

-- ============================================================================
-- updated_at-trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION set_hst_to_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hst_to_updated_at ON hst_transportorders;
CREATE TRIGGER trg_hst_to_updated_at
  BEFORE UPDATE ON hst_transportorders
  FOR EACH ROW EXECUTE FUNCTION set_hst_to_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE hst_transportorders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hst_to_all ON hst_transportorders;
CREATE POLICY hst_to_all ON hst_transportorders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- HST-adapter RPC's
-- ============================================================================

-- enqueue_hst_transportorder: HST-adapter-RPC. Wordt aangeroepen door
-- enqueue_zending_naar_vervoerder (mig 172) als vervoerder_code='hst_api'.
CREATE OR REPLACE FUNCTION enqueue_hst_transportorder(
  p_zending_id   BIGINT,
  p_debiteur_nr  INTEGER,
  p_is_test      BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO hst_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_hst_transportorder(BIGINT, INTEGER, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_hst_transportorder IS
  'HST-adapter: plaatst transportorder op wachtrij. Idempotent — als al een '
  'actieve rij voor de zending bestaat, no-op. Request_payload wordt pas '
  'gebouwd door de edge function bij claim (zo blijft data bij verzending vers).';

-- claim_volgende_hst_transportorder: edge function hst-send roept dit aan in een loop.
-- Pakt 1 rij FOR UPDATE SKIP LOCKED — meerdere workers kunnen parallel draaien.
CREATE OR REPLACE FUNCTION claim_volgende_hst_transportorder()
RETURNS hst_transportorders AS $$
DECLARE
  v_row hst_transportorders;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM hst_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_hst_transportorder() TO authenticated;

-- markeer_hst_verstuurd: na 200-respons. Schrijft tracking terug op zending.
CREATE OR REPLACE FUNCTION markeer_hst_verstuurd(
  p_id                          BIGINT,
  p_extern_transport_order_id   TEXT,
  p_extern_tracking_number      TEXT,
  p_request_payload             JSONB,
  p_response_payload            JSONB,
  p_response_http_code          INTEGER
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Verstuurd',
         extern_transport_order_id = p_extern_transport_order_id,
         extern_tracking_number = p_extern_tracking_number,
         request_payload = p_request_payload,
         response_payload = p_response_payload,
         response_http_code = p_response_http_code,
         sent_at = now(),
         error_msg = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Tracking + status doorzetten naar zending
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_extern_tracking_number, p_extern_transport_order_id),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_hst_verstuurd(BIGINT, TEXT, TEXT, JSONB, JSONB, INTEGER) TO authenticated;

-- markeer_hst_fout: bij API/HTTP-fout — retried tot max_retries dan permanent Fout.
CREATE OR REPLACE FUNCTION markeer_hst_fout(
  p_id                  BIGINT,
  p_error               TEXT,
  p_request_payload     JSONB DEFAULT NULL,
  p_response_payload    JSONB DEFAULT NULL,
  p_response_http_code  INTEGER DEFAULT NULL,
  p_max_retries         INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM hst_transportorders WHERE id = p_id;

  UPDATE hst_transportorders
     SET retry_count = retry_count + 1,
         error_msg = p_error,
         request_payload = COALESCE(p_request_payload, request_payload),
         response_payload = p_response_payload,
         response_http_code = p_response_http_code,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::hst_transportorder_status
           ELSE 'Wachtrij'::hst_transportorder_status
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_hst_fout(BIGINT, TEXT, JSONB, JSONB, INTEGER, INTEGER) TO authenticated;
