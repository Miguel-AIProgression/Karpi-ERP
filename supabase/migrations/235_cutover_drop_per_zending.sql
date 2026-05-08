-- Migratie 235: cutover — bundel-driven enqueue + drop per_zending-pad
--
-- ADR-0010: factuur volgt bundel-zending. Cron (mig 122/231) wordt
-- herschreven om per (debiteur, week) één queue-rij PER BUNDEL-ZENDING
-- te maken — i.p.v. één queue-rij voor alle orders van die week.
--
-- LET OP: de oude trigger heet sinds mig 223 niet meer trg_enqueue_factuur
-- ON orders, maar trg_enqueue_factuur_op_event ON order_events met
-- procedure enqueue_factuur_voor_event(). Dáár dropt deze migratie.
--
-- VOORWAARDE: factuur_queue mag geen pending/processing rijen meer hebben
-- met zending_id=NULL. Verifieer met:
--   SELECT type, COUNT(*) FILTER (WHERE zending_id IS NULL) AS legacy_count
--     FROM factuur_queue WHERE status IN ('pending', 'processing') GROUP BY type;
--   -- Verwacht: legacy_count = 0
--
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS.

-- Hard guard tegen voortijdig draaien.
DO $$
DECLARE
  v_legacy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_legacy_count
    FROM factuur_queue
   WHERE status IN ('pending', 'processing')
     AND zending_id IS NULL;
  IF v_legacy_count > 0 THEN
    RAISE EXCEPTION 'Mig 235 cutover: % legacy queue-rijen zonder zending_id. Drain eerst.',
      v_legacy_count
      USING HINT = 'Wacht tot factuur-verzenden de oude rijen heeft afgewikkeld, of zet ze handmatig op failed.';
  END IF;
END;
$$;

------------------------------------------------------------------------
-- 1. enqueue_wekelijkse_verzamelfacturen — bundel-driven
------------------------------------------------------------------------
-- Per bundel-zending één queue-rij; aggregatie via zending_orders M2M
-- (mig 222 backfill vulde ook 1-op-1, dus alle paden uniform).
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_doel_week TEXT := verzendweek_voor_datum((CURRENT_DATE - INTERVAL '7 days')::DATE);
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, zending_id, verzendweek)
  SELECT
    o.debiteur_nr,
    array_agg(zo.order_id ORDER BY zo.order_id),
    z.id,
    z.verzendweek
  FROM zendingen z
  JOIN zending_orders zo ON zo.zending_id = z.id
  JOIN orders o          ON o.id = zo.order_id
  WHERE z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
    AND z.verzendweek = v_doel_week
    AND NOT EXISTS (
      SELECT 1 FROM factuur_queue fq
       WHERE fq.zending_id = z.id
         AND fq.status IN ('pending', 'processing', 'done')
    )
    -- Skip bundels waarvan ÉÉN van de orders al gefactureerd is. Dat
    -- voorkomt dat een handmatig pre-gefactureerde order stilletjes uit
    -- de array_agg verdwijnt en de bundel met partial set enqueue't.
    -- Strikter dan mig 231 (die filterde per-order); hier per-bundel.
    AND NOT EXISTS (
      SELECT 1 FROM zending_orders zo2
        JOIN factuur_regels fr ON fr.order_id = zo2.order_id
       WHERE zo2.zending_id = z.id
    )
  GROUP BY z.id, o.debiteur_nr, z.verzendweek;
END;
$$;

COMMENT ON FUNCTION enqueue_wekelijkse_verzamelfacturen IS
  'Mig 235 (ADR-0010): één queue-rij per bundel-zending van vorige week '
  'zonder factuur. Aggregatie via zending_orders M2M. Vervangt de '
  '(debiteur, week)-aggregatie van mig 231.';

------------------------------------------------------------------------
-- 2. Drop event-driven enqueue-trigger (mig 223 ADR-0007)
------------------------------------------------------------------------
-- Mig 223 verving mig 118's trigger op orders.status door deze event-
-- driven variant op order_events. Per_zending-pad vervalt nu volledig
-- (ADR-0010): geen trigger meer nodig, wekelijkse cron is de enige
-- enqueue-bron.
DROP TRIGGER  IF EXISTS trg_enqueue_factuur_op_event ON order_events;
DROP FUNCTION IF EXISTS enqueue_factuur_voor_event() CASCADE;

-- factuur_queue.bron_event_id (mig 223 audit-FK) blijft staan. Bestaande
-- rijen die ernaar verwijzen blijven valide; nieuwe rijen via cron vullen
-- 'm niet (NULL = "via wekelijkse cron, niet via event"). De FK is
-- daarmee informatief; cleanup-kandidaat voor een toekomstige opruim-mig.

------------------------------------------------------------------------
-- 3. Drop debiteuren.factuurvoorkeur-kolom + enum-type
------------------------------------------------------------------------
-- Frontend stopt al met lezen vóór deze migratie (Tasks 6-7). Edge
-- function gebruikt 'm niet meer (Task 5). Het enum-type heet
-- 'factuurvoorkeur' (mig 117), zonder _enum-suffix.
ALTER TABLE debiteuren DROP COLUMN IF EXISTS factuurvoorkeur;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factuurvoorkeur') THEN
    DROP TYPE factuurvoorkeur;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
