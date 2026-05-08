-- Migration 221: factuur-pdf branding (logo-bucket + bedrijfsgegevens uitbreiding)
--
-- Karpi-template levert per pagina:
--   - KARPI GROUP-logo bovenin (afbeelding)
--   - Tweede bankregel (Commerzbank AG Bocholt) onder de hoofd-bankregel
--   - 3-talige algemene-voorwaarden (NL/DE/EN) onderaan elke pagina
--
-- Deze migratie:
--   1. Maakt PUBLIC storage-bucket 'public-assets' (idempotent).
--   2. Voegt bank2 + voorwaarden + logo-pad toe aan app_config.bedrijfsgegevens-JSONB.
--      Bestaande sleutels in `waarde` blijven gerespecteerd (links-of-merge).
--
-- Het logo-bestand zelf moet eenmalig handmatig worden geüpload — zie:
--   scripts/upload-karpi-logo.ps1   (gebruikt service-role-key + storage REST)
-- of via Supabase Studio: bucket 'public-assets' → upload `karpi-logo.jpg`.

-- 1. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-assets', 'public-assets', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Bedrijfsgegevens-JSONB uitbreiden — defaults || waarde laat bestaande sleutels winnen.
UPDATE app_config
SET
  waarde = (
    jsonb_build_object(
      'logo_storage_bucket', 'public-assets',
      'logo_storage_pad', 'karpi-logo.jpg',
      'bank2', jsonb_build_object(
        'bank', 'Commerzbank AG Bocholt',
        'rekeningnummer', '341011500',
        'blz', '42840005',
        'bic', 'COBADEFFXXX',
        'iban', 'DE32428400050341011500'
      ),
      'voorwaarden_nl',
        'Al onze offertes, verkopen en leveringen geschieden uitsluitend overeenkomstig onze Algemene Leverings- en Betalingsvoorwaarden, zoals laatstelijk gedeponeerd bij de Kamer van Koophandel te Arnhem onder nummer 09060322. Op de achterzijde treft u deze aan. Op verzoek sturen wij u de Nederlandstalige versie van de Algemene Leverings- en Betalingsvoorwaarden toe. U kunt deze voorwaarden ook raadplegen via onze internetsite, www.karpi.nl',
      'voorwaarden_de',
        'Alle unsere Angebote, Verkäufe und Lieferungen geschehen gemäss unseren Allgemeinen Lieferungs- und Zahlungsbedingungen, eingetragen beim Industrie und Handelskammer in Arnheim unter Nummer 09060322. Diese sind umseitig abgedruckt. Auf Wunsch schicken wir Ihnen die Bedingungen in Deutsche Sprache zu. Sie finden die Bedingungen auch auf unserer Internetseite www.karpi.nl',
      'voorwaarden_en',
        'All our offers, sales and deliveries are subject to our general terms and conditions of payment, which are registered at the Chamber of Commerce in Arnhem under the number 09060322. The terms of payment and conditions of payment are printed on the reverse side. You can also find these terms and conditions through internet www.karpi.nl'
    )
    || waarde
  ),
  updated_at = now()
WHERE sleutel = 'bedrijfsgegevens'
  AND waarde IS NOT NULL;
