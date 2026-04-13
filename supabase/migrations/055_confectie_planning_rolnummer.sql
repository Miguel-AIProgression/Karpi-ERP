-- Migration 055: Rolnummer toevoegen aan confectie_planning_overzicht
-- Zodat planning-cards de fysieke locatie (rol) van het tapijt tonen.

DROP VIEW IF EXISTS confectie_planning_overzicht CASCADE;

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
  GREATEST(
    COALESCE(so.snij_lengte_cm, 0),
    COALESCE(so.snij_breedte_cm, 0)
  )                                             AS strekkende_meter_cm
FROM snijplanning_overzicht so
WHERE so.status IN ('Gesneden', 'In confectie');

COMMENT ON VIEW confectie_planning_overzicht IS
  'Planningsweergave voor confectie: snijplannen met status Gesneden/In confectie, inclusief rol (locatie).';
