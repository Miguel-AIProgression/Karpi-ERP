-- Migratie 182: opruim placeholder-rollen uit mig 112 + 113
--
-- Doel: na T003's ghost-merge (rollen-overzicht toont (kw, kl)-paren zonder
-- voorraad via besteld_per_kwaliteit_kleur view-laag-aanvulling) zijn de
-- placeholder-rollen uit migraties 112 + 113 (oppervlak_m2=0,
-- rolnummer 'PH-...') overbodig. Ze waren een truc om "leeg-toch-zichtbaar"-
-- paren in `rollen` te krijgen via de oude fetchRollenGegroepeerd-query.
-- Die query is verwijderd in T003.
--
-- Audit-bevindingen (zie commit-message):
--   • Geen frontend-code leest specifiek op oppervlak_m2 = 0 of rolnummer
--     ILIKE 'PH-%'.
--   • RPC's mig 114 (uitwisselbare_partners), mig 115
--     (rollen_uitwissel_voorraad) en mig 137 (besteld_per_kwaliteit_kleur)
--     filteren al op oppervlak_m2 > 0.
--   • Edge-function `_shared/db-helpers.ts::fetchBeschikbareRollen` filtert
--     placeholder-rollen al uit via `lengte_cm <= 0 OR breedte_cm <= 0`.
--     Defensieve filter blijft bestaan; mig 182 maakt hem hooguit nooit-true.
--   • Mig 134 (snijplanning_tekort_analyse) sluit placeholders uit via
--     `r.lengte_cm > 0 AND r.breedte_cm > 0` — geen impact.
--   • Mig 179 + 180 (voorraadposities) filtert eigen rollen op
--     `oppervlak_m2 > 0` — PH-rollen worden hier al genegeerd.
--
-- HITL-stap: Karpi Supabase MCP heeft geen toegang. Migratie handmatig
-- toepassen op productie-DB.

DELETE FROM rollen
 WHERE rolnummer LIKE 'PH-%'
   AND oppervlak_m2 = 0;

-- Idempotent: bij re-run vindt DELETE 0 rijen. Mig 112 + 113 INSERT-blokken
-- zijn neutraliseerd zodat re-runs geen nieuwe PH-rollen aanmaken.
