-- Eenmalig: snijplannen die "stuck" staan op status 'Snijden' (rol-uitvoer
-- modal geopend maar nooit afgesloten) terugzetten naar 'Gepland'.
--
-- Achtergrond: `start_snijden_rol(rol_id)` zet alle snijplannen op die rol op
-- 'Snijden' en vult `rollen.snijden_gestart_op`. Pas wanneer de operator op
-- "Pauzeer" klikt of "Rol afsluiten" succesvol uitvoert worden ze weer
-- vrijgegeven. Wanneer de modal/browser dichtgaat zonder te pauzeren blijven
-- de stukken op 'Snijden' staan en blokkeren ze de auto-planning.
--
-- Definitie van "stuck": status = 'Snijden' AND gesneden_op IS NULL.
-- Uitsluiting: stukken die wél echt gesneden zijn (gesneden_op IS NOT NULL)
-- houden hun status — die horen 'Gesneden' te krijgen via voltooi_snijplan_rol.
--
-- Rol-state: na revert moeten betrokken rollen ook `snijden_gestart_op = NULL`
-- krijgen, zodat ze weer in de auto-plan / herplan-flow meegenomen worden
-- (zie db-helpers.ts:158-160 en migratie 133). Maar alleen wanneer er geen
-- ENKEL snijplan op die rol meer in 'Snijden' staat — anders is de rol terecht
-- in productie en moet de marker blijven.

BEGIN;

-- 1. Preview: welke snijplannen worden geraakt?
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM snijplannen
  WHERE status = 'Snijden'
    AND gesneden_op IS NULL;
  RAISE NOTICE 'Stuck snijplannen (status=Snijden, gesneden_op IS NULL): %', v_count;
END $$;

-- 2. Snijplannen reverten.
WITH reverted AS (
  UPDATE snijplannen
  SET status = 'Gepland'
  WHERE status = 'Snijden'
    AND gesneden_op IS NULL
  RETURNING id, rol_id
)
SELECT COUNT(*) AS aantal_snijplannen_gerevert,
       COUNT(DISTINCT rol_id) AS aantal_rollen_geraakt
FROM reverted;

-- 3. Rollen die nu geen enkel snijplan in 'Snijden' meer hebben:
--    snijden_gestart_op resetten zodat ze in de planning-flow terugkomen.
WITH rollen_zonder_snijden AS (
  SELECT r.id
  FROM rollen r
  WHERE r.snijden_gestart_op IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM snijplannen sp
      WHERE sp.rol_id = r.id
        AND sp.status = 'Snijden'
    )
),
reset AS (
  UPDATE rollen
  SET snijden_gestart_op = NULL
  WHERE id IN (SELECT id FROM rollen_zonder_snijden)
  RETURNING id
)
SELECT COUNT(*) AS aantal_rollen_gestart_op_gereset FROM reset;

-- 4. Verificatie: er mogen geen stuck snijplannen meer zijn.
DO $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM snijplannen
  WHERE status = 'Snijden'
    AND gesneden_op IS NULL;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Verificatie faalde: nog % stuck snijplannen', v_remaining;
  END IF;
  RAISE NOTICE 'Verificatie OK: 0 stuck snijplannen.';
END $$;

COMMIT;
