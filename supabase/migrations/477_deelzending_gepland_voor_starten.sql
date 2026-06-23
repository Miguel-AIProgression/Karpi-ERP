-- Migratie 477: deelzending aanmaken ≠ pickronde starten.
--
-- Achtergrond
-- -----------
-- Tot nu toe zette `start_deelzending` (mig 413/473) de nieuwe zending
-- DIRECT op `status='Picken'` en flipte de order meteen naar 'In pickronde'
-- via `markeer_pickronde_gestart`. Gevolg, gevonden tijdens het testen van de
-- override (mig 473): de order verdween uit Pick & Ship's "Picken starten"-
-- tab en stond alleen nog onder "Afronden" (die filtert op zendingen met
-- status='Picken', `fetchActievePickrondes`/pickbaarheid.ts:208) — zonder dat
-- er ook maar íets fysiek gepickt was. De operator wil expliciet: een
-- deelzending aanmaken = alleen REGELS RESERVEREN voor een latere zending,
-- pas zichtbaar onder "Picken starten" totdat de picker 'm daar zelf met
-- labels-printen daadwerkelijk start.
--
-- `'Gepland'` (eerste waarde van `zending_status`) bleek een dood, ongebruikt
-- enum-lid te zijn (nergens een schrijf- of leespad) — exact de vrije ruimte
-- die hiervoor nodig was.
--
-- Wijziging 1 — `start_deelzending`
-- ----------------------------------
-- Nieuwe zending krijgt `status='Gepland'` i.p.v. `'Picken'`. De
-- `markeer_pickronde_gestart`-call vervalt: de order blijft op zijn huidige
-- status totdat de pickronde daadwerkelijk gestart wordt. De audit-rij
-- (`order_events`, event_type 'deelzending_gestart') logt nu `status_na =
-- status_voor` (geen transitie) i.p.v. het hardcoded 'In pickronde'.
--
-- Eén bestaande guard dekt dit al correct zonder wijziging: guard (c) in
-- `start_deelzending` zelf blokkeert al op `z.status NOT IN ('Afgeleverd')`
-- als "actieve zending" — `'Gepland'` viel daar al onder, dus een tweede
-- deelzending-poging op dezelfde regel terwijl de eerste nog niet gestart is
-- blijft correct geblokkeerd.
--
-- Wijziging 2 — `start_pickronden`
-- ----------------------------------
-- Dit is de RPC die daadwerkelijk aan de "Picken starten"-knoppen hangt
-- (los van de inmiddels ongebruikte `start_pickronden_voor_order`/
-- `start_pickronden_bundel`). Twee aanpassingen, allebei in de
-- regel-selectie-CTE (`per_regel`):
--
--   1. `WHERE NOT pv.is_locked` — sluit regels uit die al in ENIGE
--      `zending_regels`-rij zitten. Dit was tot nu toe NERGENS afgedekt in
--      deze functie (alleen op order-niveau via de eindstatus-/Lopende-
--      Picken-guards) — een pure verharding, los van Gepland: zonder deze
--      filter zou een regel die al in een 'Gepland'-zending zit gewoon
--      OPNIEUW in een gloednieuwe zending belanden zodra de operator op
--      "Start & print" klikt, met dubbele `zending_regels`-rijen voor
--      dezelfde regel over twee zendingen heen tot gevolg.
--   2. Een nieuwe stap vóór de hoofdgroepering: promoot elke 'Gepland'-
--      zending van de orders in scope naar 'Picken' (i.p.v. de regels
--      opnieuw te zenden) en levert 'm terug in de resultatenset
--      (`is_nieuw=FALSE`) zodat de bestaande frontend-navigatie naar de
--      printset-pagina (labels printen) gewoon werkt — geen frontend-
--      wijziging nodig.
--
-- Geen wijziging aan de bestaande guards (eindstatus/Lopende-Picken/geen-
-- vervoerder/intake-gates/pickbaarheid) — die blijven exact zoals ze waren;
-- 'Gepland' triggert geen van die guards (ze checken alleen op 'Picken' resp.
-- de drie eindstatussen), dus het starten van een order met een Gepland-
-- deelzending was en blijft toegestaan.
--
-- Backwards-compatibel: voor een order ZONDER bestaande zending zijn beide
-- wijzigingen een no-op (geen is_locked-regels, geen Gepland-zending om te
-- promoveren) — gedrag identiek aan vóór deze migratie.

