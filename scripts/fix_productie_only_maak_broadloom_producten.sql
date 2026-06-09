-- Categorie A: maak een broadloom-artikel (zonder rolvoorraad) aan per productie-only
-- (kwaliteit, kleur) die nog GEEN product heeft, en koppel het aan de orderregels.
--
-- Keuze Miguel (2026-06-09): voor combo's die alleen als afgewerkt product bestaan
-- (geen broadloom-rol om uit te snijden) een rol-artikel aanmaken zonder voorraad,
-- puur als catalogusreferentie. De snijplanning toont hem dan correct als
-- "geen rol -> inkoop" (er is immers geen fysieke rol).
--
-- VOLGORDE: draai dit PAS NA
--   1. scripts/fix_producten_rol_type.sql        (her-typeer bestaande broadloom -> rol)
--   2. scripts/fix_productie_only_artikelnr.sql  (koppel waar al een rol-product is)
-- zodat hier alleen de echte gaten overblijven (categorie A).
--
-- artikelnr-schema: <KWAL><KLEUR>MAATWERK (canonieke maatwerk-code, vgl snijlijst_parser;
-- geen MAATWERK-producten in de catalogus, dus geen collision). FK-veilig: alleen
-- kwaliteiten die in `kwaliteiten` bestaan (categorie-3-kwaliteiten worden overgeslagen).
-- Idempotent: ON CONFLICT DO NOTHING + de UPDATE raakt alleen artikelnr IS NULL.

-- ============================================================================
-- STAP 1: producten aanmaken
-- ============================================================================
INSERT INTO producten (artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel, product_type, voorraad, gereserveerd, backorder, vrije_voorraad, actief)
SELECT DISTINCT
  oreg.maatwerk_kwaliteit_code || normaliseer_kleur_code(oreg.maatwerk_kleur_code) || 'MAATWERK' AS artikelnr,
  oreg.maatwerk_kwaliteit_code || normaliseer_kleur_code(oreg.maatwerk_kleur_code) || 'MAATWERK' AS karpi_code,
  'Maatwerk broadloom ' || oreg.maatwerk_kwaliteit_code || ' kleur ' || normaliseer_kleur_code(oreg.maatwerk_kleur_code) AS omschrijving,
  oreg.maatwerk_kwaliteit_code                                   AS kwaliteit_code,
  normaliseer_kleur_code(oreg.maatwerk_kleur_code)               AS kleur_code,
  oreg.maatwerk_kwaliteit_code || '_' || normaliseer_kleur_code(oreg.maatwerk_kleur_code) AS zoeksleutel,
  'rol'                                                          AS product_type,
  0, 0, 0, 0,
  true
FROM order_regels oreg
JOIN orders o ON o.id = oreg.order_id
WHERE o.alleen_productie = TRUE
  AND oreg.is_maatwerk   = TRUE
  AND oreg.artikelnr IS NULL
  AND oreg.maatwerk_kwaliteit_code IS NOT NULL
  AND oreg.maatwerk_kwaliteit_code <> ''
  AND normaliseer_kleur_code(oreg.maatwerk_kleur_code) <> ''
  AND oreg.maatwerk_kwaliteit_code IN (SELECT code FROM kwaliteiten)  -- kwaliteiten PK = code
ON CONFLICT (artikelnr) DO NOTHING;

-- ============================================================================
-- STAP 2: koppel de net-aangemaakte broadloom-producten aan de orderregels
-- ============================================================================
UPDATE order_regels oreg
   SET artikelnr = oreg.maatwerk_kwaliteit_code || normaliseer_kleur_code(oreg.maatwerk_kleur_code) || 'MAATWERK'
  FROM orders o
 WHERE oreg.order_id      = o.id
   AND o.alleen_productie = TRUE
   AND oreg.is_maatwerk   = TRUE
   AND oreg.artikelnr IS NULL
   AND EXISTS (
     SELECT 1 FROM producten p
      WHERE p.artikelnr = oreg.maatwerk_kwaliteit_code || normaliseer_kleur_code(oreg.maatwerk_kleur_code) || 'MAATWERK'
   );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NA-CHECK: wat blijft NULL? (= categorie 3: kwaliteit niet in `kwaliteiten`)
-- ============================================================================
-- SELECT oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code, count(*) AS regels
-- FROM order_regels oreg JOIN orders o ON o.id = oreg.order_id
-- WHERE o.alleen_productie AND oreg.is_maatwerk AND oreg.artikelnr IS NULL
-- GROUP BY 1,2 ORDER BY regels DESC;
