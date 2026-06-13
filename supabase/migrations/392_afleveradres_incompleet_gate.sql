-- Migratie 392: afleveradres-incompleet gate (intake-validatie, Feature A)
--
-- Aanleiding (13-06-2026): order ORD-2026-0097 belandde in Pick & Ship ZONDER
-- afleveradres-snapshot. Gevolg: de verzendlabels/stickers kregen geen adres
-- mee (HST-payload-builder vult lege Street/City/ZipCode). Dat mag nooit — een
-- incompleet adres moet al bij order-aanmaak geflagd worden en handmatig
-- verwerkt worden vóór de order naar de werkvloer doorstroomt.
--
-- Geen enkel intake-kanaal (EDI create_edi_order, webshop create_webshop_order,
-- e-mail, handmatig formulier) valideert de afl_*-snapshots; ze zijn allemaal
-- nullable. Deze migratie sluit het gat centraal in de DB i.p.v. per kanaal.
--
-- Patroon = de bestaande status-overstijgende gate (debiteur_zeker /
-- levertijd_wijziging_te_bevestigen_sinds): één nullable timestamp-kolom op
-- orders, afgeleid door een trigger (single source), filterbaar met IS NOT NULL.
--
-- "Incompleet" = order is GEEN afhaal-order (afhalen=FALSE), status niet
-- Verzonden/Geannuleerd, en minstens één van afl_naam/afl_adres/afl_postcode/
-- afl_plaats is leeg-na-trim. afl_land valt bewust buiten de set: dat stuurt de
-- vervoerderkeuze (eigen geen-vervoerder-guard, mig 373), niet het label-adres.
-- alleen_productie-orders worden NIET uitgesloten (keuze Miguel 13-06) — die
-- verzenden via Basta en starten hier geen pickronde, dus de hard-block raakt
-- ze niet; ze kunnen wél in de "Afleveradres ontbreekt"-tab opduiken.
--
-- Hard-block: start_pickronden weigert een order met open adres-gate via de
-- gedeelde helper _valideer_intake_gates (mig 393 breidt die uit met de
-- prijs-gate). Frontend-spiegel: AfleveradresIncompleetBanner + status-tab +
-- StartPickrondesButton (disabled).
--
-- Idempotent.

-- 1. Gate-kolom -------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS afl_adres_incompleet_sinds TIMESTAMPTZ;

COMMENT ON COLUMN orders.afl_adres_incompleet_sinds IS
  'Mig 392: NULL = afleveradres compleet. TIMESTAMPTZ = moment van eerste '
  'detectie dat het afl_*-snapshot incompleet is (niet-afhaal-order). Afgeleid '
  'door trg_orders_afl_adres_gate; gewist zodra adres compleet. Blokkeert '
  'start_pickronden via _valideer_intake_gates.';

-- 2. Detectie-trigger (single source) ---------------------------------------
CREATE OR REPLACE FUNCTION fn_orders_afl_adres_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_incompleet BOOLEAN;
BEGIN
  v_incompleet :=
    COALESCE(NEW.afhalen, FALSE) = FALSE
    AND NEW.status NOT IN ('Verzonden', 'Geannuleerd')
    AND (
      NULLIF(TRIM(NEW.afl_naam), '')     IS NULL OR
      NULLIF(TRIM(NEW.afl_adres), '')    IS NULL OR
      NULLIF(TRIM(NEW.afl_postcode), '') IS NULL OR
      NULLIF(TRIM(NEW.afl_plaats), '')   IS NULL
    );

  IF v_incompleet THEN
    -- Behoud de oorspronkelijke "sinds"-timestamp bij herhaalde updates.
    IF NEW.afl_adres_incompleet_sinds IS NULL THEN
      NEW.afl_adres_incompleet_sinds := now();
    END IF;
  ELSE
    NEW.afl_adres_incompleet_sinds := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_afl_adres_gate ON orders;
CREATE TRIGGER trg_orders_afl_adres_gate
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_orders_afl_adres_gate();

-- 3. Backfill open orders ---------------------------------------------------
-- De BEFORE-trigger vuurt op deze UPDATE en herbevestigt de waarde.
UPDATE orders
   SET afl_adres_incompleet_sinds = now()
 WHERE COALESCE(afhalen, FALSE) = FALSE
   AND status NOT IN ('Verzonden', 'Geannuleerd')
   AND afl_adres_incompleet_sinds IS NULL
   AND (
     NULLIF(TRIM(afl_naam), '')     IS NULL OR
     NULLIF(TRIM(afl_adres), '')    IS NULL OR
     NULLIF(TRIM(afl_postcode), '') IS NULL OR
     NULLIF(TRIM(afl_plaats), '')   IS NULL
   );

