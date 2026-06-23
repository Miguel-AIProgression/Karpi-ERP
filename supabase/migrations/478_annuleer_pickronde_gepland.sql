-- Migratie 478: `annuleer_pickronde` mag ook een nog-niet-gestarte ('Gepland')
-- deelzending verwijderen, niet alleen een lopende ('Picken') pickronde.
--
-- Achtergrond
-- -----------
-- Mig 477 liet `start_deelzending` een zending in `'Gepland'` aanmaken
-- (nog niet gestart, geen orderstatus-wijziging) i.p.v. direct `'Picken'`.
-- `annuleer_pickronde` (mig 398) accepteerde tot nu toe uitsluitend
-- `status='Picken'` — een operator die per ongeluk een deelzending aanmaakt
-- en 'm wil terugdraaien VOORDAT 'm gestart is, kon dat dus nergens doen (de
-- knop in de UI verdwijnt sowieso bij een andere status dan 'Picken').
--
-- De rest van de functie was hier al impliciet op voorbereid: de
-- "nog_open"-check die bepaalt of de order terug moet naar 'Klaar voor
-- picken' checkt al `z.status IN ('Gepland', 'Picken')` (zie de body) — het
-- was alleen de TOP-LEVEL guard die nog hard op 'Picken' stond.
--
-- Voor een Gepland-zending is dit zelfs veiliger dan voor een Picken-zending:
-- er is per definitie nog niets gepickt (de niets-gepickt-guard hieronder
-- gaat dus toch al altijd door), en de order-status is door mig 477 nooit
-- gewijzigd toen de deelzending werd aangemaakt — er is dus ook niets om
-- terug te draaien op orderniveau (de bestaande
-- `EXISTS (... AND status = 'In pickronde')`-check in de "orders
-- terugzetten"-stap is hier vanzelf FALSE, dus die blijft terecht een no-op).

CREATE OR REPLACE FUNCTION public.annuleer_pickronde(
  p_zending_id bigint,
  p_reden text DEFAULT NULL::text,
  p_actor_medewerker_id bigint DEFAULT NULL::bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF v_huidig NOT IN ('Gepland', 'Picken') THEN
    RAISE EXCEPTION 'Zending % is niet terug te draaien (status=%) — alleen een nog-niet-gestarte of actieve pickronde kan terug',
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
  -- 'In pickronde' als no-op, dus de transitie moet expliciet. Voor een
  -- Gepland-only annulering is deze EXISTS-check vanzelf FALSE (mig 477
  -- wijzigt de orderstatus nooit bij het aanmaken) — terecht een no-op.
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
$function$;

NOTIFY pgrst, 'reload schema';
