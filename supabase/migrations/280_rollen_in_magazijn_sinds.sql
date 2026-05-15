-- Migratie 280: rollen.in_magazijn_sinds — single source of truth voor magazijnleeftijd (FIFO)
--
-- Context (ADR-0021):
--   Kleurverschil tussen tapijtrollen van dezelfde kwaliteit+kleur ontstaat puur
--   door fysieke veroudering naarmate een rol langer in het magazijn ligt. De
--   snijplanner-packer moet die leeftijd kunnen wegen. `reststuk_datum` is hier
--   ongeschikt voor: het wordt door boek_inkooporder_ontvangst_rollen op NOW()
--   gezet voor ELKE rol (niet alleen reststukken) en het reset bij snijden
--   (voltooi_snijplan_rol zet CURRENT_DATE op nieuwe reststukken). Bovendien
--   hangt voltooi_snijplan_rol regel ~242-246 af van `reststuk_datum=CURRENT_DATE`
--   om net-gesneden reststukken te vinden — dus die kolom NIET herdefiniëren.
--
-- Deze migratie:
--   * Voegt rollen.in_magazijn_sinds DATE toe (nullable; placeholder/overige
--     INSERT-paden zetten hem niet, packer behandelt NULL als "heel oud").
--   * Backfill-vulregel:
--       - IO-rol (inkooporder_regel_id NOT NULL) → reststuk_datum::date
--         (= ontvangstmoment), fallback sentinel als reststuk_datum NULL.
--       - Reststuk/keten (oorsprong_rol_id NOT NULL) → erft van keten-wortel.
--       - Overige (historische import, beide NULL) → sentinel 2000-01-01
--         zodat ze FIFO-voorrang krijgen.

ALTER TABLE rollen ADD COLUMN IF NOT EXISTS in_magazijn_sinds DATE;

COMMENT ON COLUMN rollen.in_magazijn_sinds IS
  'Datum waarop dit MATERIAAL fysiek het magazijn binnenkwam (IO-ontvangst van '
  'de moederrol). Reststukken/aangebroken rollen erven dit van oorsprong_rol — '
  'reset NIET bij snijden. Single source of truth voor FIFO-magazijnleeftijd in '
  'de snijplanner-packer. NIET te verwarren met reststuk_datum (traceability, '
  'reset wél bij snijden). ADR-0021, mig 280.';

-- 1. Keten-wortels: IO-rollen → ontvangstdatum.
UPDATE rollen
SET in_magazijn_sinds = COALESCE(reststuk_datum::date, DATE '2000-01-01')
WHERE oorsprong_rol_id IS NULL
  AND inkooporder_regel_id IS NOT NULL;

-- 2. Keten-wortels: historische import / overige → sentinel (FIFO-voorrang).
UPDATE rollen
SET in_magazijn_sinds = DATE '2000-01-01'
WHERE oorsprong_rol_id IS NULL
  AND inkooporder_regel_id IS NULL;

-- 3. Reststuk-keten erft van de wortel (recursief, meerdere niveaus mogelijk).
WITH RECURSIVE keten AS (
  SELECT id, in_magazijn_sinds
  FROM rollen
  WHERE oorsprong_rol_id IS NULL
  UNION ALL
  SELECT r.id, k.in_magazijn_sinds
  FROM rollen r
  JOIN keten k ON r.oorsprong_rol_id = k.id
)
UPDATE rollen rr
SET in_magazijn_sinds = k.in_magazijn_sinds
FROM keten k
WHERE rr.id = k.id
  AND rr.oorsprong_rol_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_null INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null FROM rollen WHERE in_magazijn_sinds IS NULL;
  RAISE NOTICE 'Migratie 280 toegepast: rollen.in_magazijn_sinds + backfill.';
  RAISE NOTICE '  Rijen zonder in_magazijn_sinds na backfill: % (placeholder/overige INSERT-paden, packer behandelt NULL als heel oud).', v_null;
END $$;
