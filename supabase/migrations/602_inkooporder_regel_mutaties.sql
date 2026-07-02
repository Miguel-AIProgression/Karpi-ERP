-- Migratie 602: regel-mutatie-RPC's met Claim-vloer (besluit 2026-07-02)
--
-- Wijzigen van een bestaande inkooporder bestond niet (alleen ETA + hele-order-
-- annuleren). Vijf mutaties, allemaal via RPC (ADR-0017), met de Claim-vloer
-- als guard (CONTEXT.md): verlagen/verwijderen mag nooit stil onder
-- geleverd + actieve verkooporder-claims + snijplan-'Wacht op inkoop'-claims.
-- Eronder vereist p_vrijgeven=TRUE: snijplan-stukken terug naar 'Wacht'
-- (per-regel-variant van release_wacht_op_inkoop_stukken mig 445 — het
-- cm-aggregaat is per regel, dus 0 terugzetten is exact) en verkooporder-
-- claims via release_claims_voor_io_regel → herallocateer (mig 145): getroffen
-- orders vallen zichtbaar terug naar 'Wacht op inkoop', nooit stil. Ontdekt
-- tijdens TDD (2026-07-02, live steekproef): release_claims_voor_io_regel
-- delegeert naar herallocateer_orderregel, dat bewust handmatige claims
-- (mig 154) met rust laat — op live DB bleken ALLE actieve
-- inkooporder_regel-claims is_handmatig=true, dus zonder aanvullende stap
-- releasete deze functie in de praktijk nooit iets. p_vrijgeven=TRUE is
-- echter zelf al de expliciete operatoractie op de bron die verdwijnt, dus
-- wijzig_inkooporder_regel forceert na de gewone release ook resterende
-- (per definitie handmatige) claims op DEZE regel los + herwaardeert de
-- getroffen orders — mig 154's "respecteer handmatig" blijft ongewijzigd
-- voor de normale automatische herallocatie-paden.

-- NB: de FK snijplannen.verwacht_inkooporder_regel_id is ON DELETE SET NULL —
-- daarom is een kale DELETE op inkooporder_regels verboden terrein en loopt
-- verwijderen ALTIJD via verwijder_inkooporder_regel.

-- ---------------------------------------------------------------------------
-- Helper: order-status herafleiden uit de regels (zelfde CASE als de
-- ontvangst-RPC's mig 281, nu herbruikbaar voor alle mutaties)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION herbereken_inkooporder_status(p_inkooporder_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_status inkooporder_status;
  v_regels INTEGER;
  v_open INTEGER;
  v_geleverd NUMERIC;
BEGIN
  SELECT status INTO v_status FROM inkooporders WHERE id = p_inkooporder_id FOR UPDATE;
  -- Concept nooit stil promoveren: een order in opbouw blijft Concept tot een
  -- expliciete actie hem op Besteld zet (dormant vandaag — create_inkooporder
  -- mig 601 zet direct 'Besteld' — maar goedkope robuustheid; spec-review 02-07).
  IF NOT FOUND OR v_status IN ('Geannuleerd', 'Concept') THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE te_leveren_m > 0),
         COALESCE(SUM(geleverd_m), 0)
    INTO v_regels, v_open, v_geleverd
    FROM inkooporder_regels
   WHERE inkooporder_id = p_inkooporder_id;

  IF v_regels = 0 THEN RETURN; END IF;

  IF v_open = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen'
     WHERE id = p_inkooporder_id AND status <> 'Ontvangen';
  ELSIF v_geleverd > 0 THEN
    UPDATE inkooporders SET status = 'Deels ontvangen'
     WHERE id = p_inkooporder_id AND status <> 'Deels ontvangen';
  ELSE
    UPDATE inkooporders SET status = 'Besteld'
     WHERE id = p_inkooporder_id AND status NOT IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel toevoegen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voeg_inkooporder_regel_toe(
  p_inkooporder_id BIGINT,
  p_regel JSONB
) RETURNS BIGINT AS $$
DECLARE
  v_status inkooporder_status;
  v_besteld NUMERIC := (p_regel->>'besteld_m')::NUMERIC;
  v_eenheid TEXT := COALESCE(NULLIF(p_regel->>'eenheid', ''), 'm');
  v_artikelnr TEXT := NULLIF(p_regel->>'artikelnr', '');
  v_nieuw_id BIGINT;
