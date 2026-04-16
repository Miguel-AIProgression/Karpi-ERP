-- Migration 081: voeg levertijd-check velden toe aan app_config.productie_planning.
--
-- Velden:
--   logistieke_buffer_dagen (default 2): aantal kalenderdagen tussen snij-datum
--     en lever-datum (logistieke afhandeling, transport).
--   backlog_minimum_m2 (default 12): minimale totale backlog (m²) voor een
--     kwaliteit/kleur om een nieuwe rol "efficient" aan te kunnen snijden.
--     Daaronder komt scenario 'wacht_op_orders' uit de check-levertijd RPC.

UPDATE app_config
SET waarde = waarde
  || jsonb_build_object(
       'logistieke_buffer_dagen', COALESCE(waarde->'logistieke_buffer_dagen', '2'::jsonb),
       'backlog_minimum_m2', COALESCE(waarde->'backlog_minimum_m2', '12'::jsonb)
     )
WHERE sleutel = 'productie_planning';

-- Indien rij niet bestaat, INSERT met defaults
INSERT INTO app_config (sleutel, waarde)
SELECT 'productie_planning', jsonb_build_object(
  'planning_modus', 'weken',
  'capaciteit_per_week', 450,
  'capaciteit_marge_pct', 10,
  'weken_vooruit', 4,
  'max_reststuk_verspilling_pct', 15,
  'wisseltijd_minuten', 15,
  'snijtijd_minuten', 5,
  'logistieke_buffer_dagen', 2,
  'backlog_minimum_m2', 12
)
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE sleutel = 'productie_planning');
