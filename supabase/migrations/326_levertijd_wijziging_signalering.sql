-- Migratie 326: signalering van levertijd-wijzigingen door leverancier-ETA-updates
--
-- Probleem: sinds mig 318/319 propageert update_regel_eta een ETA-wijziging
-- (leverancier-portal of intern) direct en stil naar orders.afleverdatum
-- (sync_order_afleverdatum_eta is bidirectioneel — kan zowel vervroegen als
-- verlaten). Operationeel correct, maar onzichtbaar: een klant kan twee weken
-- later gaan leveren zonder dat iemand het ziet of de klant herbevestigt.
--
-- Aanpak:
--   a. order_event_type uitbreiden met 'levertijd_gewijzigd_door_eta' (audit-trail,
--      patroon mig 297: ALTER TYPE ADD VALUE vóór de functies die 'm gebruiken).
--   b. Eén nullable gate-kolom op orders: levertijd_wijziging_te_bevestigen_sinds.
--      NULL = niets open. Detectie zet 'm op now() (ook als er al een open
--      melding stond — een hernieuwde wijziging "verst" de gate dus altijd
--      opnieuw, ongeacht eerdere bevestiging). Bevestigen zet 'm terug op NULL.
--      Bewust ÉÉN kolom i.p.v. twee timestamps (zoals edi_gewenste_afleverdatum/
--      edi_bevestigd_op): PostgREST/Supabase-js kan niet filteren op
--      kolom-vs-kolom-vergelijkingen (bevestigd_op < gemeld_op), en de
--      EDI-gate is "eenmalig" (vast bij order-aanmaak) terwijl deze gate
--      herhaaldelijk open/dicht moet kunnen — een nulbare "sinds wanneer open"
--      timestamp is dan zowel het filterbare gate-predicaat (`IS NOT NULL`)
--      als de weergavewaarde ineen.
--   c. sync_order_afleverdatum_eta: detecteert of de ISO-leverweek verandert
--      (verzendweek_voor_datum, mig 228) en logt + vlagt indien zo. Optionele
--      trigger-context-parameters zodat update_regel_eta de bron kan meegeven.
--   d. update_regel_eta: geeft regel-id + eta_bijgewerkt_door + caller-snapshot
--      van de "oude" afleverdatum door als context (zie toelichting bij c).
--   e. Nieuwe RPC markeer_levertijd_herbevestigd — idempotente gate-clearer,
--      mirrort markeer_order_edi_bevestigd (mig 158). Puur administratief: geen
--      automatische klant-communicatie (afgesproken met gebruiker).

-- ── a. enum-uitbreiding ──────────────────────────────────────────────────────

ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'levertijd_gewijzigd_door_eta';

-- ── b. gate-kolom op orders ──────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS levertijd_wijziging_te_bevestigen_sinds TIMESTAMPTZ;

COMMENT ON COLUMN orders.levertijd_wijziging_te_bevestigen_sinds IS
  'Tijdstip van de laatst gedetecteerde levertijd-wijziging door een ETA-update '
  '(sync_order_afleverdatum_eta, mig 326) die nog niet aan de klant is '
  'herbevestigd. NULL = niets open. Gezet zodra de ISO-leverweek daadwerkelijk '
  'verschuift; teruggezet op NULL door markeer_levertijd_herbevestigd zodra de '
  'operator de klant handmatig heeft geïnformeerd. Eén nullable timestamp i.p.v. '
  'een gemeld_op/bevestigd_op-paar (zoals edi_gewenste_afleverdatum/'
  'edi_bevestigd_op) omdat (1) deze gate — anders dan de eenmalige EDI-gate — '
  'herhaaldelijk open/dicht gaat, en (2) PostgREST niet op kolom-vs-kolom kan '
  'filteren; "IS NOT NULL" is zowel het filterbare predicaat als de weergavewaarde.';

