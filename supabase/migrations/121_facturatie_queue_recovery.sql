-- Migration 121: Recovery van stuck factuur_queue items
-- Als factuur-verzenden edge function crasht tussen 'processing' markeren en finalisatie,
-- blijft item stuck. Deze functie zet items >10 min in 'processing' terug op 'pending'.

ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Edge function factuur-verzenden zet deze kolom bij 'processing' en clearet hem op done/failed/pending.

CREATE OR REPLACE FUNCTION recover_stuck_factuur_queue() RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE factuur_queue
    SET status = 'pending', processing_started_at = NULL
  WHERE status = 'processing'
    AND processing_started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION recover_stuck_factuur_queue IS
  'Zet factuur_queue items die >10 min in processing staan terug op pending. '
  'Aangeroepen door pg_cron elke 5 min (migratie 122).';
