-- 019: Locatie kolom toevoegen aan producten
-- Bron: Locaties123.xls — 302 unieke magazijnlocaties (A.01.L, B.03.H, etc.)
-- 5606 producten hebben een locatie. "Maatw." locaties worden overgeslagen.

-- ============================================================
-- STAP 1: Kolom toevoegen aan producten tabel
-- ============================================================
ALTER TABLE producten ADD COLUMN IF NOT EXISTS locatie TEXT;

-- Index voor snel zoeken/filteren op locatie
CREATE INDEX IF NOT EXISTS idx_producten_locatie ON producten (locatie) WHERE locatie IS NOT NULL;

-- ============================================================
-- STAP 2: View producten_overzicht opnieuw aanmaken met locatie
-- DROP nodig omdat CREATE OR REPLACE geen kolommen kan toevoegen
-- ============================================================
DROP VIEW IF EXISTS producten_overzicht;
CREATE VIEW producten_overzicht AS
SELECT
  p.artikelnr,
  p.karpi_code,
  p.ean_code,
  p.omschrijving,
  p.vervolgomschrijving,
  p.voorraad,
  p.backorder,
  p.gereserveerd,
  p.besteld_inkoop,
  p.vrije_voorraad,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  p.inkoopprijs,
  p.verkoopprijs,
  p.gewicht_kg,
  p.actief,
  p.created_at,
  p.updated_at,
  p.product_type,
  p.locatie,
  COALESCE(r.aantal_rollen, 0)         AS aantal_rollen,
  COALESCE(r.totaal_oppervlak_m2, 0)   AS totaal_oppervlak_m2,
  COALESCE(r.totaal_waarde_rollen, 0)  AS totaal_waarde_rollen
FROM producten p
LEFT JOIN (
  SELECT
    artikelnr,
    COUNT(*)::int           AS aantal_rollen,
    SUM(oppervlak_m2)       AS totaal_oppervlak_m2,
    SUM(waarde)             AS totaal_waarde_rollen
  FROM rollen
  GROUP BY artikelnr
) r ON r.artikelnr = p.artikelnr;
