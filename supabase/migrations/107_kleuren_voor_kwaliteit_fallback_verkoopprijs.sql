-- Migration 107: kleuren_voor_kwaliteit — fallback naar MAATWERK-artikel prijs
--
-- Vervolg op 105 + 106. Probleem: VELV 16 heeft geen `maatwerk_m2_prijzen`-rij,
-- dus `verkoopprijs_m2` komt NULL terug terwijl VELV16MAATWERK (771169998) wel
-- een `verkoopprijs=24.26` heeft. De UI viel daarom terug op `equiv_m2_prijs`
-- (CISC's 19.86) voor de eigen kleur — onjuist: klant bestelt VELV 16 en hoort
-- de VELV-prijs te zien.
--
-- Fix: `verkoopprijs_m2` krijgt nu een COALESCE-keten:
--  1. maatwerk_m2_prijzen.verkoopprijs_m2 (kleur-specifiek, autoritatief)
--  2. producten.verkoopprijs van het MAATWERK-artikel voor deze kwaliteit+
--     kleur (beschikbaar sinds backfill in 106)
--
-- Idem voor `kostprijs_m2` (geen product-fallback — blijft NULL als niet in
-- maatwerk_m2_prijzen). Zelfde voor `gewicht_per_m2_kg`, `max_breedte_cm`:
-- die vallen terug op de rol-producten (SYN-variant) via kwaliteiten-
-- tabel, maar dat is niet kritiek voor deze fix. Laten we conservatief.

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
uitwissel_koppel AS (
  SELECT u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND u2.kwaliteit_code <> u1.kwaliteit_code
  WHERE u1.kwaliteit_code = p_kwaliteit
),
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
-- m²-prijs van de uitwisselbare: eerst maatwerk_m2_prijzen, anders
-- verkoopprijs van het MAATWERK-product (dankzij backfill 106 koppelbaar).
uit_m2_prijs AS (
  SELECT bu.onze_kleur,
         COALESCE(
           (SELECT mp.verkoopprijs_m2 FROM maatwerk_m2_prijzen mp
             WHERE mp.kwaliteit_code = bu.uit_kwaliteit AND mp.kleur_code = bu.uit_kleur LIMIT 1),
           (SELECT p.verkoopprijs FROM producten p
             WHERE p.kwaliteit_code = bu.uit_kwaliteit
               AND p.kleur_code = bu.uit_kleur
               AND p.actief = true
               AND (p.product_type = 'overig'
                    OR p.karpi_code   ILIKE '%maatwerk%'
                    OR p.omschrijving ILIKE '%maatwerk%')
             ORDER BY (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END), p.artikelnr
             LIMIT 1)
         ) AS prijs
  FROM beste_uitwissel bu
),
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
),
-- MAATWERK-artikel van de EIGEN kwaliteit+kleur (gebruikt voor fallback-prijs)
eigen_maatwerk_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.verkoopprijs
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.actief = true
    AND (p.product_type = 'overig'
         OR p.karpi_code   ILIKE '%maatwerk%'
         OR p.omschrijving ILIKE '%maatwerk%')
  ORDER BY p.kleur_code, (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END), p.artikelnr
)
SELECT
  ku.kc                                    AS kleur_code,
  REPLACE(ku.kc, '.0', '')                 AS kleur_label,
  COALESCE(ra.omschrijving, '')            AS omschrijving,
  -- Verkoopprijs m²: eerst maatwerk_m2_prijzen (autoritatief), anders de
  -- verkoopprijs van het MAATWERK-product voor deze kwaliteit+kleur.
  COALESCE(mp.verkoopprijs_m2, ema.verkoopprijs) AS verkoopprijs_m2,
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
LEFT JOIN eigen_maatwerk_artikel ema ON ema.kleur_code = ku.kc
ORDER BY ku.kc;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION kleuren_voor_kwaliteit(TEXT) IS
  'Kleuren voor een kwaliteit met rol-voorraad én uitwisselbare-rol info. '
  'verkoopprijs_m2 valt terug op de verkoopprijs van het MAATWERK-product '
  'als er geen maatwerk_m2_prijzen-rij bestaat. equiv_* velden wijzen naar '
  'een uitwisselbare kwaliteit+kleur; UI gebruikt equiv_artikelnr als '
  'fysiek_artikelnr (omstickeer-model).';
