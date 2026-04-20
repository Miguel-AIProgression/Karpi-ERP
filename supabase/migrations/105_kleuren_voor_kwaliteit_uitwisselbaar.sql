-- Migration 105: kleuren_voor_kwaliteit — uitwisselbare rollen als alternatief
--
-- Probleem: VELV 16 heeft geen eigen rollen en geen maatwerk_m2_prijs, terwijl
-- CISC 16 (uitwisselbaar via kwaliteit_kleur_uitwisselgroepen met basis_code
-- 'CISC16', variant_nr 2) wel 3 rollen = 138 m² op voorraad heeft. De huidige
-- RPC retourneerde `equiv_rollen=0` voor alle kleuren en liet kleuren zonder
-- eigen voorraad of eigen m²-prijs helemaal weg. Daardoor kon de Op-maat UI de
-- uitwisselbare rol niet aanbieden.
--
-- Fix:
--  1. Geef ook kleuren terug die alleen via uitwisselgroep te bereiken zijn.
--  2. Vul equiv_rollen / equiv_m2 uit `rollen` van uitwisselbare kwaliteiten.
--  3. Nieuwe velden: equiv_kwaliteit_code, equiv_artikelnr, equiv_m2_prijs —
--     zodat de frontend de swap kan maken (intern ander rol snijden) terwijl
--     de factuur de bestelde kwaliteit/kleur behoudt (omstickeer-model).
--
-- Breaking change: het retourtype krijgt 3 extra kolommen. DROP + CREATE omdat
-- RETURNS TABLE-signatuur wijzigt.

DROP FUNCTION IF EXISTS kleuren_voor_kwaliteit(TEXT);

