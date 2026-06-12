-- Migratie 384: werkagenda-configuratie centraal in app_config
--
-- Werktijden + vrije dagen (feestdagen/vakantie) stonden tot nu in
-- localStorage ('karpi.werkagenda.werktijden') — per browser, onzichtbaar
-- voor edge functions. Eén rij voor alle clients: UI (productie-instellingen,
-- snijplanning-agenda), check-levertijd, spoed-check en Pick & Ship-horizon
-- lezen dezelfde kalender. Shape spiegelt de Werktijden-interface van
-- supabase/functions/_shared/werkagenda.ts (de kernel).

INSERT INTO app_config (sleutel, waarde)
VALUES ('werkagenda', jsonb_build_object(
  'werkdagen',  jsonb_build_array(1, 2, 3, 4, 5),
  'start',      '08:00',
  'eind',       '17:00',
  'pauzeStart', '12:00',
  'pauzeEind',  '12:30',
  'vrij',       jsonb_build_array()
))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
