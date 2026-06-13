-- Catalogus-fix: producten met fysieke rollen horen product_type='rol' te hebben.
--
-- Probleem: de type-classificatie ('rol' bij omschrijving "BREED") miste broadloom-
-- producten waarvan de omschrijving "400 BR" / "400br" / "400 BR." gebruikt i.p.v.
-- "BREED" -- die kregen 'vast' of 'overig'. Gevolg: snijplanning matcht ze wel (via
-- rollen.kwaliteit_code/kleur_code), maar de productie-only artikelnr-fix niet (die
-- filtert op product_type='rol'). Voorbeelden: GOLD 17 (1428006), GOKI 12 (1431000),
-- ANNA 35, PARA, LORA, BANG.
--
-- Feit-gebaseerde, veilige regel: heeft een product >=1 fysieke rol in `rollen`,
-- dan IS het een broadloom-rol. rollen.artikelnr FK -> producten (100% overlap, schema).

-- ============================================================================
-- PRE-CHECK: welke producten zouden ge-her-typeerd worden? (draai eerst los)
-- ============================================================================
-- SELECT p.product_type, count(*) AS aantal
-- FROM producten p
-- WHERE p.artikelnr IN (SELECT DISTINCT artikelnr FROM rollen WHERE artikelnr IS NOT NULL)
--   AND p.product_type <> 'rol'
-- GROUP BY p.product_type ORDER BY aantal DESC;

-- ============================================================================
-- FIX
-- ============================================================================
UPDATE producten p
   SET product_type = 'rol'
 WHERE p.artikelnr IN (SELECT DISTINCT artikelnr FROM rollen WHERE artikelnr IS NOT NULL)
   AND p.product_type <> 'rol';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- DAARNA: her-run scripts/fix_productie_only_artikelnr.sql
-- (idempotent -- koppelt nu ook de net-her-getypeerde rol-producten aan de
-- productie-only regels die nog artikelnr IS NULL hebben).
-- ============================================================================
