-- Migration 120: Seed Karpi BV bedrijfsgegevens in app_config
-- Later aanpasbaar via frontend pagina Instellingen > Bedrijfsgegevens.

INSERT INTO app_config (sleutel, waarde) VALUES (
  'bedrijfsgegevens',
  '{
    "bedrijfsnaam": "KARPI BV",
    "adres": "Tweede Broekdijk 10",
    "postcode": "7122 LB",
    "plaats": "Aalten",
    "land": "Nederland",
    "telefoon": "+31 (0)543-476116",
    "fax": "+31 (0)543-476015",
    "email": "info@karpi.nl",
    "website": "www.karpi.nl",
    "kvk": "09060322",
    "btw_nummer": "NL008543446B01",
    "iban": "NL37INGB0689412401",
    "bic": "INGBNL2A",
    "bank": "ING Bank",
    "rekeningnummer": "689412401",
    "betalingscondities_tekst": "30 dagen netto"
  }'::jsonb
)
ON CONFLICT (sleutel) DO NOTHING;
