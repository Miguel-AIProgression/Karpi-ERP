-- Migration 115: uitwissel-RPC's match hoofdoverzicht-filter op status
--
-- rollen_uitwissel_voorraad() en uitwisselbare_partners() filterden alleen
-- op r.status='beschikbaar'. Maar het hoofdoverzicht (fetchRollenGegroepeerd)
-- toont alle rollen behalve 'verkocht' en 'gesneden'. Gevolg: een rol met
-- status 'gereserveerd', 'in_snijplan' of 'reststuk' verschijnt wél als
-- "1× VOLLE ROL" in de eigen groep, maar telt niét als voorraad voor een
-- uitwisselpartner-chip. Dat leidt tot grijze chips ("geen voorraad") terwijl
-- er visueel wel 1 rol staat.
--
-- Fix: beide RPC's filteren nu op status NOT IN ('verkocht', 'gesneden'),
-- consistent met het hoofdoverzicht. oppervlak_m2 > 0 blijft staan om
-- placeholder-rollen uit te sluiten.

CREATE OR REPLACE FUNCTION rollen_uitwissel_voorraad()
RETURNS TABLE(
  kwaliteit_code       TEXT,
  kleur_code           TEXT,
  equiv_kwaliteit_code TEXT,
  equiv_kleur_code     TEXT,
  equiv_rollen         INTEGER,
  equiv_m2             NUMERIC
) AS $$
WITH
koppel AS (
  SELECT u1.kwaliteit_code AS onze_kwaliteit,
         u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
),
agg AS (
  SELECT k.onze_kwaliteit,
         k.onze_kleur,
         k.uit_kwaliteit,
         k.uit_kleur,
         COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0)::INTEGER          AS aantal,
         COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS m2
  FROM koppel k
  LEFT JOIN rollen r
    ON r.kwaliteit_code = k.uit_kwaliteit
   AND r.kleur_code = k.uit_kleur
   AND r.status NOT IN ('verkocht', 'gesneden')
  GROUP BY k.onze_kwaliteit, k.onze_kleur, k.uit_kwaliteit, k.uit_kleur
)
SELECT DISTINCT ON (a.onze_kwaliteit, a.onze_kleur)
  a.onze_kwaliteit,
  a.onze_kleur,
  a.uit_kwaliteit,
  a.uit_kleur,
  a.aantal,
  a.m2
FROM agg a
WHERE a.aantal > 0
ORDER BY a.onze_kwaliteit, a.onze_kleur, a.m2 DESC, a.uit_kwaliteit;
$$ LANGUAGE sql STABLE;


CREATE OR REPLACE FUNCTION uitwisselbare_partners()
RETURNS TABLE(
  kwaliteit_code         TEXT,
  kleur_code             TEXT,
  partner_kwaliteit_code TEXT,
  partner_kleur_code     TEXT,
  partner_rollen         INTEGER,
  partner_m2             NUMERIC
) AS $$
SELECT
  u1.kwaliteit_code                                                           AS kwaliteit_code,
  u1.kleur_code                                                               AS kleur_code,
  u2.kwaliteit_code                                                           AS partner_kwaliteit_code,
  u2.kleur_code                                                               AS partner_kleur_code,
  COALESCE(COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0), 0)::INTEGER         AS partner_rollen,
  COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS partner_m2
FROM kwaliteit_kleur_uitwisselgroepen u1
JOIN kwaliteit_kleur_uitwisselgroepen u2
  ON u2.basis_code = u1.basis_code
 AND u2.variant_nr = u1.variant_nr
 AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
LEFT JOIN rollen r
  ON r.kwaliteit_code = u2.kwaliteit_code
 AND r.kleur_code = u2.kleur_code
 AND r.status NOT IN ('verkocht', 'gesneden')
GROUP BY u1.kwaliteit_code, u1.kleur_code, u2.kwaliteit_code, u2.kleur_code
ORDER BY u1.kwaliteit_code, u1.kleur_code, partner_m2 DESC, u2.kwaliteit_code;
$$ LANGUAGE sql STABLE;
