-- Migratie 468: aparte claim-status 'verzonden' i.p.v. 'released' bij verzending.
--
-- Aanleiding: producten.voorraad wordt nooit fysiek verlaagd bij verzending
-- (alleen door de wekelijkse Excel-import of een echte inkoop-ontvangst —
-- bewust, dat blijft zo). Maar de gevolgschade was dat zodra een order
-- 'Verzonden' werd, de bijbehorende order_reserveringen-claim naar status
-- 'released' ging — EXACT dezelfde status als bij annuleren. Daardoor herstelde
-- vrije_voorraad zich na verzending ALSOF het stuk weer vrij was, terwijl het
-- fysiek de deur uit is. Tussen het moment van verzenden en de volgende
-- voorraad-import kon zo'n al-verzonden stuk opnieuw geclaimd worden door een
-- nieuwe order.
--
-- Fix: 'verzonden' wordt een eigen, derde eindstatus naast 'actief'/'released'/
-- 'geleverd' (dat laatste is iets anders — IO-claim-conversie bij
-- inkoop-ontvangst, niet aanraken). Alleen annuleren (zonder verzending) geeft
-- nog 'released' en herstelt vrije_voorraad. Verzenden zet 'verzonden' en
-- houdt vrije_voorraad omlaag totdat de volgende voorraad-telling de fysieke
-- werkelijkheid weer bijwerkt.
--
-- Geraakte plekken (audit uitgevoerd vóór deze migratie):
--   - trg_order_events_reservering_release (mig 259): de trigger-handler die
--     op zowel 'geannuleerd' als 'pickronde_voltooid' reageert — moet nu
--     differentiëren.
--   - herallocateer_orderregel (mig 408): had dezelfde Verzonden/Geannuleerd-
--     ambiguïteit in zijn eigen vroege-return-guard.
--   - herbereken_product_reservering (mig 154): telde alleen 'actief' mee,
--     en deed dat via een join naar orders.status — die join is nu overbodig
--     (de claim-status zelf draagt de juiste betekenis) en is verwijderd.
--   - voorraad_beschikbaar_voor_artikel (mig 154): idem, telde alleen 'actief'.
--   - herbereken_wacht_status: het voorraad-tekort-criterium telde ook alleen
--     'actief' — zonder fix zou een al-verzonden regel binnen een
--     "Deels verzonden"-order ten onrechte als nieuw tekort verschijnen.
-- Bewust ONGEWIJZIGD (al correct, bevestigd tijdens audit): alle overige
-- lezers filteren positief op status='actief' (niet via een negatie van
-- 'released'), dus die sluiten 'verzonden' al terecht uit zonder aanpassing —
-- o.a. orderregel_pickbaarheid, bereken_late_claim_afleverdatum,
-- sync_order_afleverdatum_met_claims (die laatste slaat Verzonden orders al
-- helemaal over).

ALTER TABLE order_reserveringen
  DROP CONSTRAINT order_reserveringen_status_check;
ALTER TABLE order_reserveringen
  ADD CONSTRAINT order_reserveringen_status_check
  CHECK (status IN ('actief', 'geleverd', 'released', 'verzonden'));

-- 1) Release-trigger-handler: differentieer verzending vs annulering.
CREATE OR REPLACE FUNCTION trg_order_events_reservering_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.event_type NOT IN ('geannuleerd', 'pickronde_voltooid') THEN
    RETURN NEW;
  END IF;

  UPDATE order_reserveringen
     SET status = CASE
           WHEN NEW.event_type = 'pickronde_voltooid' THEN 'verzonden'
           ELSE 'released'
         END
   WHERE status = 'actief'
     AND order_regel_id IN (
       SELECT id FROM order_regels WHERE order_id = NEW.order_id
     );

  RETURN NEW;
END;
$function$;

