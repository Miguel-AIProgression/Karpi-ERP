-- Migratie 522: Manco-resolutie — expliciete actie i.p.v. impliciete NL/DE-splitsing.
--
-- Mig 518 koos de uitkomst van `manco_niet_leverbaar` impliciet op afleverland
-- (NL → backorder, DE → regel afsluiten). De binnendienst wil dit expliciet kiezen
-- (zie CONTEXT.md → Manco-resolutie): land bepaalt voortaan alleen de
-- voorgeselecteerde DEFAULT in de frontend, niet de daadwerkelijke tak.
--
-- Nieuwe param `p_actie` ('backorder' | 'annuleren'). NULL = backward-compatible
-- fallback op de oude land-regel (NL→backorder, anders→annuleren), zodat een
-- 3-arg-call (en de oude metadata) ongewijzigd blijft werken.
--
-- Signatuur wijzigt (4e param) → DROP+CREATE (een 4-arg-met-default-overload naast
-- de 3-arg-versie maakt een 3-arg-call ambigu). Body verder byte-identiek aan
-- mig 518 op de tak-keuze na: voorraadcorrectie, herallocatie en de
-- end-status-afleiding (markeer_verzonden/markeer_geannuleerd) zijn ongewijzigd.
-- De voorraadcorrectie stond al DEFAULT TRUE; de frontend stuurde 'm voorheen op
-- false — dat wordt frontend-zijdig omgedraaid (opt-out "ligt er nog").

