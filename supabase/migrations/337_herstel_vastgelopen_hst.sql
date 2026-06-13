-- Migratie 337: reaper voor vastgelopen HST-transportorders
--
-- claim_volgende_hst_transportorder (mig 171) zet status='Bezig'. Crasht/timeout't
-- de edge function vóór markeer_hst_verstuurd/fout, dan blijft de rij eeuwig
-- 'Bezig' — nooit opnieuw geclaimd (claim pakt alleen 'Wachtrij'), nooit gealerteerd.
-- Deze RPC zet stale 'Bezig'-rijen terug op 'Wachtrij' zodat de volgende cron-run
-- ze oppakt. Zelfhelend; aangeroepen boven in hst-send (geen extra cron).
--
-- Idempotent.

CREATE OR REPLACE FUNCTION herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_hst(INTEGER) TO authenticated;

COMMENT ON FUNCTION herstel_vastgelopen_hst IS
  'Reaper (mig 337): zet HST-transportorders die >p_minuten in Bezig hangen terug '
  'op Wachtrij. Aangeroepen boven in hst-send elke run; ook handmatig bruikbaar.';

NOTIFY pgrst, 'reload schema';