BEGIN
  SELECT status INTO v_status FROM inkooporders WHERE id = p_inkooporder_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder % niet gevonden', p_inkooporder_id;
  END IF;
  IF v_status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Inkooporder is geannuleerd — geen regels meer toe te voegen';
  END IF;
  IF v_besteld IS NULL OR v_besteld <= 0 THEN
    RAISE EXCEPTION 'besteld_m moet > 0 zijn';
  END IF;
  IF v_eenheid NOT IN ('m', 'stuks') THEN
    RAISE EXCEPTION 'eenheid moet ''m'' of ''stuks'' zijn (kreeg %)', v_eenheid;
  END IF;
  IF v_artikelnr IS NULL AND NULLIF(p_regel->>'karpi_code', '') IS NULL THEN
    RAISE EXCEPTION 'artikelnr of karpi_code is verplicht';
  END IF;
  IF v_artikelnr IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM producten p WHERE p.artikelnr = v_artikelnr) THEN
    RAISE EXCEPTION 'Artikel % bestaat niet', v_artikelnr;
  END IF;

  INSERT INTO inkooporder_regels (
    inkooporder_id, regelnummer, artikelnr, karpi_code, artikel_omschrijving,
    inkoopprijs_eur, besteld_m, geleverd_m, te_leveren_m, eenheid
  )
  SELECT p_inkooporder_id,
         COALESCE(MAX(r.regelnummer), 0) + 1,
         v_artikelnr,
         NULLIF(p_regel->>'karpi_code', ''),
         NULLIF(p_regel->>'artikel_omschrijving', ''),
         NULLIF(p_regel->>'inkoopprijs_eur', '')::NUMERIC,
         v_besteld, 0, v_besteld, v_eenheid
    FROM inkooporder_regels r
   WHERE r.inkooporder_id = p_inkooporder_id
  RETURNING id INTO v_nieuw_id;

  -- trg_io_regel_insert_swap_evaluate (mig 297/470) en trg_sync_besteld_inkoop
  -- vuren vanzelf op deze INSERT.
  PERFORM herbereken_inkooporder_status(p_inkooporder_id);
  RETURN v_nieuw_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Aantal en/of prijs wijzigen (de kern-RPC; annuleren/verwijderen delegeren)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wijzig_inkooporder_regel(
  p_regel_id BIGINT,
  p_besteld NUMERIC DEFAULT NULL,
  p_inkoopprijs_eur NUMERIC DEFAULT NULL,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order_status inkooporder_status;
  v_geclaimd NUMERIC := 0;
  v_snijplan_cm INTEGER := 0;
  v_onder_vloer BOOLEAN := FALSE;
  v_resterende_claim RECORD;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  SELECT status INTO v_order_status FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order_status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Inkooporder is geannuleerd — regels niet meer wijzigbaar';
  END IF;

  IF p_inkoopprijs_eur IS NOT NULL THEN
    UPDATE inkooporder_regels SET inkoopprijs_eur = p_inkoopprijs_eur WHERE id = p_regel_id;
  END IF;

  IF p_besteld IS NULL OR p_besteld = v_regel.besteld_m THEN
    RETURN;
  END IF;

  IF p_besteld < v_regel.geleverd_m THEN
    RAISE EXCEPTION 'Besteld (%) kan niet lager dan al geleverd (%)', p_besteld, v_regel.geleverd_m;
  END IF;

  IF p_besteld < v_regel.besteld_m THEN
    SELECT COALESCE(SUM(aantal), 0) INTO v_geclaimd
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_regel_id
       AND bron = 'inkooporder_regel' AND status = 'actief';
    v_snijplan_cm := COALESCE(v_regel.snijplan_gebruikte_lengte_cm, 0);

    v_onder_vloer :=
         (v_regel.eenheid = 'stuks' AND p_besteld < v_regel.geleverd_m + v_geclaimd)
      OR (v_regel.eenheid = 'm'     AND v_snijplan_cm > 0);

    IF v_onder_vloer AND NOT p_vrijgeven THEN
      RAISE EXCEPTION 'Claim-vloer: op deze regel rusten beloftes (verkooporder-claims: % stuks, snijplanning: % cm). Verlagen vereist expliciet vrijgeven — getroffen orders vallen dan zichtbaar terug naar "Wacht op inkoop".',
        v_geclaimd, v_snijplan_cm;
    END IF;
  END IF;

  UPDATE inkooporder_regels
     SET besteld_m = p_besteld,
         te_leveren_m = GREATEST(p_besteld - geleverd_m, 0)
   WHERE id = p_regel_id;

  IF v_onder_vloer AND p_vrijgeven THEN
    -- Snijplan-claims op DEZE regel loslaten. Stukken gaan terug naar 'Wacht'
    -- (trigger snijplan_wacht_naar_snijden normaliseert verder, zelfde patroon
    -- als mig 445); auto-plan-groep plant ze bij de volgende run opnieuw in —
    -- werkinstructie: draai "Auto-plan opnieuw" voor de groep na vrijgeven.
    UPDATE snijplannen
       SET status = 'Wacht', verwacht_inkooporder_regel_id = NULL
     WHERE verwacht_inkooporder_regel_id = p_regel_id
       AND status = 'Wacht op inkoop';
    UPDATE inkooporder_regels SET snijplan_gebruikte_lengte_cm = 0 WHERE id = p_regel_id;

    -- Verkooporder-claims: herallocateer alle claimende orderregels. De
    -- allocator ziet de al-verlaagde ruimte en dekt elders — of laat de order
    -- zichtbaar terugvallen naar 'Wacht op inkoop' (derive_wacht_status).
    PERFORM release_claims_voor_io_regel(p_regel_id);

    -- release_claims_voor_io_regel delegeert naar herallocateer_orderregel,
    -- die BEWUST handmatige claims (mig 154, is_handmatig=true) met rust
    -- laat — correct voor gewone herallocatie, maar hier verdwijnt de BRON
    -- zelf door een expliciete p_vrijgeven=TRUE-operatoractie. Wat na de
    -- release nog actief op DEZE regel staat is dus per definitie een
    -- handmatige claim (live geverifieerd: alle 16 bestaande actieve
    -- inkooporder_regel-claims zijn is_handmatig=true) — alsnog releasen +
    -- de getroffen order herwaarderen, zodat de status zichtbaar terugvalt
    -- i.p.v. een claim te laten hangen op een regel die net verkleind is.
    FOR v_resterende_claim IN
      SELECT DISTINCT ors.order_regel_id, ore.order_id
        FROM order_reserveringen ors
        JOIN order_regels ore ON ore.id = ors.order_regel_id
       WHERE ors.inkooporder_regel_id = p_regel_id
         AND ors.bron = 'inkooporder_regel' AND ors.status = 'actief'
    LOOP
      UPDATE order_reserveringen
         SET status = 'released', updated_at = now()
       WHERE order_regel_id = v_resterende_claim.order_regel_id
         AND inkooporder_regel_id = p_regel_id
         AND bron = 'inkooporder_regel' AND status = 'actief';
      PERFORM herwaardeer_order_status(v_resterende_claim.order_id);
    END LOOP;

    -- Defensief: blijven er claims boven de nieuwe ruimte staan (bv. door een
    -- pad dat de allocator bewust niet loslaat), dan hard falen i.p.v. een
    -- stille overclaim op een verkleinde regel.
    IF (SELECT COALESCE(SUM(aantal), 0) FROM order_reserveringen
         WHERE inkooporder_regel_id = p_regel_id
           AND bron = 'inkooporder_regel' AND status = 'actief')
       > GREATEST(p_besteld - v_regel.geleverd_m, 0) THEN
      RAISE EXCEPTION 'Vrijgeven onvolledig: er blijven claims boven de nieuwe ruimte op deze regel — los ze eerst op via de claim-uitsplitsing op order-detail';
    END IF;
  END IF;

  PERFORM herbereken_inkooporder_status(v_regel.inkooporder_id);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel annuleren: "de rest komt niet meer" — besteld := geleverd
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION annuleer_inkooporder_regel(
  p_regel_id BIGINT,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_geleverd NUMERIC;
BEGIN
  SELECT geleverd_m INTO v_geleverd FROM inkooporder_regels WHERE id = p_regel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  PERFORM wijzig_inkooporder_regel(p_regel_id, v_geleverd, NULL, p_vrijgeven);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel verwijderen: alleen zonder ontvangsten; nooit de laatste regel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verwijder_inkooporder_regel(
  p_regel_id BIGINT,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  IF v_regel.geleverd_m > 0
     OR EXISTS (SELECT 1 FROM rollen r WHERE r.inkooporder_regel_id = p_regel_id) THEN
    RAISE EXCEPTION 'Regel heeft al ontvangsten — gebruik "Regel annuleren" i.p.v. verwijderen';
  END IF;
  -- order_reserveringen is append-only historie (claims worden status-geflipt
  -- naar released/verzonden/geleverd, nooit verwijderd) én de FK
  -- order_reserveringen.inkooporder_regel_id is ON DELETE RESTRICT — een regel
  -- die OOIT een claim droeg was operationeel actief en de DELETE zou hoe dan
  -- ook op een rauwe 23503 FK-fout stranden (live gereproduceerd op regel 401:
  -- 0 actieve, 4 released claims). De FK nullen zou de audit-koppeling
  -- vernietigen — weiger dus met een heldere melding; verwijderen is alleen
  -- voor pure vergissingen zonder enige historie.
  IF EXISTS (SELECT 1 FROM order_reserveringen orr WHERE orr.inkooporder_regel_id = p_regel_id) THEN
    RAISE EXCEPTION 'Regel heeft claim-historie (audit-trail) — gebruik "Regel annuleren" i.p.v. verwijderen';
  END IF;
  IF (SELECT COUNT(*) FROM inkooporder_regels
       WHERE inkooporder_id = v_regel.inkooporder_id) = 1 THEN
    RAISE EXCEPTION 'Laatste regel van de order — annuleer de hele inkooporder i.p.v. de regel te verwijderen';
  END IF;

  -- Zelfde Claim-vloer + vrijgeef-mechaniek als verlagen-naar-0; de check op
  -- resterende claims beschermt de ON DELETE RESTRICT-FK van order_reserveringen.
  PERFORM wijzig_inkooporder_regel(p_regel_id, 0, NULL, p_vrijgeven);
  DELETE FROM inkooporder_regels WHERE id = p_regel_id;
  PERFORM herbereken_inkooporder_status(v_regel.inkooporder_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herbereken_inkooporder_status(BIGINT) IS
  'Inkoop-Module (mig 602): status herafleiden uit regels (Ontvangen/Deels ontvangen/Besteld). No-op bij Geannuleerd, Concept of 0 regels.';
COMMENT ON FUNCTION voeg_inkooporder_regel_toe(BIGINT, JSONB) IS
  'Inkoop-Module (mig 602): regel toevoegen aan bestaande order, regelnummer=MAX+1. Swap-evaluatie + besteld_inkoop-sync via bestaande triggers.';
COMMENT ON FUNCTION wijzig_inkooporder_regel(BIGINT, NUMERIC, NUMERIC, BOOLEAN) IS
  'Inkoop-Module (mig 602): aantal/prijs wijzigen met Claim-vloer-guard (CONTEXT.md). p_vrijgeven=TRUE releaset snijplan- en verkooporder-claims expliciet en zichtbaar, inclusief handmatige claims (mig 154) die specifiek aan deze regel hangen — de bron verdwijnt door deze expliciete actie, dus die override is bewust.';
COMMENT ON FUNCTION annuleer_inkooporder_regel(BIGINT, BOOLEAN) IS
  'Inkoop-Module (mig 602): rest van de regel komt niet meer — besteld := geleverd. Delegeert naar wijzig_inkooporder_regel.';
COMMENT ON FUNCTION verwijder_inkooporder_regel(BIGINT, BOOLEAN) IS
  'Inkoop-Module (mig 602): regel verwijderen, alleen zonder ontvangsten, zonder claim-historie (order_reserveringen is append-only + FK ON DELETE RESTRICT) en nooit de laatste regel. Kale DELETE is verboden (FK snijplannen ON DELETE SET NULL laat anders stille wezen achter).';

GRANT EXECUTE ON FUNCTION herbereken_inkooporder_status(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION voeg_inkooporder_regel_toe(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION wijzig_inkooporder_regel(BIGINT, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION annuleer_inkooporder_regel(BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION verwijder_inkooporder_regel(BIGINT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 602 toegepast: regel-mutatie-RPC''s met Claim-vloer.';
END $$;
