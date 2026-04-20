-- Migration 103: Confectie-buffer minuten + alleen-op-planning filter
--
-- Context: na het afronden van een rol (voltooi_snijplan_rol → rollen.snijden_voltooid_op)
-- verschijnen de gesneden stukken direct in de confectie-planning. In de praktijk moet
-- een stuk nog fysiek naar het confectiestation, dus er is een korte overbrugtijd nodig
-- voordat het werk daadwerkelijk kan beginnen.
--
-- Tweede probleem: snijplannen zonder toegewezen rol (status 'Wacht'/'Gepland' maar
-- nog niet in een snijvoorstel) verschijnen óók in de confectielijst, terwijl er nog
-- niets fysiek bestaat. Die moeten weg.
--
-- Deze migratie:
--   1. Zet default `confectie_buffer_minuten = 15` in `app_config.productie_planning`
--   2. Maakt helper-functie `confectie_buffer_minuten()` die de waarde uit de config leest
--      (fallback 15 als config ontbreekt)
--   3. Update view `confectie_planning_forward`:
--      - Alleen stukken met `rol_id IS NOT NULL` (dus daadwerkelijk op een rol ingepland)
--      - Gesneden stukken verschijnen pas na `snijden_voltooid_op + buffer`

-- 1) Seed default config-waarde (non-destructief: behoudt andere velden)
UPDATE app_config
   SET waarde = waarde || jsonb_build_object('confectie_buffer_minuten', 15)
 WHERE sleutel = 'productie_planning'
   AND NOT (waarde ? 'confectie_buffer_minuten');

-- 2) Helper-functie: lees buffer uit config, fallback 15
CREATE OR REPLACE FUNCTION confectie_buffer_minuten()
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (waarde ->> 'confectie_buffer_minuten')::integer
       FROM app_config
      WHERE sleutel = 'productie_planning'),
    15
  );
$$;

COMMENT ON FUNCTION confectie_buffer_minuten() IS
  'Leest buffer-minuten uit app_config.productie_planning.confectie_buffer_minuten. Default 15.';

-- 3) View herbouwen met buffer-filter in WHERE clause
DROP VIEW IF EXISTS confectie_planning_forward;

CREATE VIEW confectie_planning_forward AS
SELECT
  -- Primaire identifiers (nieuwe namen)
  sp.id                                 AS snijplan_id,
  sp.snijplan_nr                        AS snijplan_nr,
  sp.scancode                           AS scancode,
  sp.status                             AS snijplan_status,

  -- Alias-kolommen zodat bestaande components blijven werken
  sp.id                                 AS confectie_id,
  sp.snijplan_nr                        AS confectie_nr,
  sp.status                             AS status,

  -- Lane + derived velden
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

  -- Aliassen voor overview-tabel (SnijplanRow.snij_*)
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS snij_lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS snij_breedte_cm,

  -- Strekkende meter in cm (rechthoek: 2×(l+b), rond/ovaal: π×max(l,b))
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
  sp.afleverdatum                       AS afleverdatum,

  -- Afrond-velden
  sp.confectie_afgerond_op              AS confectie_afgerond_op,
  sp.ingepakt_op                        AS ingepakt_op,
  sp.locatie                            AS locatie,

  -- Moment waarop het stuk klaar is voor confectie
  -- (voor gesneden stukken: snijden_voltooid_op + buffer)
  CASE
    WHEN sp.status = 'Gesneden' AND r.snijden_voltooid_op IS NOT NULL
      THEN r.snijden_voltooid_op + (confectie_buffer_minuten() || ' minutes')::interval
    ELSE NULL
  END                                   AS confectie_klaar_op,

  -- Beste schatting wanneer het stuk de confectie binnenkomt (datumniveau)
  CASE
    WHEN sp.status IN ('Gesneden', 'In confectie') THEN CURRENT_DATE
    WHEN sp.status = 'Snijden'                     THEN CURRENT_DATE
    WHEN sp.gesneden_datum IS NOT NULL             THEN sp.gesneden_datum
    WHEN sp.afleverdatum IS NOT NULL               THEN (sp.afleverdatum - INTERVAL '2 days')::date
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
  -- Alleen stukken die daadwerkelijk op een rol zijn ingepland
  AND sp.rol_id IS NOT NULL
  -- Buffer-filter: gesneden stukken verschijnen pas na snijden_voltooid_op + buffer
  AND NOT (
    sp.status = 'Gesneden'
    AND r.snijden_voltooid_op IS NOT NULL
    AND r.snijden_voltooid_op + (confectie_buffer_minuten() || ' minutes')::interval > NOW()
  );

COMMENT ON VIEW confectie_planning_forward IS
  'Vooruitkijkende confectie-lijst: open maatwerk-snijplannen met rol toegewezen en afgeleide type_bewerking. Gesneden stukken worden pas getoond nadat rollen.snijden_voltooid_op + confectie_buffer_minuten() verstreken is. Snijplannen zonder rol (status Wacht/Gepland maar niet in snijvoorstel) verschijnen NIET. Biedt zowel nieuwe (snijplan_*) als legacy (confectie_*, snij_*) kolomnamen voor backward compatibility.';
