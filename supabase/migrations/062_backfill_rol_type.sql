-- Migration 062: hercassificeer alle bestaande rollen via bereken_rol_type().
--
-- Achtergrond: na introductie van rol_type (058) zijn er via oudere flows
-- (migratie 047/052 en handmatige inserts) nog steeds rollen in de database
-- waarvan de classificatie niet matcht met de huidige logica — bv. reststukken
-- die als 'volle_rol' staan of omgekeerd. Deze migratie draait de
-- bereken_rol_type() helper opnieuw op álle rijen, zodat het rollen-overzicht
-- de juiste groen/blauw/rood badges toont (volle_rol / aangebroken / reststuk).

UPDATE rollen
SET rol_type = bereken_rol_type(artikelnr, breedte_cm, lengte_cm, oorsprong_rol_id)
WHERE rol_type IS DISTINCT FROM bereken_rol_type(artikelnr, breedte_cm, lengte_cm, oorsprong_rol_id);
