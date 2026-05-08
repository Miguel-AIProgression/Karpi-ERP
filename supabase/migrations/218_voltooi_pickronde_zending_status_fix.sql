-- Migratie 218: voltooi_pickronde — verwijder ongeldige 'Geannuleerd' literal
--
-- Bug op 08-05: pick-overview "Voltooi pickronde" faalde met
--   `invalid input value for enum zending_status: "Geannuleerd"` (22P02).
--
-- Oorzaak: `voltooi_pickronde` (mig 217 → mig 218 order-lifecycle) bevat een
-- "open zendingen"-telling met `status NOT IN ('Klaar voor verzending',
-- 'Onderweg', 'Afgeleverd', 'Geannuleerd')`. De enum `zending_status` (def
-- in mig 169) kent enkel: Gepland | Picken | Ingepakt | Klaar voor verzending
-- | Onderweg | Afgeleverd. PostgreSQL valideert enum-literals tijdens
-- query-execution, dus elke aanroep van het pad gooide 22P02 — ook al kon
-- er nooit een geannuleerde zending bestaan.
--
-- Vóór mig 217 (mig 211 voltooi_pickronde) had de functie geen
-- v_open_zendingen-check, dus de bug ontstond pas met de factuur-keten-koppeling.
-- Dit pad werd nooit succesvol uitgevoerd sinds mig 217 op staging stond.
--
-- Fix: 'Geannuleerd' weghalen uit de literal-lijst. Zending-cancellation is
-- geen V1-scope; mocht het ooit komen, dan vereist dat een aparte migratie
-- die ALTER TYPE zending_status ADD VALUE 'Geannuleerd' doet plus een
-- markeer_zending_geannuleerd-RPC, en dan kan deze NOT IN-lijst worden
-- uitgebreid.
--
-- Idempotent: CREATE OR REPLACE op exact dezelfde signatuur als mig 218.
-- Komt in alfabetische sortering NA 218_order_lifecycle_module.sql en
-- 218_start_pickronde_alleen_picken_hergebruik.sql, dus de fix overschrijft
-- de buggy definitie.

CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig             zending_status;
  v_aantal_niet_gev    INTEGER;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status, order_id INTO v_huidig, v_order_id
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  SELECT COUNT(*) INTO v_aantal_niet_gev
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';
  IF v_aantal_niet_gev > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gev USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  -- Sluitstuk factuur-keten: bij laatste open zending, delegeer naar Order-lifecycle.
  -- 'Geannuleerd' staat NIET in zending_status (zie mig-header) — niet meenemen.
  SELECT COUNT(*) INTO v_open_zendingen
    FROM zendingen
   WHERE order_id = v_order_id
     AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

  IF v_open_zendingen = 0 THEN
    -- Skip voor reeds-Verzonden of Geannuleerde orders (markeer_verzonden zou
    -- exception gooien op Geannuleerd; mig 217 deed silent-skip via WHERE-clause).
    IF NOT EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id
         AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN
      PERFORM markeer_verzonden(
        p_order_id            := v_order_id,
        p_actor_medewerker_id := p_picker_id
      );
      -- Tot mig 219: factuur-trigger trg_enqueue_factuur vuurt op de orders.status-UPDATE.
      -- Na mig 219: trg_enqueue_factuur is gedropt; trg_enqueue_factuur_op_event
      -- vuurt op de bijbehorende order_events-INSERT (gedaan door _apply_transitie).
    END IF;
  END IF;

  RETURN p_zending_id;
END;
$$;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 218 (ADR-0006 + zending_status-fix): voltooit Pickronde, delegeert order-status-write '
  'aan markeer_verzonden. Open-zendingen-telling gebruikt NOT IN zonder ''Geannuleerd'' — '
  'die waarde bestaat niet in enum zending_status (V1: geen zending-cancellation).';

NOTIFY pgrst, 'reload schema';
