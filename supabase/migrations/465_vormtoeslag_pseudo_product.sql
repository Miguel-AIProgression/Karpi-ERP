-- Migratie 465: VORMTOESLAG pseudo-product
--
-- Aanleiding: de vorm-toeslag (bv. € 75,00 voor een rond/ovaal/ellips-stuk,
-- `maatwerk_vormen.toeslag`) zat tot nu toe verwerkt in de per-m²-prijs van
-- de maatwerk-orderregel — de orderregel-korting% trok daardoor ook van de
-- toeslag af, wat niet de bedoeling is (verzoek gebruiker 2026-06-22).
--
-- Oplossing: de toeslag wordt een eigen orderregel met korting_pct=0, exact
-- het admin-pseudo-patroon van VERZEND/BUNDELKORTING/DREMPELKORTING (mig 265,
-- 272) en DROPSHIP-KLEIN/-GROOT (mig 353). Geen voorraad, geen allocatie,
-- geen snijplanning, niet pickbaar — puur een prijsregel. De koppeling met
-- de bijbehorende maatwerk-regel is GEEN DB-FK maar een array-positie-
-- convention in de frontend (companion staat altijd direct ná zijn
-- maatwerk-regel — zie frontend/src/lib/orders/vorm-toeslag-regel.ts),
-- omdat regelnummer toch al bij elke save herberekend wordt uit de
-- array-volgorde (create_order_with_lines/update_order_with_lines).
--
-- Géén vaste verkoopprijs op het product (anders dan DROPSHIP-KLEIN/-GROOT):
-- het bedrag varieert per vorm (`maatwerk_vormen.toeslag`) en wordt per regel
-- meegegeven vanuit de orderregel die hem aanmaakt.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING + UPDATE alleen bij is_pseudo=FALSE.

INSERT INTO producten (artikelnr, omschrijving, product_type, actief)
VALUES ('VORMTOESLAG', 'Vormtoeslag maatwerk', 'overig', true)
ON CONFLICT (artikelnr) DO NOTHING;

UPDATE producten
   SET is_pseudo = TRUE
 WHERE artikelnr = 'VORMTOESLAG'
   AND is_pseudo IS DISTINCT FROM TRUE;

DO $$
BEGIN
  RAISE NOTICE 'Mig 465: VORMTOESLAG pseudo-product aangemaakt (is_pseudo=TRUE).';
END $$;
