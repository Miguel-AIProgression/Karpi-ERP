-- Migratie 276: Levertijd-Module — schema, status-trigger, snapshot-backfill
--
-- ADR-0020: Levertijd als deep Module (capaciteit-seam owner met smal SQL-interface).
-- Plan: docs/superpowers/plans/2026-05-13-levertijd-als-deep-module.md (stap 1/10)
--
-- Levertijd-Module bezit twee nieuwe kolommen op orders:
--
--   1. orders.levertijd_status TEXT
--      Enum: 'standaard' | 'eerder_dan_standaard' | 'later_dan_standaard'
--      Planning-uitkomst — afwijking van klant-standaard. Niet verwarren met
--      orders.is_spoed (klant-aanvraag, input).
--
--   2. orders.standaard_afleverdatum_berekend DATE
--      Bevroren snapshot van wat de klant-config-formule bij orderdatum zou
--      hebben opgeleverd. Immutable na commit; voorkomt retro-effects als
--      klant-config (debiteuren.standaard_maat_werkdagen, maatwerk_weken,
--      app_config.order_config-defaults) later wijzigt.
--
-- Levertijd-Module schrijft uitsluitend deze twee kolommen. orders.afleverdatum
-- zelf blijft Order-Module (commit-pad) en Reservering-Module (mig 153/254
-- sync_order_afleverdatum_met_claims op IO-claim-pad).
--
-- Trigger trg_orders_levertijd_status_recalc deriveert levertijd_status uit
-- afleverdatum vs snapshot. BEFORE-trigger — geen secundaire UPDATE nodig.
-- Wanneer Reservering's sync de afleverdatum vóóruit schuift bij IO-vertraging,
-- flipt het label automatisch naar 'later_dan_standaard'.
--
-- Backfill-strategie: bestaande orders met afleverdatum IS NOT NULL krijgen
-- snapshot = afleverdatum. Trigger zet levertijd_status = 'standaard'. Geen
-- retro-evaluatie van historische orders tegen klant-config — historie is
-- bevroren in nul-toestand, labels zijn forward-looking.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
-- CREATE TRIGGER met DROP-IF-EXISTS.
-- VOORWAARDE: geen — pure additieve migratie op orders.

-- ============================================================================
-- 1. Kolommen op orders
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS levertijd_status TEXT
    CHECK (levertijd_status IS NULL OR levertijd_status IN (
      'standaard',
      'eerder_dan_standaard',
      'later_dan_standaard'
    )),
  ADD COLUMN IF NOT EXISTS standaard_afleverdatum_berekend DATE;

COMMENT ON COLUMN orders.levertijd_status IS
  'Levertijd-Module (ADR-0020): planning-uitkomst — afwijking van klant-standaard. '
  'Geschreven via trigger op afleverdatum-change of bij commit. '
  'Niet te verwarren met is_spoed (klant-input).';

COMMENT ON COLUMN orders.standaard_afleverdatum_berekend IS
  'Levertijd-Module (ADR-0020): bevroren snapshot van klant-config-formule bij orderdatum. '
  'Immutable na commit; voorkomt retro-effects bij klant-config-wijziging.';

-- ============================================================================
-- 2. Trigger-functie: deriveer status uit afleverdatum vs snapshot
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_levertijd_status_recalc()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Geen snapshot of geen afleverdatum: label is onbepaald
  IF NEW.afleverdatum IS NULL OR NEW.standaard_afleverdatum_berekend IS NULL THEN
    NEW.levertijd_status := NULL;
    RETURN NEW;
  END IF;

  IF NEW.afleverdatum < NEW.standaard_afleverdatum_berekend THEN
    NEW.levertijd_status := 'eerder_dan_standaard';
  ELSIF NEW.afleverdatum > NEW.standaard_afleverdatum_berekend THEN
    NEW.levertijd_status := 'later_dan_standaard';
  ELSE
    NEW.levertijd_status := 'standaard';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_levertijd_status_recalc() IS
  'Levertijd-Module (ADR-0020, mig 276): deriveert orders.levertijd_status '
  'uit afleverdatum vs standaard_afleverdatum_berekend. BEFORE-trigger.';

-- ============================================================================
-- 3. Trigger op orders
-- ============================================================================

DROP TRIGGER IF EXISTS trg_orders_levertijd_status_recalc ON orders;

CREATE TRIGGER trg_orders_levertijd_status_recalc
  BEFORE INSERT OR UPDATE OF afleverdatum, standaard_afleverdatum_berekend ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trg_levertijd_status_recalc();

-- ============================================================================
-- 4. Backfill: bestaande orders met afleverdatum krijgen snapshot = afleverdatum
-- ============================================================================
--
-- Pure forward-looking backfill: historische orders worden niet retroactief
-- tegen klant-config geëvalueerd. Snapshot = huidige afleverdatum, label
-- wordt door trigger gezet op 'standaard'. Toekomstige wijzigingen van
-- afleverdatum (door Reservering's IO-sync of door operator-actie) flippen
-- het label dan correct.

UPDATE orders
   SET standaard_afleverdatum_berekend = afleverdatum
 WHERE afleverdatum IS NOT NULL
   AND standaard_afleverdatum_berekend IS NULL;

-- ============================================================================
-- 5. ASSERT-regressie-blok
-- ============================================================================

DO $$
DECLARE
  v_trigger_count INTEGER;
  v_missing_snapshot INTEGER;
  v_missing_status INTEGER;
BEGIN
  -- Trigger bestaat
  SELECT COUNT(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgname = 'trg_orders_levertijd_status_recalc'
     AND tgrelid = 'orders'::regclass;
  ASSERT v_trigger_count = 1,
    'trigger trg_orders_levertijd_status_recalc niet aangemaakt';

  -- Backfill volledig voor orders met afleverdatum
  SELECT COUNT(*) INTO v_missing_snapshot
    FROM orders
   WHERE afleverdatum IS NOT NULL
     AND standaard_afleverdatum_berekend IS NULL;
  ASSERT v_missing_snapshot = 0,
    format('Backfill miste %s orders met afleverdatum maar zonder snapshot', v_missing_snapshot);

  SELECT COUNT(*) INTO v_missing_status
    FROM orders
   WHERE afleverdatum IS NOT NULL
     AND standaard_afleverdatum_berekend IS NOT NULL
     AND levertijd_status IS NULL;
  ASSERT v_missing_status = 0,
    format('Backfill miste %s orders met snapshot maar zonder status (trigger niet gevuurd?)', v_missing_status);
END;
$$;
