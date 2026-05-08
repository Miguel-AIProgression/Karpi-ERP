-- Migratie 231: factuur_queue krijgt verzendweek-dimensie + cron herziet aggregatie
--
-- Mig 122 (`enqueue_wekelijkse_verzamelfacturen`) groepeerde alle
-- niet-gefactureerde Verzonden orders per debiteur in 1 queue-rij — ongeacht
-- in welke verzendweek ze daadwerkelijk werden verstuurd. Dat is verkeerd voor
-- klanten die meerdere weken achterlopen (bv. door een betalingsdiscussie):
-- dan worden orders uit week 21 én 22 op één factuur gegooid.
--
-- Met week-aware bundeling (mig 228-230) hebben we sowieso een verzendweek-
-- snapshot beschikbaar (`zendingen.verzendweek` óf `verzendweek_voor_datum
-- (orders.afleverdatum)`). Deze migratie maakt de cron-job per (debiteur,
-- verzendweek) groeperen en voegt de week toe aan factuur_queue zodat de
-- drain-edge-function (mig 232 + edge function update) hem mee kan geven aan
-- de wekelijkse RPC.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.

------------------------------------------------------------------------
-- 1. Kolom: factuur_queue.verzendweek
------------------------------------------------------------------------
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS verzendweek TEXT;

-- Soft check: bij type='wekelijks' moet verzendweek gezet zijn (bij
-- per_zending mag hij NULL zijn). We doen geen CHECK-constraint op de
-- bestaande tabel om backfill-ruis te voorkomen voor legacy 'wekelijks'-
-- rijen die vóór mig 231 zonder week zijn aangemaakt.
COMMENT ON COLUMN factuur_queue.verzendweek IS
  'Mig 231: ISO-week (YYYY-Www) van de te-factureren orders. Bij '
  'type=''wekelijks'' wordt deze door de cron gevuld; bij ''per_zending'' '
  'NULL. De drain-edge-function gebruikt hem om genereer_factuur_voor_week '
  '(mig 232) aan te roepen i.p.v. genereer_factuur.';

-- Index helpt de cron-idempotentie-check (NOT EXISTS subquery zou anders
-- elke maandag een seq-scan over factuur_regels.order_id forceren).
CREATE INDEX IF NOT EXISTS idx_factuur_queue_wekelijks_week
  ON factuur_queue(debiteur_nr, verzendweek)
  WHERE type = 'wekelijks';

------------------------------------------------------------------------
-- 2. Herzie enqueue_wekelijkse_verzamelfacturen — per (debiteur, week)
------------------------------------------------------------------------
-- Wijzigingen t.o.v. mig 122:
--   · GROUP BY krijgt verzendweek_voor_datum(o.afleverdatum) erbij
--   · Filtert op verzendweek = vorige ISO-week (CURRENT_DATE - 7d)
--   · INSERT vult verzendweek-kolom
--   · NOT EXISTS-check verhindert dubbele rijen voor dezelfde (debiteur, week)
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_doel_week TEXT := verzendweek_voor_datum((CURRENT_DATE - INTERVAL '7 days')::DATE);
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, verzendweek)
  SELECT
    o.debiteur_nr,
    array_agg(o.id ORDER BY o.id),
    'wekelijks',
    v_doel_week
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE d.factuurvoorkeur = 'wekelijks'
    AND o.status = 'Verzonden'
    AND verzendweek_voor_datum(o.afleverdatum) = v_doel_week
    AND NOT EXISTS (
      SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
    )
    -- Bescherm tegen dubbele cron-runs binnen dezelfde week (bv. cron
    -- vuurde maandag + handmatige aanroep dinsdag): als er al een queue-
    -- rij bestaat voor (debiteur, week) die niet failed/done is, sla over.
    AND NOT EXISTS (
      SELECT 1 FROM factuur_queue fq
       WHERE fq.debiteur_nr = o.debiteur_nr
         AND fq.type = 'wekelijks'
         AND fq.verzendweek = v_doel_week
         AND fq.status IN ('pending', 'processing', 'done')
    )
  GROUP BY o.debiteur_nr
  HAVING COUNT(*) > 0;
END;
$$;

COMMENT ON FUNCTION enqueue_wekelijkse_verzamelfacturen IS
  'Mig 231 (week-aware): plaatst per (klant, verzendweek) één queue-item met '
  'alle nog niet gefactureerde Verzonden orders van die week. Filtert op '
  'verzendweek = vorige ISO-week (cron draait maandagochtend voor week N-1). '
  'Idempotent: bestaande queue-rijen voor dezelfde (debiteur, week) blokkeren '
  'opnieuw enqueue. Aangeroepen door pg_cron-job ''facturatie-wekelijks''.';

NOTIFY pgrst, 'reload schema';
