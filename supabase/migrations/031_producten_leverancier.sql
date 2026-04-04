-- 031_producten_leverancier.sql
--
-- Voeg leverancier_id toe aan producten tabel.
-- Leverancier is de fabrikant/leverancier van het product (bijv. Headlam, Associated Weavers).

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS leverancier_id BIGINT REFERENCES leveranciers(id);

-- Index voor lookups per leverancier
CREATE INDEX IF NOT EXISTS idx_producten_leverancier_id ON producten(leverancier_id);
