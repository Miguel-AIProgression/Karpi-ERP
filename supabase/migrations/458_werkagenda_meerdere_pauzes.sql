-- Migratie 458: werkagenda — meerdere pauzes per dag
--
-- Werkvloer heeft 3 korte pauzes (09:30-09:45, 12:00-12:30, 14:30-14:45),
-- niet alleen de lunch. De Werktijden-interface (_shared/werkagenda.ts)
-- ondersteunde maar één pauze (`pauzeStart`/`pauzeEind`, mig 384) — omgebouwd
-- naar een array `pauzes`. Backfill de enige live rij naar de nieuwe shape.

UPDATE app_config
SET waarde = (waarde - 'pauzeStart' - 'pauzeEind') || jsonb_build_object(
  'pauzes', jsonb_build_array(
    jsonb_build_object('start', '09:30', 'eind', '09:45'),
    jsonb_build_object('start', '12:00', 'eind', '12:30'),
    jsonb_build_object('start', '14:30', 'eind', '14:45')
  )
)
WHERE sleutel = 'werkagenda';

NOTIFY pgrst, 'reload schema';
