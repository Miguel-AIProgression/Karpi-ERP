-- Diagnose: classificeer de productie-only order_regels die NA de artikelnr-fix
-- nog geen product hebben (artikelnr IS NULL). Per (kwaliteit, kleur):
--   rol_prod_exact      > 0  => er IS een matchend rol-product -> match had moeten lukken (bug)
--   rol_prod_zelfde_kw  > 0 (maar exact=0) => rol-product bestaat in ANDERE kleur (kleur_code-mismatch)
--   rol_prod_zelfde_kw  = 0  => geen enkel rol-product voor deze kwaliteit (echt product-gat)
--   rollen_exact        > 0  => er zijn fysieke rollen (snijplanning kan plannen; product hoort te bestaan)
--
-- Draai dit en plak de output -> dan kies ik per categorie de juiste vervolgfix.

WITH ongekoppeld AS (
  SELECT oreg.maatwerk_kwaliteit_code AS kw,
         oreg.maatwerk_kleur_code     AS kl,
         count(*)                     AS regels
  FROM order_regels oreg
  JOIN orders o ON o.id = oreg.order_id
  WHERE o.alleen_productie = TRUE
    AND oreg.is_maatwerk   = TRUE
    AND oreg.artikelnr IS NULL
  GROUP BY 1, 2
)
SELECT
  u.kw, u.kl, u.regels,
  (SELECT count(*) FROM producten p
     WHERE p.product_type = 'rol' AND p.kwaliteit_code = u.kw)                                   AS rol_prod_zelfde_kw,
  (SELECT count(*) FROM producten p
     WHERE p.product_type = 'rol' AND p.kwaliteit_code = u.kw
       AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(u.kl))                  AS rol_prod_exact,
  (SELECT count(*) FROM rollen r
     WHERE r.kwaliteit_code = u.kw
       AND normaliseer_kleur_code(r.kleur_code) = normaliseer_kleur_code(u.kl))                  AS rollen_exact,
  (SELECT string_agg(DISTINCT normaliseer_kleur_code(p.kleur_code), ',' ORDER BY normaliseer_kleur_code(p.kleur_code))
     FROM producten p WHERE p.product_type='rol' AND p.kwaliteit_code = u.kw)                    AS rol_prod_kleuren
FROM ongekoppeld u
ORDER BY u.regels DESC, u.kw, u.kl;
