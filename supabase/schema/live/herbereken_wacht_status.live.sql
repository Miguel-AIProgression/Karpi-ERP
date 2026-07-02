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

