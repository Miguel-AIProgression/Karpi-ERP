-- Migration 118: Factuur-queue + order-trigger
-- Als orders.status overgaat naar 'Verzonden' EN klant.factuurvoorkeur = 'per_zending',
-- wordt een queue-entry aangemaakt. Een edge function (via pg_cron, migratie 122) pikt deze op.

CREATE TYPE factuur_queue_status AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE factuur_queue (
  id BIGSERIAL PRIMARY KEY,
  debiteur_nr INTEGER NOT NULL REFERENCES debiteuren(debiteur_nr),
  order_ids BIGINT[] NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('per_zending', 'wekelijks')),
  status factuur_queue_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  factuur_id BIGINT REFERENCES facturen(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_factuur_queue_pending ON factuur_queue(created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION enqueue_factuur_bij_verzonden() RETURNS TRIGGER AS $$
DECLARE
  v_voorkeur factuurvoorkeur;
BEGIN
  -- Alleen reageren op transitie NAAR 'Verzonden'
  IF NEW.status <> 'Verzonden' OR OLD.status = 'Verzonden' THEN
    RETURN NEW;
  END IF;

  SELECT factuurvoorkeur INTO v_voorkeur
    FROM debiteuren WHERE debiteur_nr = NEW.debiteur_nr;

  -- 'wekelijks'-klanten worden door een cron-job opgepakt, niet hier.
  IF v_voorkeur = 'per_zending' THEN
    INSERT INTO factuur_queue (debiteur_nr, order_ids, type)
    VALUES (NEW.debiteur_nr, ARRAY[NEW.id], 'per_zending');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_factuur
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_factuur_bij_verzonden();
