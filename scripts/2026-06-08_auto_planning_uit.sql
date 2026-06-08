-- ============================================================================
-- GO-LIVE STAP 3 (2026-06-08): auto-planning UITzetten vóór de rollen-import.
--
--   Een bulk-insert / status-reset op `rollen` triggert anders honderden
--   auto-plan-calls (mig 100/111). `import_rollen_golive.py --apply` WEIGERT
--   bovendien te draaien zolang enabled = true (self-guard) — dus dit moet
--   eerst. Draai in psql / Supabase SQL-editor.
--
--   Structuur (geverifieerd 2026-06-08): app_config-rij met
--   sleutel = 'snijplanning.auto_planning', waarde = {"enabled": true}.
--
--   LET OP: zet auto-planning NA de hele go-live weer AAN (zie onderaan).
-- ============================================================================

-- VOOR (verwacht: {"enabled": true})
SELECT sleutel, waarde FROM app_config WHERE sleutel = 'snijplanning.auto_planning';

UPDATE app_config
   SET waarde = jsonb_set(waarde, '{enabled}', 'false'::jsonb)
 WHERE sleutel = 'snijplanning.auto_planning';

-- NA (verwacht: {"enabled": false})
SELECT sleutel, waarde FROM app_config WHERE sleutel = 'snijplanning.auto_planning';

-- ============================================================================
-- NA DE GO-LIVE weer AANzetten (apart draaien zodra de rol-data op orde is):
--
--   UPDATE app_config
--      SET waarde = jsonb_set(waarde, '{enabled}', 'true'::jsonb)
--    WHERE sleutel = 'snijplanning.auto_planning';
-- ============================================================================
