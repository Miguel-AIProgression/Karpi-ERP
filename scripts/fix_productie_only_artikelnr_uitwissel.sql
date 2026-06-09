-- Categorie A (uitwissel): koppel productie-only regels zonder EIGEN rol-product aan
-- het broadloom-product van een UITWISSELBARE partner-kwaliteit (zelfde collectie +
-- kleur). Domein: VERNON 17 / LUXURY 17 / SHADE 17 zijn voor maatwerk EEN fysieke rol
-- (de LUXR 17 broadloom) waar alle uitwisselbare kwaliteiten uit gesneden worden. Het
-- systeem weet dit via uitwisselbare_paren() (mig 138/142, bron = kwaliteiten.collectie_id
-- + genormaliseerde kleur). Dus VERR 17 -> artikelnr van LUXR 17.
--
-- VOLGORDE: draai NA
--   1. fix_producten_rol_type.sql        (broadloom -> product_type='rol')
--   2. fix_productie_only_artikelnr.sql  (eigen rol-product, indien aanwezig)
-- zodat alleen regels overblijven die via een partner gedekt moeten worden.
--
-- GEVOLG voor de snijplanning (bewust/correct): een nog-ongeplande VERR 17-regel
-- toont na koppeling onder LUXR 17 (snijplanning_overzicht COALESCEt p.kwaliteit_code
-- vóór oreg.maatwerk_kwaliteit_code). Dat klopt met het fysieke model "1 type rol" --
-- al GEPLANDE stukken stonden al onder de rol-kwaliteit (r.*). De order-omschrijving
-- blijft "VERNON ..." (oreg.omschrijving ongewijzigd); alleen Artikel/Karpi-code wijst
-- naar de echte rol.
--
-- NB: de match wordt in een CTE (SELECT) berekend -- daar mág de gecorreleerde
-- subquery naar oreg verwijzen. In de UPDATE zelf kan de doeltabel niet vanuit een
-- LATERAL in FROM gerefereerd worden (PostgreSQL 42P10). is_zelf DESC: eigen kwaliteit
-- wint indien die toch een rol-product heeft. Idempotent: raakt alleen artikelnr IS NULL.

WITH te_koppelen AS (
  SELECT oreg.id AS regel_id,
         (SELECT p.artikelnr
            FROM uitwisselbare_paren(oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code) up
            JOIN producten p
              ON p.product_type   = 'rol'
             AND p.kwaliteit_code = up.target_kwaliteit_code
             AND normaliseer_kleur_code(p.kleur_code) = up.target_kleur_code
           ORDER BY up.is_zelf DESC,
                    p.actief   DESC NULLS LAST,
                    p.voorraad DESC NULLS LAST,
                    p.artikelnr
           LIMIT 1) AS nieuw_artikelnr
  FROM order_regels oreg
  JOIN orders o ON o.id = oreg.order_id
  WHERE o.alleen_productie = TRUE
    AND oreg.is_maatwerk   = TRUE
    AND oreg.artikelnr IS NULL
    AND oreg.maatwerk_kwaliteit_code IS NOT NULL
    AND oreg.maatwerk_kwaliteit_code <> ''
)
UPDATE order_regels oreg
   SET artikelnr = tk.nieuw_artikelnr
  FROM te_koppelen tk
 WHERE oreg.id = tk.regel_id
   AND tk.nieuw_artikelnr IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NA-CHECK: wat blijft NULL na de uitwissel-koppeling? (geen eigen EN geen partner
-- met een rol-product -> categorie A-zonder-broadloom + categorie 3). Voor die rest
-- volgt fix_productie_only_maak_broadloom_producten.sql (synthetisch 0-voorraad).
-- ============================================================================
-- SELECT oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code, count(*) AS regels
-- FROM order_regels oreg JOIN orders o ON o.id = oreg.order_id
-- WHERE o.alleen_productie AND oreg.is_maatwerk AND oreg.artikelnr IS NULL
-- GROUP BY 1,2 ORDER BY regels DESC;
