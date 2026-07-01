-- Wisseltijd per rol aanpassen van 15 naar 10 minuten (verzoek snijderij).
-- Levert realistischere snijsessie-planningen op; de vorige 15 min per wisseling
-- was een conservatieve schatting, de werkvloer werkt efficiënter.
--
-- Raakt: check-levertijd (bezetting()), haalbaarheid-simulatie (berekenAgenda),
--        planning-tab (nieuw — berekenPlanning()), productie-instellingen UI.

UPDATE app_config
SET waarde = jsonb_set(waarde, '{wisseltijd_minuten}', '10')
WHERE sleutel = 'productie_planning';
