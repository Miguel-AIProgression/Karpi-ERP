-- Migratie 541: concept-intake-gate Fase B — bevestig_concept_order RPC
--
-- Na Fase A (mig 540) zijn de vier lekken gedicht: Concept-orders komen niet
-- meer terecht in de allocator, snijplanning of herplan-sweep. Nu de
-- bevestig-RPC die een Concept-order operationeel activeert:
--
--   1. Guard: order moet in status 'Concept' zijn
--   2. _apply_transitie → 'Klaar voor picken' + audit-event 'concept_bevestigd'
--   3. Maatwerk-snijplannen aanmaken voor regels die er nog geen hebben
--      (auto_maak_snijplan was geblokkeerd door de Concept-guard in mig 540)
--   4. Volledig allocatiepad draaien voor alle regels via herallocateer_orderregel_auto
--      (Stap 1 = eigen voorraad, Stap 1.5 = alias/uitwisselbaar, Stap 2 = IO-claims)
--   5. herbereken_wacht_status: status bijstellen naar de definitieve waarde
--      (Wacht op inkoop / Wacht op voorraad / Wacht op maatwerk / Klaar voor picken)
--
-- Stap 4 gebruikt herallocateer_orderregel_auto (de volledige cascade uit mig 497)
-- en NIET de korte trigger-variant (herallocateer_orderregel). Reden: de
-- eerste bevestiging is een expliciete actie, geen trigger-bijwerking — het
-- volledige IO-claim-pad moet hier lopen (anders eindigen orders met tekort
-- altijd op 'Wacht op inkoop' zonder IO-claim, ook als er een passende IO bestaat).

------------------------------------------------------------------------
-- 1. Enum uitbreiden: 'concept_bevestigd' event-type
------------------------------------------------------------------------
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'concept_bevestigd' AFTER 'orderbevestiging_verstuurd';


------------------------------------------------------------------------
-- 2. bevestig_concept_order RPC
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bevestig_concept_order(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status order_status;
  v_regel  order_regels%ROWTYPE;
  v_aantal INTEGER;
  i        INTEGER;
BEGIN
  -- Lock de order-rij zodat parallelle bevestigingen geen race-condition geven
  SELECT status INTO v_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % kan niet bevestigd worden: status is % (verwacht: Concept)',
      p_order_id, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Stap 1: transitie naar 'Klaar voor picken' als startpunt.
  -- herbereken_wacht_status (Stap 4) stelt dit daarna bij als er tekort/maatwerk is.
  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'concept_bevestigd',
    p_status_na           := 'Klaar voor picken',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  -- Stap 2: maatwerk-snijplannen aanmaken voor regels die er nog geen hebben.
  -- auto_maak_snijplan (AFTER INSERT trigger) was geblokkeerd voor Concept-orders
  -- (mig 540 Lek 3). Nu de status 'Klaar voor picken' is, maken we ze hier zelf.
  FOR v_regel IN
    SELECT *
    FROM order_regels
    WHERE order_id = p_order_id
      AND COALESCE(is_maatwerk, false) = true
      AND maatwerk_lengte_cm  IS NOT NULL
      AND maatwerk_breedte_cm IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen WHERE order_regel_id = id
      )
  LOOP
    v_aantal := GREATEST(COALESCE(v_regel.orderaantal, 1), 1);
    FOR i IN 1..v_aantal LOOP
      INSERT INTO snijplannen (
        snijplan_nr, order_regel_id,
        lengte_cm, breedte_cm,
        status, opmerkingen,
        snijden_uit_standaardmaat
      )
      VALUES (
        volgend_nummer('SNIJ'),
        v_regel.id,
        v_regel.maatwerk_lengte_cm::INTEGER,
        v_regel.maatwerk_breedte_cm::INTEGER,
        'Wacht'::snijplan_status,
        CASE WHEN v_aantal > 1
             THEN 'Auto-aangemaakt bij bevestiging (' || i || '/' || v_aantal || ')'
             ELSE 'Auto-aangemaakt bij bevestiging'
        END,
        COALESCE(v_regel.snijden_uit_standaardmaat, false)
      );
    END LOOP;
  END LOOP;

  -- Stap 3: volledig allocatiepad voor alle regels.
  -- Gebruikt herallocateer_orderregel_auto (mig 497): Stap 1 (eigen voorraad)
  -- + Stap 1.5 (alias/uitwisselbaar) + Stap 2 (IO-claims). Dit is een expliciete
  -- actie, niet een trigger-bijwerking, dus de volledige cascade is hier gepast.
  -- De functie handelt admin-pseudo/maatwerk/nul-te-leveren intern af (early return).
  FOR v_regel IN
    SELECT * FROM order_regels WHERE order_id = p_order_id
  LOOP
    PERFORM herallocateer_orderregel_auto(v_regel.id);
  END LOOP;

  -- Stap 4: definitieve status bepalen.
  -- herallocateer_orderregel_auto roept herwaardeer_order_status al aan per regel,
  -- maar voor orders met uitsluitend maatwerk-regels (geen vaste-maat allocaties)
  -- is één expliciete aanroep nodig om van 'Klaar voor picken' naar 'Wacht op maatwerk'
  -- te gaan als alle maatwerk-snijplannen nog op 'Wacht' staan.
  PERFORM herbereken_wacht_status(p_order_id);
END;
$$;

COMMENT ON FUNCTION bevestig_concept_order(BIGINT, BIGINT, UUID) IS
  'Activeert een Concept-order: transitie → Klaar voor picken, maatwerk-snijplannen '
  'aanmaken, volledig allocatiepad (herallocateer_orderregel_auto), definitieve '
  'status (herbereken_wacht_status). Enige legitieme uitweg uit status Concept. '
  'Mig 541 (concept-intake-gate Fase B).';


NOTIFY pgrst, 'reload schema';