CREATE OR REPLACE FUNCTION public.start_deelzending(
  p_order_id bigint,
  p_regel_ids bigint[],
  p_picker_id bigint,
  p_override_reden text DEFAULT NULL::text
)
RETURNS TABLE(zending_id bigint, zending_nr text, vervoerder_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order        RECORD;
  v_zending_id   BIGINT;
  v_zending_nr   TEXT;
  v_vervoerder   TEXT;
  v_service      TEXT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  -- Laad order + debiteuren-vlag in één query
  SELECT o.*, d.deelleveringen_toegestaan
    INTO v_order
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- (e) Eindstatus-guard
  IF v_order.status IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % heeft status % — geen deelzending mogelijk',
      p_order_id, v_order.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) Deelleveringen toegestaan? — overrulebaar met een verplichte reden.
  IF NOT COALESCE(v_order.deelleveringen_toegestaan, FALSE)
     AND v_order.lever_modus IS DISTINCT FROM 'deelleveringen'
     AND COALESCE(btrim(p_override_reden), '') = '' THEN
    RAISE EXCEPTION
      'Order %: deelleveringen niet toegestaan voor debiteur % '
      '(stel deelleveringen_toegestaan in op de klant of pas lever_modus aan, '
      'of geef een reden op om te overrulen)',
      p_order_id, v_order.debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) Alle regel_ids horen bij deze order?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM order_regels
        WHERE id = rid AND order_id = p_order_id
     )
  ) THEN
    RAISE EXCEPTION 'Niet alle regel_ids horen bij order %', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (b) Alle regels pickbaar?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM orderregel_pickbaarheid op
        WHERE op.order_regel_id = rid
          AND op.is_pickbaar = TRUE
     )
  ) THEN
    RAISE EXCEPTION
      'Niet alle geselecteerde regels zijn pickbaar. '
      'Controleer wacht_op per regel via orderregel_pickbaarheid.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (c) Geen regel al in actieve zending? ('Gepland' valt hieronder — een
  -- nog-niet-gestarte deelzending blokkeert terecht een tweede poging op
  -- dezelfde regel.)
  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
      JOIN zendingen z ON z.id = zr.zending_id
     WHERE zr.order_regel_id = ANY(p_regel_ids)
       AND z.status NOT IN ('Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Een of meer geselecteerde regels zitten al in een actieve zending. '
      'Voltooi of annuleer die zending eerst.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Vervoerder bepalen: gebruik de eerste effectieve vervoerder van de selectie
  -- (zelfde ladder als start_pickronden_voor_order)
  SELECT evpo.effectief_code, evpo.effectief_service
    INTO v_vervoerder, v_service
    FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
   WHERE evpo.orderregel_id = ANY(p_regel_ids)
   ORDER BY evpo.orderregel_id ASC
   LIMIT 1;

  -- Maak de deelzending aan — mig 477: 'Gepland', nog niet 'Picken'. De
  -- order-status blijft ongewijzigd; pas zodra de picker 'm via "Picken
  -- starten" daadwerkelijk start (start_pickronden promoveert 'm dan), gaat
  -- de order naar 'In pickronde'.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status, picker_id,
    vervoerder_code, service_code,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum,
    is_deelzending
  ) VALUES (
    v_zending_nr, p_order_id, 'Gepland', p_picker_id,
    v_vervoerder, v_service,
    v_order.afl_naam, v_order.afl_adres,
    v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    TRUE
  ) RETURNING id INTO v_zending_id;

  -- M2M koppeling (mig 222 canoniek patroon)
  INSERT INTO zending_orders (zending_id, order_id)
  VALUES (v_zending_id, p_order_id)
  ON CONFLICT DO NOTHING;

  -- Alleen geselecteerde regels aan zending koppelen
  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.id = ANY(p_regel_ids)
     AND COALESCE(ore.orderaantal, 0) > 0;

  -- Colli genereren (kan ook vóór de pickronde-start al, is statusonafhankelijk)
  PERFORM genereer_zending_colli(v_zending_id);

  -- Audit-event: deelzending AANGEMAAKT (geen statustransitie meer — die
  -- gebeurt pas bij het daadwerkelijk starten via start_pickronden).
  INSERT INTO order_events (order_id, event_type, status_voor, status_na, metadata)
  SELECT
    p_order_id,
    'deelzending_gestart',
    v_order.status,
    v_order.status,
    jsonb_build_object(
      'zending_id',   v_zending_id,
      'zending_nr',   v_zending_nr,
      'regel_ids',    p_regel_ids,
      'vervoerder',   v_vervoerder
    ) || CASE
      WHEN COALESCE(btrim(p_override_reden), '') <> ''
        THEN jsonb_build_object('deelleveringen_override_reden', btrim(p_override_reden))
      ELSE '{}'::jsonb
    END;

  RETURN QUERY SELECT v_zending_id, v_zending_nr, v_vervoerder;
