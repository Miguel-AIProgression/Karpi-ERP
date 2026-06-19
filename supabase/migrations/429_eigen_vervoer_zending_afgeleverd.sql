-- ============================================================================
-- 429: Eigen vervoer — zending direct op 'Afgeleverd' bij afronden pickronde
--
-- BUG (melding Thom, 18-06): zendingen met vervoerder "Eigen vervoer"
-- (type='eigen', mig 424) bleven op het logistiek-zendingen-overzicht eeuwig op
-- status 'Klaar voor verzending' hangen, terwijl carrier-zendingen (HST/Rhenus/
-- Verhoek) wél doorschoten naar 'Onderweg'.
--
-- ROOT CAUSE: de zending-status wordt van 'Klaar voor verzending' → 'Onderweg'
-- getild op precies ÉÉN plek — `markeer_transportorder_verstuurd` (mig 426),
-- aangeroepen door de verzend-edge-function ná succesvolle aanmelding bij de
-- carrier. Eigen vervoer is in `enqueue_zending_naar_vervoerder` als kopie van
-- het 'print'-type geïmplementeerd: het roept alleen `genereer_zending_colli`
-- en plaatst NIETS op de `verzend_wachtrij`. Er is dus geen edge-function en
-- geen carrier-callback → niets roept ooit `markeer_transportorder_verstuurd`
-- aan → de zending blijft op 'Klaar voor verzending'. (De ORDER zelf flipt wél
-- correct naar 'Verzonden' via `voltooi_pickronde`/`markeer_verzonden`,
-- ongeacht vervoerder — het probleem zat puur in de zending-status.)
--
-- FIX: in de 'eigen'-tak van `enqueue_zending_naar_vervoerder` de zending
-- synchroon doorzetten — Karpi of een derde rijdt zelf, er komt nooit een
-- externe bevestiging. Eindstatus = 'Afgeleverd' (keuze gebruiker): er volgt
-- voor eigen vervoer geen T&T-stap die de zending later alsnog van 'Onderweg'
-- naar 'Afgeleverd' zou tillen, dus direct naar de eindstatus.
--
-- Veiligheid: de UPDATE draait binnen de AFTER-trigger
-- `trg_zending_klaar_voor_verzending`, maar `fn_zending_klaar_voor_verzending`
-- short-circuit op `NEW.status <> 'Klaar voor verzending'` → de status-flip naar
-- 'Afgeleverd' her-triggert niets (geen recursie, geen re-enqueue).
--
-- Body = exacte mig 426-versie; ALLEEN de 'eigen'-tak wijzigt. Een CREATE OR
-- REPLACE moet de complete 426-body bevatten, anders verdwijnen de api/sftp/
-- print/edi-takken + hold-guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT,
  p_handmatig  BOOLEAN DEFAULT FALSE
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_handmatig_verv  BOOLEAN;
  v_aantal_colli    INTEGER;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, handmatig_aanmelden INTO v_actief, v_type, v_handmatig_verv
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- HOLD-GUARD (colli-bundeling, mig 420): een handmatig-aanmelden-vervoerder
  -- houdt een >=2-colli-zending vast tot de operator vrijgeeft (p_handmatig=TRUE).
  IF NOT p_handmatig AND COALESCE(v_handmatig_verv, FALSE) THEN
    SELECT COUNT(*) INTO v_aantal_colli
      FROM zending_colli WHERE zending_id = p_zending_id AND bundel_colli_id IS NULL;
    IF v_aantal_colli >= 2 THEN
      RETURN 'held_handmatig';
    END IF;
  END IF;

  -- SWITCH-POINT (ADR-0038): de queue-gebaseerde carriers (api/sftp) gaan
  -- allemaal via één generieke enqueue, gediscrimineerd op de code. Géén
  -- per-code-CASE meer → nieuwe api/sftp-vervoerder = nul dispatch-edits.
  CASE v_type
    WHEN 'api', 'sftp' THEN
      PERFORM enqueue_transportorder(p_zending_id, v_debiteur_nr, v_vervoerder_code, v_is_test);
      RETURN 'enqueued_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    -- Eigen vervoer (mig 424): colli klaarzetten voor label/pakbon, GEEN externe
    -- dispatch. Er komt nooit een carrier-callback die de zending doorzet, dus
    -- doen we dat hier synchroon (mig 429): direct naar 'Afgeleverd'. De
    -- status-guard voorkomt dat een al-doorgezette zending teruggetild wordt;
    -- de flip her-triggert niets (zie fn_zending_klaar_voor_verzending-guard).
    WHEN 'eigen' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      UPDATE zendingen
         SET status = 'Afgeleverd'::zending_status
       WHERE id = p_zending_id
         AND status = 'Klaar voor verzending';
      RETURN 'eigen_afgeleverd';

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT + hold-guard. Sinds mig 426 (ADR-0038): api/sftp collapsen tot '
  'één enqueue_transportorder(code). Mig 429: type=eigen zet de zending direct '
  'op Afgeleverd (geen externe carrier-callback). Hold-guard (mig 420) + '
  'afhalen-skip + print-tak ongewijzigd.';

-- ============================================================================
-- Backfill: bestaande eigen-vervoer-zendingen die nu vastgelopen op 'Klaar voor
-- verzending' staan (o.a. ZEND-2026-0054 / ORD-2026-0614 en ZEND-2026-0056 /
-- ORD-2026-0620) direct naar 'Afgeleverd'. De flip her-triggert niets.
-- ============================================================================
UPDATE zendingen
   SET status = 'Afgeleverd'::zending_status
 WHERE status = 'Klaar voor verzending'
   AND vervoerder_code IN (SELECT code FROM vervoerders WHERE type = 'eigen');