-- 4. Gedeelde intake-gate-poort ---------------------------------------------
-- Centrale server-side guard die start_pickronden aanroept. Mig 393 vervangt
-- deze functie door een versie die óók de prijs-gate checkt; start_pickronden
-- zelf hoeft dan niet opnieuw herschreven te worden.
CREATE OR REPLACE FUNCTION _valideer_intake_gates(p_order_ids BIGINT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_adres_nr TEXT;
BEGIN
  SELECT o.order_nr INTO v_adres_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.afl_adres_incompleet_sinds IS NOT NULL
   LIMIT 1;

  IF v_adres_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Afleveradres ontbreekt of is onvolledig voor order % — vul het '
      'afleveradres aan op de order voordat je een pickronde start.',
      v_adres_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

COMMENT ON FUNCTION _valideer_intake_gates(BIGINT[]) IS
  'Mig 392/393: server-side intake-gate-poort voor start_pickronden. Weigert '
  'orders met open afleveradres-gate (mig 392) of prijs-gate (mig 393). '
  'Frontend-spiegel: StartPickrondesButton + banners.';

-- 5. start_pickronden: roep de gate-poort aan na bundel-uitbreiding ----------
-- Body = mig 373 (laatste versie) + PERFORM _valideer_intake_gates.
CREATE OR REPLACE FUNCTION start_pickronden(
  p_order_ids       BIGINT[],
  p_picker_id       BIGINT,
  p_force_solo_ids  BIGINT[] DEFAULT '{}'::BIGINT[]
) RETURNS TABLE (
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT,
  aantal_regels   INTEGER,
  aantal_orders   INTEGER,
  is_nieuw        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input_count       INTEGER;
  v_force_solo        BIGINT[];
  v_alle_orders       BIGINT[];
  v_eindstatus_nr     TEXT;
  v_eindstatus_order  BIGINT;
  v_picken_order      BIGINT;
  v_geen_verv_nr      TEXT;
  v_groep             RECORD;
  v_eerste_order      orders%ROWTYPE;
  v_zending_id        BIGINT;
  v_zending_nr        TEXT;
  v_order_id          BIGINT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  v_input_count := COALESCE(array_length(p_order_ids, 1), 0);
  IF v_input_count = 0 THEN
    RAISE EXCEPTION 'Geen orders meegegeven aan start_pickronden'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_force_solo := COALESCE(
    (SELECT array_agg(DISTINCT fid)
       FROM unnest(COALESCE(p_force_solo_ids, '{}'::BIGINT[])) AS fid
      WHERE fid = ANY(p_order_ids)),
    '{}'::BIGINT[]
  );

  WITH bundel_eligible AS (
    SELECT DISTINCT oid
      FROM unnest(p_order_ids) AS oid
     WHERE oid <> ALL(v_force_solo)
  ),
  uitgebreid AS (
    SELECT oid FROM bundel_eligible
    UNION
    SELECT pid AS oid
      FROM voorgestelde_zending_bundels b
      CROSS JOIN LATERAL unnest(b.order_ids) AS pid
     WHERE b.aantal_orders >= 2
       AND b.order_ids && (SELECT array_agg(oid) FROM bundel_eligible)
       AND pid <> ALL(v_force_solo)
  )
  SELECT array_agg(DISTINCT all_oid) INTO v_alle_orders
    FROM (
      SELECT oid AS all_oid FROM uitgebreid
      UNION
      SELECT fid AS all_oid FROM unnest(v_force_solo) AS fid
    ) merged;

  IF v_alle_orders IS NULL OR array_length(v_alle_orders, 1) = 0 THEN
    RAISE EXCEPTION 'start_pickronden: geen orders in scope na uitbreiding'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Eindstatus-zending guard
  SELECT z.zending_nr, z.order_id
    INTO v_eindstatus_nr, v_eindstatus_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY z.id DESC
   LIMIT 1;

  IF v_eindstatus_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst in /logistiek voor je een pickronde start.',
      v_eindstatus_order, v_eindstatus_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lopende-Picken guard
  SELECT zo.order_id INTO v_picken_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status = 'Picken'
   LIMIT 1;

  IF v_picken_order IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al een lopende pickronde. Voltooi of annuleer die eerst.',
      v_picken_order
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Geen-vervoerder guard (mig 373): niet-afhaal-order met >=1 regel zonder
  -- effectieve vervoerder (bron='geen') mag geen pickronde starten — de
  -- zending zou met vervoerder_code=NULL ontstaan en blijven hangen.
  SELECT o.order_nr INTO v_geen_verv_nr
    FROM unnest(v_alle_orders) AS oid
    JOIN orders o ON o.id = oid
   WHERE COALESCE(o.afhalen, FALSE) = FALSE
     AND EXISTS (
       SELECT 1
         FROM effectieve_vervoerder_per_orderregel(oid) e
        WHERE e.bron = 'geen'
     )
   LIMIT 1;

  IF v_geen_verv_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Geen vervoerder mogelijk voor order % — activeer de vervoerder voor dit afleverland (Logistiek > Vervoerders) of kies handmatig een vervoerder op de order.',
      v_geen_verv_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Intake-gate-poort (mig 392/393): afleveradres- en prijs-gate.
  PERFORM _valideer_intake_gates(v_alle_orders);

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × week × solo_marker)
  FOR v_groep IN
    WITH per_regel AS (
      SELECT
        pv.orderregel_id,
        pv.effectief_code                              AS vervoerder_code,
        pv.effectief_service                           AS service_code,
        ore.order_id,
        o.debiteur_nr,
        _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
                                                       AS adres_norm,
        verzendweek_voor_datum(o.afleverdatum)         AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
    )
    SELECT
      pr.debiteur_nr,
      pr.adres_norm,
      pr.vervoerder_code,
      pr.jaar_week,
      pr.solo_marker,
      MIN(pr.service_code)                                          AS service_code,
      array_agg(DISTINCT pr.order_id)                               AS order_ids,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id)         AS orderregel_ids,
      COUNT(*)::INTEGER                                             AS aantal_regels,
      COUNT(DISTINCT pr.order_id)::INTEGER                          AS aantal_orders
      FROM per_regel pr
     GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week, pr.solo_marker
     ORDER BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code NULLS FIRST
  LOOP
    SELECT * INTO v_eerste_order FROM orders WHERE id = v_groep.order_ids[1];

    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum, aantal_colli, totaal_gewicht_kg
    ) VALUES (
      v_zending_nr, v_eerste_order.id, 'Picken', p_picker_id,
      v_groep.vervoerder_code, v_groep.service_code,
      v_eerste_order.afl_naam, v_eerste_order.afl_adres, v_eerste_order.afl_postcode,
      v_eerste_order.afl_plaats, v_eerste_order.afl_land,
      CURRENT_DATE,
      (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
         FROM order_regels ore
        WHERE ore.id = ANY(v_groep.orderregel_ids)),
      (SELECT NULLIF(
                ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
                0
              )
         FROM order_regels ore
        WHERE ore.id = ANY(v_groep.orderregel_ids))
    ) RETURNING id INTO v_zending_id;

    INSERT INTO zending_orders (zending_id, order_id)
    SELECT v_zending_id, ord_id FROM unnest(v_groep.order_ids) AS ord_id
    ON CONFLICT DO NOTHING;

    INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
    SELECT v_zending_id, ore.id, ore.orderaantal
      FROM order_regels ore
     WHERE ore.id = ANY(v_groep.orderregel_ids)
       AND COALESCE(ore.orderaantal, 0) > 0;

    PERFORM genereer_zending_colli(v_zending_id);

    RETURN QUERY SELECT
      v_zending_id, v_zending_nr,
      v_groep.vervoerder_code,
      v_groep.aantal_regels,
      v_groep.aantal_orders,
      TRUE AS is_nieuw;
  END LOOP;

  -- ADR-0016: na zending-aanmaak status per order flippen naar 'In pickronde'.
  FOREACH v_order_id IN ARRAY v_alle_orders LOOP
    PERFORM markeer_pickronde_gestart(
      p_order_id            := v_order_id,
      p_actor_medewerker_id := p_picker_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) IS
  'Mig 392: als mig 373, plus intake-gate-poort _valideer_intake_gates — '
  'weigert orders met onvolledig afleveradres (mig 392) of ontbrekende prijs '
  '(mig 393). Frontend-spiegel: StartPickrondesButton + banners.';

-- 6. orders_list view: gate-kolom toevoegen (voor overzicht-tab + filter) ----
-- CREATE OR REPLACE VIEW kan alleen aan het eind kolommen toevoegen → volledige
-- herdefinitie van mig 335 + o.afl_adres_incompleet_sinds.
CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
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
      WHEN 'Picken'::zending_status               THEN 1
      WHEN 'Klaar voor verzending'::zending_status THEN 2
      WHEN 'Onderweg'::zending_status              THEN 3
      WHEN 'Afgeleverd'::zending_status            THEN 4
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
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  o.levertijd_wijziging_te_bevestigen_sinds,
  o.bevestigd_at,
  -- Mig 392: afleveradres-incompleet gate
  o.afl_adres_incompleet_sinds
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel-info. Sinds mig 309: '
  'edi_bevestigd_op + edi_gewenste_afleverdatum. Sinds mig 322: debiteur_zeker '
  '+ debiteur_match_bron. Sinds mig 326: levertijd_wijziging_te_bevestigen_sinds. '
  'Sinds mig 335: bevestigd_at. Sinds mig 392: afl_adres_incompleet_sinds.';

NOTIFY pgrst, 'reload schema';
