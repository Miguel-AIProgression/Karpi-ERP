-- Migratie 254: Reservering-Module split (ADR-0015 stap 6)
--
-- Splits de god-orchestratie `herwaardeer_order_status` (mig 145 → mig 153
-- → mig 218) in drie expliciete functies, elk in z'n eigen Module:
--
--   · herwaardeer_claims_voor_order(p_order_id)        — Reservering-Module (NIEUW)
--       Loopt alle orderregels, roept herallocateer_orderregel per stuk.
--       Schrijft GEEN orders.status en GEEN orders.afleverdatum.
--
--   · herbereken_wacht_status(p_order_id)              — Order-lifecycle (mig 218)
--   · sync_order_afleverdatum_met_claims(p_order_id)   — Reservering (tijdelijk;
--       eigendom verhuist naar Levertijd-Module in vervolg-ADR)
--
-- Daarnaast:
--   · simuleer_dekking(...) — pure read-only RPC, bron-van-waarheid voor de
--     TS-spiegel `berekenRegelDekking` (frontend/src/lib/utils/regel-dekking.ts).
--     Contract-test in modules/reserveringen/lib/__tests__/dekking-preview.test.ts
--     vergelijkt 1-op-1 met deze RPC.
--   · boek_io_ontvangst_claims(...) — extract uit `boek_voorraad_ontvangst`
--     (mig 148) van het IO-claim-consume-deel. `boek_voorraad_ontvangst` blijft
--     bestaan maar delegeert nu naar deze publieke Reservering-RPC.
--   · herwaardeer_order_status — herdefinieerd als thin DEPRECATED wrapper
--     voor back-compat. Verwijderd in vervolg-migratie nadat alle callers omgezet.
--
-- Geen DDL op tabellen, geen triggers gewijzigd, geen drops. Idempotent via
-- CREATE OR REPLACE. Trigger-callsite-refactor (zodat callers drie expliciete
-- PERFORMs i.p.v. één wrapper-call aanroepen) volgt in mig 255.

-- ============================================================================
-- 1. herwaardeer_claims_voor_order — Reservering-Module (NIEUW)
-- ============================================================================
-- Eigendom: Reservering-Module. Loopt alle orderregels van de order en roept
-- per regel herallocateer_orderregel aan. Schrijft NOOIT orders.status of
-- orders.afleverdatum — die verantwoordelijkheden horen respectievelijk bij
-- Order-lifecycle (herbereken_wacht_status, mig 218) en Levertijd (TODO).
--
-- Wordt vanuit triggers en RPCs aangeroepen vóór herbereken_wacht_status en
-- sync_order_afleverdatum_met_claims (drie expliciete regels).
CREATE OR REPLACE FUNCTION herwaardeer_claims_voor_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_regel_id IN
    SELECT id FROM order_regels WHERE order_id = p_order_id
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_claims_voor_order(BIGINT) IS
  'ADR-0015 / Mig 254: Reservering-Module eigendom. Loopt alle orderregels van de '
  'order en triggert per regel herallocateer_orderregel. Schrijft GEEN orders.status '
  'en GEEN orders.afleverdatum — callers chainen expliciet herbereken_wacht_status '
  '(Order-lifecycle, mig 218) en sync_order_afleverdatum_met_claims (Levertijd-TODO, mig 153).';

GRANT EXECUTE ON FUNCTION herwaardeer_claims_voor_order(BIGINT) TO authenticated;

