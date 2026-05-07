-- Migratie 211: Pickronde — pick-uitkomst per colli + status-default 'Picken'
--
-- Achtergrond: zie ADR-0003. create_zending_voor_order zette zendingen direct
-- op 'Klaar voor verzending', wat de HST-dispatch-trigger te vroeg activeerde.
-- Deze migratie:
--   1. Voegt enum `pick_uitkomst` + 3 kolommen toe aan zending_colli
--   2. Wijzigt create_zending_voor_order zodat zending in 'Picken' start
--   3. Introduceert drie RPCs: start_pickronde, markeer_colli_niet_gevonden,
--      voltooi_pickronde
--
-- Bestaande zendingen (status NIET 'Picken') zijn niet retroactief gemigreerd
-- — die hebben al geen Pickronde-flow nodig.
--
-- Idempotent.

DO $$ BEGIN
  CREATE TYPE pick_uitkomst AS ENUM ('open', 'gepickt', 'niet_gevonden');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE zending_colli
  ADD COLUMN IF NOT EXISTS pick_uitkomst pick_uitkomst NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS pick_opmerking TEXT,
  ADD COLUMN IF NOT EXISTS gepickt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_zending_colli_pick_uitkomst
  ON zending_colli (zending_id, pick_uitkomst);

COMMENT ON COLUMN zending_colli.pick_uitkomst IS
  'Per-colli uitkomst tijdens Pickronde. Default ''open''. Bij voltooi_pickronde '
  'worden alle ''open''-rijen automatisch op ''gepickt'' gezet (vinkjes-default-aan).';
COMMENT ON COLUMN zending_colli.pick_opmerking IS
  'Operator-notitie bij niet_gevonden (waarom kon dit niet gevonden worden).';
COMMENT ON COLUMN zending_colli.gepickt_at IS
  'Moment van voltooi_pickronde. NULL zolang colli niet gepickt is.';
