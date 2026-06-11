-- Migratie 369: debiteuren.email_verzend — klant-niveau verzend-/T&T-e-mailadres
--
-- Voorstel Piet-Hein (mail 11-06-2026): per klant een apart e-mailadres voor
-- het verzendadres kunnen registreren, los van het algemene adres. Marjon
-- bevestigt het pijnpunt: in Basta stond dit adres noodgedwongen bij de
-- "openingstijden" omdat het echte e-mailveld anders ook de factuur ontving.
--
-- In RugFlow is de factuur al gescheiden (email_factuur, en sinds mig 364
-- orders.fact_email), maar de T&T-default viel terug op email_overig — het
-- "algemene" adres. Dit veld maakt de scheiding compleet. De default-ladder
-- voor orders.afl_email in het orderformulier wordt:
--
--   afleveradressen.email (per afleveradres, mig 364)
--     → debiteuren.email_verzend (dit veld)
--     → debiteuren.email_overig (algemeen, bestaande fallback)
--
-- Bewust GEEN backfill vanuit email_overig: de fallback zit runtime in de
-- ladder, zodat beide velden niet uit elkaar lopen zolang er geen bewust
-- afwijkend verzendadres is ingevuld. Vullen gebeurt organisch via de
-- checkbox "Opslaan als vast verzend-e-mailadres voor deze klant" in het
-- orderformulier (delivery-address-editor) en via de klantpagina.
--
-- Dropshipment-uitzondering (mig 368) blijft: bij dropship-orders defaultet
-- het formulier helemaal niet vanuit de debiteur — ook niet uit dit veld.
--
-- Idempotent.

ALTER TABLE debiteuren ADD COLUMN IF NOT EXISTS email_verzend TEXT;

COMMENT ON COLUMN debiteuren.email_verzend IS
  'Klant-niveau e-mailadres voor verzending/track & trace (mig 369). Default '
  'voor orders.afl_email bij orderaanmaak: afleveradressen.email → dit veld → '
  'email_overig. Nooit het factuur-adres; bij dropshipment-orders geheel geen '
  'debiteur-default (mig 368).';

NOTIFY pgrst, 'reload schema';
