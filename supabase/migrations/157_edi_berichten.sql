-- Migratie 157: EDI-berichten + queue-RPCs
--
-- Centrale tabel voor alle inkomende én uitgaande EDI-berichten via Transus.
-- Plan: docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md
--
-- Architectuur:
--   - INKOMEND: edge function `transus-poll` doet M10110, schrijft hier rij met richting='in',
--     parseert payload, optioneel insert order via apart RPC, M10300-ack zet status='Verwerkt'.
--   - UITGAAND: trigger op orders/facturen/zendingen schrijft rij met richting='uit' en
--     status='Wachtrij'. Edge function `transus-send` claimt rijen, bouwt payload, M10100-stuurt.
--
-- Idempotent.

-- ============================================================================
-- Status-enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE edi_bericht_status AS ENUM (
    'Wachtrij',     -- uitgaand: nog te versturen
    'Bezig',        -- uitgaand: claim_volgende_uitgaand heeft 'm gepakt, M10100 loopt
    'Verstuurd',    -- uitgaand: M10100 returneerde TransactionID
    'Verwerkt',     -- inkomend: payload geparseerd + opgeslagen, M10300 ge-ackt
    'Fout',         -- handler retourneerde een fout (parse, build, of API)
    'Geannuleerd'   -- handmatig geblokkeerd
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Berichttype-codes
-- We gebruiken expliciete TEXT met CHECK (geen enum) zodat het flexibel is voor
-- toekomstige berichttypes (PRICAT, ORDCHG, etc.) zonder migratie-overhead.
-- ============================================================================

-- ============================================================================
-- Hoofdtabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS edi_berichten (
  id                 BIGSERIAL PRIMARY KEY,
  -- Richting + type
  richting           TEXT NOT NULL CHECK (richting IN ('in', 'uit')),
  berichttype        TEXT NOT NULL CHECK (berichttype IN (
    'order',         -- inkomend: ORDERS / D96A
    'orderbev',      -- uitgaand: ORDRSP / orderbevestiging
    'factuur',       -- uitgaand: INVOIC
    'verzendbericht' -- uitgaand: DESADV
  )),
  status             edi_bericht_status NOT NULL DEFAULT 'Wachtrij',
  -- Transus-correlatie
  transactie_id      TEXT,  -- inkomend: M10110.TransactionID; uitgaand: M10100.TransactionID na verzenden
  -- Onze tegenpartij
  debiteur_nr        INTEGER REFERENCES debiteuren(debiteur_nr),
  -- Optionele koppelingen — afhankelijk van berichttype
  order_id           BIGINT REFERENCES orders(id),
  factuur_id         BIGINT REFERENCES facturen(id),
  zending_id         BIGINT,  -- FK pas later (zendingen-tabel veld nog niet aanwezig in V1)
  -- Voor uitgaand bron-tracking — voorkomt dubbel versturen vanuit triggers
  bron_tabel         TEXT,    -- 'orders' / 'facturen' / 'zendingen'
  bron_id            BIGINT,  -- PK van het bron-record dat de trigger triggerde
  -- Payload-data
  payload_raw        TEXT,    -- Letterlijke fixed-width / EDIFACT / XML zoals ontvangen of verstuurd
  payload_parsed     JSONB,   -- Geparseerde data — voor inkomend door parser, voor uitgaand door trigger
  -- Test-flag
  is_test            BOOLEAN NOT NULL DEFAULT FALSE,
  -- Foutbehandeling
  retry_count        INTEGER NOT NULL DEFAULT 0,
  error_msg          TEXT,
  -- Acknowledge-spoor (M10300)
  ack_status         INTEGER, -- 0 = ge-ackt OK, 1 = ge-ackt met fout, 2 = pending
  ack_details        TEXT,
  -- Timestamps
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ,  -- moment van M10100/M10110 succes
  acked_at           TIMESTAMPTZ,  -- moment van M10300 succes
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexen
CREATE UNIQUE INDEX IF NOT EXISTS uk_edi_berichten_transactie_id
  ON edi_berichten (transactie_id) WHERE transactie_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edi_berichten_status
  ON edi_berichten (status, richting);

CREATE INDEX IF NOT EXISTS idx_edi_berichten_debiteur
  ON edi_berichten (debiteur_nr, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_edi_berichten_order
  ON edi_berichten (order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edi_berichten_factuur
  ON edi_berichten (factuur_id) WHERE factuur_id IS NOT NULL;

-- Idempotentie voor uitgaand: één actief bericht per (berichttype, bron_tabel, bron_id).
-- Bij retry/Fout-Wachtrij-cycle blijft hetzelfde rij; trigger schrijft alleen als geen bestaande
-- 'Wachtrij'/'Bezig'/'Verstuurd'/'Verwerkt' rij voor deze bron.
CREATE UNIQUE INDEX IF NOT EXISTS uk_edi_berichten_uitgaand_actief
  ON edi_berichten (berichttype, bron_tabel, bron_id)
  WHERE richting = 'uit' AND status NOT IN ('Fout', 'Geannuleerd');

COMMENT ON TABLE edi_berichten IS
  'Centrale audit-/queue-tabel voor alle EDI-berichten via Transus (in én uit). '
  'Inkomend (richting=in): door transus-poll edge function. '
  'Uitgaand (richting=uit): door triggers op orders/facturen/zendingen, '
  'verstuurd door transus-send edge function.';

-- updated_at-trigger
CREATE OR REPLACE FUNCTION set_edi_berichten_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_edi_berichten_updated_at ON edi_berichten;
CREATE TRIGGER trg_edi_berichten_updated_at
  BEFORE UPDATE ON edi_berichten
  FOR EACH ROW EXECUTE FUNCTION set_edi_berichten_updated_at();

-- RLS
ALTER TABLE edi_berichten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS edi_berichten_select ON edi_berichten;
CREATE POLICY edi_berichten_select
  ON edi_berichten FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS edi_berichten_insert ON edi_berichten;
CREATE POLICY edi_berichten_insert
  ON edi_berichten FOR INSERT
  TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS edi_berichten_update ON edi_berichten;
CREATE POLICY edi_berichten_update
  ON edi_berichten FOR UPDATE
  TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS edi_berichten_delete ON edi_berichten;
CREATE POLICY edi_berichten_delete
  ON edi_berichten FOR DELETE
  TO authenticated USING (TRUE);

-- ============================================================================
-- RPC's voor edge functions
-- ============================================================================

-- log_edi_inkomend: edge function transus-poll roept dit aan na ontvangst van een M10110-bericht.
-- Idempotent op transactie_id (UNIQUE-conflict → no-op return van bestaande id).
CREATE OR REPLACE FUNCTION log_edi_inkomend(
  p_transactie_id   TEXT,
  p_berichttype     TEXT,
  p_payload_raw     TEXT,
  p_payload_parsed  JSONB,
  p_debiteur_nr     INTEGER,
  p_is_test         BOOLEAN,
  p_initial_status  edi_bericht_status DEFAULT 'Verwerkt'
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  -- Check op bestaande rij (idempotent)
  SELECT id INTO v_id FROM edi_berichten
   WHERE transactie_id = p_transactie_id AND richting = 'in';

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO edi_berichten (
    richting, berichttype, status, transactie_id,
    debiteur_nr, payload_raw, payload_parsed, is_test, sent_at
  ) VALUES (
    'in', p_berichttype, p_initial_status, p_transactie_id,
    p_debiteur_nr, p_payload_raw, p_payload_parsed, p_is_test, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_edi_inkomend(TEXT, TEXT, TEXT, JSONB, INTEGER, BOOLEAN, edi_bericht_status)
  TO authenticated;

COMMENT ON FUNCTION log_edi_inkomend IS
  'Idempotent inserter voor inkomende EDI-berichten. Roept transus-poll edge function aan. '
  'Bestaande transactie_id → return bestaande id (no-op).';

-- markeer_edi_ack: na succesvolle M10300-call.
CREATE OR REPLACE FUNCTION markeer_edi_ack(
  p_id           BIGINT,
  p_ack_status   INTEGER,
  p_ack_details  TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE edi_berichten
     SET ack_status = p_ack_status,
         ack_details = p_ack_details,
         acked_at = now(),
         status = CASE
           WHEN p_ack_status = 0 THEN 'Verwerkt'::edi_bericht_status
           WHEN p_ack_status = 1 THEN 'Fout'::edi_bericht_status
           ELSE status
         END,
         error_msg = CASE
           WHEN p_ack_status = 1 THEN p_ack_details
           ELSE error_msg
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_edi_ack(BIGINT, INTEGER, TEXT) TO authenticated;

-- enqueue_edi_uitgaand: triggers en handmatige aanroepen.
-- Idempotent via uk_edi_berichten_uitgaand_actief partial index.
CREATE OR REPLACE FUNCTION enqueue_edi_uitgaand(
  p_berichttype     TEXT,
  p_debiteur_nr     INTEGER,
  p_bron_tabel      TEXT,
  p_bron_id         BIGINT,
  p_payload_parsed  JSONB,
  p_order_id        BIGINT DEFAULT NULL,
  p_factuur_id      BIGINT DEFAULT NULL,
  p_zending_id      BIGINT DEFAULT NULL,
  p_is_test         BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO edi_berichten (
    richting, berichttype, status,
    debiteur_nr, bron_tabel, bron_id,
    order_id, factuur_id, zending_id,
    payload_parsed, is_test
  ) VALUES (
    'uit', p_berichttype, 'Wachtrij',
    p_debiteur_nr, p_bron_tabel, p_bron_id,
    p_order_id, p_factuur_id, p_zending_id,
    p_payload_parsed, p_is_test
  )
  ON CONFLICT (berichttype, bron_tabel, bron_id) WHERE richting = 'uit' AND status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_edi_uitgaand(TEXT, INTEGER, TEXT, BIGINT, JSONB, BIGINT, BIGINT, BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_edi_uitgaand IS
  'Plaatst een uitgaand EDI-bericht op de wachtrij. Idempotent — als al een actief '
  'bericht bestaat voor dezelfde (berichttype, bron_tabel, bron_id) wordt geen nieuwe rij aangemaakt.';

-- claim_volgende_uitgaand: edge function transus-send roept dit aan in een loop.
-- Pakt 1 rij FOR UPDATE SKIP LOCKED — meerdere workers kunnen parallel draaien.
CREATE OR REPLACE FUNCTION claim_volgende_uitgaand()
RETURNS edi_berichten AS $$
DECLARE
  v_row edi_berichten;
BEGIN
  UPDATE edi_berichten
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM edi_berichten
      WHERE richting = 'uit' AND status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_uitgaand() TO authenticated;

-- markeer_edi_verstuurd: na succesvol M10100.
CREATE OR REPLACE FUNCTION markeer_edi_verstuurd(
  p_id              BIGINT,
  p_transactie_id   TEXT,
  p_payload_raw     TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE edi_berichten
     SET status = 'Verstuurd',
         transactie_id = p_transactie_id,
         payload_raw = p_payload_raw,
         sent_at = now(),
         error_msg = NULL
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_edi_verstuurd(BIGINT, TEXT, TEXT) TO authenticated;

-- markeer_edi_fout: bij parse/build/API-fout — retried tot max_retries dan permanent Fout.
CREATE OR REPLACE FUNCTION markeer_edi_fout(
  p_id          BIGINT,
  p_error       TEXT,
  p_max_retries INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM edi_berichten WHERE id = p_id;

  UPDATE edi_berichten
     SET retry_count = retry_count + 1,
         error_msg = p_error,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::edi_bericht_status
           ELSE 'Wachtrij'::edi_bericht_status
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_edi_fout(BIGINT, TEXT, INTEGER) TO authenticated;