END;
$function$;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_pickronden(
  p_order_ids bigint[],
  p_picker_id bigint,
  p_force_solo_ids bigint[] DEFAULT '{}'::bigint[]
)
RETURNS TABLE(zending_id bigint, zending_nr text, vervoerder_code text, aantal_regels integer, aantal_orders integer, is_nieuw boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_input_count       INTEGER;
  v_force_solo        BIGINT[];
  v_alle_orders       BIGINT[];
  v_eindstatus_nr     TEXT;
  v_eindstatus_order  BIGINT;
  v_picken_order      BIGINT;
  v_geen_verv_nr      TEXT;
  v_niet_pickbaar_nrs TEXT[];
  v_groep             RECORD;
  v_promoted          RECORD;
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
  -- effectieve vervoerder (bron='geen') mag geen pickronde starten.
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

  -- Intake-gate-poort (mig 395/396): afleveradres- en prijs-gate.
  PERFORM _valideer_intake_gates(v_alle_orders);

  -- Pickbaarheid-guard (mig 466): elke order in scope — zelf geselecteerd of
  -- via adres-bundeling toegevoegd in de 'uitgebreid'-CTE hierboven — moet
  -- voldoen aan dezelfde pick_ship_zichtbaar-voorwaarde als de Pick & Ship-
  -- lijst (order_pickbaarheid, mig 386). Zonder deze guard kan een nog-niet-
  -- klare order (bv. maatwerk dat nog niet 'Ingepakt' is) ongemerkt meeliften
  -- in dezelfde zending als een wél-klare order op hetzelfde adres.
  SELECT array_agg(o.order_nr ORDER BY o.order_nr)
    INTO v_niet_pickbaar_nrs
    FROM unnest(v_alle_orders) AS oid
    JOIN orders o ON o.id = oid
    LEFT JOIN order_pickbaarheid op ON op.order_id = oid
   WHERE NOT COALESCE(op.pick_ship_zichtbaar, FALSE);

  IF v_niet_pickbaar_nrs IS NOT NULL THEN
    RAISE EXCEPTION
      'Order(s) % zijn nog niet pickbaar (voorraad/maatwerk niet gereed) en kunnen geen pickronde starten.',
      array_to_string(v_niet_pickbaar_nrs, ', ')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Mig 477: promoot bestaande 'Gepland'-deelzendingen (start_deelzending,
  -- mig 473/477) van orders in scope naar 'Picken' i.p.v. hun regels opnieuw
  -- te zenden — de is_locked-filter in de hoofdgroepering hieronder sluit
  -- die regels daar uit. Geleverd in de resultatenset (is_nieuw=FALSE) zodat
  -- de bestaande frontend-navigatie naar de printset-pagina (labels printen)
  -- ze gewoon meeneemt, ongeacht of er ook nieuwe zendingen bijkomen.
  FOR v_promoted IN
    UPDATE zendingen z
       SET status    = 'Picken',
           picker_id = COALESCE(z.picker_id, p_picker_id)
      FROM zending_orders zo
     WHERE zo.zending_id = z.id
       AND zo.order_id = ANY(v_alle_orders)
       AND z.status = 'Gepland'
    RETURNING z.id AS zid, z.zending_nr AS znr, z.vervoerder_code AS vcode
  LOOP
    RETURN QUERY SELECT
      v_promoted.zid,
      v_promoted.znr,
      v_promoted.vcode,
      (SELECT COUNT(*)::INTEGER FROM zending_regels zr2 WHERE zr2.zending_id = v_promoted.zid),
      (SELECT COUNT(DISTINCT zo2.order_id)::INTEGER FROM zending_orders zo2 WHERE zo2.zending_id = v_promoted.zid),
      FALSE AS is_nieuw;
  END LOOP;

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × week × solo_marker)
  --
  -- Mig 403: GREATEST-clamp op jaar_week zodat achterstallige orders (verlopen
  -- verzendweek) in dezelfde GROUP-BY-groep landen als lopende-week-orders naar
  -- hetzelfde adres. Toekomstige weken zijn ongewijzigd.
  --
  -- Mig 477: `WHERE NOT pv.is_locked` sluit regels uit die al in ENIGE
  -- zending zitten (inclusief de net hierboven gepromoveerde) — voorkomt
  -- dubbele zending_regels-rijen voor dezelfde regel over twee zendingen heen.
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
        -- Clamp: verlopen verzendweek → huidige week zodat cross-week
        -- bundeling werkt. GREATEST is safe op 'YYYY-Www'-strings door de
        -- zero-padded ISO-weeknotatie.
        GREATEST(
          verzendweek_voor_datum(o.afleverdatum),
          verzendweek_voor_datum(CURRENT_DATE)
        )                                              AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
       WHERE NOT pv.is_locked
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
$function$;

NOTIFY pgrst, 'reload schema';
