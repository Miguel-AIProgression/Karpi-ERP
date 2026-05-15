-- Migratie 283: app_config 'snijplanning' — tunebare FIFO-parameters (ADR-0021)
--
-- Single source of truth voor de leeftijd-vs-snijverlies-afweging in de
-- snijplanner-packer. Alle waarden zijn online te tunen zonder code-deploy.
--
--   drempel_dagen          90  — leeftijd telt pas mee bóven deze grens
--   harde_bovengrens_dagen 180 — daarboven absolute snij-voorrang (binnen C1/C2)
--   alpha                  0.05 — m²-afval-equivalent per dag bóven de drempel
--   badge_geel_m2          5   — extra afval (m²) → gele badge
--   badge_geel_pct         25  — of extra afval (%) → gele badge
--   badge_rood_m2          10  — extra afval (m²) → rode badge (geen auto-approve)
--   badge_rood_pct         50  — of extra afval (%) → rode badge

UPDATE app_config
   SET waarde = waarde || jsonb_build_object(
         'drempel_dagen', 90,
         'harde_bovengrens_dagen', 180,
         'alpha', 0.05,
         'badge_geel_m2', 5,
         'badge_geel_pct', 25,
         'badge_rood_m2', 10,
         'badge_rood_pct', 50
       )
 WHERE sleutel = 'snijplanning';

INSERT INTO app_config (sleutel, waarde)
VALUES ('snijplanning', jsonb_build_object(
         'drempel_dagen', 90,
         'harde_bovengrens_dagen', 180,
         'alpha', 0.05,
         'badge_geel_m2', 5,
         'badge_geel_pct', 25,
         'badge_rood_m2', 10,
         'badge_rood_pct', 50
       ))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 283 toegepast: app_config.snijplanning FIFO-parameters (ADR-0021).';
END $$;