DROP FUNCTION IF EXISTS manco_niet_leverbaar(BIGINT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION manco_niet_leverbaar(
  p_order_regel_id     BIGINT,
  p_corrigeer_voorraad BOOLEAN DEFAULT TRUE,
  p_reden              TEXT DEFAULT NULL,
  p_actie              TEXT DEFAULT NULL  -- 'backorder' | 'annuleren' | NULL (land-fallback)
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id          BIGINT;
  v_status            order_status;
  v_artikelnr         TEXT;
  v_is_maatwerk       BOOLEAN;
  v_afl_land          TEXT;
  v_deb_land          TEXT;
  v_land              TEXT;
  v_actie             TEXT;
  v_manco_qty         INTEGER;
  v_onverzonde_regels INTEGER;
  v_open_zendingen    INTEGER;
  v_verzonden_zend    INTEGER;
BEGIN
  IF p_actie IS NOT NULL AND p_actie NOT IN ('backorder', 'annuleren') THEN
    RAISE EXCEPTION 'Ongeldige manco-actie %, verwacht ''backorder'' of ''annuleren''', p_actie
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ore.order_id, o.status, ore.artikelnr, ore.is_maatwerk, o.afl_land, d.land
    INTO v_order_id, v_status, v_artikelnr, v_is_maatwerk, v_afl_land, v_deb_land
    FROM order_regels ore
    JOIN orders o ON o.id = ore.order_id
    LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE ore.id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  v_land := normaliseer_land(COALESCE(NULLIF(TRIM(v_afl_land), ''), v_deb_land));
  -- Land = alleen de fallback-default; expliciete p_actie wint.
  v_actie := COALESCE(p_actie, CASE WHEN v_land = 'NL' THEN 'backorder' ELSE 'annuleren' END);

  -- Manco-aantal uit de bevroren zending_regels (fallback 1).
  SELECT COALESCE(SUM(zr.manco_aantal), 0) INTO v_manco_qty
    FROM zending_regels zr WHERE zr.order_regel_id = p_order_regel_id;
  IF v_manco_qty <= 0 THEN v_manco_qty := 1; END IF;

  -- Voorraad-correctie (enige plek die producten.voorraad raakt). Alleen voor
  -- vaste-maat-artikelen met een echte voorraadtelling; maatwerk slaat dit over.
  -- Haalt de "spookvoorraad" weg zodat de bevroren claim na vrijgeven/annuleren
  -- niet door dezelfde of een volgende order opnieuw geclaimd wordt.
  IF p_corrigeer_voorraad AND v_artikelnr IS NOT NULL AND NOT COALESCE(v_is_maatwerk, false) THEN
    UPDATE producten
       SET voorraad = GREATEST(0, COALESCE(voorraad, 0) - v_manco_qty)
     WHERE artikelnr = v_artikelnr;
    PERFORM herbereken_product_reservering(v_artikelnr);
    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    VALUES (v_order_id, 'manco_voorraad_gecorrigeerd', v_status,
            jsonb_build_object('order_regel_id', p_order_regel_id, 'artikelnr', v_artikelnr,
                               'aantal', v_manco_qty, 'migratie', 522));
  END IF;

  IF v_actie = 'backorder' THEN
    -- Wacht op voorraad: wordt een normale backorder-tekortregel; claim vrij +
    -- herallocatie. herallocateer is sinds mig 497 de korte vorm (alleen
    -- eigen-voorraad-claim, geen auto-inkoop) — resterend tekort blijft open en
    -- wordt via de reguliere allocatie weer pickbaar zodra er eigen voorraad is.
    -- Order blijft 'Deels verzonden' (eindstatus-guard in derive_wacht_status).
    UPDATE order_regels
       SET pick_backorder_sinds = NULL, pick_backorder_reden = NULL
     WHERE id = p_order_regel_id;
    PERFORM herallocateer_orderregel(p_order_regel_id);
    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    VALUES (v_order_id, 'manco_niet_leverbaar', v_status,
            jsonb_build_object('order_regel_id', p_order_regel_id, 'actie', 'backorder',
                               'land', v_land, 'reden', p_reden,
                               'corrigeer_voorraad', p_corrigeer_voorraad, 'migratie', 522));
    RETURN;
  END IF;

  -- Annuleren: regel afsluiten op deze order.
  UPDATE order_regels
     SET te_leveren = 0, pick_backorder_geannuleerd_op = now()
   WHERE id = p_order_regel_id;
  PERFORM herallocateer_orderregel(p_order_regel_id);

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (v_order_id, 'manco_niet_leverbaar', v_status,
          jsonb_build_object('order_regel_id', p_order_regel_id, 'actie', 'annuleren',
                             'land', v_land, 'reden', p_reden,
                             'corrigeer_voorraad', p_corrigeer_voorraad, 'migratie', 522));

  -- Order-status afleiden (spiegelt voltooi_pickronde/annuleer).
  IF NOT EXISTS (
    SELECT 1 FROM orders WHERE id = v_order_id AND status IN ('Verzonden', 'Geannuleerd')
  ) THEN
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_onverzonde_regels
      FROM order_regels ore
     WHERE ore.order_id = v_order_id
       AND NOT is_admin_pseudo(ore.artikelnr)
       AND ore.pick_backorder_geannuleerd_op IS NULL
       AND (
         ore.pick_backorder_sinds IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM zending_regels zr
            WHERE zr.order_regel_id = ore.id AND zr.aantal > 0
         )
       );

    IF v_open_zendingen = 0 AND v_onverzonde_regels = 0 THEN
      SELECT COUNT(*) INTO v_verzonden_zend
        FROM zendingen z
       WHERE z.id IN (
               SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
               UNION
               SELECT id FROM zendingen WHERE order_id = v_order_id
             )
         AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');
      IF v_verzonden_zend > 0 THEN
        PERFORM markeer_verzonden(v_order_id, NULL);
      ELSE
        PERFORM markeer_geannuleerd(
          p_order_id := v_order_id,
          p_reden    := COALESCE(p_reden, 'Manco — regel niet leverbaar')
        );
      END IF;
    ELSE
      PERFORM herbereken_wacht_status(v_order_id);
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION manco_niet_leverbaar(BIGINT, BOOLEAN, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION manco_niet_leverbaar(BIGINT, BOOLEAN, TEXT, TEXT) IS
  'Mig 522: Manco-resolutie B. p_actie kiest expliciet backorder vs annuleren; '
  'land (NL→backorder, anders→annuleren) is alleen de fallback-default als p_actie '
  'NULL is. p_corrigeer_voorraad boekt de telling af (spookvoorraad weg).';
