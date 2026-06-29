-- Migratie 526: handmatige IO-koppeling per snijplan-stuk (werklijst fase c).
--
-- CONTEXT
-- De werklijst-pagina toont tekort-stukken (geen rol, geen IO-claim).
-- De planner kan vanuit de werklijst handmatig een stuk aan een openstaande
-- inkooporder-regel koppelen, zonder dat auto-plan-groep opnieuw gedraaid
-- hoeft te worden.
--
-- IMPACT-PREFLIGHT
-- SCHRIJFT:
--   snijplannen.verwacht_inkooporder_regel_id (SET bij koppel, CLEAR bij ontkoppel)
--   snijplannen.status → 'Wacht op inkoop' (koppel) of 'Wacht' (ontkoppel)
--   inkooporder_regels.snijplan_gebruikte_lengte_cm (incrementeel ±)
--   order_regels.verzendweek / verzendweek_bron (twee paden):
--     • koppel: via trigger trg_snijplan_rol_toegewezen_auto_verzendweek (mig 471)
--       → zet week ALLEEN als verzendweek IS NULL én alle stuks gedekt zijn
--         (voorstel, bron='automatisch_voorraad'; IS NULL-guard voorkomt overschrijven
--          van een handmatig of al-berekende week)
--     • ontkoppel: clearing arm in ontkoppel_snijplan_van_io (Beslissing 2)
--       → wist week ALLEEN als verzendweek_bron='automatisch_voorraad' én
--         orderregel na ontkoppeling niet meer volledig gedekt is
--         handmatig gezette weken (bron='handmatig') worden NOOIT gewist
-- LEEST (via JOIN):
--   order_regels.maatwerk_afwerking, .maatwerk_vorm, .order_regel_id
--   kwaliteiten.standaard_breedte_cm (via k.code)
--   inkooporders.status (open-check: Besteld / Deels ontvangen)
-- TRIGGERS DIE VUREN na UPDATE op snijplannen.verwacht_inkooporder_regel_id:
--   trg_snijplan_rol_toegewezen_auto_verzendweek (mig 471)
--     → kan order_regels.verzendweek zetten als ALLE stukken van de regel gedekt zijn
--   pg_net-triggers (mig 441/442) → inert tot edge_url geconfigureerd is
-- NIET GERAAKT:
--   herallocateer_orderregel  (vaste-maat, geen maatwerk-pad)
--   herwaardeer_order_status  (geen trigger-ketting vanuit snijplannen naar orders)
--   rollen, zendingen, facturen, reserveringen
--
-- CONSERVATIEVE BIJDRAGE-SCHATTING
-- De bijdrage per stuk = placed_breedte_cm = breedte_cm + stuk_snij_marge_cm(...).
-- (MARGE-2.5CM) Dit gebruikt stuk_snij_marge_cm (mig 464) dat:
--   • rond/ovaal/organisch/*  : 2.5 cm per zijde  ← wijzig mig 464 als je 5 cm kiest
--   • ZO-afwerking             : 6 cm per zijde    (altijd, ongeacht rolbreedte)
--   • exact rolbreedte         : 0 cm              (mig 463-uitzondering)
--   • rechthoek / overig       : 0 cm
-- Bij naast-elkaar-packing is de feitelijke bijdrage minder (max per shelf, niet som),
-- maar dat is een veilige overschatting: auto-plan-groep herberekent exact bij de
-- volgende run via claim_wacht_op_inkoop (full-overwrite, mig 438).
--
-- TWEE PUBLIEKE RPC's:
--   koppel_snijplan_aan_io(p_snijplan_id, p_io_regel_id) → koppel of herkoppel één stuk
--   koppel_orderregel_aan_io(p_order_regel_id, p_io_regel_id) → koppel alle stuks atomisch
--   ontkoppel_snijplan_van_io(p_snijplan_id)               → release één stuk

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. koppel_snijplan_aan_io: koppel of herkoppel één snijplan-stuk aan een IO.
--    Atomisch: stuk vergrendeld via FOR UPDATE; faalt = volledige rollback.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION koppel_snijplan_aan_io(
  p_snijplan_id  BIGINT,
  p_io_regel_id  BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_sp_status         TEXT;
  v_sp_rol_id         BIGINT;
  v_sp_oud_io_id      BIGINT;
  v_sp_breedte_cm     INTEGER;
  v_sp_lengte_cm      INTEGER;
  v_afwerking         TEXT;
  v_vorm              TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: stuk_snij_marge_cm geeft 2.5 voor rond/ovaal (mig 464);
  -- wijzig die functie als de werkvloer-marge verandert, niet hier.
  v_marge             NUMERIC;
  v_bijdrage_cm       INTEGER;
  v_io_te_leveren_m   NUMERIC;
  v_io_gebruikt_cm    INTEGER;
  v_resterend_cm      NUMERIC;
BEGIN
  -- ── Stap 1: haal stuk op + vergrendel ───────────────────────────────────
  SELECT sp.status, sp.rol_id, sp.verwacht_inkooporder_regel_id,
         sp.breedte_cm, sp.lengte_cm,
         oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
         COALESCE(k.standaard_breedte_cm, 400)
  INTO v_sp_status, v_sp_rol_id, v_sp_oud_io_id,
       v_sp_breedte_cm, v_sp_lengte_cm,
       v_afwerking, v_vorm,
       v_standaard_breedte
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
  WHERE sp.id = p_snijplan_id
  FOR UPDATE OF sp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snijplan_niet_gevonden:Stuk % bestaat niet', p_snijplan_id;
  END IF;

  IF v_sp_rol_id IS NOT NULL THEN
    RAISE EXCEPTION 'stuk_heeft_rol:Stuk % heeft al een rol — gebruik Verplaatsen', p_snijplan_id;
  END IF;

  IF v_sp_status NOT IN ('Wacht', 'Gepland', 'Wacht op inkoop') THEN
    RAISE EXCEPTION 'ongeldige_status:Stuk % heeft status % — kan niet koppelen',
      p_snijplan_id, v_sp_status;
  END IF;

  -- Al gekoppeld aan dezelfde IO → no-op
  IF v_sp_oud_io_id = p_io_regel_id THEN
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'al_gekoppeld');
  END IF;

  -- ── Stap 2: bijdrage berekenen ───────────────────────────────────────────
  -- MARGE-2.5CM: stuk_snij_marge_cm(afwerking, vorm, lengte, breedte, std_breedte)
  -- Wijzig mig 464 (stuk_snij_marge_cm) als de marge-waarde verandert.
  v_marge := stuk_snij_marge_cm(v_afwerking, v_vorm,
    v_sp_lengte_cm::NUMERIC, v_sp_breedte_cm::NUMERIC,
    v_standaard_breedte::NUMERIC);
  -- bijdrage = placed_breedte_cm (Y-as = rollengterichting = lengte verbruikt van IO)
  v_bijdrage_cm := ROUND(v_sp_breedte_cm::NUMERIC + v_marge)::INTEGER;

  -- ── Stap 3: valideer de nieuwe IO-regel + vergrendel ────────────────────
  SELECT ir.te_leveren_m, ir.snijplan_gebruikte_lengte_cm
  INTO v_io_te_leveren_m, v_io_gebruikt_cm
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE ir.id = p_io_regel_id
    AND ir.eenheid = 'm'
    AND io.status IN ('Besteld', 'Deels ontvangen')
  FOR UPDATE OF ir;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'io_niet_gevonden:IO-regel % is niet gevonden of niet open', p_io_regel_id;
  END IF;

  v_resterend_cm := (v_io_te_leveren_m * 100) - v_io_gebruikt_cm;

  -- ── Stap 4: capaciteitscheck ─────────────────────────────────────────────
  -- Als het stuk al aan een andere IO zat, telt die vrijgave NIET mee voor de
  -- nieuwe IO (andere IO = andere teller). Dus: check puur de nieuwe IO.
  IF v_resterend_cm < v_bijdrage_cm THEN
    RAISE EXCEPTION 'onvoldoende_ruimte:IO heeft %.1f m resterend, stuk heeft %.1f m nodig (conservatief)',
      v_resterend_cm / 100.0, v_bijdrage_cm / 100.0;
  END IF;

  -- ── Stap 5: release van de oude IO (als aanwezig en anders) ─────────────
  IF v_sp_oud_io_id IS NOT NULL AND v_sp_oud_io_id <> p_io_regel_id THEN
    UPDATE inkooporder_regels
    SET snijplan_gebruikte_lengte_cm =
          GREATEST(0, snijplan_gebruikte_lengte_cm - v_bijdrage_cm)
    WHERE id = v_sp_oud_io_id;
  END IF;

  -- ── Stap 6: koppel het stuk aan de nieuwe IO ─────────────────────────────
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = p_io_regel_id,
      status = 'Wacht op inkoop'
  WHERE id = p_snijplan_id;

  -- ── Stap 7: verhoog het gebruik op de nieuwe IO ──────────────────────────
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm = snijplan_gebruikte_lengte_cm + v_bijdrage_cm
  WHERE id = p_io_regel_id;

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'bijdrage_cm', v_bijdrage_cm,
    'resterend_cm', v_resterend_cm - v_bijdrage_cm
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. koppel_orderregel_aan_io: koppel ALLE stuks van een orderregel in één
--    atomische transactie. Faalt als de IO onvoldoende ruimte heeft voor de
--    som van alle bijdrages.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION koppel_orderregel_aan_io(
  p_order_regel_id  BIGINT,
  p_io_regel_id     BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_io_te_leveren_m   NUMERIC;
  v_io_gebruikt_cm    INTEGER;
  v_resterend_cm      NUMERIC;
  v_totaal_bijdrage   INTEGER := 0;
  v_afwerking         TEXT;
  v_vorm              TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: zie stuk_snij_marge_cm (mig 464)
  v_marge             NUMERIC;
  v_bijdrage          INTEGER;
  v_stuk              RECORD;
  v_te_koppelen_ids   BIGINT[];
  v_oud_io_ids        BIGINT[];
  v_oud_io_bijdrages  INTEGER[];
  v_i                 INTEGER;
BEGIN
  -- ── Stap 1: verzamel stuks die van status wisselen ───────────────────────
  -- (stuks die al aan dezelfde IO zitten worden overgeslagen)
  FOR v_stuk IN
    SELECT sp.id, sp.breedte_cm, sp.lengte_cm,
           sp.verwacht_inkooporder_regel_id AS oud_io_id,
           oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
           COALESCE(k.standaard_breedte_cm, 400) AS standaard_breedte_cm
    FROM snijplannen sp
    JOIN order_regels oreg ON oreg.id = sp.order_regel_id
    LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
    LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
    WHERE sp.order_regel_id = p_order_regel_id
      AND sp.rol_id IS NULL
      AND sp.status IN ('Wacht', 'Gepland', 'Wacht op inkoop')
      AND (sp.verwacht_inkooporder_regel_id IS NULL
           OR sp.verwacht_inkooporder_regel_id <> p_io_regel_id)
    FOR UPDATE OF sp
    ORDER BY sp.id
  LOOP
    -- MARGE-2.5CM: bijdrage = placed_breedte_cm (Y-as, lente-richting)
    v_marge := stuk_snij_marge_cm(
      v_stuk.maatwerk_afwerking, v_stuk.maatwerk_vorm,
      v_stuk.lengte_cm::NUMERIC, v_stuk.breedte_cm::NUMERIC,
      v_stuk.standaard_breedte_cm::NUMERIC);
    v_bijdrage := ROUND(v_stuk.breedte_cm::NUMERIC + v_marge)::INTEGER;

    v_te_koppelen_ids   := array_append(v_te_koppelen_ids, v_stuk.id);
    v_oud_io_ids        := array_append(v_oud_io_ids, v_stuk.oud_io_id);
    v_oud_io_bijdrages  := array_append(v_oud_io_bijdrages, v_bijdrage);
    v_totaal_bijdrage   := v_totaal_bijdrage + v_bijdrage;
  END LOOP;

  IF array_length(v_te_koppelen_ids, 1) IS NULL THEN
    -- Alle stuks al gekoppeld aan deze IO, of geen koppelbare stuks
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'geen_stuks_te_koppelen');
  END IF;

  -- ── Stap 2: valideer + vergrendel de IO-regel ────────────────────────────
  SELECT ir.te_leveren_m, ir.snijplan_gebruikte_lengte_cm
  INTO v_io_te_leveren_m, v_io_gebruikt_cm
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE ir.id = p_io_regel_id
    AND ir.eenheid = 'm'
    AND io.status IN ('Besteld', 'Deels ontvangen')
  FOR UPDATE OF ir;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'io_niet_gevonden:IO-regel % is niet gevonden of niet open', p_io_regel_id;
  END IF;

  v_resterend_cm := (v_io_te_leveren_m * 100) - v_io_gebruikt_cm;

  -- ── Stap 3: capaciteitscheck (conservatief: som van bijdrages) ───────────
  IF v_resterend_cm < v_totaal_bijdrage THEN
    RAISE EXCEPTION 'onvoldoende_ruimte:IO heeft %.1f m resterend, % stukken vereisen %.1f m (conservatief)',
      v_resterend_cm / 100.0,
      array_length(v_te_koppelen_ids, 1),
      v_totaal_bijdrage / 100.0;
  END IF;

  -- ── Stap 4: release stuks van hun oude IO (als anders) ───────────────────
  FOR v_i IN 1 .. array_length(v_te_koppelen_ids, 1)
  LOOP
    IF v_oud_io_ids[v_i] IS NOT NULL AND v_oud_io_ids[v_i] <> p_io_regel_id THEN
      UPDATE inkooporder_regels
      SET snijplan_gebruikte_lengte_cm =
            GREATEST(0, snijplan_gebruikte_lengte_cm - v_oud_io_bijdrages[v_i])
      WHERE id = v_oud_io_ids[v_i];
    END IF;
  END LOOP;

  -- ── Stap 5: koppel alle stuks aan de nieuwe IO ───────────────────────────
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = p_io_regel_id,
      status = 'Wacht op inkoop'
  WHERE id = ANY(v_te_koppelen_ids);

  -- ── Stap 6: update de IO-teller in één keer ──────────────────────────────
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm = snijplan_gebruikte_lengte_cm + v_totaal_bijdrage
  WHERE id = p_io_regel_id;

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'aantal_stuks', array_length(v_te_koppelen_ids, 1),
    'totaal_bijdrage_cm', v_totaal_bijdrage,
    'resterend_cm', v_resterend_cm - v_totaal_bijdrage
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ontkoppel_snijplan_van_io: release één stuk van zijn IO-claim.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ontkoppel_snijplan_van_io(
  p_snijplan_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_sp_status     TEXT;
  v_sp_rol_id     BIGINT;
  v_sp_oud_io_id  BIGINT;
  v_sp_breedte_cm INTEGER;
  v_sp_lengte_cm  INTEGER;
  v_afwerking     TEXT;
  v_vorm          TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: zie stuk_snij_marge_cm (mig 464)
  v_marge         NUMERIC;
  v_bijdrage_cm   INTEGER;
  v_sp_order_regel_id BIGINT;  -- voor clearing arm (Beslissing 2)
BEGIN
  -- Haal stuk op + vergrendel
  SELECT sp.status, sp.rol_id, sp.verwacht_inkooporder_regel_id,
         sp.breedte_cm, sp.lengte_cm, sp.order_regel_id,
         oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
         COALESCE(k.standaard_breedte_cm, 400)
  INTO v_sp_status, v_sp_rol_id, v_sp_oud_io_id,
       v_sp_breedte_cm, v_sp_lengte_cm, v_sp_order_regel_id,
       v_afwerking, v_vorm, v_standaard_breedte
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
  WHERE sp.id = p_snijplan_id
  FOR UPDATE OF sp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snijplan_niet_gevonden:Stuk % bestaat niet', p_snijplan_id;
  END IF;

  -- Geen IO-claim → no-op
  IF v_sp_oud_io_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'geen_io_claim');
  END IF;

  -- MARGE-2.5CM: zelfde formule als bij koppelen
  v_marge := stuk_snij_marge_cm(v_afwerking, v_vorm,
    v_sp_lengte_cm::NUMERIC, v_sp_breedte_cm::NUMERIC,
    v_standaard_breedte::NUMERIC);
  v_bijdrage_cm := ROUND(v_sp_breedte_cm::NUMERIC + v_marge)::INTEGER;

  -- Release van de IO-teller
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm =
        GREATEST(0, snijplan_gebruikte_lengte_cm - v_bijdrage_cm)
  WHERE id = v_sp_oud_io_id;

  -- Reset het stuk
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = NULL,
      status = 'Wacht'
  WHERE id = p_snijplan_id;

  -- Beslissing 2 — clearing arm:
  -- Na ontkoppeling: als de orderregel niet meer volledig gedekt is (≥1 stuk
  -- heeft geen rol_id én geen verwacht_inkooporder_regel_id, het nu-reset stuk
  -- zelf telt mee), wis dan een automatisch gezette verzendweek.
  -- Handmatig gezette weken (verzendweek_bron='handmatig') worden NOOIT gewist.
  -- Het EXISTS-subquery leest de state NADAT het huidige stuk gereset is,
  -- dus vindt altijd minstens het huidige stuk als ongedekt → correct.
  UPDATE order_regels
  SET verzendweek      = NULL,
      verzendweek_bron = NULL
  WHERE id = v_sp_order_regel_id
    AND verzendweek_bron = 'automatisch_voorraad'
    AND EXISTS (
      SELECT 1 FROM snijplannen sp2
      WHERE sp2.order_regel_id = v_sp_order_regel_id
        AND sp2.status <> 'Geannuleerd'
        AND sp2.rol_id IS NULL
        AND sp2.verwacht_inkooporder_regel_id IS NULL
    );

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'vrijgegeven_cm', v_bijdrage_cm
  );
END;
$$;

-- Rechten: zelfde patroon als andere werklijst-RPC's
GRANT EXECUTE ON FUNCTION koppel_snijplan_aan_io(BIGINT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION koppel_orderregel_aan_io(BIGINT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ontkoppel_snijplan_van_io(BIGINT) TO anon, authenticated;

DO $$ BEGIN
  RAISE NOTICE 'Mig 526: koppel_snijplan_aan_io / koppel_orderregel_aan_io / ontkoppel_snijplan_van_io aangemaakt.';
END $$;
