-- Migration 082: voeg spoed-toeslag velden toe aan app_config.productie_planning.
--
-- Velden:
--   spoed_buffer_uren (default 4): minimum aantal uren dat per ISO-week vrij
--     moet blijven. Een week telt als "vol" voor spoed-evaluatie als de
--     resterende capaciteit < spoed_buffer_uren is.
--   spoed_toeslag_bedrag (default 50): vast bedrag (€) dat als SPOEDTOESLAG-
--     orderregel wordt toegevoegd wanneer de gebruiker spoed activeert.
--   spoed_product_id (default 'SPOEDTOESLAG'): artikelnr waaronder de
--     spoed-toeslag-regel wordt aangemaakt (analoog aan VERZEND-shipping).

UPDATE app_config
SET waarde = waarde
  || jsonb_build_object(
       'spoed_buffer_uren', COALESCE(waarde->'spoed_buffer_uren', '4'::jsonb),
       'spoed_toeslag_bedrag', COALESCE(waarde->'spoed_toeslag_bedrag', '50'::jsonb),
       'spoed_product_id', COALESCE(waarde->'spoed_product_id', '"SPOEDTOESLAG"'::jsonb)
     )
WHERE sleutel = 'productie_planning';
