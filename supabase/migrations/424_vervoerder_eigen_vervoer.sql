-- Migratie 424: vervoerder 'eigen_vervoer' + type 'eigen'
--
-- Achtergrond
-- -----------
-- Verzoek Thom (18-06, /pick-ship): naast HST/Rhenus/Verhoek ook "eigen vervoer"
-- kunnen kiezen in Pick & Ship. Bij eigen vervoer rijdt Karpi (of een derde)
-- zelf — de volledige pick/label/pakbon/zending-flow blijft identiek, alleen
-- wordt er NIETS naar een externe portal/API doorgestuurd.
--
-- Dit is een eigen, losstaande vervoerder (NIET de afhalen-vlag, mig 204): de
-- operator kiest 'm handmatig via de bestaande vervoerder-override per order
-- (bron='override'). Bewust GEEN selectie-regel → geen automatische routering.
--
-- Patroon = data-driven vervoerder (ADR-0008/0030/0034): één rij in
-- `vervoerders` + één dispatch-tak. Net als de bestaande 'print'-tak (DPD,
-- mig 207) doet de 'eigen'-tak alleen genereer_zending_colli — geen
-- transportorder-queue, geen edge function, geen preflight/capability. Aparte
-- type-waarde i.p.v. 'print' hergebruiken: semantisch helder (eigen vervoer is
-- géén lokaal carrier-label) + eigen audit-spoor ('enqueued_eigen').
--
-- Idempotent.

-- ============================================================================
-- 1. CHECK-constraint uitbreiden met 'eigen'
--    (mig 170: api/edi; mig 207: +print; mig 374: +sftp)
-- ============================================================================
ALTER TABLE vervoerders DROP CONSTRAINT IF EXISTS vervoerders_type_check;
ALTER TABLE vervoerders ADD CONSTRAINT vervoerders_type_check
  CHECK (type IN ('api', 'edi', 'print', 'sftp', 'eigen'));

COMMENT ON COLUMN vervoerders.type IS
  'Communicatiemethode: ''api'' (HST-style REST), ''edi'' (Transus/EDIFACT), '
  '''print'' (lokale label-printer, bv. DPD via Zebra), ''sftp'' (Verhoek/Rhenus '
  'XML), ''eigen'' (eigen vervoer — geen externe koppeling, alleen colli/label/pakbon).';

-- ============================================================================
-- 2. Vervoerder 'eigen_vervoer' toevoegen.
--    Direct actief=TRUE: er is geen externe partij, dus geen rondreis-test nodig.
-- ============================================================================
INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
  ('eigen_vervoer', 'Eigen vervoer', 'eigen', TRUE,
   'Eigen vervoer (verzoek Thom 18-06): Karpi of een derde rijdt zelf. Volledige '
   'pick/label/pakbon/zending-flow, maar GEEN aanmelding bij een externe portal/API. '
   'Handmatig kiezen via de vervoerder-override per order (bron=''override''); geen '
   'selectie-regel, dus geen automatische routering.')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 3. Dispatcher uitbreiden met de 'eigen'-tak.
--    CREATE OR REPLACE = volledige mig-420-body + WHEN 'eigen'. Bij elke
--    wijziging moet de complete body opnieuw mee — drift-check via
--    pg_get_functiondef('enqueue_zending_naar_vervoerder'::regproc).
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

  -- HOLD-GUARD (colli-bundeling): een handmatig-aanmelden-vervoerder houdt een
  -- multi-colli-zending vast tot de operator vrijgeeft (p_handmatig=TRUE). Een
  -- 1-colli-zending kan niet gebundeld worden -> gaat altijd automatisch door.
  IF NOT p_handmatig AND COALESCE(v_handmatig_verv, FALSE) THEN
    -- Tel alleen niet-gebundelde colli (bundel_colli_id IS NULL): bij de auto-trigger
    -- bestaan er nog geen bundels, dus dit = het fysieke aantal; de filter maakt de
    -- intentie expliciet en is defensief tegen een eventuele her-trigger na bundeling.
    SELECT COUNT(*) INTO v_aantal_colli
      FROM zending_colli WHERE zending_id = p_zending_id AND bundel_colli_id IS NULL;
    IF v_aantal_colli >= 2 THEN
      RETURN 'held_handmatig';
    END IF;
  END IF;

  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'sftp' THEN
      CASE v_vervoerder_code
        WHEN 'verhoek_sftp' THEN
          PERFORM enqueue_verhoek_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_verhoek';
        WHEN 'rhenus_sftp' THEN
          PERFORM enqueue_rhenus_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_rhenus';
        ELSE
          RAISE NOTICE 'SFTP-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    -- Eigen vervoer (mig 424): identiek aan 'print' qua flow (colli klaarzetten
    -- voor label/pakbon) maar GEEN externe dispatch. Eigen return voor audit.
    WHEN 'eigen' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_eigen';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT + hold-guard. Sinds mig 420: 2-arg (p_handmatig). Een vervoerder '
  'met handmatig_aanmelden houdt een >=2-colli-zending vast (RETURN ''held_handmatig'') '
  'tot de operator vrijgeeft (p_handmatig=TRUE, via meld_zending_handmatig_aan). '
  'De trigger roept de 1-arg-vorm aan -> resolved naar deze functie met default FALSE. '
  'Mig 424: type ''eigen'' (eigen vervoer) -> genereer_zending_colli, geen externe dispatch.';

NOTIFY pgrst, 'reload schema';
