-- Migratie 354: 'Maatwerk afgerond' in de eindstatus-guard van sync_order_afleverdatum_met_claims
--
-- PROBLEEM (bevinding B14, docs/order-lifecycle.md §11C): de eindstatus-lijst
-- van sync_order_afleverdatum_met_claims (mig 153 → 298) kent 'Maatwerk
-- afgerond' (mig 327, jonger) niet. Effect: de afleverdatum van een afgeronde
-- productie-only order zou nog door IO-claim-syncs verschoven kunnen worden.
-- Laag risico in de praktijk (productie-only orders zijn maatwerk-only en
-- maatwerk reserveert niet op inkoop in V1 → bereken_late_claim_afleverdatum
-- geeft NULL → no-op), maar de guard hoort compleet te zijn — zelfde klasse
-- als B13 (mig 351/352): elke status-lijst die ouder is dan mig 327 moet de
-- terminale status expliciet kennen.
--
-- FIX: body byte-voor-byte mig 298, met 'Maatwerk afgerond' toegevoegd aan
-- de eindstatus-guard.
--
-- Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION sync_order_afleverdatum_met_claims(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_huidige DATE;
  v_oude DATE;
  v_status order_status;
  v_claim_datum DATE;
  v_standaard DATE;
  v_heeft_swap_event BOOLEAN;
  v_heeft_recent_conflict BOOLEAN;
BEGIN
  SELECT afleverdatum, status, standaard_afleverdatum_berekend
    INTO v_huidige, v_status, v_standaard
  FROM orders WHERE id = p_order_id;

  v_oude := v_huidige;

  -- Eindstatussen niet aanraken (mig 354: + 'Maatwerk afgerond', mig 327)
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending', 'Maatwerk afgerond') THEN
    RETURN;
  END IF;

  v_claim_datum := bereken_late_claim_afleverdatum(p_order_id);
  IF v_claim_datum IS NULL THEN
    RETURN;
  END IF;

  -- Bestaand gedrag: schuif alleen vooruit (later), nooit terug naar eerdere datum
  IF v_huidige IS NULL OR v_claim_datum > v_huidige THEN
    UPDATE orders
       SET afleverdatum = v_claim_datum,
           week = to_char(v_claim_datum, 'IW')
     WHERE id = p_order_id;
    v_huidige := v_claim_datum;
  END IF;

  -- Mig 298 (ADR-0027 Ingreep 5): post-swap-deadline-conflict-detectie
  IF v_standaard IS NOT NULL
     AND v_huidige IS NOT NULL
     AND v_huidige > v_standaard THEN

    SELECT EXISTS (
      SELECT 1 FROM order_events
       WHERE order_id = p_order_id
         AND event_type = 'claim_geswapt_weg'
    ) INTO v_heeft_swap_event;

    IF v_heeft_swap_event THEN
      -- Dedup-guard: 24u-venster. Voorkomt event-spam bij meerdere allocator-
      -- herwaarderingen binnen dezelfde werkstroom.
      SELECT EXISTS (
        SELECT 1 FROM order_events
         WHERE order_id = p_order_id
           AND event_type = 'deadline_conflict_na_swap'
           AND created_at > (now() - INTERVAL '24 hours')
      ) INTO v_heeft_recent_conflict;

      IF NOT v_heeft_recent_conflict THEN
        INSERT INTO order_events (order_id, event_type, status_na, metadata)
        VALUES (
          p_order_id,
          'deadline_conflict_na_swap',
          v_status,  -- geen status-overgang, kopieer huidige
          jsonb_build_object(
            'oude_afleverdatum', v_oude,
            'nieuwe_afleverdatum', v_huidige,
            'standaard', v_standaard,
            'adr', '0027',
            'migratie', 298
          )
        );
      END IF;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_order_afleverdatum_met_claims IS
  'Update orders.afleverdatum + week naar de laatste IO-claim-leverdatum als '
  'die later is dan de huidige afleverdatum. Schuift alleen vooruit, nooit terug. '
  'Eindstatussen blijven ongewijzigd (mig 354: + Maatwerk afgerond). '
  'Sinds mig 298 (ADR-0027 Ingreep 5): emit `deadline_conflict_na_swap`-event '
  'als afleverdatum > standaard_afleverdatum_berekend EN order heeft eerder '
  'een claim_geswapt_weg-event gehad. Dedup 24u-venster. Migratie 153→297→298→354.';

-- Zelf-test: de eindstatus-guard kent de terminale productie-only-status.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('sync_order_afleverdatum_met_claims(BIGINT)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%''Maatwerk afgerond''%' THEN
    RAISE EXCEPTION 'Mig 354: eindstatus-guard mist Maatwerk afgerond';
  END IF;
  RAISE NOTICE 'Mig 354: alle asserties geslaagd — Maatwerk afgerond in de eindstatus-guard';
END $$;

NOTIFY pgrst, 'reload schema';
