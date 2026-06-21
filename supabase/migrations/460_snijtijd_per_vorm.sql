-- Migratie 460: snijtijd per vorm i.p.v. vlak 5 min/stuk
--
-- snijtijd_minuten was tot nu toe één vlakke waarde (app_config.productie_
-- planning) voor elk stuk, ongeacht vorm. Sommige vormen (rond/ovaal/organic/
-- etc.) zijn fysiek lastiger te snijden dan een rechthoek en verdienen een
-- hoger tarief; klanteigen-vormen nog meer. maatwerk_vormen heeft al precies
-- de juiste rijen (code/naam) voor een prijstoeslag — hergebruikt hier voor
-- snijtijd in plaats van een nieuwe tabel.
--
-- Uitzondering: kwaliteiten die moeilijk te snijden zijn (Marich/Louvre/
-- Galaxy-collecties, incl. hun naam-equivalente kwaliteit-codes binnen
-- diezelfde collectie) kosten ook voor rechthoek 5 min i.p.v. 2,5 min.

ALTER TABLE maatwerk_vormen ADD COLUMN IF NOT EXISTS snijtijd_minuten NUMERIC NOT NULL DEFAULT 5;

UPDATE maatwerk_vormen SET snijtijd_minuten = 2.5 WHERE code = 'rechthoek';
UPDATE maatwerk_vormen SET snijtijd_minuten = 10  WHERE code = 'klanteigen_vorm';
-- overige vormen (rond, ovaal, organisch_a, organisch_b_sp, pebble, ellips,
-- afgeronde_hoeken, cloud, contour) houden de default van 5.

COMMENT ON COLUMN maatwerk_vormen.snijtijd_minuten IS
  'Mig 460: snijtijd in minuten voor deze vorm — vervangt het vlakke app_config.productie_planning.snijtijd_minuten.';

ALTER TABLE kwaliteiten ADD COLUMN IF NOT EXISTS moeilijk_te_snijden BOOLEAN NOT NULL DEFAULT FALSE;

-- GALAXY (collectie 38): GALA, GUST, HAMP, LESL, SOUL
-- LOUVRE (collectie 52): LOUV, LIVI
-- MARI13 (collectie 87): MARI, CLSS
UPDATE kwaliteiten SET moeilijk_te_snijden = TRUE
  WHERE code IN ('GALA','GUST','HAMP','LESL','SOUL','LOUV','LIVI','MARI','CLSS');

COMMENT ON COLUMN kwaliteiten.moeilijk_te_snijden IS
  'Mig 460: rechthoek-snijtijd telt voor deze kwaliteit als het algemene (5 min) tarief, niet de rechthoek-korting (2,5 min). Geen UI — bewerk via SQL, zelfde patroon als standaard_breedte_cm/alleen_recht_maatwerk.';

-- snijtijd_minuten is vervangen door het per-vorm tarief — geen back-compat-
-- sleutel laten hangen (zelfde besluit als mig 452 voor capaciteit_per_week).
UPDATE app_config SET waarde = waarde - 'snijtijd_minuten' WHERE sleutel = 'productie_planning';

NOTIFY pgrst, 'reload schema';
