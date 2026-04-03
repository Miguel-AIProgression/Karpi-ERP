-- 027_verzendkosten.sql
-- Voegt ondersteuning toe voor verzendkosten:
--   1. Kolom gratis_verzending op debiteuren (klanten kunnen vrijgesteld worden)
--   2. Speciaal product 'VERZEND' voor verzendkosten als orderregel
--      Voorraad op 999999 zodat de reserveringstrigger geen negatieve vrije_voorraad geeft.

-- 1. Gratis verzending vlag op klanten
ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS gratis_verzending BOOLEAN DEFAULT false;

-- 2. Verzendkosten-product (idempotent)
INSERT INTO producten (
  artikelnr,
  omschrijving,
  verkoopprijs,
  actief,
  kwaliteit_code,
  voorraad,
  gereserveerd,
  vrije_voorraad
) VALUES (
  'VERZEND',
  'Verzendkosten',
  20.00,
  true,
  NULL,
  999999,
  0,
  999999
) ON CONFLICT (artikelnr) DO NOTHING;
