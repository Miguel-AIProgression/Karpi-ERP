-- Verzendkosten en drempel instelbaar per klant
ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS verzendkosten NUMERIC(6,2) DEFAULT 35.00,
  ADD COLUMN IF NOT EXISTS verzend_drempel NUMERIC(8,2) DEFAULT 500.00;

-- Bestaande klanten krijgen de standaardwaarden (al gedaan via DEFAULT, maar expliciet voor zekerheid)
UPDATE debiteuren
  SET verzendkosten = 35.00
  WHERE verzendkosten IS NULL;

UPDATE debiteuren
  SET verzend_drempel = 500.00
  WHERE verzend_drempel IS NULL;

-- Update het VERZEND product van €20 naar €35
UPDATE producten
  SET verkoopprijs = 35.00
  WHERE artikelnr = 'VERZEND';
