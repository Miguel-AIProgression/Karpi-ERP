-- Migratie 432: zendingen.gereed_op — moment waarop de pickronde is afgerond.
--
-- Aanleiding: het logistiek-zendingenoverzicht (/logistiek) moet sorteerbaar +
-- groepeerbaar + filterbaar worden op de datum waarop een zending op de pagina
-- "verscheen" = het moment dat de pickronde werd afgerond en de zending naar
-- status 'Klaar voor verzending' ging.
--
-- Tot nu toe was er geen timestamp voor die transitie:
--   - created_at = pickronde-START (zending-aanmaak)
--   - updated_at = laatste mutatie (schuift mee bij Onderweg/Afgeleverd)
-- Daarom een dedicated, onveranderlijke kolom `gereed_op` die EENMALIG wordt
-- gezet zodra de zending 'Klaar voor verzending' bereikt (alle aanmaakroutes:
-- voltooi_pickronde, start_pickronden, create_zending_voor_order).
--
-- Idempotent.

-- ============================================================================
-- 1. Kolom
-- ============================================================================
ALTER TABLE zendingen ADD COLUMN IF NOT EXISTS gereed_op TIMESTAMPTZ;

COMMENT ON COLUMN zendingen.gereed_op IS
  'Mig 432. Moment waarop de zending voor het eerst status ''Klaar voor verzending'' '
  'bereikte = pickronde afgerond. Eenmalig gezet door BEFORE-trigger '
  'trg_zending_set_gereed_op; daarna onveranderlijk (latere transities naar '
  'Onderweg/Afgeleverd raken het niet). Voedt sortering/groepering/datumfilter op '
  'het logistiek-zendingenoverzicht. Backfill = pickronde_voltooid-event (via '
  'zending_orders) met fallback op updated_at.';

-- ============================================================================
-- 2. BEFORE-trigger: zet gereed_op eenmalig bij het bereiken van een
--    "afgeronde" status. BEFORE zodat NEW muteerbaar is (de bestaande
--    AFTER-trigger trg_zending_klaar_voor_verzending uit mig 172 blijft los
--    bestaan voor de vervoerder-enqueue).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_zending_set_gereed_op() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.gereed_op IS NULL
     AND NEW.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd') THEN
    NEW.gereed_op := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zending_set_gereed_op ON zendingen;
CREATE TRIGGER trg_zending_set_gereed_op
  BEFORE INSERT OR UPDATE OF status ON zendingen
  FOR EACH ROW EXECUTE FUNCTION fn_zending_set_gereed_op();

COMMENT ON FUNCTION fn_zending_set_gereed_op IS
  'Mig 432. Stempelt zendingen.gereed_op (now()) zodra een zending voor het eerst '
  'een afgeronde status (Klaar voor verzending/Onderweg/Afgeleverd) bereikt. '
  'COALESCE-gedrag via de NULL-guard: blijft onveranderlijk na de eerste stempel.';

-- ============================================================================
-- 3. Backfill bestaande zendingen
-- ============================================================================
-- 3a. Beste bron: het 'pickronde_voltooid'-order_event van een gekoppelde order
--     (via de zending_orders M2M, mig 222/242 — élke zending heeft ≥1 rij).
UPDATE zendingen z
   SET gereed_op = sub.ts
  FROM (
    SELECT zo.zending_id, MIN(oe.created_at) AS ts
      FROM zending_orders zo
      JOIN order_events oe ON oe.order_id = zo.order_id
     WHERE oe.event_type = 'pickronde_voltooid'
     GROUP BY zo.zending_id
  ) sub
 WHERE z.id = sub.zending_id
   AND z.gereed_op IS NULL;

-- 3b. Fallback voor afgeronde zendingen zonder voltooid-event (bv. nog
--     'Klaar voor verzending', order nog niet als verzonden afgesloten):
--     benader met updated_at. Groepering is per dag, dus dag-precisie volstaat.
UPDATE zendingen
   SET gereed_op = updated_at
 WHERE gereed_op IS NULL
   AND status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

-- ============================================================================
-- 4. Index voor de overzicht-sortering (gereed_op DESC).
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_zendingen_gereed_op
  ON zendingen (gereed_op DESC NULLS LAST);
