-- ============================================================================
-- POST-FLIGHT (2026-06-08): auto-planning weer AANzetten NA de go-live.
--
--   Draai dit ZODRA de rol-data op orde is (na stap 1-7 van de voorraad-import).
--   Tegenhanger van 2026-06-08_auto_planning_uit.sql. Vergeet dit NIET — anders
--   blijft de snijplanning-automatisering permanent uit.
--
--   Draai in psql / Supabase SQL-editor.
-- ============================================================================

-- VOOR (verwacht na de go-live: {"enabled": false})
SELECT sleutel, waarde FROM app_config WHERE sleutel = 'snijplanning.auto_planning';

UPDATE app_config
   SET waarde = jsonb_set(waarde, '{enabled}', 'true'::jsonb)
 WHERE sleutel = 'snijplanning.auto_planning';

-- NA (verwacht: {"enabled": true})
SELECT sleutel, waarde FROM app_config WHERE sleutel = 'snijplanning.auto_planning';
