-- 395_annuleer_pickronde.sql
-- Terugdraai-vangnet voor een nog-niet-gepickte pickronde (ADR-0003 stond dit
-- als V2 open; aanleiding 13-06-2026: 2 orders moesten handmatig via SQL uit een
-- pickronde gehaald worden, en de geplande "hele week starten"-knop vergroot het
-- risico op een grote foutieve start). Spiegel van `voltooi_pickronde` (mig 258),
-- maar omgekeerd: verwijdert de zending-data en zet de betrokken orders terug.
--
-- Veiligheidsgrenzen (bewust streng — dit is een correctie, geen werkvloer-flow):
--   * alleen zendingen met status 'Picken';
--   * alleen als NIETS gepickt is (alle colli `pick_uitkomst='open'`) — zodra er
--     gepickt/niet-gevonden is, moet de operator via voltooien/pick-probleem.
-- Een 'Picken'-zending heeft nog geen transportorder (die ontstaat pas bij
-- voltooien/enqueue) en nog geen factuur, dus er is niets verderop op te ruimen.
--
-- Bundel-aware: leest de betrokken orders uit `zending_orders` (mig 222), met
-- legacy `zendingen.order_id`-fallback zoals voltooi_pickronde.

-- 1. Audit-event-waarde voor de terugdraai (ontbrak — mijn handmatige insert van
--    13-06 faalde hierop). Volgt het mig 258-patroon (ADD VALUE in dezelfde file
--    als de functie die hem gebruikt; de plpgsql-body resolvet de literal pas bij
--    uitvoering, dus geen "unsafe use of new value"-probleem).
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'pickronde_teruggedraaid' AFTER 'pickronde_gestart';

-- 2. RPC
CREATE OR REPLACE FUNCTION annuleer_pickronde(
  p_zending_id          BIGINT,
  p_reden               TEXT   DEFAULT NULL,
  p_actor_medewerker_id BIGINT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_huidig        zending_status;
  v_aantal_bezig  INTEGER;
  v_zending_nr    TEXT;
  v_orders        BIGINT[];
  v_order_id      BIGINT;
  v_nog_open      INTEGER;
BEGIN
  SELECT status, zending_nr INTO v_huidig, v_zending_nr
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Zending % is niet terug te draaien (status=%) — alleen een actieve pickronde kan terug',
      p_zending_id, v_huidig USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Niets-gepickt-guard: zodra ook maar één colli niet meer 'open' is, weigeren.
  SELECT COUNT(*) INTO v_aantal_bezig
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst <> 'open';
  IF v_aantal_bezig > 0 THEN
    RAISE EXCEPTION 'Zending % heeft al % gepickte/niet-gevonden colli — terugdraaien kan niet meer; voltooi of los het pick-probleem op',
      p_zending_id, v_aantal_bezig USING ERRCODE = 'restrict_violation';
  END IF;

  -- Betrokken orders via M2M (mig 222), met legacy order_id-fallback.
  SELECT array_agg(order_id) INTO v_orders
    FROM zending_orders WHERE zending_id = p_zending_id;
  IF v_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_orders
      FROM zendingen WHERE id = p_zending_id;
  END IF;

  -- Zending-data verwijderen (children eerst — FK-veilig, ongeacht cascade).
  DELETE FROM zending_colli  WHERE zending_id = p_zending_id;
  DELETE FROM zending_regels WHERE zending_id = p_zending_id;
  DELETE FROM zending_orders WHERE zending_id = p_zending_id;
  DELETE FROM zendingen      WHERE id = p_zending_id;

  -- Betrokken orders terugzetten. Alleen als de order daardoor geen actieve
  -- ('Gepland'/'Picken') zending meer heeft (bundel met andere open zending →
  -- order blijft 'In pickronde'). derive_wacht_status (mig 346) behandelt
  -- 'In pickronde' als no-op, dus de transitie moet expliciet.
  IF v_orders IS NOT NULL THEN
    FOREACH v_order_id IN ARRAY v_orders LOOP
      SELECT COUNT(*) INTO v_nog_open
        FROM zendingen z
       WHERE z.status IN ('Gepland', 'Picken')
         AND (
           z.order_id = v_order_id
           OR z.id IN (SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id)
         );

      IF v_nog_open = 0 AND EXISTS (
        SELECT 1 FROM orders WHERE id = v_order_id AND status = 'In pickronde'
      ) THEN
        PERFORM _apply_transitie(
          p_order_id            := v_order_id,
          p_event_type          := 'pickronde_teruggedraaid',
          p_status_na           := 'Klaar voor picken',
          p_actor_medewerker_id := p_actor_medewerker_id,
          p_reden               := COALESCE(p_reden, 'Pickronde teruggedraaid'),
          p_metadata            := jsonb_build_object('zending_nr', v_zending_nr)
        );
        -- Settelt alsnog in Wacht op X als er intussen een tekort/claim is.
        PERFORM herbereken_wacht_status(v_order_id);
      END IF;
    END LOOP;
  END IF;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION annuleer_pickronde(BIGINT, TEXT, BIGINT) TO authenticated;

COMMENT ON FUNCTION annuleer_pickronde(BIGINT, TEXT, BIGINT) IS
  'Mig 395: draait een nog-niet-gepickte pickronde terug (status Picken, alle colli open). '
  'Verwijdert zending_colli/_regels/_orders/zendingen en zet betrokken orders zonder '
  'andere actieve zending via _apply_transitie terug naar Klaar voor picken '
  '(event pickronde_teruggedraaid) + herbereken_wacht_status. Spiegel van voltooi_pickronde.';

NOTIFY pgrst, 'reload schema';
