-- Migratie 240: cleanup — drop oude factuur-RPCs en factuur_queue.type
--
-- ADR-0010: na de cutover (mig 235) en drain van alle legacy queue-rijen
-- bestaan er geen callers meer voor genereer_factuur_voor_week (mig 232)
-- en genereer_factuur (mig 119/124/227). Drop ze. factuur_queue.type-
-- kolom verliest z'n functie en wordt ook gedropt.
--
-- factuur_queue.zending_id krijgt een partial CHECK (verplicht voor live
-- pending/processing-rijen, mag NULL voor historische done/failed) —
-- pure SET NOT NULL zou historische rijen uit pre-mig-234 blokkeren.
-- Hard guard bovenaan refuseert de migratie als de drain niet schoon is.
--
-- Mig-nummer-noot: plan-spec was mig 237, maar 237/238/239 zijn door
-- andere features in gebruik genomen. 240 is het eerstvolgende vrije
-- nummer.
--
-- Idempotent: DROP IF EXISTS / ALTER COLUMN.

------------------------------------------------------------------------
-- 0. Hard guard: refuseer run als drain niet voltooid is
------------------------------------------------------------------------
-- Mirrort mig 235's guard. Mig 240 dropt de legacy RPCs definitief; als
-- er nog pending/processing-rijen zonder zending_id zijn, zou de drain
-- na deze migratie eindeloos blijven loopen op `genereer_factuur_voor_week
-- bestaat niet`-fouten. Hier breken we vroeg met een actionable melding.
DO $$
DECLARE
  v_legacy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_legacy_count
    FROM factuur_queue
   WHERE status IN ('pending', 'processing')
     AND zending_id IS NULL;
  IF v_legacy_count > 0 THEN
    RAISE EXCEPTION 'Mig 240 cleanup: % legacy queue-rijen zonder zending_id (pending/processing). Drain eerst.',
      v_legacy_count
      USING HINT = 'Wacht tot factuur-verzenden de oude rijen heeft afgewikkeld, of zet ze handmatig op failed.';
  END IF;
END;
$$;

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

-- Partial CHECK i.p.v. SET NOT NULL: historische done/failed-rijen uit
-- pre-mig-234 hebben zending_id=NULL (kolom bestond toen niet) en mogen
-- blijven staan als audit-spoor. De operationele invariant is "live
-- queue-rijen hebben altijd zending_id" — die handhaven we hier.
-- NOT VALID + VALIDATE-pattern doorloopt rijen één keer; bij volgende
-- runs is de constraint al aanwezig en wordt de DO-block overgeslagen.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'factuur_queue_zending_id_required_when_live'
       AND conrelid = 'factuur_queue'::regclass
  ) THEN
    ALTER TABLE factuur_queue
      ADD CONSTRAINT factuur_queue_zending_id_required_when_live
      CHECK (zending_id IS NOT NULL OR status IN ('done', 'failed'))
      NOT VALID;
    ALTER TABLE factuur_queue
      VALIDATE CONSTRAINT factuur_queue_zending_id_required_when_live;
  END IF;
END $$;

COMMENT ON CONSTRAINT factuur_queue_zending_id_required_when_live ON factuur_queue IS
  'Mig 240 (ADR-0010): zending_id verplicht voor live queue-rijen '
  '(pending/processing). Historische done/failed-rijen uit pre-mig-234 '
  'mogen NULL houden — partial CHECK i.p.v. SET NOT NULL voorkomt dat '
  'die historie de migratie blokkeert.';

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
