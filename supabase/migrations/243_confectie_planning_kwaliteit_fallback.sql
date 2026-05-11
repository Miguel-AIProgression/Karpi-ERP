-- Migration 243: confectie_planning_forward — kwaliteit/kleur fallback naar rol + product
--
-- Probleem: bij sommige (vaak handmatig aangemaakte of pre-fix-webshop) orders
-- is `order_regels.maatwerk_kwaliteit_code` / `maatwerk_kleur_code` NULL,
-- waardoor de kolom "Kwaliteit / Kleur" op /confectie leeg blijft, terwijl
-- de orderregel duidelijk aan een product hangt met die info (bv. CISC 11
-- SANDRO via artikelnr 1771008).
--
-- Fix: zelfde COALESCE-chain die `snijplanning_overzicht` (mig 233) al hanteert:
--   1. rol (fysiek stuk tapijt → autoritatieve bron als rol toegewezen)
--   2. product (artikelnr op de orderregel)
--   3. maatwerk-snapshot op de orderregel (legacy / webshop-pad)
--
-- Backwards compatibel: alle bestaande kolommen blijven, alleen de twee
-- kwaliteit/kleur-velden krijgen een fallback. WHERE-clausule en JOINs
-- ongewijzigd op één extra LEFT JOIN producten na.
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
  -- Fallback rol → product → maatwerk-snapshot (zie mig 233 snijplanning_overzicht)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, orr.maatwerk_kwaliteit_code) AS kwaliteit_code,
  COALESCE(r.kleur_code,     p.kleur_code,     orr.maatwerk_kleur_code)     AS kleur_code,
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
LEFT JOIN producten p       ON p.artikelnr   = orr.artikelnr
LEFT JOIN afwerking_types at ON at.code      = orr.maatwerk_afwerking
WHERE sp.status IN ('Gepland', 'Wacht', 'Snijden', 'Gesneden', 'In confectie', 'Ingepakt')
  AND sp.rol_id IS NOT NULL
  AND NOT (
    sp.status = 'Gesneden'
    AND r.snijden_voltooid_op IS NOT NULL
    AND r.snijden_voltooid_op + (confectie_buffer_minuten() || ' minutes')::interval > NOW()
  );

COMMENT ON VIEW confectie_planning_forward IS
  'Vooruitkijkende confectie-lijst: open maatwerk-snijplannen met rol toegewezen. Afleverdatum valt terug op orders.afleverdatum als snijplan-kolom leeg is. Kwaliteit/kleur valt terug van rol → product → maatwerk-snapshot zodat handmatig aangemaakte orders zonder maatwerk_kwaliteit_code-snapshot tóch de juiste code tonen. Gesneden stukken wachten confectie_buffer_minuten() na snijden_voltooid_op. Biedt zowel nieuwe (snijplan_*) als legacy (confectie_*, snij_*) kolomnamen voor backward compatibility.';
