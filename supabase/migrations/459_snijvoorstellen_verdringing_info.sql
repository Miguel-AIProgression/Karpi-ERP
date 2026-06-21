-- Migratie 459: persisteer verdringings-context op snijvoorstellen
--
-- auto-plan-groep liet een voorstel tot nu toe als 'concept' liggen bij
-- verdringingsrisico (Fase 2) of een rode FIFO-badge (ADR-0021), maar de
-- reden + verdrongen orders + wacht-op-inkoop-details bestonden alleen in de
-- HTTP-respons van die ene aanroep — een planner die later kijkt zag niets.
-- Spiegelt het bestaande fifo_rationale JSONB-patroon (mig 284) op dezelfde
-- tabel.

ALTER TABLE snijvoorstellen ADD COLUMN IF NOT EXISTS verdringing_info JSONB;

COMMENT ON COLUMN snijvoorstellen.verdringing_info IS
  'Mig 459: {reden, verdrongen_orders, wacht_op_inkoop} — gevuld door auto-plan-groep '
  'wanneer het voorstel concept blijft (verdringingsrisico of rode FIFO-badge), zodat '
  'een planner later kan zien waarom en kan beoordelen.';

NOTIFY pgrst, 'reload schema';