-- 2) herallocateer_orderregel: dezelfde differentiatie in de vroege-return-guard.
CREATE OR REPLACE FUNCTION public.herallocateer_orderregel(p_order_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr          TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       INTEGER;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
  v_te_leveren         INTEGER;
  v_is_maatwerk        BOOLEAN;
  v_order_id           BIGINT;
  v_order_status       order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad        INTEGER;
  v_resterend          INTEGER;
  v_handmatig_totaal   INTEGER;
  v_alias              RECORD;
  v_alias_beschikbaar  INTEGER;
  v_alias_alloc        INTEGER;
  v_io                 RECORD;
  v_io_ruimte          INTEGER;
  v_alloc              INTEGER;
  -- Doos→stuks
  v_stuks_artikelnr    TEXT;
  v_stuks_per_doos     INTEGER;
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
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = CASE WHEN v_order_status = 'Verzonden' THEN 'verzonden' ELSE 'released' END,
           updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- ── Doos→stuks vertaling (mig 408) ────────────────────────────────────────
  -- Als het artikel een doos-artikel is (stuks_artikelnr IS NOT NULL), alloceer
  -- dan op het stuks-artikel met hoeveelheid te_leveren × stuks_per_doos.
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;
  -- ──────────────────────────────────────────────────────────────────────────

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

  -- Resterend te dekken na handmatige claims
  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad (na doos→stuks vertaling = stuks-artikel voorraad)
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- Stap 1.5: alias voorraad (zelfde collectie + kleur_code + maat + maatwerk_vorm_code)
  IF v_resterend > 0 THEN
    SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
      INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    WHERE p.artikelnr = v_artikelnr;

    IF v_collectie_id IS NOT NULL AND v_kleur_code IS NOT NULL THEN
      FOR v_alias IN
        SELECT p.artikelnr
          FROM producten p
          JOIN kwaliteiten k ON k.code = p.kwaliteit_code
         WHERE k.collectie_id = v_collectie_id
           AND p.kleur_code    = v_kleur_code
           AND p.breedte_cm    = v_breedte_cm
           AND p.lengte_cm     = v_lengte_cm
           AND p.artikelnr    <> v_artikelnr
           AND p.actief        = true
           AND p.vrije_voorraad > 0
           AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
           AND NOT EXISTS (
             SELECT 1 FROM order_reserveringen or2
              WHERE or2.order_regel_id  = p_order_regel_id
                AND or2.fysiek_artikelnr = p.artikelnr
                AND or2.bron            = 'voorraad'
                AND or2.status          = 'actief'
                AND or2.is_handmatig    = true
           )
         ORDER BY p.vrije_voorraad DESC, p.artikelnr ASC
      LOOP
        EXIT WHEN v_resterend <= 0;
        v_alias_beschikbaar := voorraad_beschikbaar_voor_artikel(v_alias.artikelnr, p_order_regel_id);
        v_alias_alloc := LEAST(v_resterend, v_alias_beschikbaar);
        IF v_alias_alloc > 0 THEN
          INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
          VALUES (p_order_regel_id, 'voorraad', v_alias_alloc, v_alias.artikelnr, false);
          v_resterend := v_resterend - v_alias_alloc;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Stap 2: IO-claims stuks-artikel op oudste verwacht_datum eerst
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id, io.verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr  -- na vertaling = stuks_artikelnr
         AND ir.eenheid   = 'stuks'
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
$function$;

-- 3) herbereken_product_reservering: 'verzonden' telt mee als bezet. De join
-- naar order_regels/orders was alleen nodig voor de oude orders.status-check
-- en is overbodig nu de claim-status zelf de juiste betekenis draagt.
CREATE OR REPLACE FUNCTION public.herbereken_product_reservering(p_artikelnr text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_gereserveerd INTEGER;
BEGIN
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_gereserveerd
  FROM order_reserveringen r
  WHERE r.fysiek_artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status IN ('actief', 'verzonden');

  UPDATE producten
  SET gereserveerd = v_gereserveerd,
      vrije_voorraad = COALESCE(voorraad, 0) - v_gereserveerd - COALESCE(backorder, 0)
  WHERE artikelnr = p_artikelnr;
END;
$function$;

-- 4) voorraad_beschikbaar_voor_artikel: idem, 'verzonden' telt mee als geclaimd.
CREATE OR REPLACE FUNCTION public.voorraad_beschikbaar_voor_artikel(p_artikelnr text, p_excl_order_regel_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_voorraad INTEGER;
  v_voorraad_geclaimd INTEGER;
BEGIN
  SELECT COALESCE(voorraad, 0) - COALESCE(backorder, 0)
  INTO v_voorraad
  FROM producten WHERE artikelnr = p_artikelnr;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_voorraad_geclaimd
  FROM order_reserveringen r
  WHERE r.fysiek_artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status IN ('actief', 'verzonden')
    AND r.order_regel_id <> p_excl_order_regel_id;

  RETURN GREATEST(0, COALESCE(v_voorraad, 0) - v_voorraad_geclaimd);
END;
$function$;

-- 5) herbereken_wacht_status: voorraad-tekort-criterium moet 'verzonden'
-- meetellen als gedekt, anders krijgt een al-verzonden regel binnen een
-- "Deels verzonden"-order ten onrechte een nieuw tekort-signaal.
CREATE OR REPLACE FUNCTION public.herbereken_wacht_status(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig         order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort   BOOLEAN;
  v_heeft_maatwerk BOOLEAN;
  v_doel           order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten, geen admin-pseudo's)
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status IN ('actief', 'verzonden')
      ), 0)
  ) INTO v_heeft_tekort;

  -- 3) Maatwerk-regel zonder ingepakt snijplan = nog niet pickbaar.
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen sp
        WHERE sp.order_regel_id = oreg.id
          AND sp.status = 'Ingepakt'
      )
  ) INTO v_heeft_maatwerk;

  -- Beslissing via single-source. NULL = niet wijzigen.
  v_doel := derive_wacht_status(v_huidig, v_heeft_io_claim, v_heeft_tekort, v_heeft_maatwerk);

  IF v_doel IS NOT NULL THEN
    PERFORM _apply_transitie(
      p_order_id   := p_order_id,
      p_event_type := 'wacht_status_herberekend',
      p_status_na  := v_doel
    );
  END IF;
END;
$function$;
