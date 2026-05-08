-- Migratie 240: cleanup — drop oude factuur-RPCs en factuur_queue.type
--
-- ADR-0010: na de cutover (mig 235) en drain van alle legacy queue-rijen
-- bestaan er geen callers meer voor genereer_factuur_voor_week (mig 232)
-- en genereer_factuur (mig 119/124/227). Drop ze. factuur_queue.type-
-- kolom verliest z'n functie en wordt ook gedropt.
--
-- factuur_queue.zending_id wordt NOT NULL gemaakt (alle nieuwe rijen
-- hebben hem; legacy is gedraind).
--
-- Mig-nummer-noot: plan-spec was mig 237, maar 237/238/239 zijn door
-- andere features in gebruik genomen. 240 is het eerstvolgende vrije
-- nummer.
--
-- Idempotent: DROP IF EXISTS / ALTER COLUMN.

------------------------------------------------------------------------
-- 1. Drop oude factuur-RPCs
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS genereer_factuur_voor_week(INTEGER, TEXT);
DROP FUNCTION IF EXISTS genereer_factuur(BIGINT[]);

------------------------------------------------------------------------
-- 2. factuur_queue.type-kolom dropt; zending_id wordt NOT NULL
------------------------------------------------------------------------
DROP INDEX  IF EXISTS idx_factuur_queue_wekelijks_week;
ALTER TABLE factuur_queue DROP COLUMN IF EXISTS type;
ALTER TABLE factuur_queue ALTER COLUMN zending_id SET NOT NULL;

------------------------------------------------------------------------
-- 3. claim_factuur_queue_items — type-veld weg uit return-shape
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS claim_factuur_queue_items(INTEGER);

CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id          BIGINT,
  debiteur_nr INTEGER,
  order_ids   BIGINT[],
  attempts    INTEGER,
  zending_id  BIGINT,
  verzendweek TEXT
)
LANGUAGE sql
AS $$
  UPDATE factuur_queue q
     SET status = 'processing',
         processing_started_at = now()
   WHERE q.id IN (
     SELECT inner_q.id
       FROM factuur_queue inner_q
      WHERE inner_q.status = 'pending'
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.attempts,
            q.zending_id, q.verzendweek;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION claim_factuur_queue_items(INTEGER) IS
  'Mig 240 (ADR-0010 cleanup): claim met FOR UPDATE SKIP LOCKED. '
  'Type-veld weg uit return-shape (factuur_queue.type is gedropt). '
  'Edge function consumeert alleen nog zending_id-pad — Group F dropt '
  'de legacy-fallback in de edge function na deze migratie.';

NOTIFY pgrst, 'reload schema';
