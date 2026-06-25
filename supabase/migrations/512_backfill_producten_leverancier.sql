-- Migratie 512: backfill producten.leverancier_id vanuit inkooporders
--
-- Strategie: meest recente inkooporder per artikel (op besteldatum DESC, id DESC)
-- bepaalt de leverancier. Alleen artikelen waarbij leverancier_id nog NULL is
-- worden bijgewerkt — geen bestaande koppelingen worden overschreven.
--
-- Bereik: 415 producten, 0 conflicten (geverifieerd 2026-06-25).

UPDATE producten p
SET leverancier_id = mr.leverancier_id
FROM (
  SELECT DISTINCT ON (ir.artikelnr)
    ir.artikelnr,
    io.leverancier_id
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE io.leverancier_id IS NOT NULL
  ORDER BY ir.artikelnr, io.besteldatum DESC NULLS LAST, io.id DESC
) mr
WHERE p.artikelnr = mr.artikelnr
  AND p.leverancier_id IS NULL;

-- Resultaat loggen
DO $$
DECLARE v_count integer;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'producten.leverancier_id bijgewerkt: % rijen', v_count;
END $$;
