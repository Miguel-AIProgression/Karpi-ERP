-- Migration 063: Snijden-timing velden op rollen
--
-- Achtergrond: we willen de daadwerkelijke snijduur per rol kunnen meten om
-- later tijdnormen (bijv. snij-tijd per m2) te kalibreren. Daarvoor registreren
-- we wanneer een medewerker "Start met rol" klikt en wanneer de rol volledig
-- afgesneden is (via voltooi_snijplan_rol).
--
-- Backwards compatible: kolommen zijn NULLABLE — bestaande rollen houden NULL,
-- alleen rollen die na deze migratie gesneden worden krijgen timestamps.

ALTER TABLE rollen
  ADD COLUMN IF NOT EXISTS snijden_gestart_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snijden_voltooid_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snijden_gestart_door TEXT;

COMMENT ON COLUMN rollen.snijden_gestart_op IS 'Timestamp wanneer medewerker "Start met rol" klikte — voor tijdanalyse snijduur.';
COMMENT ON COLUMN rollen.snijden_voltooid_op IS 'Timestamp wanneer rol werd afgesloten via voltooi_snijplan_rol.';
COMMENT ON COLUMN rollen.snijden_gestart_door IS 'Medewerker die snijden gestart is.';
