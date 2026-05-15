-- Migratie 285: FIFO-modus 'simpel' als default (ADR-0021 — geparkeerd)
--
-- De geavanceerde leeftijd-vs-snijverlies-kostfunctie + badge + auto-approve-
-- carve-out blijven volledig in code aanwezig, maar staan bewust UIT tot de
-- interne rol-data op orde is. Live-gedrag voor nu:
--   * elke rol + voortvloeiende reststukken hebben in_magazijn_sinds (mig 280-282)
--   * de snijplanner pakt strikt de oudst-binnengekomen rol eerst
--   * geen badge, geen extra-snijverlies-acceptatie, geen carve-out
--
-- Omschakelen naar de volledige functionaliteit = `modus` op 'geavanceerd'
-- zetten (via Instellingen → Productie Instellingen of deze sleutel).

UPDATE app_config
   SET waarde = waarde || jsonb_build_object('modus', 'simpel')
 WHERE sleutel = 'snijplanning'
   AND NOT (waarde ? 'modus');

INSERT INTO app_config (sleutel, waarde)
VALUES ('snijplanning', jsonb_build_object(
         'modus', 'simpel',
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
  RAISE NOTICE 'Migratie 285 toegepast: FIFO-modus default ''simpel'' (geavanceerde laag geparkeerd, ADR-0021).';
END $$;
