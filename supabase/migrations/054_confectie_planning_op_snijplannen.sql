-- Migration 054: Confectie-planning view op snijplannen baseren
--
-- De planning-view moet dezelfde rijen tonen als de Confectielijst (die uit
-- snijplanning_overzicht leest). Voorheen las hij uit confectie_orders, wat
-- kon afwijken (bv. als confectie_orders nog niet was gebackfilled).
--
-- Nieuwe definitie: snijplannen met status 'Gesneden' of 'In confectie',
-- type_bewerking afgeleid via confectie_bewerking_voor_afwerking() uit migratie 052.

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
  'Planningsweergave voor confectie: snijplannen met status Gesneden/In confectie, type_bewerking afgeleid uit maatwerk_afwerking.';
