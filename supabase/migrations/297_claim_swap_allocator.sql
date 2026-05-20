-- Migratie 297: deadline-bewuste claim-swap in herallocateer_orderregel (ADR-0027)
--
-- Context: tot mig 154 was claim-volgorde-prio strikt FIFO ("wie eerst claimt
-- wordt eerst beleverd"). ADR-0027 herziet die invariant beperkt voor het
-- volgende scenario:
--
--   T0: order A komt binnen, afleverdatum=wk 40 (operator vult bewust later
--       in, want klant heeft "geen haast"). Voorraad=1 → A claimt voorraad.
--   T+1 week: order B komt binnen, afleverdatum=wk 21 (urgent). Voorraad=0,
--       allocator → IO wk 30 → B mist deadline.
--
-- Optimale uitkomst: A → IO wk 30 (past ruim in wk 40), B → voorraad. Beide
-- deadlines gehaald.
--
-- Oplossing: extra swap-fase in `herallocateer_orderregel` tussen de bestaande
-- voorraad-claim-stap en de IO-fallback. Wanneer B nog tekort heeft nadat het
-- voorraad voor zichzelf heeft geclaimd, scant de RPC naar swap-baar voorraad
-- onder andere orders A waarvoor:
--
--   - A.afleverdatum > A.standaard_afleverdatum_berekend (bewust later)
--   - A heeft alléén voorraad-claims voor die orderregel (geen multi-source)
--   - A.status NOT IN ('Verzonden', 'Geannuleerd')
--   - er bestaat een IO-regel met verwacht_datum + buffer ≤ A.afleverdatum
--
-- EDD-selectie (Earliest Deadline gives last): de A met de meeste headroom
-- verliest claim eerst (ORDER BY A.afleverdatum DESC). IO-keuze bij swap is
-- de laatst-passende IO (verwacht_datum DESC) — bewaart vroege IO's voor
-- toekomstige urgente claims.
--
-- Audit: bij elke geslaagde swap insert de RPC twee `order_events`-rijen
-- (`claim_geswapt_weg` op A, `claim_geswapt_naar` op B). Géén bestaande
-- listener leest deze types — pure audit.
--
-- Reactieve trigger `trg_io_regel_insert_swap_evaluate` heralloceert
-- orderregels in 'Wacht op voorraad' / 'Wacht op inkoop' wanneer een nieuwe
-- IO-regel binnenkomt — die kan nu een swap-doelwit zijn voor één van de A's,
-- waardoor de wachtende orderregel alsnog voorraad krijgt.
--
-- Constraints:
--   - Geen schema-DDL op order_reserveringen of orders.
--   - `herallocateer_orderregel`-signature ongewijzigd; bestaande callers
--     (triggers mig 146/147, set_uitwisselbaar_claims mig 154) blijven werken.
--   - Lock-volgorde: target-orderregel-claims eerst, dán swap-bron-claims.
--     Vermijdt deadlock met `set_uitwisselbaar_claims` en `release_claims_voor_io_regel`
--     die uitsluitend op één orderregel tegelijk locken.
--   - Voor cross-orderregel-locking gebruiken we ORDER BY order_regel_id om
--     consistente volgorde te garanderen bij meerdere swap-kandidaten.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS,
-- ADD VALUE IF NOT EXISTS op enum.
-- LET OP: ADD VALUE staat aan top, vóór CREATE OR REPLACE FUNCTION. Postgres 12+
-- staat dat toe omdat de plpgsql-body alleen tekst is bij CREATE-tijd; de
-- enum-cast vindt pas plaats wanneer de trigger vuurt. Hetzelfde patroon als
-- mig 257 → 258.

-- ============================================================================
-- 1. order_event_type-enum uitbreiden
-- ============================================================================
-- ADD VALUE IF NOT EXISTS is idempotent (PG 9.6+). Geen DO-block nodig.
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'claim_geswapt_weg'
  AFTER 'backfill_fase_normalisatie';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'claim_geswapt_naar'
  AFTER 'claim_geswapt_weg';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'deadline_conflict_na_swap'
  AFTER 'claim_geswapt_naar';

-- ============================================================================
-- 2. herallocateer_orderregel met swap-fase
-- ============================================================================
-- Body: behoud alle gedrag van mig 154 (handmatige claims respect, voorraad
-- eerst, dan IO ASC). Tussen voorraad-claim en IO-fallback komt een nieuwe
-- swap-fase die — alleen als er nog tekort is na voorraad — scant naar
-- swap-bare A-orders en hun voorraad afpakt.
--
-- Algoritme swap-fase:
--   while v_resterend > 0:
--     1. Zoek beste swap-bron-kandidaat A (EDD: hoogste afleverdatum eerst)
--     2. Zoek laatst-passende IO voor A (verwacht_datum + buffer ≤ A.afleverdatum)
--     3. Geen kandidaat OF geen passende IO → break (val terug op IO-fallback)
--     4. Lock A's voorraad-claim FOR UPDATE
--     5. Reduce/release A's voorraad-claim met v_swap (min van A's claim, B's tekort)
--     6. Insert IO-claim voor A op de gevonden IO
--     7. Insert voorraad-claim voor B
--     8. Insert 2× order_events (claim_geswapt_weg op A, claim_geswapt_naar op B)
--     9. PERFORM herwaardeer_order_status voor A's order
--     10. v_resterend -= v_swap
--
-- Per swap-iteratie maximaal 1 A-kandidaat gepakt. Loop herhaalt zolang B
-- tekort heeft EN nieuwe A's blijven verschijnen. EDD-volgorde wordt elke
-- iteratie opnieuw geëvalueerd zodat A's die door deze run zelf zijn
-- veranderd niet opnieuw worden gekozen (hun fysieke claim is nu IO, niet
-- voorraad-only — voldoet niet meer aan swap-bron-criterium).

CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_artikelnr TEXT;
  v_te_leveren INTEGER;
  v_is_maatwerk BOOLEAN;
  v_order_id BIGINT;
  v_order_status order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad INTEGER;
  v_resterend INTEGER;
  v_handmatig_totaal INTEGER;
  v_io RECORD;
  v_io_ruimte INTEGER;
  v_alloc INTEGER;
  v_buffer_dagen INTEGER;
  v_swap_kandidaat RECORD;
  v_swap_io RECORD;
  v_swap_io_id BIGINT;
  v_swap_io_verwacht DATE;
  v_swap_aantal INTEGER;
  v_a_claim_resterend INTEGER;
BEGIN
  -- Lees orderregel
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    -- Regel bestaat niet (kan na DELETE-cascade gebeuren)
    RETURN;
  END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    -- Maatwerk of zonder artikelnr: release alle claims, doe verder niets
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- LOCK-VOLGORDE STAP 1: target-orderregel-claims eerst
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  -- Release niet-handmatige claims voor de target-orderregel
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  -- Handmatige claims blijven staan en tellen mee in resterend te dekken
  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- ===========================================================================
  -- STAP 1 (bestaand): Voorraad eigen artikel
  -- ===========================================================================
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- ===========================================================================
  -- STAP 2 (NIEUW — ADR-0027): swap-fase
  -- ===========================================================================
  -- Probeer voorraad af te pakken van order A waar A.afleverdatum bewust
  -- later is dan de standaard-snapshot EN er een IO bestaat die binnen
  -- A.afleverdatum past. Loop tot v_resterend = 0 of geen kandidaten meer.
  IF v_resterend > 0 THEN
    -- Buffer eenmalig ophalen (constant binnen deze RPC)
    SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
      INTO v_buffer_dagen
    FROM app_config WHERE sleutel = 'order_config';
    v_buffer_dagen := COALESCE(v_buffer_dagen, 7);

    LOOP
      EXIT WHEN v_resterend <= 0;

      -- 2a. Zoek beste swap-bron-kandidaat A (EDD: meeste headroom eerst)
      --     Criteria uit ADR-0027 Ingreep 2:
      --       - actieve voorraad-claim op v_artikelnr (= B's fysiek_artikelnr)
      --       - A.afleverdatum > A.standaard_afleverdatum_berekend
      --       - A heeft uitsluitend voorraad-claims voor die orderregel (geen IO-mix)
      --       - A.status NOT IN ('Verzonden', 'Geannuleerd')
      --       - A.orderregel <> p_order_regel_id (B mag niet zijn eigen claim swappen)
      v_swap_kandidaat := NULL;
      SELECT r.id           AS claim_id,
             r.order_regel_id AS a_orderregel_id,
             r.aantal       AS claim_aantal,
             oreg.order_id  AS a_order_id,
             o.afleverdatum AS a_afleverdatum
        INTO v_swap_kandidaat
        FROM order_reserveringen r
        JOIN order_regels oreg ON oreg.id = r.order_regel_id
        JOIN orders o          ON o.id = oreg.order_id
       WHERE r.bron = 'voorraad'
         AND r.status = 'actief'
         AND r.fysiek_artikelnr = v_artikelnr
         AND r.order_regel_id <> p_order_regel_id
         AND COALESCE(r.is_handmatig, false) = false  -- A3 fix: handmatige uitwisselbaar-claims (mig 154) zijn nooit swap-bron
         AND o.status NOT IN ('Verzonden', 'Geannuleerd')
         AND o.afleverdatum IS NOT NULL
         AND o.standaard_afleverdatum_berekend IS NOT NULL
         AND o.afleverdatum > o.standaard_afleverdatum_berekend
         -- A heeft geen IO-claim voor diezelfde orderregel (voorraad-only-criterium)
         AND NOT EXISTS (
           SELECT 1 FROM order_reserveringen r2
            WHERE r2.order_regel_id = r.order_regel_id
              AND r2.status = 'actief'
              AND r2.bron = 'inkooporder_regel'
         )
       ORDER BY o.afleverdatum DESC, oreg.id ASC
       LIMIT 1;

      -- Geen kandidaat? Stop met swappen.
      EXIT WHEN NOT FOUND;

      -- 2b. Zoek laatst-passende IO voor A
      --     Buffer + verwacht_datum mag niet later vallen dan A.afleverdatum.
      --     Loop kandidaten zodat io_regel_ruimte > 0 is. Gebruik losse vars
      --     in plaats van FOR-record (loop-variable scope is loop-lokaal in
      --     PL/pgSQL, dus na END LOOP zou v_swap_io onbetrouwbaar zijn).
      v_swap_io_id := NULL;
      v_swap_io_verwacht := NULL;
      FOR v_swap_io IN
        SELECT ir.id        AS ir_id,
               io.verwacht_datum
          FROM inkooporder_regels ir
          JOIN inkooporders io ON io.id = ir.inkooporder_id
         WHERE ir.artikelnr = v_artikelnr
           AND ir.eenheid = 'stuks'
           AND io.status IN ('Besteld', 'Deels ontvangen')
           AND io.verwacht_datum IS NOT NULL
           AND (io.verwacht_datum + v_buffer_dagen) <= v_swap_kandidaat.a_afleverdatum
         ORDER BY io.verwacht_datum DESC, ir.id ASC
      LOOP
        IF io_regel_ruimte(v_swap_io.ir_id) > 0 THEN
          v_swap_io_id := v_swap_io.ir_id;
          v_swap_io_verwacht := v_swap_io.verwacht_datum;
          EXIT;
        END IF;
      END LOOP;

      -- Geen passende IO met ruimte? Stop met swappen (val terug op IO-fallback)
      EXIT WHEN v_swap_io_id IS NULL;

      -- LOCK-VOLGORDE STAP 2: swap-bron-claim FOR UPDATE
      -- Verwerf nu pas de lock op A's claim (target was al gelockt boven).
      -- Re-check dat de claim nog past nadat we de lock hebben (kan zijn
      -- gewijzigd door een concurrent transactie tussen SELECT en LOCK).
      SELECT aantal INTO v_a_claim_resterend
        FROM order_reserveringen
       WHERE id = v_swap_kandidaat.claim_id
         AND status = 'actief'
       FOR UPDATE;

      IF v_a_claim_resterend IS NULL OR v_a_claim_resterend <= 0 THEN
        -- Claim is tussentijds verdwenen. Volgende iteratie zoekt opnieuw.
        CONTINUE;
      END IF;

      -- 2c. Bepaal swap-aantal: min van (A's claim, B's resterend, IO-ruimte)
      v_swap_aantal := LEAST(
        v_a_claim_resterend,
        v_resterend,
        io_regel_ruimte(v_swap_io_id)
      );

      EXIT WHEN v_swap_aantal <= 0;

      -- 2d. Reduce of release A's voorraad-claim
      IF v_swap_aantal >= v_a_claim_resterend THEN
        -- Volledige claim wordt overgenomen → release
        UPDATE order_reserveringen
           SET status = 'released', updated_at = now()
         WHERE id = v_swap_kandidaat.claim_id;
      ELSE
        -- Gedeeltelijke swap → verlaag het aantal
        UPDATE order_reserveringen
           SET aantal = aantal - v_swap_aantal, updated_at = now()
         WHERE id = v_swap_kandidaat.claim_id;
      END IF;

      -- 2e. Insert IO-claim voor A op de gevonden IO
      INSERT INTO order_reserveringen
        (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr)
      VALUES
        (v_swap_kandidaat.a_orderregel_id,
         'inkooporder_regel',
         v_swap_io_id,
         v_swap_aantal,
         v_artikelnr);

      -- 2f. Insert voorraad-claim voor B (target-orderregel)
      INSERT INTO order_reserveringen
        (order_regel_id, bron, aantal, fysiek_artikelnr)
      VALUES
        (p_order_regel_id, 'voorraad', v_swap_aantal, v_artikelnr);

      -- 2g. Audit-events — twee rijen (ADR-0027 Ingreep 4).
      --      status_na = NEW.status (geen status-overgang door swap).
      INSERT INTO order_events (order_id, event_type, status_na, metadata)
      VALUES (
        v_swap_kandidaat.a_order_id,
        'claim_geswapt_weg',
        (SELECT status FROM orders WHERE id = v_swap_kandidaat.a_order_id),
        jsonb_build_object(
          'naar_order_id', v_order_id,
          'orderregel_id', v_swap_kandidaat.a_orderregel_id,
          'aantal', v_swap_aantal,
          'oude_bron', 'voorraad',
          'nieuwe_bron', 'inkooporder_regel',
          'io_regel_id', v_swap_io_id,
          'io_verwacht_datum', v_swap_io_verwacht,
          'fysiek_artikelnr', v_artikelnr,
          'adr', '0027',
          'migratie', 297
        )
      );

      INSERT INTO order_events (order_id, event_type, status_na, metadata)
      VALUES (
        v_order_id,
        'claim_geswapt_naar',
        (SELECT status FROM orders WHERE id = v_order_id),
        jsonb_build_object(
          'van_order_id', v_swap_kandidaat.a_order_id,
          'orderregel_id', p_order_regel_id,
          'aantal', v_swap_aantal,
          'bron', 'voorraad',
          'fysiek_artikelnr', v_artikelnr,
          'adr', '0027',
          'migratie', 297
        )
      );

      -- 2h. Herwaardeer A's order-status (kan nu naar 'Wacht op inkoop' gaan).
      --      Synct ook A's afleverdatum vooruit als IO-claim later valt (mig 153).
      PERFORM herwaardeer_order_status(v_swap_kandidaat.a_order_id);

      v_resterend := v_resterend - v_swap_aantal;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- STAP 3 (bestaand): IO-claims op oudste verwacht_datum eerst (eigen artikel)
  -- ===========================================================================
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id, io.verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr
         AND ir.eenheid = 'stuks'
         AND io.status IN ('Besteld', 'Deels ontvangen')
       ORDER BY io.verwacht_datum NULLS LAST, ir.id ASC
    LOOP
      EXIT WHEN v_resterend <= 0;
      v_io_ruimte := io_regel_ruimte(v_io.id);
      v_alloc := LEAST(v_resterend, v_io_ruimte);
      IF v_alloc > 0 THEN
        INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr)
        VALUES (p_order_regel_id, 'inkooporder_regel', v_io.id, v_alloc, v_artikelnr);
        v_resterend := v_resterend - v_alloc;
      END IF;
    END LOOP;
  END IF;

  PERFORM herwaardeer_order_status(v_order_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herallocateer_orderregel IS
  'Idempotent: release niet-handmatige claims + alloceer opnieuw '
  '(voorraad eigen artikel → swap-fase ADR-0027 → IO eigen artikel). '
  'Handmatige uitwisselbaar-claims (is_handmatig=true) blijven staan en tellen mee. '
  'Swap-fase (mig 297): pakt voorraad af van orders met afleverdatum > '
  'standaard_afleverdatum_berekend wanneer een IO past binnen hun afleverdatum '
  '(EDD-selectie + laatst-passende IO). Sluit maatwerk-regels uit. Migratie 296.';

-- ============================================================================
-- 3. Trigger: bij INSERT op inkooporder_regels heralloceer wachtende orderregels
-- ============================================================================
-- Doel: wanneer een nieuwe IO-regel wordt aangemaakt voor v_artikelnr, kan
-- die IO een swap-doelwit zijn voor een eerder-niet-helpbare orderregel B
-- die nu in 'Wacht op voorraad' / 'Wacht op inkoop' zit. Door herallocatie
-- opnieuw te triggeren krijgt B alsnog voorraad (via swap met A) of IO.
--
-- Idempotent: als swap niet kan, gedraagt `herallocateer_orderregel` zich
-- als no-op (release + opnieuw alloceren op identieke verdeling).
--
-- Alleen bij eenheid='stuks' — dat is de scope van order_reserveringen v1.

CREATE OR REPLACE FUNCTION trg_io_regel_insert_swap_evaluate()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.eenheid IS DISTINCT FROM 'stuks' THEN
    RETURN NEW;
  END IF;

  -- A5 fix (ADR-0027 V1 = expliciet GEEN cascade):
  --   Heralloceer alleen orderregels met daadwerkelijk dekking-tekort. Beperk
  --   tot status 'Wacht op voorraad' (geen IO-claim ÷ voorraad-tekort). Orders
  --   in 'Wacht op inkoop' hebben al een IO-claim — herevaluatie daar zou een
  --   keten van re-allocaties triggeren die feitelijk cascade-swap creëert,
  --   wat in V1 expliciet uitgesloten is. Bij hoge frequentie heroverwegen.
  --   Verder: alleen regels met effectief tekort (te_leveren > SUM(actieve
  --   claims)) — anders is herallocatie idempotent maar zinloos extra werk.
  FOR v_regel_id IN
    SELECT oreg.id
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
     WHERE oreg.artikelnr = NEW.artikelnr
       AND COALESCE(oreg.is_maatwerk, false) = false
       AND COALESCE(oreg.te_leveren, 0) > 0
       AND o.status = 'Wacht op voorraad'
       AND COALESCE(oreg.te_leveren, 0) > COALESCE((
         SELECT SUM(r.aantal)
           FROM order_reserveringen r
          WHERE r.order_regel_id = oreg.id
            AND r.status = 'actief'
       ), 0)
     ORDER BY oreg.id  -- consistente volgorde → reproduceerbare uitkomst
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_io_regel_insert_swap_evaluate ON inkooporder_regels;
CREATE TRIGGER trg_io_regel_insert_swap_evaluate
  AFTER INSERT ON inkooporder_regels
  FOR EACH ROW
  EXECUTE FUNCTION trg_io_regel_insert_swap_evaluate();

COMMENT ON FUNCTION trg_io_regel_insert_swap_evaluate IS
  'ADR-0027 / mig 297: bij INSERT van een IO-regel (eenheid=stuks) heralloceer '
  'orderregels voor hetzelfde artikelnr die wachten — een nieuwe IO kan nu een '
  'swap-doelwit zijn voor een order met afleverdatum > standaard, zodat een '
  'urgenter order alsnog voorraad krijgt. Idempotent: no-op als swap niet kan.';

-- ============================================================================
-- 4. order_events comment-update (event-type-overzicht)
-- ============================================================================
-- order_events is geen text-kolom (zie mig 218: order_event_type ENUM).
-- Comment op de tabel updaten zodat lezers de nieuwe types kennen.
COMMENT ON TABLE order_events IS
  'Mig 218 (ADR-0006): typed audit-log van orders-events. '
  'Bron-van-waarheid voor wie/wanneer/waarom een transitie deed. '
  'Sinds mig 297 (ADR-0027) ook drie niet-status-events: '
  'claim_geswapt_weg, claim_geswapt_naar, deadline_conflict_na_swap. '
  'Status_na = huidige status (geen overgang) bij niet-status-events.';