-- ============================================================================
-- 2. simuleer_dekking — pure read-only contract-RPC (NIEUW)
-- ============================================================================
-- Bron-van-waarheid voor de {direct, uitwisselbaar, io_tekort}-splitsing.
-- Spiegelt frontend/src/lib/utils/regel-dekking.ts:berekenRegelDekking 1-op-1.
-- Contract-test (frontend/src/modules/reserveringen/lib/__tests__/dekking-preview.test.ts)
-- vergelijkt 20 fixtures byte-voor-byte zodat TS-spiegel en SQL nooit driften.
--
-- Pure read-only: leest voorraad_beschikbaar_voor_artikel (mig 154) en de
-- handmatig opgegeven keuzes uit p_uitwisselbaar_keuzes. Geen INSERT/UPDATE/DELETE.
--
-- p_uitwisselbaar_keuzes formaat: jsonb array van {artikelnr, aantal}.
--   Voorbeeld: '[{"artikelnr":"VELVET-200x290","aantal":5}]'::jsonb
--   Lege array of NULL → uitwisselbaar = 0.
--
-- Excl-orderregel-arg op voorraad_beschikbaar_voor_artikel: -1 (sentinel,
-- geen bestaande orderregel) zodat ALLE actieve voorraad-claims meegeteld
-- worden. Pure what-if-simulatie zonder order-context.
CREATE OR REPLACE FUNCTION simuleer_dekking(
  p_artikelnr TEXT,
  p_te_leveren INT,
  p_uitwisselbaar_keuzes JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (direct INT, uitwisselbaar INT, io_tekort INT)
AS $$
DECLARE
  v_te_leveren INT := COALESCE(p_te_leveren, 0);
  v_vrij INT := 0;
  v_uitwisselbaar_totaal INT := 0;
  v_direct INT;
  v_uitwisselbaar INT;
  v_io_tekort INT;
BEGIN
  -- Geen artikelnr of geen positieve hoeveelheid → splitsing is (0,0,0).
  -- Spiegelt de isVasteMaat-guard in berekenRegelDekking.
  IF p_artikelnr IS NULL OR v_te_leveren <= 0 THEN
    RETURN QUERY SELECT 0::INT, 0::INT, 0::INT;
    RETURN;
  END IF;

  -- Stap 1: vrije voorraad eigen artikel. Sentinel -1 excludeert geen
  -- bestaande orderregel — pure what-if over de huidige claim-staat.
  v_vrij := voorraad_beschikbaar_voor_artikel(p_artikelnr, -1::BIGINT);

  -- Stap 2: som van handmatige uitwisselbaar-keuzes uit JSONB-array.
  IF p_uitwisselbaar_keuzes IS NOT NULL
     AND jsonb_typeof(p_uitwisselbaar_keuzes) = 'array' THEN
    SELECT COALESCE(SUM(GREATEST(0, COALESCE((elem->>'aantal')::INT, 0))), 0)
      INTO v_uitwisselbaar_totaal
      FROM jsonb_array_elements(p_uitwisselbaar_keuzes) AS elem
     WHERE elem->>'artikelnr' IS NOT NULL;
  END IF;

  -- Stap 3: splitsing zoals in berekenRegelDekking.
  v_direct := GREATEST(0, LEAST(v_vrij, v_te_leveren));
  v_uitwisselbaar := GREATEST(0, LEAST(v_uitwisselbaar_totaal, v_te_leveren - v_direct));
  v_io_tekort := GREATEST(0, v_te_leveren - v_direct - v_uitwisselbaar);

  RETURN QUERY SELECT v_direct, v_uitwisselbaar, v_io_tekort;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION simuleer_dekking(TEXT, INT, JSONB) IS
  'ADR-0015 / Mig 254: pure read-only RPC die de {direct, uitwisselbaar, io_tekort}-'
  'splitsing voor één artikelnr+te_leveren+keuzes-tuple uitrekent. Bron-van-waarheid '
  'voor de TS-spiegel berekenRegelDekking (frontend/src/lib/utils/regel-dekking.ts). '
  'Contract-test in modules/reserveringen/lib/__tests__/dekking-preview.test.ts.';

GRANT EXECUTE ON FUNCTION simuleer_dekking(TEXT, INT, JSONB) TO authenticated;

-- ============================================================================
-- 3. boek_io_ontvangst_claims — IO-claim-consume extract (NIEUW)
-- ============================================================================
-- Geëxtract uit boek_voorraad_ontvangst (mig 148). Bevat het Reservering-deel:
-- consumeer IO-claims op deze IO-regel in claim_volgorde-volgorde tot
-- p_aantal_ontvangen op is, zet ze om naar voorraad-claims op dezelfde
-- orderregel, en triggert per geconsumeerde claim herwaardeer_order_status.
--
-- ALLE andere logica van boek_voorraad_ontvangst (validatie, rol/voorraad-
-- updates, IO-status-update) blijft in boek_voorraad_ontvangst zelf — die
-- delegeert alleen het claim-consume-deel naar deze publieke Reservering-RPC.
CREATE OR REPLACE FUNCTION boek_io_ontvangst_claims(
  p_io_regel_id BIGINT,
  p_aantal_ontvangen INT
) RETURNS VOID AS $$
DECLARE
  v_resterend INTEGER := p_aantal_ontvangen;
  v_claim RECORD;
  v_consume INTEGER;
  v_bestaande_voorraadclaim BIGINT;
BEGIN
  IF p_aantal_ontvangen IS NULL OR p_aantal_ontvangen <= 0 THEN
    RETURN;
  END IF;

  FOR v_claim IN
    SELECT id, order_regel_id, aantal
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
     ORDER BY claim_volgorde ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_resterend <= 0;
    v_consume := LEAST(v_claim.aantal, v_resterend);

    IF v_consume = v_claim.aantal THEN
      UPDATE order_reserveringen
         SET status = 'geleverd', geleverd_op = now(), updated_at = now()
       WHERE id = v_claim.id;
    ELSE
      UPDATE order_reserveringen
         SET aantal = aantal - v_consume, updated_at = now()
       WHERE id = v_claim.id;
    END IF;

    -- Maak/upgrade voorraad-claim voor dezelfde orderregel
    SELECT id INTO v_bestaande_voorraadclaim
      FROM order_reserveringen
     WHERE order_regel_id = v_claim.order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
     FOR UPDATE;

    IF v_bestaande_voorraadclaim IS NOT NULL THEN
      UPDATE order_reserveringen
         SET aantal = aantal + v_consume, updated_at = now()
       WHERE id = v_bestaande_voorraadclaim;
    ELSE
      INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
      VALUES (v_claim.order_regel_id, 'voorraad', v_consume);
    END IF;

    v_resterend := v_resterend - v_consume;

    -- Order-status van de bijbehorende order opnieuw waarderen.
    -- Blijft via de thin wrapper aanroepen (back-compat); na mig 255 callsite-
    -- refactor wordt dit drie expliciete PERFORMs.
    PERFORM herwaardeer_order_status(
      (SELECT order_id FROM order_regels WHERE id = v_claim.order_regel_id)
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_io_ontvangst_claims(BIGINT, INT) IS
  'ADR-0015 / Mig 254: Reservering-Module eigendom. Consumeert IO-claims op deze '
  'IO-regel in claim_volgorde-volgorde tot p_aantal_ontvangen op is en zet ze om '
  'naar voorraad-claims op dezelfde orderregel. Geëxtract uit boek_voorraad_ontvangst '
  '(mig 148, regels 64-110); die delegeert nu naar deze publieke RPC zonder andere '
  'gedrag te wijzigen (rol-creatie/voorraad-mutatie/IO-status blijven daar).';

GRANT EXECUTE ON FUNCTION boek_io_ontvangst_claims(BIGINT, INT) TO authenticated;

-- ============================================================================
-- 4. boek_voorraad_ontvangst — refactor: delegeer claim-consume
-- ============================================================================
-- Identieke functionaliteit als mig 148, alleen het claim-consume-blok is
-- vervangen door een PERFORM boek_io_ontvangst_claims-aanroep. ALLE andere
-- logica (validatie, eenheid-check, producten.voorraad += p_aantal, regel-
-- bijwerking, IO-status-Deels ontvangen/Ontvangen) blijft identiek.
CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_open_regels INTEGER;
BEGIN
  IF p_aantal IS NULL OR p_aantal <= 0 THEN
    RAISE EXCEPTION 'Aantal moet > 0 zijn';
  END IF;

  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  IF v_regel.eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Voorraad-ontvangst is alleen voor eenheid ''stuks''. Gebruik boek_ontvangst voor rollen.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  -- Voorraad ophogen op het product
  IF v_regel.artikelnr IS NOT NULL THEN
    UPDATE producten
    SET voorraad = COALESCE(voorraad, 0) + p_aantal
    WHERE artikelnr = v_regel.artikelnr;
  END IF;

  -- Regel bijwerken
  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + p_aantal,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + p_aantal), 0)
  WHERE id = p_regel_id;

  -- Mig 254: claim-consume gedelegeerd naar Reservering-Module
  PERFORM boek_io_ontvangst_claims(p_regel_id, p_aantal);

  -- IO-status update: Deels ontvangen / Ontvangen
  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'Boekt ontvangst van een inkooporder-regel met eenheid=stuks (vaste producten): '
  'verhoogt producten.voorraad met p_aantal en werkt regel + order-status bij. '
  'Sinds mig 254 (ADR-0015): delegeert het IO-claim-consume-deel naar de Reservering-'
  'Module-RPC boek_io_ontvangst_claims. Functioneel onveranderd t.o.v. mig 148.';

