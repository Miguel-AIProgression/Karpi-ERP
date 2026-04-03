-- 028_afleverwijze.sql
-- Standaard afleverwijze per klant (Bezorgen / Afhalen / Franco)

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS afleverwijze TEXT DEFAULT 'Bezorgen'
  CHECK (afleverwijze IN ('Bezorgen', 'Afhalen'));
