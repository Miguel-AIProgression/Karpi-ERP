-- supabase/migrations/183_app_config_vormwerk_levertijd.sql
-- Voegt configurabele levertijd-buffer voor vorm-maatwerk toe (default 6 weken).

UPDATE app_config
SET waarde = COALESCE(waarde, '{}'::jsonb)
           || jsonb_build_object('inkoop_buffer_weken_vormwerk', 6)
WHERE sleutel = 'order_config';

-- Sanity-check: als rij niet bestaat, maak hem aan met alleen deze key.
INSERT INTO app_config (sleutel, waarde)
SELECT 'order_config', jsonb_build_object('inkoop_buffer_weken_vormwerk', 6)
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE sleutel = 'order_config');
