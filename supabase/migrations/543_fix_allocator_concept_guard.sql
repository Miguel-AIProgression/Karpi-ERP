-- Migratie 543: Concept-guard verwijderd uit herallocateer_orderregel
--
-- Bug (gevonden 2026-07-01): orders in Concept-status toonden "Wacht op inkoop"
-- en te_leveren=0 terwijl het product wél vrije voorraad had.
-- Aanleiding: mig 540 voegde een Concept-guard toe aan herallocateer_orderregel
-- die de volledige allocator blokkeerde voor Concept-orders. Daardoor werden
-- geen order_reserveringen aangemaakt en liep de levertijd-indicator al mee
-- vóór bevestiging (backorder=1, levertijd="Wacht op inkoop") — misleidend.
--
-- Analyse
-- -------
-- De guard was bedoeld om te voorkomen dat Concept-orders voorraadreclames
-- aanlegden, maar dat was niet het juiste niveau om te blokkeren:
--
--   ✓ Wat WEL geblokkeerd moet worden:
--     - snijplannen aanmaken (auto_maak_snijplan, auto_sync_snijplan_maten) ← mig 540 OK
--     - herplan-sweep (actieve_snijgroepen) ← mig 540 OK
--     - status-wijziging door herbereken_wacht_status (derive_wacht_status no-touch) ← mig 540 OK
--
--   ✗ Wat NIET geblokkeerd moet worden:
--     - allocatie/claims aanmaken → die zijn nodig voor de juiste display
--       (te_leveren, levertijd-indicator, backorder) zodat de operator bij
--       het bevestigen een correcte situatie ziet.
--
-- Fix: Concept-guard verwijderd. De allocator draait nu normaal ook voor
-- Concept-orders. derive_wacht_status geeft 'Concept' als no-touch (mig 540)
-- terug, dus herwaardeer_order_status wijzigt de orderstatus NIET — die
-- blijft 'Concept' tot bevestig_concept_order (mig 541) expliciet wordt
-- aangeroepen. Alle operationele blokkeringen (snijplannen, sweep, pick & ship)
-- blijven volledig intact via de andere guards uit mig 540.
--
-- BASIS: volledige body uit mig 540 (die op zijn beurt mig 497 als basis had),
--        alleen de Concept-guard-stap (3 regels) verwijderd.

CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr            TEXT;
  v_te_leveren           INTEGER;
  v_is_maatwerk          BOOLEAN;
  v_order_id             BIGINT;
  v_order_status         order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad          INTEGER;
  v_resterend            INTEGER;
  v_handmatig_totaal     INTEGER;
  v_stuks_artikelnr      TEXT;
  v_stuks_per_doos       INTEGER;
BEGIN
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN RETURN; END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;

  -- Eindstatus-guards: verzonden/geannuleerd → claims afsluiten
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = CASE WHEN v_order_status = 'Verzonden' THEN 'verzonden' ELSE 'released' END,
           updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Concept-guard verwijderd (mig 543): allocatie draait normaal voor Concept-orders.
  -- Status blijft 'Concept' via derive_wacht_status no-touch (mig 540).
  -- Operationele blokkeringen (snijplannen, herplan-sweep) blijven via andere guards.

  -- Doos→stuks vertaling (mig 408)
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;

  -- Lock + release alleen NIET-handmatige claims
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad — enige automatische stap in de korte vorm.
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  -- Resterend tekort blijft open — geen Stap 1.5/2 in deze korte vorm.

  PERFORM herwaardeer_order_status(v_order_id);
END;
$function$;

-- ============================================================================
-- Backfill: bestaande Concept-orders herberekenen
-- Alle regels van orders die nu in Concept staan en nog geen actieve claims
-- hebben maar wel voorraad beschikbaar is, worden nu correct gealloceerd.
-- ============================================================================
DO $$
DECLARE
  v_regel_id BIGINT;
  v_count    INTEGER := 0;
BEGIN
  FOR v_regel_id IN
    SELECT r.id
      FROM order_regels r
      JOIN orders o ON o.id = r.order_id
     WHERE o.status = 'Concept'
       AND NOT COALESCE(r.is_maatwerk, false)
       AND r.artikelnr IS NOT NULL
       AND COALESCE(r.te_leveren, 0) > 0
     ORDER BY r.id
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Mig 543: % Concept-orderregel(s) herberekend.', v_count;
END $$;

-- ============================================================================
-- Zelf-test: verify dat de Concept-guard weg is
-- ============================================================================
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('herallocateer_orderregel(bigint)'::regprocedure);
BEGIN
  IF v_def LIKE '%IF v_order_status = ''Concept'' THEN%' THEN
    RAISE EXCEPTION 'Mig 543: Concept-guard is NIET verwijderd uit herallocateer_orderregel';
  END IF;
  RAISE NOTICE 'Mig 543: Concept-guard verwijderd — allocator draait nu voor alle orders.';
END $$;

NOTIFY pgrst, 'reload schema';
