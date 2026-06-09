-- Categorie B: ongekoppelde productie-only regels waarvoor WEL fysieke rollen bestaan.
-- Toont het backing-product van die rollen: waarom matchte mijn product_type='rol'-fix
-- niet, en is de kleur_code correct (= veilig om te koppelen zonder de snijplanning-
-- groepering te vervuilen via COALESCE in snijplanning_overzicht)?
--
-- Verwacht patroon: prod_type <> 'rol' (mis-getypeerd) maar prod_kw=maatwerk_kw en
-- prod_kl=maatwerk_kl => veilig koppelen. Wijkt prod_kl af => eerst producten-coding fixen.

SELECT DISTINCT
  oreg.maatwerk_kwaliteit_code               AS maatwerk_kw,
  oreg.maatwerk_kleur_code                   AS maatwerk_kl,
  p.artikelnr,
  p.product_type                             AS prod_type,
  p.kwaliteit_code                           AS prod_kw,
  p.kleur_code                               AS prod_kl,
  p.karpi_code,
  (p.kwaliteit_code = oreg.maatwerk_kwaliteit_code
   AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(oreg.maatwerk_kleur_code))
                                             AS coding_klopt
FROM order_regels oreg
JOIN orders o   ON o.id = oreg.order_id
JOIN rollen r   ON r.kwaliteit_code = oreg.maatwerk_kwaliteit_code
               AND normaliseer_kleur_code(r.kleur_code) = normaliseer_kleur_code(oreg.maatwerk_kleur_code)
JOIN producten p ON p.artikelnr = r.artikelnr
WHERE o.alleen_productie = TRUE
  AND oreg.is_maatwerk   = TRUE
  AND oreg.artikelnr IS NULL
ORDER BY maatwerk_kw, maatwerk_kl;
