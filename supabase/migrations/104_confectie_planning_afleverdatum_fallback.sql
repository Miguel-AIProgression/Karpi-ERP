-- Migration 104: confectie_planning_forward — afleverdatum fallback naar orders
--
-- Probleem: de view nam `snijplannen.afleverdatum` over. Webshop-orders krijgen
-- die kolom vaak NIET ingevuld (alleen `orders.afleverdatum`), waardoor de
-- sortering in de confectie-planning "onbepaald" was en stukken met een
-- vroegere leverdatum onderaan kwamen.
--
-- Fix: COALESCE(sp.afleverdatum, o.afleverdatum) — valt terug op de order als
-- de snijplan-kolom leeg is. Idem voor confectie_startdatum (die gebruikt
-- dezelfde bron).

DROP VIEW IF EXISTS confectie_planning_forward CASCADE;

CREATE VIEW confectie_planning_forward AS
SELECT
  sp.id                                 AS snijplan_id,
  sp.snijplan_nr                        AS snijplan_nr,
  sp.scancode                           AS scancode,
  sp.status                             AS snijplan_status,
  sp.id                                 AS confectie_id,
  sp.snijplan_nr                        AS confectie_nr,
  sp.status                             AS status,
  at.type_bewerking                     AS type_bewerking,
  sp.order_regel_id                     AS order_regel_id,
  orr.order_id                          AS order_id,
  o.order_nr                            AS order_nr,
  d.naam                                AS klant_naam,
  orr.maatwerk_afwerking                AS maatwerk_afwerking,
  orr.maatwerk_band_kleur               AS maatwerk_band_kleur,
  orr.maatwerk_instructies              AS maatwerk_instructies,
  orr.maatwerk_vorm                     AS maatwerk_vorm,
  orr.maatwerk_vorm                     AS vorm,
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS breedte_cm,
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS snij_lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS snij_breedte_cm,
  CASE
    WHEN lower(COALESCE(orr.maatwerk_vorm, '')) IN ('rond', 'ovaal') THEN
      (pi() * GREATEST(COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0),
                       COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
    ELSE
      (2 * (COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0) +
            COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
  END                                   AS strekkende_meter_cm,
  r.id                                  AS rol_id,
  r.rolnummer                           AS rolnummer,
  orr.maatwerk_kwaliteit_code           AS kwaliteit_code,
  orr.maatwerk_kleur_code               AS kleur_code,
  -- Afleverdatum: val terug op orders.afleverdatum als snijplan-kolom leeg is
  COALESCE(sp.afleverdatum, o.afleverdatum) AS afleverdatum,
  sp.confectie_afgerond_op              AS confectie_afgerond_op,
  sp.ingepakt_op                        AS ingepakt_op,
  sp.locatie                            AS locatie,
  CASE
    WHEN sp.status = 'Gesneden' AND r.snijden_voltooid_op IS NOT NULL
      THEN r.snijden_voltooid_op + (confectie_buffer_minuten() || ' minutes')::interval
    ELSE NULL
  END                                   AS confectie_klaar_op,
  -- Startdatum: zelfde fallback
  CASE
    WHEN sp.status IN ('Gesneden', 'In confectie') THEN CURRENT_DATE
    WHEN sp.status = 'Snijden'                     THEN CURRENT_DATE
    WHEN sp.gesneden_datum IS NOT NULL             THEN sp.gesneden_datum
    WHEN COALESCE(sp.afleverdatum, o.afleverdatum) IS NOT NULL
                                                   THEN (COALESCE(sp.afleverdatum, o.afleverdatum) - INTERVAL '2 days')::date
    ELSE CURRENT_DATE
  END::date                             AS confectie_startdatum,
  sp.opmerkingen                        AS opmerkingen
FROM snijplannen sp
LEFT JOIN order_regels orr  ON orr.id        = sp.order_regel_id
LEFT JOIN orders o          ON o.id          = orr.order_id
LEFT JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN rollen r          ON r.id          = sp.rol_id
LEFT JOIN afwerking_types at ON at.code      = orr.maatwerk_afwerking
WHERE sp.status IN ('Gepland', 'Wacht', 'Snijden', 'Gesneden', 'In confectie', 'Ingepakt')
  AND sp.rol_id IS NOT NULL
  AND NOT (
    sp.status = 'Gesneden'
    AND r.snijden_voltooid_op IS NOT NULL
    AND r.snijden_voltooid_op + (confectie_buffer_minuten() || ' minutes')::interval > NOW()
  );

COMMENT ON VIEW confectie_planning_forward IS
  'Vooruitkijkende confectie-lijst: open maatwerk-snijplannen met rol toegewezen. Afleverdatum valt terug op orders.afleverdatum als snijplan-kolom leeg is. Gesneden stukken wachten confectie_buffer_minuten() na snijden_voltooid_op. Biedt zowel nieuwe (snijplan_*) als legacy (confectie_*, snij_*) kolomnamen voor backward compatibility.';
