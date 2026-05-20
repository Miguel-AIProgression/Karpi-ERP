-- Migratie 298: deadline-conflict-detectie na claim-swap (ADR-0027, Ingreep 5)
--
-- Context: nadat mig 297 een swap heeft uitgevoerd (A's voorraad → A's IO,
-- B krijgt voorraad), kan A's IO later vertragen. `sync_order_afleverdatum_met_claims`
-- (mig 153) schuift dan A.afleverdatum vooruit. Vandaag flipt `levertijd_status`
-- vanzelf naar 'later_dan_standaard' (mig 276), maar dat label kent ook andere
-- oorzaken (operator-keuze, debiteur-config).
--
-- Toevoeging: post-swap-conflict expliciet detecteren en als `order_events`-rij
-- markeren zodat operator-dashboard rood label kan tonen. Geen automatische
-- reverse-swap — dat zou oscillatie veroorzaken; handmatige actie (klant
-- bellen, spoedinkoop, voorraad elders) wordt verwacht.
--
-- Algoritme (binnen `sync_order_afleverdatum_met_claims`):
--   1. (bestaand) bereken v_claim_datum = laatste IO-claim + buffer
--   2. (bestaand) als v_claim_datum > v_huidige → UPDATE orders.afleverdatum
--   3. (NIEUW) check: ging deze order vandaag voorbij standaard_afleverdatum_berekend
--      EN heeft deze order ooit een claim_geswapt_weg-event? → insert
--      `deadline_conflict_na_swap` event op deze order.
--      Dedup-guard: alleen inserten als er geen recente (laatste 24u)
--      `deadline_conflict_na_swap`-rij bestaat — voorkomt event-spam bij
--      herhaalde herwaarderingen binnen één werkstroom.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- VOORWAARDE: mig 297 (toevoeging van 'deadline_conflict_na_swap' enum-waarde
-- aan order_event_type) is reeds toegepast.

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

  -- Eindstatussen niet aanraken
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
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

  -- NIEUW (mig 298, ADR-0027 Ingreep 5): post-swap-deadline-conflict-detectie
  -- Alleen relevant als:
  --   - standaard-snapshot bestaat (anders kunnen we niet vergelijken)
  --   - huidige afleverdatum is later dan de snapshot (= 'later_dan_standaard')
  --   - deze order heeft ooit een claim_geswapt_weg-event gehad
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
      -- herwaarderingen binnen dezelfde werkstroom (bv. operator bewerkt order,
      -- herallocateer wordt 3× door verschillende triggers gefired).
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
  'Eindstatussen blijven ongewijzigd. '
  'Sinds mig 298 (ADR-0027 Ingreep 5): emit `deadline_conflict_na_swap`-event '
  'als afleverdatum > standaard_afleverdatum_berekend EN order heeft eerder '
  'een claim_geswapt_weg-event gehad. Dedup 24u-venster. Migratie 153→297.';
