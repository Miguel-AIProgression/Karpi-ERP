-- Migratie 565: herbereken_wacht_status — Combi-levering-bewust + groep-cascade (ADR-0040)
--
-- Combi-levering is een groepsbeslissing (2D-sleutel debiteur_nr × genormaliseerd
-- afleveradres, view combi_levering_status uit mig 557/561/562) — anders dan de
-- overige drie wacht-criteria hierbeneden, die puur uit DÉZE order zelf komen.
-- herbereken_wacht_status draait bij elke orderregel-/claim-/snijplan-mutatie
-- van ÉÉN order, maar een sibling in dezelfde groep verandert daardoor niet mee
-- vanzelf (zijn eigen orderregels zijn niet geraakt). Deze migratie voegt daarom
-- een expliciete groep-cascade toe: ná het herevalueren van de eigen order,
-- herevalueert dezelfde functie ook elke sibling — begrensd tot 1 niveau diep
-- (p_cascade_groep=FALSE in de recursieve aanroep) zodat er nooit een cyclus
-- ontstaat.
--
-- Signatuurwijziging (1→2 args) vereist DROP + CREATE (mig 490-precedent).
-- Body is de mig 468-versie (inclusief de 'verzonden'-claim-status-fix) plus:
--   (a) een 4e verzamelde boolean v_heeft_combi_wacht uit combi_levering_status,
--       doorgegeven aan de nu 5-arg derive_wacht_status (mig 564);
--   (b) de groep-cascade-stap, ONVOORWAARDELIJK na de transitie-stap — ook als
--       v_doel NULL was voor DEZE order (bv. een annulering is voor de
--       geannuleerde order zelf een no-op, maar moet wél zijn siblings
--       herevalueren, want de groep-noemer is net veranderd).
--
-- Veiligheid tegen resonantie: trg_order_status_herallocateer (mig 146) vuurt
-- alleen bij transities van/naar 'Geannuleerd'/'Verzonden' — de nieuwe
-- 'Klaar voor picken' ⇄ 'Wacht op combi-levering'-transitie triggert die dus
-- NIET. Geen ander bestaand AFTER-UPDATE-ON-orders-trigger reageert op deze
-- transitie. De cascade zelf kan niet cyclisch worden: de top-level aanroep
-- (cascade=TRUE, standaard) loopt over alle siblings en roept elk met
-- cascade=FALSE aan — die cascadet zelf nooit verder, dus max. recursiediepte 2.
--
-- Sibling-lookup gaat BEWUST rechtstreeks via orders/debiteuren (dezelfde
-- WHERE-predicaten als combi_levering_status's leden-CTE, mig 561), niet via
-- de view zelf — de view kan voor een net-uitgesloten order (bv. net
-- geannuleerd, in dezelfde transactie) een lege/inconsistente rij geven.

DROP FUNCTION IF EXISTS public.herbereken_wacht_status(bigint);

CREATE FUNCTION public.herbereken_wacht_status(p_order_id bigint, p_cascade_groep boolean DEFAULT true)
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

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
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

  -- 4) Combi-levering (mig 564/ADR-0040) — geen rij in de view = nooit geblokkeerd.
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

  -- Groep-cascade (mig 565/ADR-0040): onvoorwaardelijk, ook als v_doel NULL was.
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
$function$;

COMMENT ON FUNCTION public.herbereken_wacht_status(bigint, boolean) IS
  'Mig 218+258+272/273+275+346+351+352+468: verzamelt claim-/snijplan-state en '
  'delegeert de statuskeuze aan derive_wacht_status() (single-source). '
  'Mig 565 (ADR-0040): 2e parameter p_cascade_groep (default TRUE) — herevalueert '
  'na de eigen transitie ook alle Combi-levering-siblings (debiteur × adres-norm), '
  'met cascade=FALSE in de recursieve aanroep zodat de cascade nooit cyclisch '
  'wordt (max. recursiediepte 2). Schrijft via _apply_transitie. '
  'SECURITY DEFINER + search_path gepind in de CREATE zelf.';

NOTIFY pgrst, 'reload schema';
