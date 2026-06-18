-- Migratie 418: HST ook default-vervoerder binnen BE
--
-- Aanleiding (2026-06-18): er zijn 12 open BE-orders, maar er bestond géén
-- selectie-regel die BE dekt (alleen NL→HST mig 336 en DE→Rhenus). Álle
-- BE-orders vielen daardoor op `bron='geen'` ("Geen vervoerder mogelijk") —
-- behalve de orders waar een operator handmatig HST had overschreven. HST levert
-- ook in België (bevestigd door gebruiker), dus BE hoort net als NL automatisch
-- naar HST te routeren i.p.v. per order een handmatige override.
--
-- Mechanisme: catch-all `vervoerder_selectie_regel` met laagste prio en conditie
-- {land:['BE']}, identiek aan de NL-catch-all (mig 336). `matcht_regel` (mig 214)
-- normaliseert beide kanten via `normaliseer_land`, dus deze ene regel matcht
-- zowel `afl_land='BE'` als `afl_land='BELGIË'`. Specifieke regels (lagere prio)
-- winnen nog steeds.
--
-- N.B. naast deze routering is ook de capability `landbereik` van HST uitgebreid
-- naar ['NL','BE'] (vervoerders/capabilities.ts) zodat de hst-send-preflight
-- (`valideerVoorVervoerder`) een BE-zending niet alsnog op LAND_BUITEN_BEREIK
-- afkeurt. Die wijziging is code (geen migratie) → vereist hst-send-redeploy.
--
-- Idempotent.

INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, service_code, notitie)
SELECT 'hst_api', 99999, jsonb_build_object('land', ARRAY['BE']), NULL,
       'Default-vervoerder binnen BE (mig 418) — HST levert ook in België; laagste prio, specifieke regels winnen.'
 WHERE EXISTS (SELECT 1 FROM vervoerders WHERE code = 'hst_api' AND actief = TRUE)
   AND NOT EXISTS (
     SELECT 1 FROM vervoerder_selectie_regels
      WHERE vervoerder_code = 'hst_api' AND prio = 99999
        AND conditie = jsonb_build_object('land', ARRAY['BE'])
   );

NOTIFY pgrst, 'reload schema';