-- ── c. sync_order_afleverdatum_eta: detectie + logging + vlag ────────────────
-- Variant van mig 319 met snapshot-vergelijking op ISO-leverweek. Optionele
-- p_trigger_* parameters laten de aanroeper (update_regel_eta) de bron van de
-- wijziging meegeven voor de audit-metadata; bij ontbreken (NULL) wordt de
-- metadata zonder die velden gevuld.

-- Vervangt eerdere signatures (mig 319: 1 arg) door de 4-argument-variant met
-- optionele trigger-context + caller-snapshot — geen overload, één signature.
DROP FUNCTION IF EXISTS sync_order_afleverdatum_eta(BIGINT);
DROP FUNCTION IF EXISTS sync_order_afleverdatum_eta(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS sync_order_afleverdatum_eta(BIGINT, BIGINT, TEXT, DATE);

CREATE OR REPLACE FUNCTION sync_order_afleverdatum_eta(
  p_order_id           BIGINT,
  p_trigger_regel_id   BIGINT DEFAULT NULL,
  p_trigger_door       TEXT   DEFAULT NULL,
  p_oude_afleverdatum  DATE   DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_status              order_status;
  v_oude_afleverdatum   DATE;
  v_claim_datum         DATE;
  v_week_oud            TEXT;
  v_week_nieuw          TEXT;
BEGIN
  SELECT status, afleverdatum INTO v_status, v_oude_afleverdatum
    FROM orders WHERE id = p_order_id;

  -- p_oude_afleverdatum (indien meegegeven door update_regel_eta) is de
  -- afleverdatum VÓÓR herallocateer_orderregel — dat pad triggert zelf al
  -- herwaardeer_order_status -> sync_order_afleverdatum_met_claims (forward-only),
  -- wat de "voor"-snapshot hieronder kan vertroebelen bij een latere ETA
  -- (de datum staat dan al op de nieuwe waarde tegen de tijd dat wij hier komen).
  -- De caller-snapshot is dus leidend wanneer aanwezig.
  IF p_oude_afleverdatum IS NOT NULL THEN
    v_oude_afleverdatum := p_oude_afleverdatum;
  END IF;

  -- Eindstatussen niet aanraken
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
    RETURN;
  END IF;

  v_claim_datum := bereken_late_claim_afleverdatum(p_order_id);
  IF v_claim_datum IS NULL THEN
    RETURN;
  END IF;

  v_week_oud   := verzendweek_voor_datum(v_oude_afleverdatum);
  v_week_nieuw := verzendweek_voor_datum(v_claim_datum);

  -- Signalering: alleen als de leverweek daadwerkelijk verschuift (mig 326).
  -- Kleine dag-schuiven binnen dezelfde ISO-week triggeren bewust geen melding —
  -- het systeem communiceert overal in verzendweken (mig 228-230, EDI-leverweek).
  IF v_oude_afleverdatum IS NOT NULL AND v_week_oud IS DISTINCT FROM v_week_nieuw THEN
    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    VALUES (
      p_order_id,
      'levertijd_gewijzigd_door_eta',
      v_status,
      jsonb_build_object(
        'afleverdatum_oud',     v_oude_afleverdatum,
        'afleverdatum_nieuw',   v_claim_datum,
        'verzendweek_oud',      v_week_oud,
        'verzendweek_nieuw',    v_week_nieuw,
        'inkooporder_regel_id', p_trigger_regel_id,
        'eta_bijgewerkt_door',  p_trigger_door,
        'migratie', 326
      )
    );

    UPDATE orders
       SET afleverdatum = v_claim_datum,
           week         = to_char(v_claim_datum, 'IW'),
           levertijd_wijziging_te_bevestigen_sinds = now()
     WHERE id = p_order_id;
  ELSE
    -- Bidirectioneel: update altijd naar de nieuwe berekende datum (mig 319-gedrag),
    -- maar zonder melding/gate-wijziging als de leverweek gelijk blijft.
    UPDATE orders
       SET afleverdatum = v_claim_datum,
           week         = to_char(v_claim_datum, 'IW')
     WHERE id = p_order_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_order_afleverdatum_eta(BIGINT, BIGINT, TEXT, DATE) IS
  'Bidirectionele variant van sync_order_afleverdatum_met_claims, gebruikt bij '
  'expliciete ETA-updates via update_regel_eta (mig 319). Mig 326: detecteert '
  'leverweek-verschuivingen, logt een levertijd_gewijzigd_door_eta order_event en '
  'zet orders.levertijd_wijziging_te_bevestigen_sinds = now() zodat de operator dit '
  'kan signaleren/herbevestigen richting de klant (handmatig — geen automatische '
  'communicatie).';

-- ── d. update_regel_eta: geef trigger-context + caller-snapshot door ─────────

CREATE OR REPLACE FUNCTION update_regel_eta(
  p_regel_id          BIGINT,
  p_verwacht_datum    DATE,
  p_door              TEXT,         -- 'karpi' | 'leverancier'
  p_leverancier_id    BIGINT DEFAULT NULL,
  p_portal_token      UUID   DEFAULT NULL,
  p_notitie           TEXT   DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_leverancier_id     BIGINT;
  v_order_id           BIGINT;
  v_oude_afleverdatum  DATE;
BEGIN
  -- Resolve leverancier_id vanuit token als die wordt gebruikt
  IF p_portal_token IS NOT NULL THEN
    SELECT id INTO v_leverancier_id FROM leveranciers WHERE portal_token = p_portal_token;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ongeldig portal token';
    END IF;
  ELSE
    v_leverancier_id := p_leverancier_id;
  END IF;

  -- Verificeer dat de regel bij deze leverancier hoort
  IF v_leverancier_id IS NOT NULL THEN
    PERFORM 1
      FROM inkooporder_regels r
      JOIN inkooporders o ON o.id = r.inkooporder_id
     WHERE r.id = p_regel_id
       AND o.leverancier_id = v_leverancier_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Regel % hoort niet bij leverancier %', p_regel_id, v_leverancier_id;
    END IF;
  END IF;

  IF p_door NOT IN ('karpi', 'leverancier') THEN
    RAISE EXCEPTION 'p_door moet ''karpi'' of ''leverancier'' zijn';
  END IF;

  -- Update de ETA op de inkooporder_regel
  UPDATE inkooporder_regels
  SET
    verwacht_datum      = p_verwacht_datum,
    eta_bijgewerkt_door = p_door,
    eta_bijgewerkt_op   = NOW(),
    leverancier_notitie = COALESCE(p_notitie, leverancier_notitie)
  WHERE id = p_regel_id;

  -- Propageer naar alle orderregels met een actieve IO-claim op deze IO-regel:
  -- 1. Herbereken allocaties voor de betreffende orderregel
  -- 2. Sync afleverdatum bidirectioneel (ETA + buffer) naar de order, met
  --    signalering bij leverweek-verschuiving (mig 326) — context (regel + door)
  --    wordt meegegeven voor de audit-metadata.
  FOR v_order_id IN
    SELECT DISTINCT oreg.order_id
      FROM order_reserveringen r
      JOIN order_regels oreg ON oreg.id = r.order_regel_id
     WHERE r.inkooporder_regel_id = p_regel_id
       AND r.status = 'actief'
       AND r.bron = 'inkooporder_regel'
  LOOP
    -- Snapshot VÓÓR herallocateer_orderregel (mig 326): dat pad triggert zelf al
    -- herwaardeer_order_status -> sync_order_afleverdatum_met_claims (forward-only),
    -- die bij een latere ETA de afleverdatum al naar voren kan schuiven — waardoor
    -- de "voor"-waarde verloren zou gaan als we die pas ná allocatie zouden lezen.
    SELECT afleverdatum INTO v_oude_afleverdatum FROM orders WHERE id = v_order_id;

    -- Alleen de orderregels heralloceren die deze IO-regel claimen
    PERFORM herallocateer_orderregel(r2.order_regel_id)
      FROM order_reserveringen r2
      JOIN order_regels oreg2 ON oreg2.id = r2.order_regel_id
     WHERE r2.inkooporder_regel_id = p_regel_id
       AND r2.status = 'actief'
       AND r2.bron = 'inkooporder_regel'
       AND oreg2.order_id = v_order_id;

    -- Bidirectionele datum-sync + signalering na allocatie, met de pré-allocatie
    -- snapshot als betrouwbare "voor"-waarde voor de vergelijking.
    PERFORM sync_order_afleverdatum_eta(v_order_id, p_regel_id, p_door, v_oude_afleverdatum);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_regel_eta IS
  'Update ETA op inkooporder_regel (mig 318) en propageert naar afleverdatum '
  'van alle getroffen orders (bidirectioneel + signalering bij leverweek-wijziging, '
  'mig 319/326). Valideert token/leverancier-eigenaarschap.';

-- ── e. RPC markeer_levertijd_herbevestigd ────────────────────────────────────
-- Idempotente gate-clearer, mirrort markeer_order_edi_bevestigd (mig 158).
-- Puur administratief: zet de gate terug op NULL. Geen orderbev/mail — de
-- operator communiceert zelf met de klant en vinkt het hier af als audit-trail.

CREATE OR REPLACE FUNCTION markeer_levertijd_herbevestigd(p_order_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE orders
     SET levertijd_wijziging_te_bevestigen_sinds = NULL
   WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_levertijd_herbevestigd(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_levertijd_herbevestigd IS
  'Markeert dat de operator de klant handmatig heeft geïnformeerd over een '
  'gewijzigde levertijd (door leverancier-ETA-update). Zet enkel '
  'orders.levertijd_wijziging_te_bevestigen_sinds = NULL (gate dicht) — geen '
  'geautomatiseerde communicatie. Mig 326.';

-- ── orders_list view: nieuwe kolom toevoegen ─────────────────────────────────
-- orders_list selecteert expliciete kolommen (o.a. edi_gewenste_afleverdatum/
-- edi_bevestigd_op, mig 309). De nieuwe gate-kolom volgt hetzelfde pad zodat
-- fetchOrders erop kan filteren en de banner op order-detail erop kan
-- conditioneren. CREATE OR REPLACE behoudt de bestaande definitie 1-op-1, met
-- alleen de nieuwe kolom toegevoegd aan het einde van de SELECT-lijst (Postgres
-- staat geen herordering/verwijdering van bestaande view-kolommen toe).

CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id) zo.order_id,
    z.id AS zending_id,
    z.zending_nr AS bundel_zending_nr,
    cnt.aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT count(*)::integer AS aantal_orders
    FROM zending_orders zo2
    WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY zo.order_id, (
    CASE z.status
      WHEN 'Picken'::zending_status THEN 1
      WHEN 'Klaar voor verzending'::zending_status THEN 2
      WHEN 'Onderweg'::zending_status THEN 3
      WHEN 'Afgeleverd'::zending_status THEN 4
      ELSE 5
    END), z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  o.debiteur_zeker,
  o.debiteur_match_bron,
  b.zending_id AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  o.levertijd_wijziging_te_bevestigen_sinds
FROM orders o
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b ON b.order_id = o.id;

COMMENT ON VIEW orders_list IS
  'Orders met klantnaam-join + bundel-info. Mig 326: voegt '
  'levertijd_wijziging_te_bevestigen_sinds toe (signalering bij leverweek-'
  'verschuiving door ETA-update) — verder ongewijzigd t.o.v. mig 309/322.';

NOTIFY pgrst, 'reload schema';
