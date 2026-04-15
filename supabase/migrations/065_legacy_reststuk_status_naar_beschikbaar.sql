-- Migration 065: legacy status='reststuk' → 'beschikbaar'.
--
-- Achtergrond: tot migratie 059 zette voltooi_snijplan_rol() nieuwe rest-rollen
-- op status='reststuk'. Sinds 059 is de conventie status='beschikbaar' +
-- rol_type='reststuk' of 'aangebroken' (afgeleid via bereken_rol_type).
--
-- Side-effect zonder fix: rollen-overzicht toont een oranje "RESTSTUK"
-- status-badge naast een blauwe "AANGEBROKEN" rol_type-badge — verwarrend en
-- inhoudelijk fout (een rol met volle breedte is geen reststuk maar een
-- aangebroken rol).
--
-- Deze migratie:
--   1. Zet status='reststuk' → 'beschikbaar' voor alle bestaande rollen.
--   2. rol_type wordt al correct beheerd door trg_set_rol_type (BEFORE UPDATE),
--      dus geen aparte hercassificatie nodig.

UPDATE rollen
SET status = 'beschikbaar'
WHERE status = 'reststuk';
