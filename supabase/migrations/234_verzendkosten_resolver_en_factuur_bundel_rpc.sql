-- Migratie 234: bundel-factuur fundament — additief
--
-- ADR-0010: factuur volgt bundel-zending, factuurvoorkeur vervalt.
-- Deze migratie is **additief** — alle nieuwe objecten leven naast de
-- oude. Mig 235 drukt de cutover-knop, mig 237 ruimt de oude weg.
--
-- Bevat in volgorde:
--   1. verzendkosten_voor_bundel(deb, subtotaal, is_afhalen) — resolver
--   2. View voorgestelde_zending_bundels (mig 229) consumeert resolver
--   3. factuur_queue.zending_id-kolom (FK → zendingen)
--   4. genereer_factuur_voor_bundel(p_zending_id) — nieuwe factuur-RPC
--   5. claim_factuur_queue_items uitgebreid met zending_id + verzendweek
--
-- Idempotent: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / DROP IF EXISTS.

------------------------------------------------------------------------
-- 1. verzendkosten_voor_bundel — drempel-resolver
------------------------------------------------------------------------
-- Concentreert de 4-paden-toets die vóór ADR-0010 op vier plekken leefde:
-- view 229 (CASE-ladder), mig 232 (IF/ELSIF), order-form (TS), drempel-
-- progressbar (TS-label). Eén bron-van-waarheid voor SQL-consumers.
--
-- Returnt een 1-rij tabel met (te_betalen, status, reden):
--   · gratis_afhalen        — order met afhalen=TRUE; verzendkosten = €0
--   · gratis_klantafspraak  — debiteuren.gratis_verzending = TRUE
--   · gratis_drempel        — bundel_subtotaal ≥ debiteuren.verzend_drempel
--   · betaald               — anders, te_betalen = debiteuren.verzendkosten
--
-- Stable + parallel safe: leest debiteuren maar muteert niets.

CREATE OR REPLACE FUNCTION verzendkosten_voor_bundel(
  p_debiteur_nr     INTEGER,
  p_bundel_subtotaal NUMERIC,
  p_is_afhalen      BOOLEAN
) RETURNS TABLE (
  te_betalen NUMERIC(8,2),
  status     TEXT,
  reden      TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_d debiteuren%ROWTYPE;
BEGIN
  IF p_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr is verplicht';
  END IF;

  SELECT * INTO v_d FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF COALESCE(p_is_afhalen, FALSE) THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_afhalen'::TEXT,
      'Afhalen — geen verzendkosten'::TEXT;
    RETURN;
  END IF;

  IF v_d.gratis_verzending THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_klantafspraak'::TEXT,
      'Gratis volgens klantafspraak'::TEXT;
    RETURN;
  END IF;

  IF v_d.verzend_drempel IS NOT NULL
     AND COALESCE(p_bundel_subtotaal, 0) >= v_d.verzend_drempel THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_drempel'::TEXT,
      format('Gratis vanaf €%s', to_char(v_d.verzend_drempel, 'FM999999.00'))::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_d.verzendkosten, 0)::NUMERIC(8,2),
    'betaald'::TEXT,
    'Standaard verzendkosten'::TEXT;
END;
$$;

COMMENT ON FUNCTION verzendkosten_voor_bundel(INTEGER, NUMERIC, BOOLEAN) IS
  'Mig 234 (ADR-0010): drempel-resolver voor bundel-verzendkosten. '
  'Concentreert de 4-paden-toets (afhalen / klant-gratis / drempel / '
  'betaald) die vóór ADR-0010 op view 229, mig 232, order-form en '
  'drempel-progressbar verspreid leefde. Returnt (te_betalen, status, reden).';

GRANT EXECUTE ON FUNCTION verzendkosten_voor_bundel(INTEGER, NUMERIC, BOOLEAN)
  TO authenticated, service_role;

-- Verificatie (run in SQL Editor na deploy):
--   -- Pad 1: afhalen
--   SELECT * FROM verzendkosten_voor_bundel(100000, 100, TRUE);
--   -- Verwacht: (0, 'gratis_afhalen', 'Afhalen — geen verzendkosten')
--
--   -- Pad 2: klant met gratis_verzending=TRUE (UPDATE eerst voor test)
--   SELECT * FROM verzendkosten_voor_bundel(<deb_met_gratis>, 100, FALSE);
--   -- Verwacht: (0, 'gratis_klantafspraak', ...)
--
--   -- Pad 3: bundel boven drempel
--   SELECT * FROM verzendkosten_voor_bundel(<deb_met_drempel_500>, 600, FALSE);
--   -- Verwacht: (0, 'gratis_drempel', 'Gratis vanaf €500.00')
--
--   -- Pad 4: standaard
--   SELECT * FROM verzendkosten_voor_bundel(<deb_zonder_gratis>, 100, FALSE);
--   -- Verwacht: (verzendkosten van klant, 'betaald', 'Standaard verzendkosten')