-- ============================================================================
-- 5. herwaardeer_order_status — thin DEPRECATED wrapper
-- ============================================================================
-- Body wordt: drie expliciete PERFORMs naar de eigenaars. Bestaande callers
-- (triggers, RPCs binnen mig 145-156, 218) blijven dezelfde signature aanroepen
-- — daarom blijft de wrapper bestaan. Wordt verwijderd in een vervolg-migratie
-- nadat alle callers zijn omgezet naar de drie expliciete aanroepen (zie mig 255).
CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID AS $$
BEGIN
  PERFORM herwaardeer_claims_voor_order(p_order_id);
  PERFORM herbereken_wacht_status(p_order_id);                   -- Order-lifecycle (mig 218)
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);        -- TODO: Levertijd-Module
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_order_status(BIGINT) IS
  'DEPRECATED (ADR-0015 / Mig 254): gebruik de drie expliciete functies — '
  'herwaardeer_claims_voor_order (Reservering), herbereken_wacht_status '
  '(Order-lifecycle), sync_order_afleverdatum_met_claims (Levertijd-TODO). '
  'Deze wrapper blijft voor back-compat tijdens callsite-refactor en wordt '
  'verwijderd in vervolg-migratie nadat alle callers omgezet zijn.';

-- ============================================================================
-- 6. RAISE NOTICE — duidelijke afronding voor handmatige SQL Editor-run
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migratie 254 toegepast: Reservering-Module split (ADR-0015 stap 6).';
  RAISE NOTICE '  + herwaardeer_claims_voor_order (NIEUW)';
  RAISE NOTICE '  + simuleer_dekking (NIEUW, read-only)';
  RAISE NOTICE '  + boek_io_ontvangst_claims (NIEUW, extract uit mig 148)';
  RAISE NOTICE '  ~ boek_voorraad_ontvangst (refactor: delegeert claim-consume)';
  RAISE NOTICE '  ~ herwaardeer_order_status (thin DEPRECATED wrapper)';
  RAISE NOTICE 'Triggers en callsites onaangeroerd — refactor volgt in mig 255.';
END $$;
