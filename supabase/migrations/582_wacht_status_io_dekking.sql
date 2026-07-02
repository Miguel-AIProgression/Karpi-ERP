-- Migratie 582: 'Wacht op voorraad' vereist dat de bestaande claims het
-- tekort ook daadwerkelijk DEKKEN (audit 2026-07-02, Task 1.5 / bug B6).
--
-- Bug
-- ---
-- In de status-ladder (mig 470-semantiek) betekent 'Wacht op voorraad' =
-- "er bestaat al een IO-claim, wacht alleen op levering" en
-- 'Wacht op inkoop' = "er moet nog besteld worden". `herbereken_wacht_status`
-- zette `v_heeft_io_claim` echter op TRUE zodra er ÉÉN actieve IO-claim
-- bestond op ÉÉN regel van de order — ongeacht of die claim (samen met
-- eventuele voorraad-claims) de `te_leveren` van die regel daadwerkelijk
-- dekte. Een half-gedekte regel (bv. 10 nodig, 4 op IO) toonde daardoor
-- 'Wacht op voorraad', terwijl er in werkelijkheid nog 6 stuks besteld
-- moeten worden — de inkoper zag dat nergens.
--
-- Fix
-- ---
-- `v_heeft_io_claim` wordt alleen nog TRUE als er (a) minstens één actieve
-- IO-claim bestaat ÉN (b) er geen enkele regel is die zowel een tekort
-- heeft (te_leveren > som van 'actief'+'verzonden'-claims, alle bronnen)
-- ALS een actieve IO-claim — zo'n regel is "onvolledig gedekt" en moet de
-- order naar 'Wacht op inkoop' laten vallen (branch 3 in derive_wacht_status)
-- in plaats van 'Wacht op voorraad' (branch 2). De onvolledig-gedekt-
-- subquery mirrort exact SECTIE B van UITVRAAG-2026-07-02.sql, waarmee
-- Miguel de impact vooraf op 0 orders heeft geverifieerd (GO gegeven
-- 2026-07-02) — geen enkele live order flipt van status op het moment van
-- toepassen.
--
-- `derive_wacht_status` (de pure ladder) is bewust ONGEWIJZIGD — alleen de
-- input-berekening in herbereken_wacht_status verandert. De TS-spiegel
-- (`_shared/order-lifecycle/derive-status.ts` + golden fixtures) test die
-- pure ladder en hoeft dus niet mee te veranderen.
--
-- Verder byte-identiek aan de live body (v_heeft_tekort, v_heeft_maatwerk,
-- combi-cascade mig 558/559/ADR-0040) — alleen sectie 1 wijzigt.

CREATE OR REPLACE FUNCTION public.herbereken_wacht_status(p_order_id bigint, p_cascade_groep boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig            order_status;
  v_heeft_io_claim    BOOLEAN;
  v_heeft_tekort      BOOLEAN;
  v_heeft_maatwerk    BOOLEAN;
  v_heeft_combi_wacht BOOLEAN;
  v_doel              order_status;
  v_debiteur_nr       INTEGER;
  v_adres_norm        TEXT;
  v_sibling_id        BIGINT;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN RETURN; END IF;

  -- 1) Inkoop-claim — alleen tellen als de claims de te_leveren ook
  --    daadwerkelijk DEKKEN voor elke regel met een actieve IO-claim
  --    (B6-fix, mig 582). Een regel met tekort ÉN een actieve IO-claim is
  --    "onvolledig gedekt" en moet naar 'Wacht op inkoop' vallen, niet
  --    'Wacht op voorraad'.
  SELECT (
    EXISTS (
      SELECT 1 FROM order_reserveringen r
      JOIN order_regels oreg ON oreg.id = r.order_regel_id
      WHERE oreg.order_id = p_order_id
        AND r.bron = 'inkooporder_regel'
        AND r.status = 'actief'
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_regels oreg
      WHERE oreg.order_id = p_order_id
        AND NOT is_admin_pseudo(oreg.artikelnr)
        AND oreg.te_leveren > COALESCE((
          SELECT SUM(r.aantal) FROM order_reserveringen r
          WHERE r.order_regel_id = oreg.id AND r.status IN ('actief', 'verzonden')
        ), 0)
        AND EXISTS (
          SELECT 1 FROM order_reserveringen r2
          WHERE r2.order_regel_id = oreg.id
            AND r2.bron = 'inkooporder_regel' AND r2.status = 'actief'
        )
    )
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten, geen admin-pseudo's) — 'verzonden'
  --    claims tellen mee als gedekt (mig 468).
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

  -- 4) Combi-levering (mig 558/ADR-0040) — geen rij in de view = nooit geblokkeerd.
  SELECT wacht_op_combi_levering INTO v_heeft_combi_wacht
    FROM combi_levering_status WHERE order_id = p_order_id;
  v_heeft_combi_wacht := COALESCE(v_heeft_combi_wacht, FALSE);

  -- Beslissing via single-source. NULL = niet wijzigen.
  v_doel := derive_wacht_status(v_huidig, v_heeft_io_claim, v_heeft_tekort, v_heeft_maatwerk, v_heeft_combi_wacht);

  IF v_doel IS NOT NULL THEN
    PERFORM _apply_transitie(
      p_order_id   := p_order_id,
      p_event_type := 'wacht_status_herberekend',
      p_status_na  := v_doel
    );
  END IF;

  -- Groep-cascade (mig 559/ADR-0040): onvoorwaardelijk, ook als v_doel NULL was.
  IF p_cascade_groep THEN
    SELECT o.debiteur_nr, _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
      INTO v_debiteur_nr, v_adres_norm
      FROM orders o WHERE o.id = p_order_id;

    FOR v_sibling_id IN
      SELECT o2.id
        FROM orders o2
        JOIN debiteuren d2 ON d2.debiteur_nr = o2.debiteur_nr
       WHERE o2.debiteur_nr = v_debiteur_nr
         AND _normaliseer_afleveradres(o2.afl_adres, o2.afl_postcode, o2.afl_land) = v_adres_norm
         AND o2.id <> p_order_id
         AND o2.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
         AND o2.combi_levering_override = FALSE
         AND d2.combi_levering = TRUE
         AND NOT is_dropship_order(o2.id)
    LOOP
      PERFORM herbereken_wacht_status(v_sibling_id, FALSE);
    END LOOP;
  END IF;
END;
$function$
;

COMMENT ON FUNCTION public.herbereken_wacht_status(bigint, boolean) IS
  'Mig 578 (audit 2026-07-02, Task 1.5/B6): v_heeft_io_claim vereist nu dat de '
  'bestaande claims (alle bronnen, status actief/verzonden) het tekort ook '
  'daadwerkelijk dekken voor elke regel met een actieve IO-claim — anders valt '
  'de order naar ''Wacht op inkoop'' i.p.v. ''Wacht op voorraad''. '
  'derive_wacht_status (de pure ladder) is ongewijzigd. Impact-telling vooraf: '
  '0 live orders flippen op apply-datum (SECTIE B, UITVRAAG-2026-07-02.sql).';

NOTIFY pgrst, 'reload schema';