CREATE FUNCTION kleuren_voor_kwaliteit(p_kwaliteit TEXT)
RETURNS TABLE(
  kleur_code           TEXT,
  kleur_label          TEXT,
  omschrijving         TEXT,
  verkoopprijs_m2      NUMERIC,
  kostprijs_m2         NUMERIC,
  gewicht_per_m2_kg    NUMERIC,
  max_breedte_cm       INTEGER,
  artikelnr            TEXT,
  karpi_code           TEXT,
  aantal_rollen        INTEGER,
  beschikbaar_m2       NUMERIC,
  equiv_rollen         INTEGER,
  equiv_m2             NUMERIC,
  equiv_kwaliteit_code TEXT,
  equiv_artikelnr      TEXT,
  equiv_m2_prijs       NUMERIC
) AS $$
WITH
-- Alle kleuren die relevant zijn voor p_kwaliteit: eigen m²-prijs, eigen
-- product, of een uitwisselgroep-koppeling (waardoor een andere kwaliteit
-- leverbaar zou zijn).
kleur_universe AS (
  SELECT kc FROM (
    SELECT mp.kleur_code AS kc FROM maatwerk_m2_prijzen mp
      WHERE mp.kwaliteit_code = p_kwaliteit
    UNION
    SELECT p.kleur_code FROM producten p
      WHERE p.kwaliteit_code = p_kwaliteit
        AND p.kleur_code IS NOT NULL
        AND p.actief = true
    UNION
    SELECT u.kleur_code FROM kwaliteit_kleur_uitwisselgroepen u
      WHERE u.kwaliteit_code = p_kwaliteit
  ) s
  WHERE kc IS NOT NULL
),
-- Eigen rollen per kleur (status 'beschikbaar' telt mee voor leverbaarheid)
eigen_rollen AS (
  SELECT r.kleur_code,
         COUNT(*)::INTEGER         AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM rollen r
  WHERE r.kwaliteit_code = p_kwaliteit
    AND r.status = 'beschikbaar'
    AND r.kleur_code IS NOT NULL
  GROUP BY r.kleur_code
),
-- Koppelingen: welke andere (kwaliteit,kleur) is uitwisselbaar voor onze
-- (p_kwaliteit, kleur) via gedeeld basis_code + variant_nr.
uitwissel_koppel AS (
  SELECT u1.kleur_code  AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code  AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND u2.kwaliteit_code <> u1.kwaliteit_code
  WHERE u1.kwaliteit_code = p_kwaliteit
),
-- Beschikbare rollen per (onze_kleur, uit_kwaliteit)
uit_rollen_agg AS (
  SELECT uk.onze_kleur,
         uk.uit_kwaliteit,
         uk.uit_kleur,
         COUNT(r.id)::INTEGER      AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM uitwissel_koppel uk
  LEFT JOIN rollen r
    ON r.kwaliteit_code = uk.uit_kwaliteit
   AND r.kleur_code = uk.uit_kleur
   AND r.status = 'beschikbaar'
  GROUP BY uk.onze_kleur, uk.uit_kwaliteit, uk.uit_kleur
),
-- Beste uitwissel-kandidaat per onze_kleur: meeste m² beschikbaar
beste_uitwissel AS (
  SELECT DISTINCT ON (ura.onze_kleur)
    ura.onze_kleur,
    ura.uit_kwaliteit,
    ura.uit_kleur,
    ura.aantal,
    ura.m2
  FROM uit_rollen_agg ura
  WHERE ura.aantal > 0
  ORDER BY ura.onze_kleur, ura.m2 DESC, ura.uit_kwaliteit
),
-- MAATWERK-artikel (voor prijslijst-lookup) van de uitwisselbare kwaliteit+kleur.
-- Voorkeur voor product_type='overig', anders 'maatwerk' in code/naam.
uit_maatwerk_artikel AS (
  SELECT bu.onze_kleur,
         (
           SELECT p.artikelnr
           FROM producten p
           WHERE p.kwaliteit_code = bu.uit_kwaliteit
             AND p.kleur_code = bu.uit_kleur
             AND p.actief = true
             AND (p.product_type = 'overig'
                  OR p.karpi_code   ILIKE '%maatwerk%'
                  OR p.omschrijving ILIKE '%maatwerk%')
           ORDER BY (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
                    p.artikelnr
           LIMIT 1
         ) AS artikelnr
  FROM beste_uitwissel bu
),
-- m²-prijs van de uitwisselbare kwaliteit+kleur
uit_m2_prijs AS (
  SELECT bu.onze_kleur,
         (
           SELECT mp.verkoopprijs_m2
           FROM maatwerk_m2_prijzen mp
           WHERE mp.kwaliteit_code = bu.uit_kwaliteit
             AND mp.kleur_code = bu.uit_kleur
           LIMIT 1
         ) AS prijs
  FROM beste_uitwissel bu
),
-- Rol-product voor onze eigen kleur (SYN-variant) — hieruit komt artikelnr
-- en karpi_code die de UI als basis-referentie gebruikt.
rol_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.artikelnr,
         p.karpi_code,
         p.omschrijving
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.product_type = 'rol'
    AND p.actief = true
  ORDER BY p.kleur_code, p.artikelnr
)
SELECT
  ku.kc                                    AS kleur_code,
  REPLACE(ku.kc, '.0', '')                 AS kleur_label,
  COALESCE(ra.omschrijving, '')            AS omschrijving,
  mp.verkoopprijs_m2                       AS verkoopprijs_m2,
  mp.kostprijs_m2                          AS kostprijs_m2,
  mp.gewicht_per_m2_kg                     AS gewicht_per_m2_kg,
  mp.max_breedte_cm                        AS max_breedte_cm,
  ra.artikelnr                             AS artikelnr,
  ra.karpi_code                            AS karpi_code,
  COALESCE(er.aantal, 0)                   AS aantal_rollen,
  COALESCE(er.m2, 0)                       AS beschikbaar_m2,
  COALESCE(bu.aantal, 0)                   AS equiv_rollen,
  COALESCE(bu.m2, 0)                       AS equiv_m2,
  bu.uit_kwaliteit                         AS equiv_kwaliteit_code,
  uma.artikelnr                            AS equiv_artikelnr,
  ump.prijs                                AS equiv_m2_prijs
FROM kleur_universe ku
LEFT JOIN maatwerk_m2_prijzen mp
       ON mp.kwaliteit_code = p_kwaliteit AND mp.kleur_code = ku.kc
LEFT JOIN rol_artikel ra             ON ra.kleur_code = ku.kc
LEFT JOIN eigen_rollen er            ON er.kleur_code = ku.kc
LEFT JOIN beste_uitwissel bu         ON bu.onze_kleur = ku.kc
LEFT JOIN uit_maatwerk_artikel uma   ON uma.onze_kleur = ku.kc
LEFT JOIN uit_m2_prijs ump           ON ump.onze_kleur = ku.kc
ORDER BY ku.kc;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION kleuren_voor_kwaliteit(TEXT) IS
  'Kleuren voor een kwaliteit met rol-voorraad én uitwisselbare-rol info. '
  'equiv_* velden wijzen naar een andere kwaliteit+kleur in dezelfde '
  'uitwisselgroep (basis_code + variant_nr). UI gebruikt equiv_artikelnr als '
  'fysiek_artikelnr (omstickeer-model) zodat klant bestelde kwaliteit ziet '
  'maar we fysiek uit een uitwisselbare rol snijden.';
