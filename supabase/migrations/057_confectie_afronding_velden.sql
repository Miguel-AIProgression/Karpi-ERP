-- Migration 057: Velden voor confectie-afronding op snijplannen
-- - confectie_afgerond_op: timestamp wanneer confectie klaar was (stuk nog niet ingepakt)
-- - ingepakt_op: timestamp wanneer ingepakt voor verzending (status gaat dan naar 'Gereed')
-- - locatie: vrij tekstveld met fysieke locatie van het afgeronde stuk (bv. "Rek A-12")

ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS confectie_afgerond_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingepakt_op           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locatie               TEXT;

-- Herdefinieer overzichten zodat de nieuwe velden beschikbaar zijn
DROP VIEW IF EXISTS snijplanning_overzicht CASCADE;

CREATE VIEW snijplanning_overzicht AS
SELECT
  sp.id,
  sp.snijplan_nr,
  sp.scancode,
  sp.status,
  sp.rol_id,
  sp.lengte_cm    AS snij_lengte_cm,
  sp.breedte_cm   AS snij_breedte_cm,
  sp.prioriteit,
  sp.planning_week,
  sp.planning_jaar,
  sp.afleverdatum,
  sp.positie_x_cm,
  sp.positie_y_cm,
  sp.geroteerd,
  sp.gesneden_datum,
  sp.gesneden_op,
  sp.gesneden_door,
  sp.confectie_afgerond_op,
  sp.ingepakt_op,
  sp.locatie      AS snijplan_locatie,
  -- Rol info
  r.rolnummer,
  r.breedte_cm    AS rol_breedte_cm,
  r.lengte_cm     AS rol_lengte_cm,
  r.oppervlak_m2  AS rol_oppervlak_m2,
  r.status        AS rol_status,
  r.locatie       AS locatie,
  -- Product/kwaliteit info (COALESCE: rollen → producten → maatwerk)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, ore.maatwerk_kwaliteit_code) AS kwaliteit_code,
  COALESCE(r.kleur_code, p.kleur_code, ore.maatwerk_kleur_code) AS kleur_code,
  ore.artikelnr,
  p.omschrijving  AS product_omschrijving,
  p.karpi_code,
  -- Maatwerk specs
  ore.maatwerk_vorm,
  ore.maatwerk_lengte_cm,
  ore.maatwerk_breedte_cm,
  ore.maatwerk_afwerking,
  ore.maatwerk_band_kleur,
  ore.maatwerk_instructies,
  ore.orderaantal,
  -- Order info
  ore.id           AS order_regel_id,
  o.id             AS order_id,
  o.order_nr,
  o.debiteur_nr,
  d.naam           AS klant_naam
FROM snijplannen sp
JOIN order_regels ore ON ore.id = sp.order_regel_id
JOIN orders o         ON o.id = ore.order_id
JOIN debiteuren d     ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p ON p.artikelnr = ore.artikelnr
LEFT JOIN rollen r    ON r.id = sp.rol_id;

CREATE VIEW confectie_planning_overzicht AS
SELECT
  so.id                                         AS confectie_id,
  so.snijplan_nr                                AS confectie_nr,
  so.scancode,
  so.status::TEXT                               AS status,
  confectie_bewerking_voor_afwerking(so.maatwerk_afwerking) AS type_bewerking,
  so.order_regel_id,
  so.order_id,
  so.order_nr,
  so.klant_naam,
  so.afleverdatum,
  so.kwaliteit_code,
  so.kleur_code,
  so.rol_id,
  so.rolnummer,
  so.snij_lengte_cm                             AS lengte_cm,
  so.snij_breedte_cm                            AS breedte_cm,
  so.maatwerk_vorm                              AS vorm,
  so.maatwerk_afwerking,
  so.maatwerk_band_kleur,
  so.maatwerk_instructies,
  so.confectie_afgerond_op,
  so.ingepakt_op,
  so.snijplan_locatie                           AS locatie,
  GREATEST(
    COALESCE(so.snij_lengte_cm, 0),
    COALESCE(so.snij_breedte_cm, 0)
  )                                             AS strekkende_meter_cm
FROM snijplanning_overzicht so
WHERE so.status IN ('Gesneden', 'In confectie');

COMMENT ON VIEW confectie_planning_overzicht IS
  'Planningsweergave voor confectie: snijplannen met status Gesneden/In confectie, inclusief afronding- en locatievelden.';
