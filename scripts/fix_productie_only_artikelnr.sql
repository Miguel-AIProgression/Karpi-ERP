-- Datafix: koppel een product (artikelnr) aan de productie-only order_regels.
--
-- Mig 329 liet artikelnr bewust NULL ("productie-only heeft geen echt artikel"),
-- maar in de order-detail staan Artikel + Karpi-code daardoor leeg. Een maatwerk-
-- regel hoort in RugFlow naar het 'rol'-broadloomproduct te verwijzen (zelfde
-- patroon als auto_markeer_maatwerk: product_type='rol' => is_maatwerk). We koppelen
-- daarom per regel het 'rol'-product dat matcht op (kwaliteit_code, kleur_code).
--
-- VEILIG voor de allocator: de UPDATE van artikelnr vuurt trg_orderregel_herallocateer,
-- maar herallocateer_orderregel (mig 297) doet bij is_maatwerk=TRUE enkel een
-- claim-release + RETURN -- geen voorraadreservering / IO-claims. Diezelfde trigger
-- vuurde al bij de import (AFTER INSERT met is_maatwerk=TRUE), dus dit voegt geen
-- nieuw gedrag toe.
--
-- Kleur-match via normaliseer_kleur_code() (zoals mig 142) -- '16' == '16.0'.
-- Bij meerdere rol-producten per (kw,kl): deterministisch het actieve/meest-op-
-- voorraad product. Regels van een (kw,kl) ZONDER rol-product blijven NULL
-- (echt gat -> product ontbreekt in producten; zie de telquery onderaan).

-- ============================================================================
-- PRE-CHECK (optioneel): hoeveel regels matchen / blijven liggen?
-- ============================================================================
-- SELECT
--   count(*)                                            AS totaal_productie_regels,
--   count(*) FILTER (WHERE oreg.artikelnr IS NOT NULL)  AS al_gekoppeld,
--   count(*) FILTER (WHERE oreg.artikelnr IS NULL)      AS nog_leeg
-- FROM order_regels oreg
-- JOIN orders o ON o.id = oreg.order_id
-- WHERE o.alleen_productie = TRUE;

-- ============================================================================
-- UPDATE
-- ============================================================================
WITH rol_per_kk AS (
  SELECT DISTINCT ON (p.kwaliteit_code, normaliseer_kleur_code(p.kleur_code))
         p.kwaliteit_code                     AS kwaliteit_code,
         normaliseer_kleur_code(p.kleur_code) AS kleur_norm,
         p.artikelnr                          AS artikelnr
  FROM producten p
  WHERE p.product_type = 'rol'
    AND p.kwaliteit_code IS NOT NULL
    AND p.kleur_code     IS NOT NULL
  ORDER BY p.kwaliteit_code,
           normaliseer_kleur_code(p.kleur_code),
           p.actief DESC NULLS LAST,
           p.voorraad DESC NULLS LAST,
           p.artikelnr
)
UPDATE order_regels oreg
   SET artikelnr = rk.artikelnr
  FROM orders o, rol_per_kk rk
 WHERE oreg.order_id        = o.id
   AND o.alleen_productie   = TRUE
   AND oreg.is_maatwerk     = TRUE
   AND oreg.artikelnr IS NULL
   AND rk.kwaliteit_code    = oreg.maatwerk_kwaliteit_code
   AND rk.kleur_norm        = normaliseer_kleur_code(oreg.maatwerk_kleur_code);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NA-CHECK: welke (kwaliteit, kleur) bleven ongekoppeld (geen rol-product)?
-- ============================================================================
-- SELECT oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code, count(*) AS regels
-- FROM order_regels oreg
-- JOIN orders o ON o.id = oreg.order_id
-- WHERE o.alleen_productie = TRUE AND oreg.is_maatwerk = TRUE AND oreg.artikelnr IS NULL
-- GROUP BY 1, 2 ORDER BY regels DESC;
