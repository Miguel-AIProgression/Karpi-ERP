-- GEGENEREERD: alle public-functies van de live DB (audit-remediatie Task 4.1).
-- Ververs met scripts/dump-schema.ps1 (db query-route). NIET handmatig bewerken.

CREATE OR REPLACE FUNCTION public._afl_gln_matcht_vestiging(p_debiteur_nr integer, p_gln text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM afleveradressen a
     WHERE a.debiteur_nr = p_debiteur_nr
       AND a.gln_afleveradres IN (p_gln, p_gln || '.0')
  );
$function$


CREATE OR REPLACE FUNCTION public._apply_transitie(p_order_id bigint, p_event_type order_event_type, p_status_na order_status, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid, p_reden text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status_voor order_status;
  v_zet_verzonden_at BOOLEAN;
BEGIN
  SELECT status INTO v_status_voor FROM orders WHERE id = p_order_id;
  IF v_status_voor IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- No-op als status al gelijk is (idempotent).
  IF v_status_voor = p_status_na THEN
    RETURN;
  END IF;

  v_zet_verzonden_at := (p_status_na = 'Verzonden');

  UPDATE orders
     SET status = p_status_na,
         verzonden_at = CASE
           WHEN v_zet_verzonden_at AND verzonden_at IS NULL THEN now()
           ELSE verzonden_at
         END
   WHERE id = p_order_id;

  -- Mig 506: voeg gedaan_door toe aan metadata als er een gebruiker-sessie is.
  -- Systeemtriggers (geen JWT → auth.uid() = NULL) krijgen geen gedaan_door.
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na,
    actor_medewerker_id, actor_auth_user_id, reden, metadata
  ) VALUES (
    p_order_id, p_event_type, v_status_voor, p_status_na,
    p_actor_medewerker_id, p_actor_auth_user_id, p_reden,
    COALESCE(p_metadata, '{}'::jsonb) ||
      CASE
        WHEN auth.uid() IS NOT NULL
          THEN jsonb_build_object('gedaan_door', huidige_actor_email())
        ELSE '{}'::jsonb
      END
  );
END;
$function$


CREATE OR REPLACE FUNCTION public._normaliseer_afleveradres(p_adres text, p_postcode text, p_land text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT
       -- postcode: alle whitespace weg
       COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_postcode, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         '', 'g'))), ''), '?')
    || '|'
       -- adres: whitespace-runs naar 1 spatie, randen trimmen
    || COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_adres, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         ' ', 'g'))), ''), '?')
    || '|'
       -- land: alleen rand-whitespace strippen (binnenste blijft, zoals TS .trim())
    || COALESCE(NULLIF(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_land, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
         '', 'g')), ''), '?');
$function$


CREATE OR REPLACE FUNCTION public._sync_rol_kwaliteit_from_artikel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_kw TEXT;
  v_kl TEXT;
BEGIN
  IF NEW.artikelnr IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kwaliteit_code, kleur_code
  INTO v_kw, v_kl
  FROM producten
  WHERE artikelnr = NEW.artikelnr;

  IF FOUND THEN
    NEW.kwaliteit_code := v_kw;
    NEW.kleur_code     := v_kl;
    NEW.zoeksleutel    := v_kw || '_' || v_kl;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public._valideer_intake_gates(p_order_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_adres_nr TEXT;
  v_gln_nr   TEXT;
  v_prijs_nr TEXT;
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

  SELECT o.order_nr INTO v_gln_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.afl_gln_ongekoppeld_sinds IS NOT NULL
     AND o.afl_gln_gecontroleerd_op IS NULL
   LIMIT 1;

  IF v_gln_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Afleveradres van order % is niet gekoppeld aan een vestiging (de aflever-GLN '
      'matcht niets, het adres viel terug op het hoofdadres) — koppel de juiste '
      'vestiging of geef het adres bewust vrij voordat je een pickronde start.',
      v_gln_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT o.order_nr INTO v_prijs_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.prijs_ontbreekt_sinds IS NOT NULL
   LIMIT 1;

  IF v_prijs_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft één of meer regels zonder prijs (€0) — corrigeer de prijs '
      'of bevestig op de order dat €0 klopt voordat je een pickronde start.',
      v_prijs_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public._valideer_picker(p_picker_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Picker optioneel: NULL is toegestaan (= niet vastgelegd). Geen exception meer.
  IF p_picker_id IS NULL THEN
    RETURN;
  END IF;

  -- Als er wél een picker is opgegeven, moet die een actieve picker-medewerker zijn.
  IF NOT EXISTS (
    SELECT 1 FROM medewerkers
     WHERE id = p_picker_id
       AND 'picker' = ANY(rollen)
       AND actief
  ) THEN
    RAISE EXCEPTION 'Medewerker % is geen actieve picker', p_picker_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.acquire_snijplan_lock(p_kwaliteit text, p_kleur text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO snijplan_locks (kwaliteit_code, kleur_code)
  VALUES (p_kwaliteit, p_kleur)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$function$


CREATE OR REPLACE FUNCTION public.actieve_snijgroepen()
 RETURNS TABLE(kwaliteit_code text, kleur_code text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT DISTINCT
    sp.kwaliteit_code,
    sp.kleur_code
  FROM snijplanning_overzicht sp
  WHERE sp.order_status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
    AND sp.status IN ('Gepland', 'Wacht', 'Wacht op inkoop', 'Snijden')
    AND sp.snijden_uit_standaardmaat = FALSE
    AND sp.kwaliteit_code IS NOT NULL
    AND sp.kleur_code IS NOT NULL
  ORDER BY sp.kwaliteit_code, sp.kleur_code
$function$


CREATE OR REPLACE FUNCTION public.admin_truncate_orders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  TRUNCATE TABLE orders, order_regels RESTART IDENTITY CASCADE;
END;
$function$


CREATE OR REPLACE FUNCTION public.allocatie_opties_voor_artikel(p_artikelnr text)
 RETURNS TABLE(bron text, artikelnr text, omschrijving text, inkooporder_regel_id bigint, vrij_aantal integer, verwacht_datum date, eigen_artikelnr text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_eigen_artikelnr    TEXT;
  v_stuks_artikelnr    TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       BIGINT;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
BEGIN
  SELECT p0.stuks_artikelnr INTO v_stuks_artikelnr
    FROM producten p0 WHERE p0.artikelnr = p_artikelnr;
  v_eigen_artikelnr := COALESCE(v_stuks_artikelnr, p_artikelnr);

  -- Optie 2: eigen artikel, open inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, v_eigen_artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum, v_eigen_artikelnr
    FROM inkooporder_regels ir
    JOIN inkooporders io ON io.id = ir.inkooporder_id
    JOIN producten p ON p.artikelnr = ir.artikelnr
   WHERE ir.artikelnr = v_eigen_artikelnr
     AND ir.eenheid = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;

  SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
    INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = v_eigen_artikelnr;

  IF v_collectie_id IS NULL OR v_kleur_code IS NULL THEN
    RETURN;
  END IF;

  -- Optie 1: equivalent, nu op voorraad.
  RETURN QUERY
  SELECT 'voorraad'::TEXT, p.artikelnr, p.omschrijving,
         NULL::BIGINT, p.vrije_voorraad, NULL::DATE, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.vrije_voorraad > 0
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
   ORDER BY p.vrije_voorraad DESC;

  -- Optie 3: equivalent, wacht op zíjn eigen inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, p.artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    JOIN inkooporder_regels ir ON ir.artikelnr = p.artikelnr
    JOIN inkooporders io ON io.id = ir.inkooporder_id
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
     AND ir.eenheid      = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;
END;
$function$


CREATE OR REPLACE FUNCTION public.annuleer_pickronde(p_zending_id bigint, p_reden text DEFAULT NULL::text, p_actor_medewerker_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig        zending_status;
  v_aantal_bezig  INTEGER;
  v_zending_nr    TEXT;
  v_orders        BIGINT[];
  v_order_id      BIGINT;
  v_nog_open      INTEGER;
BEGIN
  SELECT status, zending_nr INTO v_huidig, v_zending_nr
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig NOT IN ('Gepland', 'Picken') THEN
    RAISE EXCEPTION 'Zending % is niet terug te draaien (status=%) — alleen een nog-niet-gestarte of actieve pickronde kan terug',
      p_zending_id, v_huidig USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Niets-gepickt-guard: zodra ook maar één colli niet meer 'open' is, weigeren.
  SELECT COUNT(*) INTO v_aantal_bezig
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst <> 'open';
  IF v_aantal_bezig > 0 THEN
    RAISE EXCEPTION 'Zending % heeft al % gepickte/niet-gevonden colli — terugdraaien kan niet meer; voltooi of los het pick-probleem op',
      p_zending_id, v_aantal_bezig USING ERRCODE = 'restrict_violation';
  END IF;

  -- Betrokken orders via M2M (mig 222), met legacy order_id-fallback.
  SELECT array_agg(order_id) INTO v_orders
    FROM zending_orders WHERE zending_id = p_zending_id;
  IF v_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_orders
      FROM zendingen WHERE id = p_zending_id;
  END IF;

  -- Zending-data verwijderen (children eerst — FK-veilig, ongeacht cascade).
  DELETE FROM zending_colli  WHERE zending_id = p_zending_id;
  DELETE FROM zending_regels WHERE zending_id = p_zending_id;
  DELETE FROM zending_orders WHERE zending_id = p_zending_id;
  DELETE FROM zendingen      WHERE id = p_zending_id;

  -- Betrokken orders terugzetten. Alleen als de order daardoor geen actieve
  -- ('Gepland'/'Picken') zending meer heeft (bundel met andere open zending →
  -- order blijft 'In pickronde'). derive_wacht_status (mig 346) behandelt
  -- 'In pickronde' als no-op, dus de transitie moet expliciet. Voor een
  -- Gepland-only annulering is deze EXISTS-check vanzelf FALSE (mig 477
  -- wijzigt de orderstatus nooit bij het aanmaken) — terecht een no-op.
  IF v_orders IS NOT NULL THEN
    FOREACH v_order_id IN ARRAY v_orders LOOP
      SELECT COUNT(*) INTO v_nog_open
        FROM zendingen z
       WHERE z.status IN ('Gepland', 'Picken')
         AND (
           z.order_id = v_order_id
           OR z.id IN (SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id)
         );

      IF v_nog_open = 0 AND EXISTS (
        SELECT 1 FROM orders WHERE id = v_order_id AND status = 'In pickronde'
      ) THEN
        PERFORM _apply_transitie(
          p_order_id            := v_order_id,
          p_event_type          := 'pickronde_teruggedraaid',
          p_status_na           := 'Klaar voor picken',
          p_actor_medewerker_id := p_actor_medewerker_id,
          p_reden               := COALESCE(p_reden, 'Pickronde teruggedraaid'),
          p_metadata            := jsonb_build_object('zending_nr', v_zending_nr)
        );
        -- Settelt alsnog in Wacht op X als er intussen een tekort/claim is.
        PERFORM herbereken_wacht_status(v_order_id);
      END IF;
    END LOOP;
  END IF;

  RETURN p_zending_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.assert_bundel_sleutel_contract(p_golden jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  f      JSONB;
  v_uit  TEXT;
  v_verw TEXT;
  v_n    INTEGER := 0;
  v_key  TEXT;
BEGIN
  -- Vorm-guard: een getypo'de sleutel of lege array zou anders stil slagen
  -- (jsonb_array_elements over NULL levert nul rijen) -- en deze assert is
  -- bij een handmatige SQL Editor-apply de laatste verdedigingslinie.
  FOREACH v_key IN ARRAY ARRAY['adres_cases', 'week_cases', 'sleutel_cases'] LOOP
    IF jsonb_typeof(p_golden->v_key) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_golden->v_key) = 0 THEN
      RAISE EXCEPTION 'bundel-sleutel-contract: "%" ontbreekt, is geen array of is leeg', v_key;
    END IF;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'adres_cases') LOOP
    v_uit  := _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land');
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract adres_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'week_cases') LOOP
    v_uit  := verzendweek_voor_datum((f->>'datum')::date);
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract week_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'sleutel_cases') LOOP
    v_uit := bundel_sleutel(
      (f->>'debiteur_nr')::integer,
      _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land'),
      -- Spiegelt de AFHAAL-glue uit mig 229 (voorgestelde_zending_bundels)
      -- en TS bundelSleutelVoorOrder; drift daar valt buiten dit contract.
      CASE WHEN COALESCE((f->>'afhalen')::boolean, FALSE)
           THEN 'AFHAAL' ELSE f->>'vervoerder_code' END,
      verzendweek_voor_datum((f->>'afleverdatum')::date)
    );
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract sleutel_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'bundel-sleutel-contract: alle % cases geslaagd', v_n;
END $function$


CREATE OR REPLACE FUNCTION public.assert_normaliseer_land_contract(p_golden jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  f      JSONB;
  v_uit  TEXT;
  v_verw TEXT;
  v_n    INTEGER := 0;
BEGIN
  -- Vorm-guard: een getypo'de sleutel of lege array zou anders stil slagen
  -- (jsonb_array_elements over NULL levert nul rijen) — en deze assert is
  -- bij een handmatige SQL Editor-apply de laatste verdedigingslinie.
  IF jsonb_typeof(p_golden->'cases') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_golden->'cases') = 0 THEN
    RAISE EXCEPTION 'normaliseer_land-contract: "cases" ontbreekt, is geen array of is leeg';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'cases') LOOP
    v_uit  := normaliseer_land(f->>'input');
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'normaliseer_land-contract "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'normaliseer_land-contract: alle % cases geslaagd', v_n;
END $function$


CREATE OR REPLACE FUNCTION public.auto_maak_snijplan()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_aantal       INTEGER;
  i              INTEGER;
  v_order_status order_status;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE
     OR NEW.maatwerk_lengte_cm  IS NULL
     OR NEW.maatwerk_breedte_cm IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Concept-guard: snijplannen worden pas aangemaakt bij bevestiging
  -- (bevestig_concept_order, mig 541 — maakt ze in een loop zelf aan).
  SELECT status INTO v_order_status FROM orders WHERE id = NEW.order_id;
  IF v_order_status = 'Concept' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  FOR i IN 1..v_aantal LOOP
    INSERT INTO snijplannen (
      snijplan_nr, order_regel_id,
      lengte_cm, breedte_cm,
      status, opmerkingen,
      snijden_uit_standaardmaat
    )
    VALUES (
      volgend_nummer('SNIJ'),
      NEW.id,
      NEW.maatwerk_lengte_cm::INTEGER,
      NEW.maatwerk_breedte_cm::INTEGER,
      'Wacht'::snijplan_status,
      CASE WHEN v_aantal > 1
           THEN 'Auto-aangemaakt (' || i || '/' || v_aantal || ')'
           ELSE 'Auto-aangemaakt'
      END,
      COALESCE(NEW.snijden_uit_standaardmaat, false)
    );
  END LOOP;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.auto_markeer_maatwerk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Check if product is rol type OR artikelnr contains MAATWERK/BREED
  IF EXISTS (
    SELECT 1 FROM producten
    WHERE artikelnr = NEW.artikelnr
      AND product_type = 'rol'
  ) OR NEW.artikelnr ILIKE '%MAATWERK%' OR NEW.artikelnr ILIKE '%BREED%' THEN
    NEW.is_maatwerk := true;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.auto_sync_snijplan_maten()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_aantal_bestaand INTEGER;
  v_aantal_target   INTEGER;
  v_geblokkeerd     INTEGER;
  i                 INTEGER;
  v_order_status    order_status;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Concept-guard: zelfde principe als auto_maak_snijplan.
  -- De self-healing fallback (v_aantal_bestaand = 0) mag ook voor Concept
  -- geen snijplannen aanmaken.
  SELECT status INTO v_order_status FROM orders WHERE id = NEW.order_id;
  IF v_order_status = 'Concept' THEN
    RETURN NEW;
  END IF;

  v_aantal_target := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  SELECT COUNT(*) INTO v_aantal_bestaand
    FROM snijplannen WHERE order_regel_id = NEW.id;

  -- Self-healing fallback (mig 323): nog GEEN snijplannen en beide maten gevuld
  -- → maak ze alsnog aan, ongeacht of de maten in déze update zijn veranderd.
  -- Mig 328: kopieert tevens snijden_uit_standaardmaat naar elk nieuw snijplan.
  IF v_aantal_bestaand = 0 THEN
    IF NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL THEN
      FOR i IN 1..v_aantal_target LOOP
        INSERT INTO snijplannen (
          snijplan_nr, order_regel_id,
          lengte_cm, breedte_cm,
          status, opmerkingen,
          snijden_uit_standaardmaat
        )
        VALUES (
          volgend_nummer('SNIJ'),
          NEW.id,
          NEW.maatwerk_lengte_cm::INTEGER,
          NEW.maatwerk_breedte_cm::INTEGER,
          'Wacht'::snijplan_status,
          CASE WHEN v_aantal_target > 1
               THEN 'Auto-aangemaakt na update (' || i || '/' || v_aantal_target || ')'
               ELSE 'Auto-aangemaakt na update'
          END,
          COALESCE(NEW.snijden_uit_standaardmaat, false)
        );
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  -- Er bestaan al snijplannen: alleen iets doen als de maten daadwerkelijk wijzigen.
  IF NEW.maatwerk_lengte_cm IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  -- Maten naar NULL gezet: niets te syncen.
  IF NEW.maatwerk_lengte_cm IS NULL OR NEW.maatwerk_breedte_cm IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sync: update alle snijplannen die nog veilig zijn (geen rol, status in
  -- Wacht/Gepland/Snijden). Snijplannen met rol of voorbij Snijden: WARNING.
  SELECT COUNT(*) INTO v_geblokkeerd
    FROM snijplannen
   WHERE order_regel_id = NEW.id
     AND (rol_id IS NOT NULL
          OR status NOT IN ('Wacht'::snijplan_status,
                            'Gepland'::snijplan_status,
                            'Snijden'::snijplan_status));

  IF v_geblokkeerd > 0 THEN
    RAISE WARNING
      'Snijplannen voor order_regel % gedeeltelijk NIET bijgewerkt: % stuks '
      'hebben rol of voorbij Snijden. Release + hersnijden nodig.',
      NEW.id, v_geblokkeerd;
  END IF;

  UPDATE snijplannen
     SET lengte_cm  = NEW.maatwerk_lengte_cm::INTEGER,
         breedte_cm = NEW.maatwerk_breedte_cm::INTEGER
   WHERE order_regel_id = NEW.id
     AND rol_id IS NULL
     AND status IN ('Wacht'::snijplan_status,
                    'Gepland'::snijplan_status,
                    'Snijden'::snijplan_status);

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.backlog_per_kwaliteit_kleur(p_kwaliteit text, p_kleur text)
 RETURNS TABLE(totaal_m2 numeric, aantal_stukken integer, vroegste_afleverdatum date)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    COALESCE(SUM(snij_lengte_cm::numeric * snij_breedte_cm / 10000), 0)::NUMERIC AS totaal_m2,
    COUNT(*)::INTEGER AS aantal_stukken,
    MIN(afleverdatum)::DATE AS vroegste_afleverdatum
  FROM snijplanning_overzicht
  WHERE kwaliteit_code = p_kwaliteit
    AND kleur_code IN (
      p_kleur,
      p_kleur || '.0',
      regexp_replace(p_kleur, '\.0$', '')
    )
    AND status = 'Wacht'
    AND rol_id IS NULL;
$function$


CREATE OR REPLACE FUNCTION public.bepaal_btw_regeling(p_afl_land text, p_debiteur_land text, p_afhalen boolean, p_verlegd_vlag boolean, p_btw_nummer text, p_btw_percentage numeric)
 RETURNS TABLE(regeling text, effectief_pct numeric, controle_nodig boolean, controle_reden text, land_iso2 text)
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_land_bron TEXT;
  v_iso2      TEXT;
BEGIN
  -- Afhalen: Karpi heeft geen vervoersbewijs naar het land waar de klant zelf
  -- naartoe rijdt — behandel als binnenlands (conservatieve aanname).
  IF COALESCE(p_afhalen, FALSE) THEN
    v_land_bron := p_debiteur_land;
  ELSE
    v_land_bron := COALESCE(NULLIF(TRIM(p_afl_land), ''), p_debiteur_land);
  END IF;

  v_iso2 := normaliseer_land(v_land_bron);

  -- Geval 1: geen land af te leiden (order én debiteur leeg) — veilig
  -- terugvallen op binnenlands gedrag. GEEN blokkade: 62% van de actieve
  -- debiteuren heeft een leeg land-veld (legacy NL-klanten).
  IF v_iso2 IS NULL THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Geval 2: NL (binnenland) — gewoon het debiteur-tarief, geen controle.
  IF v_iso2 = 'NL' THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 3: andere EU-lidstaat — altijd ICL, 0% BTW (mig 550).
  -- eu_b2b_binnenland_afwijking-tak vervalt: Karpi levert uitsluitend B2B,
  -- dus elk ander EU-lid = ICL (art. 9(2)(b) Wet OB 1968). De debiteur-vlag
  -- btw_verlegd_intracom was handmatig en kon foutief staan (DECOR-UNION).
  -- Ontbrekend btw-nummer → advisory (ICP-verplichting, mig 164-besluit, niet
  -- blokkerend — blijft ongewijzigd).
  IF is_eu_land(v_iso2) THEN
    RETURN QUERY SELECT
      'eu_b2b_icl'::TEXT,
      0.00::NUMERIC(5,2),
      (p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''),
      CASE WHEN p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''
        THEN 'EU-intracommunautaire levering zonder btw-nummer bij de afnemer — controleer voor de ICP-opgave.'
        ELSE NULL END,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 4: buiten de EU — export, 0% met exportbewijs. Altijd controle_nodig:
  -- geen exportbewijs-tracking (bewust buiten scope) en 0% mag niet stilzwijgend
  -- ontstaan zonder menselijke bevestiging.
  RETURN QUERY SELECT
    'export_buiten_eu'::TEXT,
    0.00::NUMERIC(5,2),
    TRUE,
    format('Afleverland (%s) ligt buiten de EU — exportlevering, in principe 0%% BTW mits exportbewijs. Controleer en bevestig.', v_iso2),
    v_iso2;
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_late_claim_afleverdatum(p_order_id bigint)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_buffer_dagen INTEGER;
  v_laatste_claim_datum DATE;
BEGIN
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
    INTO v_buffer_dagen
  FROM app_config WHERE sleutel = 'order_config';

  -- Per-regel ETA heeft prioriteit boven order-niveau datum (mig 319)
  SELECT MAX(COALESCE(ir.verwacht_datum, io.verwacht_datum))
    INTO v_laatste_claim_datum
  FROM order_reserveringen r
  JOIN order_regels oreg       ON oreg.id = r.order_regel_id
  JOIN inkooporder_regels ir   ON ir.id   = r.inkooporder_regel_id
  JOIN inkooporders io         ON io.id   = ir.inkooporder_id
  WHERE oreg.order_id = p_order_id
    AND r.bron = 'inkooporder_regel'
    AND r.status = 'actief';

  IF v_laatste_claim_datum IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_laatste_claim_datum + COALESCE(v_buffer_dagen, 7);
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_orderregel_gewicht_kg(p_order_regel_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_is_maatwerk        BOOLEAN;
  v_maatwerk_opp       NUMERIC;
  v_maatwerk_kwaliteit TEXT;
  v_artikelnr          TEXT;
  v_density            NUMERIC;
  v_gewicht            NUMERIC;
BEGIN
  SELECT ore.is_maatwerk, ore.maatwerk_oppervlak_m2,
         ore.maatwerk_kwaliteit_code, ore.artikelnr
    INTO v_is_maatwerk, v_maatwerk_opp, v_maatwerk_kwaliteit, v_artikelnr
  FROM order_regels ore
  WHERE ore.id = p_order_regel_id;

  IF v_is_maatwerk = true AND v_maatwerk_opp IS NOT NULL
     AND v_maatwerk_kwaliteit IS NOT NULL THEN
    SELECT gewicht_per_m2_kg INTO v_density
      FROM kwaliteiten WHERE code = v_maatwerk_kwaliteit;
    IF v_density IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN ROUND(v_maatwerk_opp * v_density, 2);
  END IF;

  IF v_artikelnr IS NOT NULL THEN
    -- Mig 387: LIVE berekening (vorm-aware, mig 188/192) i.p.v. copy van de
    -- producten.gewicht_kg-cache — de cache bleek vervuilbaar (density-bug).
    -- bereken_product_gewicht_kg valt zelf al terug op legacy-gewicht als
    -- maat/density ontbreken. NULLIF: 0 is geen gewicht.
    SELECT bg.gewicht_kg INTO v_gewicht
      FROM bereken_product_gewicht_kg(v_artikelnr) bg;
    RETURN NULLIF(v_gewicht, 0);
  END IF;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_orderregel_prijs(p_artikelnr text, p_prijslijst_nr text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_prod              RECORD;
  v_oppervlak_m2      NUMERIC;
  v_vorm_toeslag      NUMERIC := 0;
  v_vorm_code         TEXT;
  v_maatwerk_artikel  TEXT;
  v_m2_prijs          NUMERIC;
  v_m2_bron_artikel   TEXT;
  v_vaste_prijs       NUMERIC;
  v_kleur_norm        TEXT;
  v_is_maatwerk_prod  BOOLEAN;
BEGIN
  -- 0. Product ophalen — nu ook omschrijving + karpi_code voor maatwerk-detectie
  SELECT
    p.artikelnr, p.kwaliteit_code, p.kleur_code,
    p.lengte_cm, p.breedte_cm, p.vorm, p.maatwerk_vorm_code,
    p.verkoopprijs, p.product_type,
    p.omschrijving, p.karpi_code
  INTO v_prod
  FROM producten p
  WHERE p.artikelnr = p_artikelnr;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'prijs', NULL, 'bron', 'onbekend_artikel',
      'breakdown', jsonb_build_object('reden', 'Artikel niet gevonden')
    );
  END IF;

  -- Spiegelt detectie in route 3: een product is maatwerk wanneer
  -- omschrijving óf karpi_code 'MAATWERK' bevat (case-insensitive).
  v_is_maatwerk_prod := (
    upper(coalesce(v_prod.omschrijving,'')) LIKE '%MAATWERK%'
    OR upper(coalesce(v_prod.karpi_code,''))   LIKE '%MAATWERK%'
  );

  ----------------------------------------------------------------------
  -- 1. Vaste prijs uit klant-prijslijst (hoofdpad, ongewijzigd)
  ----------------------------------------------------------------------
  IF p_prijslijst_nr IS NOT NULL THEN
    SELECT pr.prijs INTO v_vaste_prijs
      FROM prijslijst_regels pr
     WHERE pr.prijslijst_nr = p_prijslijst_nr
       AND pr.artikelnr = p_artikelnr
     LIMIT 1;

    IF v_vaste_prijs IS NOT NULL THEN
      RETURN jsonb_build_object(
        'prijs', v_vaste_prijs,
        'bron',  'prijslijst_vast',
        'breakdown', jsonb_build_object(
          'prijslijst_nr', p_prijslijst_nr,
          'artikelnr',     p_artikelnr
        )
      );
    END IF;
  END IF;

  ----------------------------------------------------------------------
  -- 1b. NIEUW (mig 253): eigen verkoopprijs voor vaste-maat (niet-maatwerk)
  --     producten. Voorkomt dat ze in route 2-4 (m²-fallback) belanden.
  ----------------------------------------------------------------------
  IF NOT v_is_maatwerk_prod
     AND v_prod.verkoopprijs IS NOT NULL
     AND v_prod.verkoopprijs > 0 THEN
    RETURN jsonb_build_object(
      'prijs', v_prod.verkoopprijs,
      'bron',  'product_vaste_verkoopprijs',
      'breakdown', jsonb_build_object(
        'artikelnr', p_artikelnr,
        'reden',     'Vaste-maat artikel — eigen verkoopprijs heeft voorrang op m²-fallback'
      )
    );
  END IF;

  ----------------------------------------------------------------------
  -- 2. Bepaal oppervlak — vereist voor alle m²-fallbacks
  ----------------------------------------------------------------------
  IF v_prod.lengte_cm IS NOT NULL AND v_prod.breedte_cm IS NOT NULL
     AND v_prod.lengte_cm > 0 AND v_prod.breedte_cm > 0 THEN
    IF v_prod.vorm = 'rond' THEN
      v_oppervlak_m2 := pi() * power(v_prod.lengte_cm::NUMERIC / 200.0, 2);
    ELSE
      v_oppervlak_m2 := (v_prod.lengte_cm::NUMERIC * v_prod.breedte_cm) / 10000.0;
    END IF;
  END IF;

  IF v_prod.maatwerk_vorm_code IS NOT NULL THEN
    SELECT mv.code, mv.toeslag INTO v_vorm_code, v_vorm_toeslag
      FROM maatwerk_vormen mv
     WHERE mv.code = v_prod.maatwerk_vorm_code
     LIMIT 1;
  END IF;
  v_vorm_toeslag := COALESCE(v_vorm_toeslag, 0);
  v_vorm_code    := COALESCE(v_vorm_code, 'rechthoek');

  ----------------------------------------------------------------------
  -- 3. Zoek kleur-specifiek MAATWERK-artikel voor m²-prijs
  ----------------------------------------------------------------------
  IF v_oppervlak_m2 IS NOT NULL
     AND v_prod.kwaliteit_code IS NOT NULL
     AND v_prod.kleur_code IS NOT NULL THEN

    v_kleur_norm := regexp_replace(v_prod.kleur_code, '\.0$', '');

    SELECT p2.artikelnr INTO v_maatwerk_artikel
      FROM producten p2
     WHERE p2.kwaliteit_code = v_prod.kwaliteit_code
       AND (p2.kleur_code = v_prod.kleur_code OR p2.kleur_code = v_kleur_norm)
       AND p2.actief = true
       AND (
         upper(coalesce(p2.omschrijving,'')) LIKE '%MAATWERK%'
         OR upper(coalesce(p2.karpi_code,''))   LIKE '%MAATWERK%'
       )
     ORDER BY (p2.product_type = 'overig') DESC, p2.artikelnr
     LIMIT 1;
  END IF;

  ----------------------------------------------------------------------
  -- 4. Probeer fallbacks 2 → 3 → 4 op volgorde
  ----------------------------------------------------------------------
  IF v_oppervlak_m2 IS NOT NULL THEN

    -- 2. m² uit prijslijst via maatwerk-artikel
    IF v_maatwerk_artikel IS NOT NULL AND p_prijslijst_nr IS NOT NULL THEN
      SELECT pr.prijs INTO v_m2_prijs
        FROM prijslijst_regels pr
       WHERE pr.prijslijst_nr = p_prijslijst_nr
         AND pr.artikelnr = v_maatwerk_artikel
       LIMIT 1;
      IF v_m2_prijs IS NOT NULL THEN
        v_m2_bron_artikel := v_maatwerk_artikel;
        RETURN jsonb_build_object(
          'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
          'bron',  'prijslijst_m2',
          'breakdown', jsonb_build_object(
            'oppervlak_m2',     round(v_oppervlak_m2::NUMERIC, 4),
            'm2_prijs',         v_m2_prijs,
            'vorm_code',        v_vorm_code,
            'vorm_toeslag',     v_vorm_toeslag,
            'maatwerk_artikel', v_maatwerk_artikel,
            'prijslijst_nr',    p_prijslijst_nr
          )
        );
      END IF;
    END IF;

    -- 3. producten.verkoopprijs van maatwerk-artikel
    IF v_maatwerk_artikel IS NOT NULL THEN
      SELECT p3.verkoopprijs INTO v_m2_prijs
        FROM producten p3
       WHERE p3.artikelnr = v_maatwerk_artikel;
      IF v_m2_prijs IS NOT NULL AND v_m2_prijs > 0 THEN
        RETURN jsonb_build_object(
          'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
          'bron',  'maatwerk_artikel_m2',
          'breakdown', jsonb_build_object(
            'oppervlak_m2',     round(v_oppervlak_m2::NUMERIC, 4),
            'm2_prijs',         v_m2_prijs,
            'vorm_code',        v_vorm_code,
            'vorm_toeslag',     v_vorm_toeslag,
            'maatwerk_artikel', v_maatwerk_artikel
          )
        );
      END IF;
    END IF;

    -- 4. Generieke kwaliteits-m²-prijs uit maatwerk_m2_prijzen
    SELECT mmp.verkoopprijs_m2 INTO v_m2_prijs
      FROM maatwerk_m2_prijzen mmp
     WHERE mmp.kwaliteit_code = v_prod.kwaliteit_code
       AND mmp.verkoopprijs_m2 IS NOT NULL
     ORDER BY (mmp.kleur_code = v_prod.kleur_code) DESC,
              (mmp.kleur_code = v_kleur_norm) DESC
     LIMIT 1;
    IF v_m2_prijs IS NOT NULL AND v_m2_prijs > 0 THEN
      RETURN jsonb_build_object(
        'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
        'bron',  'kwaliteit_m2',
        'breakdown', jsonb_build_object(
          'oppervlak_m2',   round(v_oppervlak_m2::NUMERIC, 4),
          'm2_prijs',       v_m2_prijs,
          'vorm_code',      v_vorm_code,
          'vorm_toeslag',   v_vorm_toeslag,
          'kwaliteit_code', v_prod.kwaliteit_code
        )
      );
    END IF;
  END IF;

  ----------------------------------------------------------------------
  -- 5. Laatste redmiddel: producten.verkoopprijs van het product zelf
  --    (alleen nog bereikt voor maatwerk-producten zonder oppervlak,
  --    of vaste-maat producten zonder verkoopprijs die niet via m²-pad lopen)
  ----------------------------------------------------------------------
  IF v_prod.verkoopprijs IS NOT NULL AND v_prod.verkoopprijs > 0 THEN
    RETURN jsonb_build_object(
      'prijs', v_prod.verkoopprijs,
      'bron',  'product_verkoopprijs',
      'breakdown', jsonb_build_object(
        'reden', 'Geen prijslijst-prijs en geen m²-fallback mogelijk'
      )
    );
  END IF;

  ----------------------------------------------------------------------
  -- 6. Niets gevonden
  ----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'prijs', NULL,
    'bron',  'geen',
    'breakdown', jsonb_build_object(
      'reden', 'Geen prijs in prijslijst, geen m²-fallback en geen verkoopprijs'
    )
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_product_gewicht_kg(p_artikelnr text)
 RETURNS TABLE(gewicht_kg numeric, uit_kwaliteit boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_lengte INTEGER;
  v_breedte INTEGER;
  v_vorm TEXT;
  v_density NUMERIC;
  v_legacy_gewicht NUMERIC;
BEGIN
  SELECT p.lengte_cm, p.breedte_cm, p.vorm, q.gewicht_per_m2_kg, p.gewicht_kg
    INTO v_lengte, v_breedte, v_vorm, v_density, v_legacy_gewicht
  FROM producten p
  LEFT JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  IF v_lengte IS NOT NULL AND v_breedte IS NOT NULL AND v_density IS NOT NULL THEN
    IF v_vorm = 'rond' THEN
      RETURN QUERY SELECT
        ROUND(PI()::NUMERIC * POWER(v_lengte::NUMERIC / 200.0, 2) * v_density, 2),
        true;
    ELSE
      RETURN QUERY SELECT
        ROUND((v_lengte::NUMERIC * v_breedte::NUMERIC / 10000.0) * v_density, 2),
        true;
    END IF;
  ELSE
    RETURN QUERY SELECT v_legacy_gewicht, false;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_rol_type(p_artikelnr text, p_breedte_cm integer, p_lengte_cm integer, p_oorsprong_rol_id bigint)
 RETURNS rol_type
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_std_breedte INTEGER;
BEGIN
  -- 1. Primair: kwaliteiten.standaard_breedte_cm via producten-lookup
  SELECT k.standaard_breedte_cm INTO v_std_breedte
  FROM producten p
  JOIN kwaliteiten k ON k.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  -- 2. Fallback: laatste 3 cijfers van artikelnr
  IF v_std_breedte IS NULL THEN
    v_std_breedte := NULLIF(SUBSTRING(p_artikelnr FROM '(\d{3})$'), '')::INTEGER;
  END IF;

  -- 3. Laatste fallback
  IF v_std_breedte IS NULL THEN
    v_std_breedte := 400;
  END IF;

  -- Lengte <1m = altijd reststuk
  IF p_lengte_cm IS NULL OR p_lengte_cm < 100 THEN
    RETURN 'reststuk';
  END IF;

  -- Afwijkende (smallere) breedte = reststuk
  IF p_breedte_cm < v_std_breedte THEN
    RETURN 'reststuk';
  END IF;

  -- Gesneden (heeft parent) + std breedte + lengte >=1m = aangebroken
  IF p_oorsprong_rol_id IS NOT NULL THEN
    RETURN 'aangebroken';
  END IF;

  RETURN 'volle_rol';
END;
$function$


CREATE OR REPLACE FUNCTION public.bereken_vroegst_leverbaar(p_order_regel_id bigint)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_is_maatwerk    BOOLEAN;
  v_heeft_voorraad BOOLEAN;
  v_max_io_datum   DATE;
  v_buffer_dagen   INTEGER;
BEGIN
  SELECT COALESCE(is_maatwerk, FALSE)
    INTO v_is_maatwerk
    FROM order_regels
   WHERE id = p_order_regel_id;

  -- Maatwerk: timing ligt bij snijplanning, niet bij IO-claims
  IF v_is_maatwerk OR v_is_maatwerk IS NULL THEN
    RETURN NULL;
  END IF;

  -- Inkoop-buffer (default 1 week = 7 dagen)
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
    INTO v_buffer_dagen
    FROM app_config
   WHERE sleutel = 'order_config';
  v_buffer_dagen := COALESCE(v_buffer_dagen, 7);

  -- IO-claims aanwezig?
  SELECT MAX(io.verwacht_datum)
    INTO v_max_io_datum
    FROM order_reserveringen rsv
    JOIN inkooporder_regels ior ON ior.id = rsv.inkooporder_regel_id
    JOIN inkooporders io ON io.id = ior.inkooporder_id
   WHERE rsv.order_regel_id = p_order_regel_id
     AND rsv.bron = 'inkooporder_regel'
     AND rsv.status = 'actief';

  IF v_max_io_datum IS NOT NULL THEN
    -- IO-datum inclusief buffer = vroegst leverbaar vanuit inkoop
    RETURN v_max_io_datum + v_buffer_dagen;
  END IF;

  -- Voorraad-claim aanwezig?
  SELECT EXISTS(
    SELECT 1 FROM order_reserveringen
     WHERE order_regel_id = p_order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
  ) INTO v_heeft_voorraad;

  IF v_heeft_voorraad THEN
    RETURN CURRENT_DATE;
  END IF;

  -- Geen dekking
  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.beste_rol_voor_snijplan(p_kwaliteit_code text, p_kleur_code text, p_lengte_cm numeric, p_breedte_cm numeric)
 RETURNS TABLE(rol_id bigint, rolnummer text, lengte_cm integer, breedte_cm integer, status text, verspilling_m2 numeric, prioriteit_score integer)
 LANGUAGE sql
 STABLE
AS $function$
SELECT
  r.id,
  r.rolnummer,
  r.lengte_cm,
  r.breedte_cm,
  r.status,
  ROUND((r.lengte_cm::NUMERIC * r.breedte_cm::NUMERIC - p_lengte_cm * p_breedte_cm) / 10000.0, 2) AS verspilling_m2,
  CASE
    WHEN r.status = 'reststuk' THEN 1    -- reststukken first (hergebruik)
    WHEN r.oorsprong_rol_id IS NOT NULL THEN 2  -- aangebroken rollen
    ELSE 3                                 -- volle rollen
  END AS prioriteit_score
FROM rollen r
WHERE r.kwaliteit_code = p_kwaliteit_code
  AND r.kleur_code = p_kleur_code
  AND r.status IN ('beschikbaar', 'reststuk')
  AND r.lengte_cm >= p_lengte_cm
  AND r.breedte_cm >= p_breedte_cm
ORDER BY prioriteit_score ASC, verspilling_m2 ASC
LIMIT 5;
$function$


CREATE OR REPLACE FUNCTION public.besteld_per_kwaliteit_kleur()
 RETURNS TABLE(kwaliteit_code text, kleur_code text, besteld_m numeric, besteld_m2 numeric, orders_count bigint, eerstvolgende_leverweek text, eerstvolgende_verwacht_datum date, eerstvolgende_m numeric, eerstvolgende_m2 numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH eerstvolg AS (
    SELECT DISTINCT ON (v.kwaliteit_code, v.kleur_code)
      v.kwaliteit_code,
      v.kleur_code,
      v.leverweek,
      v.verwacht_datum
    FROM openstaande_inkooporder_regels v
    WHERE v.kwaliteit_code IS NOT NULL
      AND v.kleur_code IS NOT NULL
      AND v.verwacht_datum IS NOT NULL
    ORDER BY v.kwaliteit_code, v.kleur_code, v.verwacht_datum ASC
  )
  SELECT
    v.kwaliteit_code,
    v.kleur_code,
    COALESCE(SUM(v.te_leveren_m), 0)::NUMERIC AS besteld_m,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
          THEN v.te_leveren_m * k.standaard_breedte_cm / 100.0
        ELSE 0
      END
    ), 0)::NUMERIC AS besteld_m2,
    COUNT(DISTINCT v.inkooporder_id)::BIGINT AS orders_count,
    MAX(e.leverweek)                          AS eerstvolgende_leverweek,
    MAX(e.verwacht_datum)                     AS eerstvolgende_verwacht_datum,
    COALESCE(SUM(v.te_leveren_m) FILTER (
      WHERE e.verwacht_datum IS NOT NULL
        AND v.verwacht_datum = e.verwacht_datum
    ), 0)::NUMERIC AS eerstvolgende_m,
    COALESCE(SUM(
      CASE
        WHEN v.verwacht_datum IS NOT NULL
         AND e.verwacht_datum IS NOT NULL
         AND v.verwacht_datum = e.verwacht_datum
         AND COALESCE(k.standaard_breedte_cm, 0) > 0
        THEN v.te_leveren_m * k.standaard_breedte_cm / 100.0
        ELSE 0
      END
    ), 0)::NUMERIC AS eerstvolgende_m2
  FROM openstaande_inkooporder_regels v
  LEFT JOIN kwaliteiten k ON k.code = v.kwaliteit_code
  LEFT JOIN eerstvolg e
    ON e.kwaliteit_code = v.kwaliteit_code
   AND e.kleur_code     = v.kleur_code
  WHERE v.kwaliteit_code IS NOT NULL
    AND v.kleur_code IS NOT NULL
  GROUP BY v.kwaliteit_code, v.kleur_code;
$function$


CREATE OR REPLACE FUNCTION public.betaaltermijn_dagen(p_betaalconditie text)
 RETURNS integer
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- Standaard-formaat "{code} - {naam}": match op betaalcondities.code
    (SELECT bc.dagen
       FROM betaalcondities bc
      WHERE p_betaalconditie ~ '^\s*[^-]+\s*-'
        AND trim(split_part(p_betaalconditie, '-', 1)) = bc.code
        AND bc.dagen IS NOT NULL
      LIMIT 1),
    -- Vangnet: vrije tekst met "<n> dagen/tage/days" erin.
    -- LET OP: PostgreSQL kent \b niet als woordgrens (dat is backspace) -> \y.
    NULLIF((regexp_match(p_betaalconditie, '\y(\d+)\s*(?:dagen|tage|days|tag|day)\y', 'i'))[1], '')::INTEGER,
    -- Default conform mig 202-comment
    30
  );
$function$


CREATE OR REPLACE FUNCTION public.bevestig_concept_order(p_order_id bigint, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status order_status;
  v_regel  order_regels%ROWTYPE;
  v_aantal INTEGER;
  i        INTEGER;
BEGIN
  SELECT status INTO v_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % kan niet bevestigd worden: status is % (verwacht: Concept)',
      p_order_id, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'concept_bevestigd',
    p_status_na           := 'Klaar voor picken',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  FOR v_regel IN
    SELECT *
    FROM order_regels
    WHERE order_id = p_order_id
      AND COALESCE(is_maatwerk, false) = true
      AND maatwerk_lengte_cm  IS NOT NULL
      AND maatwerk_breedte_cm IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen WHERE order_regel_id = v_regel.id  -- FIX: was `id` (= snijplannen.id)
      )
  LOOP
    v_aantal := GREATEST(COALESCE(v_regel.orderaantal, 1), 1);
    FOR i IN 1..v_aantal LOOP
      INSERT INTO snijplannen (
        snijplan_nr, order_regel_id,
        lengte_cm, breedte_cm,
        status, opmerkingen,
        snijden_uit_standaardmaat
      )
      VALUES (
        volgend_nummer('SNIJ'),
        v_regel.id,
        v_regel.maatwerk_lengte_cm::INTEGER,
        v_regel.maatwerk_breedte_cm::INTEGER,
        'Wacht'::snijplan_status,
        CASE WHEN v_aantal > 1
             THEN 'Auto-aangemaakt bij bevestiging (' || i || '/' || v_aantal || ')'
             ELSE 'Auto-aangemaakt bij bevestiging'
        END,
        COALESCE(v_regel.snijden_uit_standaardmaat, false)
      );
    END LOOP;
  END LOOP;

  FOR v_regel IN
    SELECT * FROM order_regels WHERE order_id = p_order_id
  LOOP
    PERFORM herallocateer_orderregel_auto(v_regel.id);
  END LOOP;

  PERFORM herbereken_wacht_status(p_order_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.boek_inkooporder_ontvangst_rollen(p_regel_id bigint, p_rollen jsonb, p_medewerker text DEFAULT NULL::text)
 RETURNS TABLE(rol_id bigint, rolnummer text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_product RECORD;
  v_rol JSONB;
  v_lengte_cm INTEGER;
  v_breedte_cm INTEGER;
  v_oppervlak_m2 NUMERIC;
  v_rolnummer TEXT;
  v_nieuw_id BIGINT;
  v_totaal_geleverd_m2 NUMERIC := 0;
  v_open_regels INTEGER;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  IF v_regel.eenheid <> 'm' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rol-ontvangst is alleen voor eenheid ''m''. Gebruik boek_inkooporder_ontvangst_stuks voor vaste producten.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  IF v_regel.artikelnr IS NOT NULL THEN
    SELECT p.karpi_code, p.kwaliteit_code, p.kleur_code, p.zoeksleutel, p.omschrijving,
           p.verkoopprijs AS vvp_m2
      INTO v_product
    FROM producten p
    WHERE p.artikelnr = v_regel.artikelnr;
  END IF;

  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    v_rolnummer := NULLIF(TRIM(COALESCE(v_rol->>'rolnummer', '')), '');

    IF v_lengte_cm IS NULL OR v_lengte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige lengte_cm in rol: %', v_rol;
    END IF;
    IF v_breedte_cm IS NULL OR v_breedte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige breedte_cm in rol: %', v_rol;
    END IF;

    IF v_rolnummer IS NULL THEN
      LOOP
        v_rolnummer := volgend_nummer('R');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnummer);
      END LOOP;
    END IF;

    v_oppervlak_m2 := ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, inkooporder_regel_id, reststuk_datum, in_magazijn_sinds
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW(), CURRENT_DATE
    )
    RETURNING id INTO v_nieuw_id;

    INSERT INTO voorraad_mutaties (
      rol_id, type, lengte_cm, breedte_cm,
      referentie_id, referentie_type, notitie, aangemaakt_door
    )
    VALUES (
      v_nieuw_id, 'inkoop', v_lengte_cm, v_breedte_cm,
      p_regel_id, 'inkooporder_regel',
      'Ontvangst inkooporder ' || v_order.inkooporder_nr || ' regel ' || v_regel.regelnummer,
      p_medewerker
    );

    v_totaal_geleverd_m2 := v_totaal_geleverd_m2 + v_oppervlak_m2;
    rol_id := v_nieuw_id;
    rolnummer := v_rolnummer;
    RETURN NEXT;
  END LOOP;

  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + v_totaal_geleverd_m2,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + v_totaal_geleverd_m2), 0)
  WHERE id = p_regel_id;

  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.boek_inkooporder_ontvangst_stuks(p_regel_id bigint, p_aantal integer, p_medewerker text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_open_regels INTEGER;
BEGIN
  IF p_aantal IS NULL OR p_aantal <= 0 THEN
    RAISE EXCEPTION 'Aantal moet > 0 zijn';
  END IF;

  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  IF v_regel.eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Voorraad-ontvangst is alleen voor eenheid ''stuks''. Gebruik boek_inkooporder_ontvangst_rollen voor rollen.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  -- Voorraad ophogen op het product
  IF v_regel.artikelnr IS NOT NULL THEN
    UPDATE producten
    SET voorraad = COALESCE(voorraad, 0) + p_aantal
    WHERE artikelnr = v_regel.artikelnr;
  END IF;

  -- Regel bijwerken
  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + p_aantal,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + p_aantal), 0)
  WHERE id = p_regel_id;

  -- Mig 254: claim-consume gedelegeerd naar Reservering-Module
  PERFORM boek_io_ontvangst_claims(p_regel_id, p_aantal);

  -- IO-status update: Deels ontvangen / Ontvangen
  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.boek_io_ontvangst_claims(p_io_regel_id bigint, p_aantal_ontvangen integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_resterend INTEGER := p_aantal_ontvangen;
  v_claim RECORD;
  v_consume INTEGER;
  v_bestaande_voorraadclaim BIGINT;
BEGIN
  IF p_aantal_ontvangen IS NULL OR p_aantal_ontvangen <= 0 THEN
    RETURN;
  END IF;

  FOR v_claim IN
    SELECT id, order_regel_id, aantal
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
     ORDER BY claim_volgorde ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_resterend <= 0;
    v_consume := LEAST(v_claim.aantal, v_resterend);

    IF v_consume = v_claim.aantal THEN
      UPDATE order_reserveringen
         SET status = 'geleverd', geleverd_op = now(), updated_at = now()
       WHERE id = v_claim.id;
    ELSE
      UPDATE order_reserveringen
         SET aantal = aantal - v_consume, updated_at = now()
       WHERE id = v_claim.id;
    END IF;

    -- Maak/upgrade voorraad-claim voor dezelfde orderregel
    SELECT id INTO v_bestaande_voorraadclaim
      FROM order_reserveringen
     WHERE order_regel_id = v_claim.order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
     FOR UPDATE;

    IF v_bestaande_voorraadclaim IS NOT NULL THEN
      UPDATE order_reserveringen
         SET aantal = aantal + v_consume, updated_at = now()
       WHERE id = v_bestaande_voorraadclaim;
    ELSE
      INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
      VALUES (v_claim.order_regel_id, 'voorraad', v_consume);
    END IF;

    v_resterend := v_resterend - v_consume;

    -- Order-status van de bijbehorende order opnieuw waarderen.
    -- Blijft via de thin wrapper aanroepen (back-compat); na mig 255 callsite-
    -- refactor wordt dit drie expliciete PERFORMs.
    PERFORM herwaardeer_order_status(
      (SELECT order_id FROM order_regels WHERE id = v_claim.order_regel_id)
    );
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.boek_ontvangst(p_regel_id bigint, p_rollen jsonb, p_medewerker text DEFAULT NULL::text)
 RETURNS TABLE(rol_id bigint, rolnummer text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM boek_inkooporder_ontvangst_rollen(p_regel_id, p_rollen, p_medewerker);
END;
$function$


CREATE OR REPLACE FUNCTION public.boek_voorraad_ontvangst(p_regel_id bigint, p_aantal integer, p_medewerker text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM boek_inkooporder_ontvangst_stuks(p_regel_id, p_aantal, p_medewerker);
END;
$function$


CREATE OR REPLACE FUNCTION public.bug_meldingen_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $function$


CREATE OR REPLACE FUNCTION public.bundel_sleutel(p_debiteur_nr integer, p_adres_norm text, p_vervoerder text, p_jaar_week text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT 'D' || p_debiteur_nr::TEXT
      || '|V' || COALESCE(NULLIF(p_vervoerder, ''), 'GEEN')
      || '|W' || COALESCE(NULLIF(p_jaar_week, ''), 'GEEN')
      || '|A' || COALESCE(NULLIF(p_adres_norm, ''), '?');
$function$


CREATE OR REPLACE FUNCTION public.claim_factuur_queue_items(p_max_batch integer DEFAULT 10)
 RETURNS TABLE(id bigint, debiteur_nr integer, order_ids bigint[], type text, attempts integer, zending_id bigint, verzendweek text, factuur_id bigint, gefinaliseerd_op timestamp with time zone)
 LANGUAGE sql
AS $function$
  UPDATE factuur_queue q
     SET status = 'processing',
         processing_started_at = now()
   WHERE q.id IN (
     SELECT inner_q.id
       FROM factuur_queue inner_q
      WHERE inner_q.status = 'pending'
        AND (inner_q.beschikbaar_op IS NULL OR inner_q.beschikbaar_op <= now())
        AND (inner_q.factuur_id IS NOT NULL OR inner_q.zending_id IS NULL)
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.type, q.attempts,
            q.zending_id, q.verzendweek, q.factuur_id, q.gefinaliseerd_op;
$function$


CREATE OR REPLACE FUNCTION public.claim_volgende_hst_transportorder()
 RETURNS hst_transportorders
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row hst_transportorders;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM hst_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_volgende_rhenus_transportorder()
 RETURNS rhenus_transportorders
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row rhenus_transportorders;
BEGIN
  UPDATE rhenus_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM rhenus_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_volgende_transportorder(p_vervoerder_code text)
 RETURNS verzend_wachtrij
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row verzend_wachtrij;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM verzend_wachtrij
      WHERE status = 'Wachtrij' AND vervoerder_code = p_vervoerder_code
        AND (beschikbaar_op IS NULL OR beschikbaar_op <= now())
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_volgende_uitgaand()
 RETURNS edi_berichten
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row edi_berichten;
BEGIN
  UPDATE edi_berichten
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM edi_berichten
      WHERE richting = 'uit' AND status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_volgende_verhoek_transportorder()
 RETURNS verhoek_transportorders
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row verhoek_transportorders;
BEGIN
  UPDATE verhoek_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM verhoek_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.claim_wacht_op_inkoop(p_claims jsonb, p_regel_totalen jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_geclaimd INTEGER := 0;
BEGIN
  WITH input AS (
    SELECT (c->>'snijplan_id')::BIGINT AS snijplan_id,
           (c->>'inkooporder_regel_id')::BIGINT AS inkooporder_regel_id
      FROM jsonb_array_elements(COALESCE(p_claims, '[]'::jsonb)) c
  ),
  updated AS (
    UPDATE snijplannen sn
       SET status = 'Wacht op inkoop',
           rol_id = NULL,
           positie_x_cm = NULL,
           positie_y_cm = NULL,
           geroteerd = false,
           verwacht_inkooporder_regel_id = input.inkooporder_regel_id
      FROM input
     WHERE sn.id = input.snijplan_id
       AND sn.status IN ('Wacht', 'Gepland')
       AND sn.rol_id IS NULL
    RETURNING sn.id
  )
  SELECT COUNT(*)::INTEGER INTO v_geclaimd FROM updated;

  UPDATE inkooporder_regels ir
     SET snijplan_gebruikte_lengte_cm = (t->>'gebruikte_lengte_cm')::INTEGER
    FROM jsonb_array_elements(COALESCE(p_regel_totalen, '[]'::jsonb)) t
   WHERE ir.id = (t->>'inkooporder_regel_id')::BIGINT;

  RETURN v_geclaimd;
END;
$function$


CREATE OR REPLACE FUNCTION public.claims_voor_product(p_artikelnr text)
 RETURNS TABLE(claim_id bigint, bron text, aantal integer, inkooporder_nr text, verwacht_datum date, order_id bigint, order_nr text, order_status text, orderdatum date, klant_naam text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    r.id                AS claim_id,
    r.bron::TEXT        AS bron,
    r.aantal            AS aantal,
    io.inkooporder_nr   AS inkooporder_nr,
    io.verwacht_datum   AS verwacht_datum,
    o.id                AS order_id,
    o.order_nr          AS order_nr,
    o.status::TEXT      AS order_status,
    o.orderdatum        AS orderdatum,
    d.naam              AS klant_naam
  FROM order_reserveringen r
  JOIN order_regels reg     ON reg.id = r.order_regel_id
  JOIN orders o             ON o.id = reg.order_id
  LEFT JOIN debiteuren d    ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN inkooporder_regels ior ON ior.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ior.inkooporder_id
  WHERE r.status = 'actief'
    AND o.status NOT IN ('Verzonden', 'Geannuleerd')
    AND (reg.artikelnr = p_artikelnr OR reg.fysiek_artikelnr = p_artikelnr)
  ORDER BY o.orderdatum NULLS LAST, o.order_nr;
$function$


CREATE OR REPLACE FUNCTION public.combi_levering_orderregel_subtotaal(p_order_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    FROM order_regels
   WHERE order_id = p_order_id
     AND NOT is_admin_pseudo(artikelnr)
     AND COALESCE(orderaantal, 0) > 0;
$function$


CREATE OR REPLACE FUNCTION public.compose_colli_omschrijving(p_maatwerk boolean, p_kwaliteit_code text, p_kwaliteit_naam text, p_mw_lengte_cm integer, p_mw_breedte_cm integer, p_afwerking_code text, p_product_naam text, p_prod_lengte_cm integer, p_prod_breedte_cm integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_dim TEXT;
BEGIN
  IF COALESCE(p_maatwerk, FALSE) THEN
    -- Maatwerk-formaat
    v_dim := COALESCE(lpad(p_mw_breedte_cm::TEXT, 3, '0') || 'x' || lpad(p_mw_lengte_cm::TEXT, 3, '0'), '');
    RETURN trim(BOTH ' ' FROM
      'MAATW. ' ||
      COALESCE(upper(p_kwaliteit_naam), '') || ' ' ||
      v_dim ||
      CASE WHEN v_dim <> '' THEN ' cm' ELSE '' END ||
      CASE WHEN p_kwaliteit_code IS NOT NULL THEN ', ' || p_kwaliteit_code ELSE '' END ||
      CASE WHEN p_afwerking_code IS NOT NULL THEN ' Band:' || p_afwerking_code ELSE '' END
    );
  ELSE
    -- Vaste maat
    v_dim := CASE
      WHEN p_prod_lengte_cm IS NOT NULL AND p_prod_breedte_cm IS NOT NULL
        THEN lpad(p_prod_breedte_cm::TEXT, 3, '0') || 'x' || lpad(p_prod_lengte_cm::TEXT, 3, '0') || ' cm'
      ELSE ''
    END;
    RETURN trim(BOTH ' ' FROM
      COALESCE(p_product_naam, '') ||
      CASE WHEN v_dim <> '' THEN ' ' || v_dim ELSE '' END
    );
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.compose_klant_omschrijving(p_omschrijving text, p_omschrijving_2 text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_o1     TEXT := btrim(COALESCE(p_omschrijving, ''));
  v_o2     TEXT := btrim(COALESCE(p_omschrijving_2, ''));
  v_dubbel BOOLEAN;
BEGIN
  v_dubbel := v_o2 <> '' AND POSITION(lower(v_o2) IN lower(v_o1)) > 0;
  RETURN NULLIF(btrim(
    v_o1 || CASE WHEN v_o2 <> '' AND NOT v_dubbel THEN ' ' || v_o2 ELSE '' END
  ), '');
END;
$function$


CREATE OR REPLACE FUNCTION public.confectie_bewerking_voor_afwerking(p_afwerking text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN CASE p_afwerking
    WHEN 'B' THEN 'breedband'
    WHEN 'SB' THEN 'smalband'
    WHEN 'FE' THEN 'feston'
    WHEN 'SF' THEN 'smalfeston'
    WHEN 'LO' THEN 'locken'
    WHEN 'VO' THEN 'volume afwerking'
    WHEN 'ON' THEN 'stickeren'
    WHEN 'ZO' THEN 'stickeren'
    ELSE 'stickeren'
  END;
END;
$function$


CREATE OR REPLACE FUNCTION public.confectie_buffer_minuten()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    (SELECT (waarde ->> 'confectie_buffer_minuten')::integer
       FROM app_config
      WHERE sleutel = 'productie_planning'),
    0
  );
$function$


CREATE OR REPLACE FUNCTION public.confectie_status_counts()
 RETURNS TABLE(status text, aantal bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    co.status::TEXT,
    COUNT(*) AS aantal
  FROM confectie_overzicht co
  GROUP BY co.status
  HAVING COUNT(*) > 0
  ORDER BY co.status;
$function$


CREATE OR REPLACE FUNCTION public.converteer_regel_naar_maatwerk(p_order_regel_id bigint, p_lengte_cm integer, p_breedte_cm integer DEFAULT NULL::integer, p_vorm text DEFAULT 'rechthoek'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id      BIGINT;
  v_order_status  order_status;
  v_is_maatwerk   BOOLEAN;
  v_te_leveren    INTEGER;
  v_artikelnr     TEXT;
  v_kwaliteit     TEXT;
  v_kleur         TEXT;
BEGIN
  SELECT order_id, is_maatwerk, te_leveren, artikelnr
    INTO v_order_id, v_is_maatwerk, v_te_leveren, v_artikelnr
  FROM order_regels
  WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;
  IF COALESCE(v_is_maatwerk, false) THEN
    RAISE EXCEPTION 'Orderregel % is al maatwerk', p_order_regel_id;
  END IF;
  IF COALESCE(v_te_leveren, 0) <= 0 THEN
    RAISE EXCEPTION 'Orderregel % heeft niets meer te leveren', p_order_regel_id;
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0 THEN
    RAISE EXCEPTION 'Geen geldige lengte opgegeven voor orderregel %', p_order_regel_id;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Order % staat al in eindstatus % — kan orderregel niet meer omzetten', v_order_id, v_order_status;
  END IF;

  SELECT kwaliteit_code, kleur_code INTO v_kwaliteit, v_kleur
  FROM producten WHERE artikelnr = v_artikelnr;

  -- Eén UPDATE — trg_auto_sync_snijplan_maten (snijplan-aanmaak) en
  -- trg_orderregel_herallocateer (claim-release + status-herwaardering)
  -- triggeren hierop automatisch, geen expliciete PERFORM nodig.
  UPDATE order_regels
  SET is_maatwerk          = TRUE,
      maatwerk_lengte_cm   = p_lengte_cm,
      maatwerk_breedte_cm  = COALESCE(p_breedte_cm, p_lengte_cm),
      maatwerk_vorm        = p_vorm,
      maatwerk_kwaliteit_code = v_kwaliteit,
      maatwerk_kleur_code     = v_kleur
  WHERE id = p_order_regel_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.corrigeer_voorraad_handmatig(p_artikelnr text, p_nieuwe_voorraad integer, p_reden text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_oud INTEGER;
BEGIN
  SELECT voorraad INTO v_oud FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % niet gevonden', p_artikelnr;
  END IF;

  IF p_nieuwe_voorraad = v_oud THEN
    RETURN;
  END IF;

  UPDATE producten SET voorraad = p_nieuwe_voorraad WHERE artikelnr = p_artikelnr;

  INSERT INTO producten_voorraad_correcties (artikelnr, van, naar, delta, reden, aangemaakt_door)
  VALUES (p_artikelnr, v_oud, p_nieuwe_voorraad, p_nieuwe_voorraad - v_oud, p_reden, huidige_actor_email());
END;
$function$


CREATE OR REPLACE FUNCTION public.create_edi_order(p_inkomend_bericht_id bigint, p_payload_parsed jsonb, p_debiteur_nr integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_header           JSONB := p_payload_parsed->'header';
  v_regels           JSONB := p_payload_parsed->'regels';
  v_ordernr          TEXT;
  v_existing_id      BIGINT;
  v_order_id         BIGINT;
  v_klantref         TEXT  := v_header->>'ordernummer';
  v_leverdatum       DATE  := NULLIF(v_header->>'leverdatum', '')::DATE;
  v_orderdatum       DATE  := COALESCE(NULLIF(v_header->>'orderdatum','')::DATE, CURRENT_DATE);
  v_gln_gefact       TEXT  := v_header->>'gln_gefactureerd';
  v_gln_best         TEXT  := v_header->>'gln_besteller';
  v_gln_afl          TEXT  := v_header->>'gln_afleveradres';
  v_deb_naam         TEXT;
  v_deb_adres        TEXT;
  v_deb_postcode     TEXT;
  v_deb_plaats       TEXT;
  v_deb_land         TEXT;
  v_fact_naam        TEXT;
  v_fact_adres       TEXT;
  v_fact_postcode    TEXT;
  v_fact_plaats      TEXT;
  v_prijslijst_nr    TEXT;
  v_korting_pct      NUMERIC := 0;
  v_afl_naam         TEXT;
  v_afl_adres        TEXT;
  v_afl_postcode     TEXT;
  v_afl_plaats       TEXT;
  v_afl_land         TEXT;
  v_email_factuur    TEXT;
  v_email_overig     TEXT;
  v_fact_email       TEXT;
  v_afl_email        TEXT;
  v_transactie_id    TEXT;
  v_is_test          BOOLEAN;
  r                  JSONB;
  v_regelnr          INTEGER := 0;
  v_match            RECORD;
  v_aantal           INTEGER;
  v_omschrijving     TEXT;
  v_prijs            NUMERIC;
  v_bedrag           NUMERIC;
BEGIN
  SELECT transactie_id, is_test
    INTO v_transactie_id, v_is_test
    FROM edi_berichten
   WHERE id = p_inkomend_bericht_id;

  IF v_transactie_id IS NULL THEN
    RAISE EXCEPTION 'edi_berichten id=% niet gevonden of geen transactie_id', p_inkomend_bericht_id;
  END IF;

  SELECT id INTO v_existing_id
    FROM orders
   WHERE bron_systeem = 'edi'
     AND bron_order_id = v_transactie_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE edi_berichten SET order_id = v_existing_id WHERE id = p_inkomend_bericht_id;
    RETURN v_existing_id;
  END IF;

  IF p_debiteur_nr IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           COALESCE(fact_naam, naam),
           COALESCE(fact_adres, adres),
           COALESCE(fact_postcode, postcode),
           COALESCE(fact_plaats, plaats),
           prijslijst_nr,
           COALESCE(korting_pct, 0),
           NULLIF(TRIM(COALESCE(email_factuur, '')), ''),
           NULLIF(TRIM(COALESCE(email_overig,  '')), '')
      INTO v_deb_naam, v_deb_adres, v_deb_postcode, v_deb_plaats, v_deb_land,
           v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats,
           v_prijslijst_nr, v_korting_pct,
           v_email_factuur, v_email_overig
      FROM debiteuren
     WHERE debiteur_nr = p_debiteur_nr;
  END IF;

  v_fact_email := COALESCE(v_email_factuur, v_email_overig);

  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           NULLIF(TRIM(COALESCE(email, '')), '')
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land,
           v_afl_email
      FROM afleveradressen
     WHERE debiteur_nr = p_debiteur_nr
       AND gln_afleveradres IN (v_gln_afl, v_gln_afl || '.0')
     LIMIT 1;
  END IF;

  IF v_afl_naam IS NULL THEN
    v_afl_naam := v_deb_naam;
    v_afl_adres := v_deb_adres;
    v_afl_postcode := v_deb_postcode;
    v_afl_plaats := v_deb_plaats;
    v_afl_land := v_deb_land;
  END IF;

  v_afl_email := COALESCE(v_afl_email, v_email_overig);

  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr, debiteur_nr, klant_referentie,
    orderdatum, afleverdatum, edi_gewenste_afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email,
    factuuradres_gln, besteller_gln, afleveradres_gln,
    bron_systeem, bron_order_id, status
  ) VALUES (
    v_ordernr, p_debiteur_nr, v_klantref,
    v_orderdatum, v_leverdatum, v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    v_fact_email,
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
    v_afl_email,
    v_gln_gefact, v_gln_best, v_gln_afl,
    'edi', v_transactie_id, 'Concept'  -- mig 542: EDI-orders beginnen in Concept
  )
  RETURNING id INTO v_order_id;

  FOR r IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    v_aantal := COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1);
    v_prijs := NULL;

    SELECT * INTO v_match
      FROM match_edi_artikel(r->>'gtin', r->>'artikelcode');

    IF v_match.artikelnr IS NULL THEN
      v_omschrijving := '[EDI ongematcht: ' ||
        COALESCE(NULLIF(r->>'artikelcode', ''), r->>'gtin', '?') || ']';
    ELSE
      v_omschrijving := COALESCE(v_match.omschrijving, v_match.artikelnr);

      IF v_prijslijst_nr IS NOT NULL THEN
        SELECT pr.prijs
          INTO v_prijs
          FROM prijslijst_regels pr
         WHERE pr.prijslijst_nr = v_prijslijst_nr
           AND pr.artikelnr = v_match.artikelnr
         LIMIT 1;
      END IF;

      v_prijs := COALESCE(v_prijs, v_match.verkoopprijs);
    END IF;

    v_bedrag := ROUND(COALESCE(v_prijs, 0) * v_aantal * (1 - COALESCE(v_korting_pct, 0) / 100), 2);

    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag
    ) VALUES (
      v_order_id, v_regelnr,
      v_match.artikelnr,
      v_omschrijving,
      v_aantal, v_aantal,
      v_prijs,
      COALESCE(v_korting_pct, 0),
      v_bedrag
    );
  END LOOP;

  UPDATE edi_berichten SET order_id = v_order_id WHERE id = p_inkomend_bericht_id;

  RETURN v_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.create_or_get_magazijn_locatie(p_code text, p_omschrijving text DEFAULT NULL::text, p_type text DEFAULT 'rek'::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code TEXT;
  v_id BIGINT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Magazijnlocatie-code mag niet leeg zijn';
  END IF;

  SELECT id INTO v_id FROM magazijn_locaties WHERE code = v_code;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO magazijn_locaties (code, omschrijving, type, actief)
  VALUES (v_code, p_omschrijving, p_type, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.create_order_with_lines(p_order jsonb, p_regels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_order_nr      TEXT;
    v_order_id      BIGINT;
    v_debiteur_nr   INTEGER;
    v_prijslijst_nr TEXT;
BEGIN
    v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

    SELECT prijslijst_nr INTO v_prijslijst_nr
      FROM debiteuren
     WHERE debiteur_nr = v_debiteur_nr;

    IF v_prijslijst_nr IS NULL THEN
      RAISE EXCEPTION
        'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
        v_debiteur_nr
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        fact_email,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        afl_email,
        lever_modus,
        afhalen,
        combi_levering_override,
        lever_type,
        status
    ) VALUES (
        v_order_nr,
        v_debiteur_nr,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        NULLIF(p_order->>'fact_email', ''),
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'afl_email', ''),
        NULLIF(p_order->>'lever_modus', ''),
        COALESCE((p_order->>'afhalen')::BOOLEAN, FALSE),
        COALESCE((p_order->>'combi_levering_override')::BOOLEAN, FALSE),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Concept'  -- mig 542: alle handmatige orders beginnen in Concept
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie,
        is_vrije_regel
    )
    SELECT
        v_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', ''),
        COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$function$


CREATE OR REPLACE FUNCTION public.create_webshop_order(p_header jsonb, p_regels jsonb, p_initieel_status order_status DEFAULT 'Concept'::order_status)
 RETURNS TABLE(order_nr text, was_existing boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_oid     BIGINT;
  v_onr     TEXT;
  v_regel   JSONB;
  v_regelnr INT := 0;
  v_env_fallback  BOOLEAN := COALESCE(NULLIF(p_header->>'debiteur_match_bron', ''), '') = 'env_fallback';
  v_email_factuur TEXT;
  v_email_overig  TEXT;
  v_fact_email    TEXT := NULLIF(p_header->>'fact_email', '');
  v_afl_email     TEXT := NULLIF(p_header->>'afl_email',  '');
BEGIN
  SELECT o.id, o.order_nr INTO v_oid, v_onr
  FROM orders o
  WHERE o.bron_order_id = p_header->>'bron_order_id'
    AND o.bron_systeem  = p_header->>'bron_systeem'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_onr, TRUE;
    RETURN;
  END IF;

  IF (v_fact_email IS NULL OR v_afl_email IS NULL)
     AND NOT v_env_fallback
     AND NULLIF(p_header->>'debiteur_nr', '') IS NOT NULL THEN
    SELECT NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
           NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
      INTO v_email_factuur, v_email_overig
      FROM debiteuren d
     WHERE d.debiteur_nr = (p_header->>'debiteur_nr')::INTEGER;

    v_fact_email := COALESCE(v_fact_email, v_email_factuur, v_email_overig);
    v_afl_email  := COALESCE(v_afl_email,  v_email_overig);
  END IF;

  v_onr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr, klant_referentie, orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email, afl_telefoon, opmerkingen,
    bron_systeem, bron_shop, bron_order_id,
    debiteur_zeker, debiteur_match_bron,
    status
  ) VALUES (
    v_onr,
    (p_header->>'debiteur_nr')::INTEGER,
    p_header->>'klant_referentie',
    NULLIF(p_header->>'orderdatum',   '')::DATE,
    NULLIF(p_header->>'afleverdatum', '')::DATE,
    p_header->>'fact_naam',  p_header->>'fact_adres',  p_header->>'fact_postcode',  p_header->>'fact_plaats',  COALESCE(NULLIF(p_header->>'fact_land', ''), 'NL'),
    v_fact_email,
    p_header->>'afl_naam',   p_header->>'afl_naam_2',  p_header->>'afl_adres',  p_header->>'afl_postcode',  p_header->>'afl_plaats',  p_header->>'afl_land',
    v_afl_email,
    NULLIF(p_header->>'afl_telefoon', ''),
    NULLIF(p_header->>'opmerkingen',  ''),
    p_header->>'bron_systeem', p_header->>'bron_shop', p_header->>'bron_order_id',
    COALESCE((p_header->>'debiteur_zeker')::BOOLEAN, TRUE),
    NULLIF(p_header->>'debiteur_match_bron', ''),
    p_initieel_status
  )
  RETURNING id INTO v_oid;

  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels) LOOP
    v_regelnr := v_regelnr + 1;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr,
      omschrijving, omschrijving_2,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag, gewicht_kg,
      is_maatwerk, maatwerk_kwaliteit_code, maatwerk_kleur_code,
      maatwerk_vorm,
      maatwerk_lengte_cm, maatwerk_breedte_cm
    ) VALUES (
      v_oid, v_regelnr,
      NULLIF(v_regel->>'artikelnr', ''),
      v_regel->>'omschrijving',
      NULLIF(v_regel->>'omschrijving_2', ''),
      (v_regel->>'orderaantal')::INTEGER,
      (v_regel->>'te_leveren')::INTEGER,
      NULLIF(v_regel->>'prijs',      '')::NUMERIC,
      COALESCE(NULLIF(v_regel->>'korting_pct', '')::NUMERIC, 0),
      NULLIF(v_regel->>'bedrag',     '')::NUMERIC,
      NULLIF(v_regel->>'gewicht_kg', '')::NUMERIC,
      COALESCE((v_regel->>'is_maatwerk')::BOOLEAN, FALSE),
      NULLIF(v_regel->>'maatwerk_kwaliteit_code', ''),
      NULLIF(v_regel->>'maatwerk_kleur_code', ''),
      (SELECT mv.code FROM maatwerk_vormen mv
        WHERE mv.code = NULLIF(v_regel->>'maatwerk_vorm', '')),
      NULLIF(v_regel->>'maatwerk_lengte_cm', '')::NUMERIC,
      NULLIF(v_regel->>'maatwerk_breedte_cm', '')::NUMERIC
    );
  END LOOP;

  -- Voor niet-Concept orders: meteen reserveringen/status herberekenen.
  -- Bij Concept (nu de default): allocator is geblokkeerd via mig 540-guards;
  -- bevestig_concept_order (mig 541) doet de allocatie na bevestiging.
  IF p_initieel_status <> 'Concept' THEN
    PERFORM herbereken_wacht_status(v_oid);
  END IF;

  RETURN QUERY SELECT v_onr, FALSE;
END;
$function$


CREATE OR REPLACE FUNCTION public.dag_order_snij_buffer_werkdagen()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    (SELECT (waarde ->> 'dag_order_snij_buffer_werkdagen')::integer
       FROM app_config
      WHERE sleutel = 'productie_planning'),
    2
  );
$function$


CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_artikelnr TEXT;
    v_status TEXT;
BEGIN
    -- Check dat de order bestaat en niet verzonden is
    SELECT status INTO v_status
    FROM orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
    END IF;

    IF v_status IN ('Verzonden') THEN
        RAISE EXCEPTION 'Order met status "%" kan niet verwijderd worden', v_status;
    END IF;

    -- Verzamel betrokken artikelnrs VOOR het verwijderen
    -- Inclusief fysiek_artikelnr voor substitutie-producten
    CREATE TEMP TABLE _tmp_affected_artikels ON COMMIT DROP AS
        SELECT DISTINCT COALESCE(fysiek_artikelnr, artikelnr) AS artikelnr
        FROM order_regels
        WHERE order_id = p_order_id
          AND artikelnr IS NOT NULL
        UNION
        SELECT DISTINCT artikelnr
        FROM order_regels
        WHERE order_id = p_order_id
          AND fysiek_artikelnr IS NOT NULL
          AND fysiek_artikelnr IS DISTINCT FROM artikelnr;

    -- Verwijder orderregels
    DELETE FROM order_regels WHERE order_id = p_order_id;

    -- Verwijder de order
    DELETE FROM orders WHERE id = p_order_id;

    -- Herbereken reservering voor alle betrokken producten
    FOR v_artikelnr IN SELECT artikelnr FROM _tmp_affected_artikels
    LOOP
        PERFORM herbereken_product_reservering(v_artikelnr);
    END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.derive_wacht_status(p_huidig order_status, p_heeft_io_claim boolean, p_heeft_tekort boolean, p_heeft_maatwerk boolean, p_wacht_op_combi_levering boolean DEFAULT false)
 RETURNS order_status
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases + concept: door commands beheerd → no-op.
    WHEN p_huidig IN (
      'Concept',
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
    ) THEN NULL
    -- 2) Inkoop-claim bestaat al → wacht op de BINNENKOMST (mig 470)
    WHEN p_heeft_io_claim            THEN 'Wacht op voorraad'::order_status
    -- 3) Vaste-maten-tekort zonder IO-claim → er moet nog een inkooporder komen (mig 470)
    WHEN p_heeft_tekort              THEN 'Wacht op inkoop'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk            THEN 'Wacht op maatwerk'::order_status
    -- 5) Alle stock-/productie-gates open, maar klant wacht op combi-levering (mig 558/ADR-0040)
    WHEN p_wacht_op_combi_levering   THEN 'Wacht op combi-levering'::order_status
    -- 6) Wacht-staat (of legacy 'Nieuw') zonder open blokkades → pickbaar
    WHEN p_huidig IN (
      'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk',
      'Wacht op combi-levering', 'Nieuw'
    )                                THEN 'Klaar voor picken'::order_status
    -- 7) Anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$function$


CREATE OR REPLACE FUNCTION public.effectief_btw_pct(p_verlegd boolean, p_btw_percentage numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN COALESCE(p_verlegd, FALSE) THEN 0::NUMERIC(5,2)
              ELSE COALESCE(p_btw_percentage, 21.00) END;
$function$


CREATE OR REPLACE FUNCTION public.effectieve_vervoerder_per_orderregel(p_order_id bigint)
 RETURNS TABLE(orderregel_id bigint, override_code text, evaluator_code text, evaluator_service text, effectief_code text, effectief_service text, bron text, is_locked boolean, uitleg jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_afhalen          BOOLEAN;
  v_regel            RECORD;
  v_attr             RECORD;
  v_match_regel      RECORD;
  v_eval_uitleg      JSONB;
  v_eval_code        TEXT;
  v_eval_service     TEXT;
  v_is_locked        BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  SELECT o.afhalen
    INTO v_afhalen
    FROM orders o WHERE o.id = p_order_id;

  -- Afhalen-orders: geen vervoerder, ongeacht override of evaluator.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY
    SELECT
      ore.id,
      ore.vervoerder_code,
      NULL::TEXT, NULL::TEXT,
      NULL::TEXT, NULL::TEXT,
      'afhalen'::TEXT,
      EXISTS (SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = ore.id),
      jsonb_build_object('reden', 'afhalen')
    FROM order_regels ore
    WHERE ore.order_id = p_order_id
      AND COALESCE(ore.orderaantal, 0) > 0
      AND COALESCE(ore.artikelnr, '') <> 'VERZEND';
    RETURN;
  END IF;

  FOR v_regel IN
    SELECT id, vervoerder_code
      FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    -- Lock-status: regel zit al in een zending (RESTRICT-trigger blokkeert update).
    SELECT EXISTS (
      SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = v_regel.id
    ) INTO v_is_locked;

    SELECT * INTO v_attr
      FROM evalueer_orderregel_attributes(v_regel.id);

    v_eval_code := NULL;
    v_eval_service := NULL;
    v_eval_uitleg := jsonb_build_object(
      'strategie',         'regels_v2_per_orderregel',
      'orderregel_id',     v_regel.id,
      'land',              v_attr.afl_land,
      'kleinste_zijde_cm', v_attr.kleinste_zijde_cm,
      'totaal_gewicht_kg', v_attr.totaal_gewicht_kg,
      'debiteur_nr',       v_attr.debiteur_nr,
      'inkoopgroep',       v_attr.inkoopgroep_code
    );

    FOR v_match_regel IN
      SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie,
             vsr.service_code, vsr.notitie
        FROM vervoerder_selectie_regels vsr
        JOIN vervoerders v ON v.code = vsr.vervoerder_code
       WHERE vsr.actief = TRUE
         AND v.actief    = TRUE
       ORDER BY vsr.prio ASC, vsr.id ASC
    LOOP
      IF matcht_regel(
           v_match_regel.conditie,
           v_attr.afl_land,
           v_attr.kleinste_zijde_cm,
           v_attr.totaal_gewicht_kg,
           v_attr.debiteur_nr,
           v_attr.inkoopgroep_code
         )
      THEN
        v_eval_code := v_match_regel.vervoerder_code;
        v_eval_service := v_match_regel.service_code;
        v_eval_uitleg := v_eval_uitleg || jsonb_build_object(
          'match_regel_id', v_match_regel.id,
          'match_prio',     v_match_regel.prio,
          'match_conditie', v_match_regel.conditie,
          'match_notitie',  v_match_regel.notitie
        );
        EXIT;
      END IF;
    END LOOP;

    IF v_eval_code IS NULL THEN
      v_eval_uitleg := v_eval_uitleg || jsonb_build_object('reden', 'geen_matchende_regel');
    END IF;

    -- Effectieve keuze + bron-bepaling — klant-fallback-tak is verwijderd (ADR-0008).
    -- Ladder: override → regel-evaluator → geen.
    IF v_regel.vervoerder_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_regel.vervoerder_code, NULL::TEXT,
        'override'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'override');
    ELSIF v_eval_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_eval_code, v_eval_service,
        'regel'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'regel');
    ELSE
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        NULL::TEXT, NULL::TEXT,
        'geen'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'geen');
    END IF;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.effectieve_vervoerder_voor_orders(p_order_ids bigint[])
 RETURNS TABLE(order_id bigint, orderregel_id bigint, override_code text, evaluator_code text, evaluator_service text, effectief_code text, effectief_service text, bron text, is_locked boolean, uitleg jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    ids.oid AS order_id,
    r.orderregel_id,
    r.override_code,
    r.evaluator_code,
    r.evaluator_service,
    r.effectief_code,
    r.effectief_service,
    r.bron,
    r.is_locked,
    r.uitleg
  FROM (
    SELECT DISTINCT u AS oid
      FROM unnest(COALESCE(p_order_ids, ARRAY[]::BIGINT[])) AS u
     WHERE EXISTS (SELECT 1 FROM orders o WHERE o.id = u)
  ) ids
  CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(ids.oid) AS r;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_edi_uitgaand(p_berichttype text, p_debiteur_nr integer, p_bron_tabel text, p_bron_id bigint, p_payload_parsed jsonb, p_order_id bigint DEFAULT NULL::bigint, p_factuur_id bigint DEFAULT NULL::bigint, p_zending_id bigint DEFAULT NULL::bigint, p_is_test boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO edi_berichten (
    richting, berichttype, status,
    debiteur_nr, bron_tabel, bron_id,
    order_id, factuur_id, zending_id,
    payload_parsed, is_test
  ) VALUES (
    'uit', p_berichttype, 'Wachtrij',
    p_debiteur_nr, p_bron_tabel, p_bron_id,
    p_order_id, p_factuur_id, p_zending_id,
    p_payload_parsed, p_is_test
  )
  ON CONFLICT (berichttype, bron_tabel, bron_id) WHERE richting = 'uit' AND status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_factuur_bij_verzonden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_voorkeur factuurvoorkeur;
BEGIN
  -- Alleen reageren op transitie NAAR 'Verzonden'
  IF NEW.status <> 'Verzonden' OR OLD.status = 'Verzonden' THEN
    RETURN NEW;
  END IF;

  SELECT factuurvoorkeur INTO v_voorkeur
    FROM debiteuren WHERE debiteur_nr = NEW.debiteur_nr;

  -- 'wekelijks'-klanten worden door een cron-job opgepakt, niet hier.
  IF v_voorkeur = 'per_zending' THEN
    INSERT INTO factuur_queue (debiteur_nr, order_ids, type)
    VALUES (NEW.debiteur_nr, ARRAY[NEW.id], 'per_zending');
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_factuur_voor_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_voorkeur       factuurvoorkeur;
  v_debiteur_nr    INTEGER;
  v_vertraging_min INTEGER;
BEGIN
  -- Mig 474: ook op een voltooide deelzending (event 'deels_verzonden' →
  -- status 'Deels verzonden'), niet alleen op de laatste zending van de order.
  IF NOT (
    (NEW.event_type = 'pickronde_voltooid' AND NEW.status_na = 'Verzonden') OR
    (NEW.event_type = 'deels_verzonden'    AND NEW.status_na = 'Deels verzonden')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  -- Wekelijkse klanten enqueueren via cron, niet hier. NULL = per_zending-default.
  IF v_voorkeur IS NOT NULL AND v_voorkeur <> 'per_zending' THEN
    RETURN NEW;
  END IF;

  -- Verzend-vertraging uit config (default 120 min = 2 uur). Geen rij of geen
  -- veld → COALESCE valt terug op 120.
  SELECT (ac.waarde->>'vertraging_minuten')::int
    INTO v_vertraging_min
    FROM app_config ac
   WHERE ac.sleutel = 'facturatie';
  v_vertraging_min := COALESCE(v_vertraging_min, 120);

  -- Per zending waarin deze order zit: één queue-rij, beschikbaar over
  -- v_vertraging_min minuten. ON CONFLICT dedupliceert het herhaald vuren van
  -- de trigger voor de zusterorders van dezelfde bundel-zending (én voorkomt
  -- nu ook een dubbele rij voor een deelzending die al eerder ingequeued is).
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, zending_id, bron_event_id, beschikbaar_op)
  SELECT
    v_debiteur_nr,
    (SELECT array_agg(zo2.order_id ORDER BY zo2.order_id)
       FROM zending_orders zo2
      WHERE zo2.zending_id = zo.zending_id),
    'per_zending',
    zo.zending_id,
    NEW.id,
    now() + make_interval(mins => v_vertraging_min)
  FROM zending_orders zo
  WHERE zo.order_id = NEW.order_id
  ON CONFLICT (zending_id) WHERE zending_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_hst_transportorder(p_zending_id bigint, p_debiteur_nr integer, p_is_test boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO hst_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_rhenus_transportorder(p_zending_id bigint, p_debiteur_nr integer, p_is_test boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO rhenus_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_transportorder(p_zending_id bigint, p_debiteur_nr integer, p_vervoerder_code text, p_is_test boolean DEFAULT false, p_beschikbaar_op timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO verzend_wachtrij
      (zending_id, debiteur_nr, vervoerder_code, status, is_test, beschikbaar_op)
       VALUES (p_zending_id, p_debiteur_nr, p_vervoerder_code, 'Wachtrij', p_is_test, p_beschikbaar_op)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout','Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_verhoek_transportorder(p_zending_id bigint, p_debiteur_nr integer, p_is_test boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO verhoek_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_wekelijkse_verzamelfacturen()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_doel_week TEXT := verzendweek_voor_datum((CURRENT_DATE - INTERVAL '7 days')::DATE);
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, verzendweek)
  SELECT
    o.debiteur_nr,
    array_agg(o.id ORDER BY o.id),
    'wekelijks',
    v_doel_week
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE d.factuurvoorkeur = 'wekelijks'
    AND o.status = 'Verzonden'
    -- mig 534: week op basis van daadwerkelijke verzenddatum (gereed_op).
    AND (
      SELECT verzendweek_voor_datum(
               COALESCE(MAX(z.gereed_op)::date, MAX(z.verzenddatum))
             )
        FROM zending_orders zo
        JOIN zendingen z ON z.id = zo.zending_id
       WHERE zo.order_id = o.id
    ) = v_doel_week
    AND NOT EXISTS (
      SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
    )
    -- Bescherm tegen dubbele cron-runs binnen dezelfde week.
    AND NOT EXISTS (
      SELECT 1 FROM factuur_queue fq
       WHERE fq.debiteur_nr = o.debiteur_nr
         AND fq.type = 'wekelijks'
         AND fq.verzendweek = v_doel_week
         AND fq.status IN ('pending', 'processing', 'done')
    )
  GROUP BY o.debiteur_nr
  HAVING COUNT(*) > 0;
END;
$function$


CREATE OR REPLACE FUNCTION public.enqueue_zending_naar_vervoerder(p_zending_id bigint, p_handmatig boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_batch_tijd      TIME;
  v_beschikbaar     TIMESTAMPTZ;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, batch_cutoff_tijd INTO v_actief, v_type, v_batch_tijd
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- Dagbatch (mig 484): een vervoerder met batch_cutoff_tijd gaat wél meteen in
  -- de wachtrij, maar pas claimbaar op de eerstvolgende werkdag-cutoff. NULL =
  -- direct (HST/Verhoek). De mig-420-hold-guard is hiermee overbodig en weg.
  v_beschikbaar := volgende_batch_moment(v_batch_tijd);

  -- SWITCH-POINT (ADR-0038): api/sftp via één generieke enqueue, carrier-blind.
  CASE v_type
    WHEN 'api', 'sftp' THEN
      PERFORM enqueue_transportorder(p_zending_id, v_debiteur_nr, v_vervoerder_code, v_is_test, v_beschikbaar);
      RETURN 'enqueued_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    -- Eigen vervoer (mig 424/429): colli klaarzetten + zending synchroon naar
    -- 'Afgeleverd' (geen carrier-callback). ONGEWIJZIGD overgenomen uit mig 429 —
    -- deze CREATE OR REPLACE moet die fix behouden (drift-valkuil).
    WHEN 'eigen' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      UPDATE zendingen
         SET status = 'Afgeleverd'::zending_status
       WHERE id = p_zending_id
         AND status = 'Klaar voor verzending';
      RETURN 'eigen_afgeleverd';

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$function$


CREATE OR REPLACE FUNCTION public.evalueer_orderregel_attributes(p_orderregel_id bigint)
 RETURNS TABLE(afl_land text, kleinste_zijde_cm integer, totaal_gewicht_kg numeric, debiteur_nr integer, inkoopgroep_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    o.afl_land,
    LEAST(
      COALESCE(ore.maatwerk_lengte_cm,  p.lengte_cm),
      COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
    )::INTEGER AS kleinste_zijde_cm,
    -- Mig 387: NULLIF(0) — een 0-gewicht-cache mag de ladder niet
    -- kortsluiten (34 orderregels stonden op exact 0).
    (COALESCE(NULLIF(ore.gewicht_kg, 0), NULLIF(p.gewicht_kg, 0), 0)
       * GREATEST(COALESCE(ore.orderaantal, 0), 0))::NUMERIC AS totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM order_regels ore
  JOIN orders o          ON o.id = ore.order_id
  LEFT JOIN producten p  ON p.artikelnr = ore.artikelnr
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE ore.id = p_orderregel_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.evalueer_zending_attributes(p_zending_id bigint)
 RETURNS TABLE(afl_land text, kleinste_zijde_cm integer, totaal_gewicht_kg numeric, debiteur_nr integer, inkoopgroep_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    z.afl_land,
    -- Grootste kleinste-zijde over alle orderregels in de zending.
    -- Maatwerk: LEAST(maatwerk_lengte, maatwerk_breedte).
    -- Vast:     LEAST(producten.lengte_cm, producten.breedte_cm).
    (
      SELECT MAX(LEAST(
        COALESCE(ore.maatwerk_lengte_cm, p.lengte_cm),
        COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
      ))::INTEGER
        FROM zending_regels zr
        LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
        LEFT JOIN producten p     ON p.artikelnr = zr.artikelnr
       WHERE zr.zending_id = z.id
    ) AS kleinste_zijde_cm,
    z.totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM zendingen z
  JOIN orders o     ON o.id = z.order_id
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE z.id = p_zending_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.finaliseer_concept_factuur(p_zending_id bigint, p_factuur_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id BIGINT;
  v_order_ids  BIGINT[];
  v_admin_regelnr INTEGER;
  r RECORD;
BEGIN
  IF p_factuur_id IS NULL THEN
    RAISE EXCEPTION 'p_factuur_id is verplicht voor finalisatie';
  END IF;

  -- Verse rebuild op de bestaande concept-factuur.
  v_factuur_id := projecteer_concept_factuur(p_zending_id, p_factuur_id);

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  -- Side-effect 1: flip gefactureerd (product + VERZEND; korting-orderregels
  -- bestaan hier nog niet en worden hieronder met gefactureerd=1 ingevoegd).
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Side-effect 2: spiegel de korting-FACTUURregels naar korting-ORDERregels.
  -- bedrag <> 0 filtert het theoretische DREMPEL-bij-0-verzendkosten-geval
  -- (mig 341 deel 3a vereiste v_verzendkosten_per_order > 0).
  FOR r IN
    SELECT order_id, artikelnr, omschrijving, bedrag
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id
       AND artikelnr IN ('DREMPELKORTING', 'BUNDELKORTING')
       AND bedrag <> 0
     ORDER BY regelnummer
  LOOP
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
      FROM order_regels WHERE order_id = r.order_id;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, gefactureerd,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      r.order_id, v_admin_regelnr, r.artikelnr, r.omschrijving,
      1, 0, 1,
      r.bedrag, 0, r.bedrag, 0
    );
  END LOOP;

  RETURN v_factuur_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_afleveradressen_gln_gate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.gln_afleveradres IS NOT NULL THEN
    UPDATE orders o
       SET afl_gln_ongekoppeld_sinds = NULL
     WHERE o.afl_gln_ongekoppeld_sinds IS NOT NULL
       AND o.debiteur_nr = NEW.debiteur_nr
       AND o.afleveradres_gln IN (
             NEW.gln_afleveradres,
             NEW.gln_afleveradres || '.0',
             regexp_replace(NEW.gln_afleveradres, '\.0$', '')
           );
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_hst_pdf_naar_order_documenten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_nr TEXT;
  v_order_ids  BIGINT[];
  v_order_id   BIGINT;
  v_filename   TEXT;
BEGIN
  -- Alleen vuren als pdf_path nieuw wordt gezet (van NULL naar een waarde) of
  -- wijzigt naar een andere waarde.
  IF NEW.pdf_path IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.pdf_path IS NOT DISTINCT FROM NEW.pdf_path THEN
    RETURN NEW;
  END IF;

  -- Haal zending_nr op + alle gekoppelde orders (bundle-aware)
  SELECT z.zending_nr INTO v_zending_nr
    FROM zendingen z WHERE z.id = NEW.zending_id;

  IF v_zending_nr IS NULL THEN
    RAISE NOTICE 'fn_hst_pdf_naar_order_documenten: zending % bestaat niet, skip', NEW.zending_id;
    RETURN NEW;
  END IF;

  -- Probeer bundle-table zending_orders eerst, fallback naar zendingen.order_id
  SELECT COALESCE(
    array_agg(DISTINCT zo.order_id) FILTER (WHERE zo.order_id IS NOT NULL),
    ARRAY[]::BIGINT[]
  ) INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = NEW.zending_id;

  IF array_length(v_order_ids, 1) IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    -- Fallback voor pre-mig-242 zendingen of als zending_orders nog niet gevuld is
    SELECT ARRAY[z.order_id] INTO v_order_ids
      FROM zendingen z WHERE z.id = NEW.zending_id AND z.order_id IS NOT NULL;
  END IF;

  v_filename := 'HST-vrachtbrief-' || v_zending_nr || '.pdf';

  -- Insert één rij per order, met order_id in storage_path voor uniciteit
  -- (fysieke storage blijft op één pad — frontend strippe de #order-suffix).
  FOREACH v_order_id IN ARRAY COALESCE(v_order_ids, ARRAY[]::BIGINT[]) LOOP
    INSERT INTO order_documenten (
      order_id, bestandsnaam, storage_path, mime_type, omschrijving, geupload_op
    ) VALUES (
      v_order_id,
      v_filename,
      NEW.pdf_path || '#order=' || v_order_id,
      'application/pdf',
      'HST vrachtbrief — OrderNumber ' || COALESCE(NEW.extern_transport_order_id, '?'),
      COALESCE(NEW.pdf_uploaded_at, now())
    )
    ON CONFLICT (storage_path) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_order_regels_maatwerk_kw_fallback()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_kw TEXT;
  v_kl TEXT;
BEGIN
  -- Alleen actief als is_maatwerk=TRUE én er een artikelnr is om op te zoeken
  IF NEW.artikelnr IS NOT NULL THEN
    IF NEW.maatwerk_kwaliteit_code IS NULL OR NEW.maatwerk_kleur_code IS NULL THEN
      SELECT kwaliteit_code, kleur_code
        INTO v_kw, v_kl
        FROM producten
       WHERE artikelnr = NEW.artikelnr;

      IF NEW.maatwerk_kwaliteit_code IS NULL THEN
        NEW.maatwerk_kwaliteit_code := v_kw;
      END IF;
      IF NEW.maatwerk_kleur_code IS NULL THEN
        NEW.maatwerk_kleur_code := v_kl;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_order_regels_prijs_gate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id BIGINT;
  v_prod     BOOLEAN;
  v_heeft    BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Productie-only orders (Basta-facturatie) zijn nooit prijs-geflagd.
  SELECT COALESCE(o.alleen_productie, FALSE) INTO v_prod
    FROM orders o WHERE o.id = v_order_id;

  IF v_prod THEN
    UPDATE orders
       SET prijs_ontbreekt_sinds = NULL
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NOT NULL;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM order_regels r
     WHERE r.order_id = v_order_id
       AND COALESCE(r.artikelnr, '') <> 'VERZEND'
       AND NOT is_admin_pseudo(r.artikelnr)
       AND COALESCE(r.korting_pct, 0) < 100
       AND COALESCE(r.prijs, 0) = 0
  ) INTO v_heeft;

  IF v_heeft THEN
    UPDATE orders
       SET prijs_ontbreekt_sinds = now()
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NULL;
  ELSE
    UPDATE orders
       SET prijs_ontbreekt_sinds = NULL
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_orders_afl_adres_gate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_incompleet BOOLEAN;
BEGIN
  v_incompleet :=
    COALESCE(NEW.afhalen, FALSE) = FALSE
    AND COALESCE(NEW.alleen_productie, FALSE) = FALSE
    AND NEW.status NOT IN ('Verzonden', 'Geannuleerd')
    AND (
      NULLIF(TRIM(NEW.afl_naam), '')     IS NULL OR
      NULLIF(TRIM(NEW.afl_adres), '')    IS NULL OR
      NULLIF(TRIM(NEW.afl_postcode), '') IS NULL OR
      NULLIF(TRIM(NEW.afl_plaats), '')   IS NULL
    );

  IF v_incompleet THEN
    IF NEW.afl_adres_incompleet_sinds IS NULL THEN
      NEW.afl_adres_incompleet_sinds := now();
    END IF;
  ELSE
    NEW.afl_adres_incompleet_sinds := NULL;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_orders_afl_gln_gate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.bron_systeem = 'edi'
     AND NEW.afleveradres_gln IS NOT NULL AND NEW.afleveradres_gln <> ''
     AND COALESCE(NEW.afhalen, FALSE) = FALSE
     AND COALESCE(NEW.alleen_productie, FALSE) = FALSE
     AND NEW.status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
     AND NOT _afl_gln_matcht_vestiging(NEW.debiteur_nr, NEW.afleveradres_gln)
  THEN
    IF NEW.afl_gln_ongekoppeld_sinds IS NULL THEN
      NEW.afl_gln_ongekoppeld_sinds := now();
    END IF;
  ELSE
    NEW.afl_gln_ongekoppeld_sinds := NULL;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_verzend_wachtrij_pdf_naar_order_documenten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_nr       TEXT;
  v_primary_order_id BIGINT;
  v_filename         TEXT;
BEGIN
  -- Alleen de HST-vrachtbrief-PDF spiegelen (gedragsneutraal t.o.v. mig 304).
  IF NEW.vervoerder_code <> 'hst_api' THEN RETURN NEW; END IF;
  IF NEW.document_pad IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.document_pad IS NOT DISTINCT FROM NEW.document_pad THEN
    RETURN NEW;
  END IF;

  SELECT z.zending_nr, z.order_id INTO v_zending_nr, v_primary_order_id
    FROM zendingen z WHERE z.id = NEW.zending_id;
  IF v_zending_nr IS NULL OR v_primary_order_id IS NULL THEN
    RAISE NOTICE 'fn_verzend_wachtrij_pdf: zending % zonder nr/order_id, skip', NEW.zending_id;
    RETURN NEW;
  END IF;

  v_filename := 'HST-vrachtbrief-' || v_zending_nr || '.pdf';

  INSERT INTO order_documenten (
    order_id, bestandsnaam, storage_path, mime_type, omschrijving, geupload_op
  ) VALUES (
    v_primary_order_id, v_filename, NEW.document_pad, 'application/pdf',
    'HST vrachtbrief — OrderNumber ' || COALESCE(NEW.extern_referentie, '?'),
    COALESCE(NEW.sent_at, now())
  )
  ON CONFLICT (storage_path) DO NOTHING;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_zending_fill_email()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_afl_email   TEXT;
  v_fact_email  TEXT;
  v_debiteur_nr INTEGER;
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_email, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_email,  '')), ''),
         NULLIF(TRIM(COALESCE(o.fact_email, '')), ''),
         o.debiteur_nr
    INTO v_afl_email, v_fact_email, v_debiteur_nr
    FROM orders o
   WHERE o.id = NEW.order_id;

  IF v_afl_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dropshipment-guard (mig 368): een factuur-/debiteur-adres mag nooit als
  -- T&T-adres bij de vervoerder belanden — de consument is de ontvanger.
  -- Liever geen T&T-mail dan een T&T naar de winkel.
  IF is_dropship_order(NEW.order_id) THEN
    IF LOWER(v_afl_email) = LOWER(COALESCE(v_fact_email, '')) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM debiteuren d
       WHERE d.debiteur_nr = v_debiteur_nr
         AND LOWER(v_afl_email) IN (
               LOWER(TRIM(COALESCE(d.email_factuur, ''))),
               LOWER(TRIM(COALESCE(d.email_overig,  '')))
             )
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.afl_email := v_afl_email;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_zending_fill_telefoon()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_telefoon, '')), '')
    INTO NEW.afl_telefoon
    FROM orders o
   WHERE o.id = NEW.order_id;

  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NULL THEN
    SELECT NULLIF(TRIM(COALESCE(d.telefoon, '')), '')
      INTO NEW.afl_telefoon
      FROM orders o
      JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     WHERE o.id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_zending_klaar_voor_verzending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status <> 'Klaar voor verzending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Klaar voor verzending' THEN RETURN NEW; END IF;

  PERFORM enqueue_zending_naar_vervoerder(NEW.id);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_zending_regels_skip_admin_pseudo()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr    TEXT;
  v_is_vrije     BOOLEAN;
BEGIN
  SELECT artikelnr, COALESCE(is_vrije_regel, FALSE)
    INTO v_artikelnr, v_is_vrije
    FROM order_regels
   WHERE id = NEW.order_regel_id;

  -- Admin-pseudo (VERZEND/DROPSHIP-*/korting) of vrije omschrijvingsregel
  -- → geen fysiek collo/label/pakbon-onderregel.
  IF is_admin_pseudo(v_artikelnr) OR v_is_vrije THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_zending_set_gereed_op()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.gereed_op IS NULL
     AND NEW.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd') THEN
    NEW.gereed_op := now();
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.genereer_factuur(p_order_ids bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_eerste_order orders%ROWTYPE;
  v_btw_regeling RECORD;
  v_subtotaal NUMERIC(12,2);
  v_btw_pct NUMERIC(5,2);
  v_btw_bedrag NUMERIC(12,2);
  v_totaal NUMERIC(12,2);
  v_betaaltermijn_dagen INTEGER := 30;
  v_aantal_te_factureren INTEGER;
BEGIN
  IF array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids mag niet leeg zijn';
  END IF;

  SELECT DISTINCT debiteur_nr INTO v_debiteur_nr
    FROM orders WHERE id = ANY(p_order_ids);
  IF v_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'Geen orders gevonden voor ids %', p_order_ids;
  END IF;
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(p_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Orders behoren niet tot dezelfde debiteur';
  END IF;

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(p_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL;
  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', p_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  -- Mig 456: BTW-regeling op basis van de eerste order in de array.
  SELECT * INTO v_eerste_order FROM orders WHERE id = p_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- Mig 456 (gecorrigeerd): geen blokkade hier — zie projecteer_concept_factuur.

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
  ) RETURNING id INTO v_factuur_id;

  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(p_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(p_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL;
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.genereer_factuur_voor_week(p_debiteur_nr integer, p_jaar_week text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_zending              RECORD;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_aantal_orders_bundel INTEGER;
  v_te_betalen           NUMERIC(8,2);
  v_omschrijving         TEXT;
  -- Toeslag (mig 530/533)
  v_toeslag_bedrag       NUMERIC(12,2) := 0;
  v_toeslag_omschrijving TEXT          := NULL;
  v_toeslag_actief       BOOLEAN       := FALSE;
  v_product_subtotaal    NUMERIC(12,2);
BEGIN
  IF p_debiteur_nr IS NULL OR p_jaar_week IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr en p_jaar_week zijn verplicht';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Verzamel orders van deze (debiteur, week) die nog niet gefactureerd zijn.
  SELECT array_agg(o.id ORDER BY o.id)
    INTO v_order_ids
    FROM orders o
   WHERE o.debiteur_nr = p_debiteur_nr
     AND o.status = 'Verzonden'
     AND verzendweek_voor_datum(o.afleverdatum) = p_jaar_week
     AND NOT EXISTS (
       SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
     );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Geen te-factureren orders gevonden voor debiteur % week %',
      p_debiteur_nr, p_jaar_week
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Mig 456: BTW-regeling op basis van de eerste order in de week-batch.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- No-op guard: tel te-factureren product-regels.
  -- VERZEND + TOESLAG worden door dit pad apart behandeld → uitgesloten.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'TOESLAG');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', v_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Toeslag-activatie (mig 533): geldig als ALLE orders in de weekbatch zijn aangemaakt
  -- binnen de periode. BOOL_AND over lege set = NULL → FALSE → geen toeslag (veilig).
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND (
        SELECT BOOL_AND(
            o.created_at::date >= COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
            AND o.created_at::date <= COALESCE(v_debiteur.toeslag_einddatum, 'infinity'::date)
        )
        FROM orders o WHERE o.id = ANY(v_order_ids)
    );

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds,
    toeslag_bedrag, toeslag_omschrijving, toeslag_procent
  ) VALUES (
    v_factuur_nr, p_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
    0, NULL, NULL
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels (alle orderregels behalve VERZEND en TOESLAG).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
    AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Side-effect: markeer product-regels als gefactureerd (excl. VERZEND en TOESLAG).
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'TOESLAG');

  -- Verzend-regels: 1 per bundel-zending van deze (debiteur, week).
  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  FOR v_zending IN
    SELECT z.id, z.zending_nr, z.vervoerder_code, z.afl_naam, z.afl_plaats
      FROM zendingen z
     WHERE z.verzendweek = p_jaar_week
       AND EXISTS (
         SELECT 1 FROM zending_orders zo
          WHERE zo.zending_id = z.id
            AND zo.order_id = ANY(v_order_ids)
       )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     ORDER BY z.id
  LOOP
    SELECT COALESCE(SUM(fr.bedrag), 0)::NUMERIC(12,2),
           COUNT(DISTINCT fr.order_id)::INTEGER
      INTO v_bundel_subtotaal, v_aantal_orders_bundel
      FROM factuur_regels fr
     WHERE fr.factuur_id = v_factuur_id
       AND fr.order_id IN (
         SELECT zo.order_id FROM zending_orders zo
          WHERE zo.zending_id = v_zending.id
       );

    IF v_aantal_orders_bundel = 0 THEN
      CONTINUE;
    END IF;

    IF v_zending.vervoerder_code IS NULL THEN
      v_te_betalen := 0;
      v_omschrijving := 'Afhalen — geen verzendkosten';
    ELSIF v_debiteur.gratis_verzending THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis volgens klantafspraak',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    ELSIF v_debiteur.verzend_drempel IS NOT NULL
          AND v_bundel_subtotaal >= v_debiteur.verzend_drempel THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis vanaf €%s',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END,
        to_char(v_debiteur.verzend_drempel, 'FM999999.00')
      );
    ELSE
      v_te_betalen := COALESCE(v_debiteur.verzendkosten, 0);
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s)',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    END IF;

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id,
      (SELECT MIN(zo.order_id) FROM zending_orders zo WHERE zo.zending_id = v_zending.id),
      NULL,
      v_volgnr,
      'VERZEND',
      v_omschrijving,
      1, v_te_betalen, 0, v_te_betalen, v_btw_pct
    );
  END LOOP;

  -- Toeslag-berekening (mig 530): grondslag = product excl. VERZEND.
  IF v_toeslag_actief THEN
    SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
      INTO v_product_subtotaal
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id
       AND COALESCE(artikelnr, '') <> 'VERZEND';

    v_toeslag_bedrag := ROUND(v_product_subtotaal * v_debiteur.toeslag_procent / 100, 2);
    v_toeslag_omschrijving := REPLACE(
      v_debiteur.toeslag_omschrijving,
      '{percentage}',
      REPLACE(
        REGEXP_REPLACE(v_debiteur.toeslag_procent::TEXT, '\.?0+$', ''),
        '.', ','
      )
    );
  END IF;

  -- Eindtotalen (mig 530: BTW over subtotaal + toeslag).
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  v_btw_bedrag := ROUND((v_subtotaal + v_toeslag_bedrag) * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_toeslag_bedrag + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal            = v_subtotaal,
         btw_bedrag           = v_btw_bedrag,
         totaal               = v_totaal,
         toeslag_bedrag       = v_toeslag_bedrag,
         toeslag_omschrijving = v_toeslag_omschrijving,
         toeslag_procent      = CASE WHEN v_toeslag_actief THEN v_debiteur.toeslag_procent ELSE NULL END
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.genereer_scancode()
 RETURNS text
 LANGUAGE sql
AS $function$
  SELECT 'KC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$function$


CREATE OR REPLACE FUNCTION public.genereer_sscc()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_extension      TEXT := '0';
  v_company_prefix TEXT := '8715954';   -- Karpi GS1-prefix (eerste 7 van GLN 8715954999998)
  v_serial         TEXT;
  v_data           TEXT;
  v_check          INTEGER;
BEGIN
  -- Serial-lengte = 17 - 1 (extension) - length(prefix). Voor prefix=7: serial=9.
  v_serial := lpad(nextval('sscc_serial_seq')::TEXT, 17 - 1 - length(v_company_prefix), '0');
  v_data   := v_extension || v_company_prefix || v_serial;
  v_check  := sscc_check_digit(v_data);
  RETURN v_data || v_check::TEXT;
END;
$function$


CREATE OR REPLACE FUNCTION public.genereer_zending_colli(p_zending_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_aantal_aangemaakt INTEGER := 0;
  v_volgnr            INTEGER := 0;
  r                   RECORD;
  i                   INTEGER;
  v_omsticker_codes   TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  -- Skip als al colli's bestaan
  IF EXISTS (SELECT 1 FROM zending_colli WHERE zending_id = p_zending_id) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT
      zr.id              AS zending_regel_id,
      zr.order_regel_id,
      zr.artikelnr,
      zr.rol_id,
      zr.aantal,
      ore.artikelnr       AS regel_artikelnr,
      ore.is_maatwerk,
      ore.maatwerk_lengte_cm::INTEGER  AS maatwerk_lengte_cm,
      ore.maatwerk_breedte_cm::INTEGER AS maatwerk_breedte_cm,
      ore.maatwerk_afwerking,
      ore.omschrijving    AS regel_omschrijving,
      ore.omschrijving_2  AS regel_omschrijving_2,
      p.omschrijving      AS product_naam,
      p.lengte_cm         AS prod_lengte_cm,
      p.breedte_cm        AS prod_breedte_cm,
      p.gewicht_kg        AS prod_gewicht_kg,
      ore.gewicht_kg      AS regel_gewicht_kg,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
      k.omschrijving      AS kwaliteit_naam,
      -- Mig 419: klant-eigennaam voor de kwaliteit, bevroren op shipmoment.
      resolve_klanteigen_naam(
        o.debiteur_nr,
        COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
        COALESCE(ore.maatwerk_kleur_code, p.kleur_code)
      ) AS klanteigen_naam
    FROM zending_regels zr
    LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
    -- Mig 419: orders erbij voor debiteur_nr (klant-eigennaam-resolve).
    LEFT JOIN orders o         ON o.id = ore.order_id
    -- Mig 400: join via het order_regel-artikel (zr.artikelnr is altijd NULL).
    LEFT JOIN producten p     ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    -- Mig 436: per-stuk omsticker-code-array voor deze orderregel. Actieve claims
    -- geëxpandeerd op `aantal` (claim_volgorde-volgorde); een claim waarvan het
    -- fysieke artikel afwijkt van het bestelde levert de karpi_code (val terug op
    -- het artikelnr), eigen voorraad / IO leveren NULL. Stuk i pakt element i.
    SELECT array_agg(sub.code ORDER BY sub.k, sub.gs)
    INTO v_omsticker_codes
    FROM (
      SELECT
        CASE
          WHEN res.fysiek_artikelnr IS NOT NULL
           AND res.fysiek_artikelnr <> COALESCE(r.regel_artikelnr, '')
          THEN COALESCE(fp.karpi_code, res.fysiek_artikelnr)
          ELSE NULL
        END                 AS code,
        res.claim_volgorde  AS k,
        gs.gs               AS gs
      FROM order_reserveringen res
      LEFT JOIN producten fp ON fp.artikelnr = res.fysiek_artikelnr
      CROSS JOIN LATERAL generate_series(1, GREATEST(res.aantal, 1)) AS gs(gs)
      WHERE res.order_regel_id = r.order_regel_id
        AND res.status = 'actief'
    ) sub;

    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot,
        lengte_cm, breedte_cm, klanteigen_naam_snapshot, omsticker_snapshot, aantal
      ) VALUES (
        p_zending_id,
        v_volgnr,
        r.order_regel_id,
        r.rol_id,
        genereer_sscc(),
        -- Mig 387 gewicht-ladder: regel-cache (respecteert eventuele
        -- handmatige correctie; 0 = ontbreekt) → live resolver (vorm-aware,
        -- ook maatwerk) → product-cache als laatste vangnet.
        COALESCE(
          NULLIF(r.regel_gewicht_kg, 0),
          bereken_orderregel_gewicht_kg(r.order_regel_id),
          NULLIF(r.prod_gewicht_kg, 0)
        ),
        compose_colli_omschrijving(
          r.is_maatwerk, r.kwaliteit_code, r.kwaliteit_naam,
          r.maatwerk_lengte_cm, r.maatwerk_breedte_cm, r.maatwerk_afwerking,
          r.product_naam, r.prod_lengte_cm, r.prod_breedte_cm
        ),
        -- Mig 390: bevroren klant-omschrijving (single source voor label/pakbon).
        compose_klant_omschrijving(r.regel_omschrijving, r.regel_omschrijving_2),
        -- Mig 399/400: bevroren afmetingen (single source voor Rhenus/Verhoek).
        COALESCE(r.maatwerk_lengte_cm,  r.prod_lengte_cm),
        COALESCE(r.maatwerk_breedte_cm, r.prod_breedte_cm),
        -- Mig 419: bevroren klant-eigennaam voor de kwaliteit (of NULL).
        r.klanteigen_naam,
        -- Mig 436: omsticker-code voor dit stuk (of NULL = eigen artikel gepakt).
        v_omsticker_codes[i],
        1
      );
      v_aantal_aangemaakt := v_aantal_aangemaakt + 1;
    END LOOP;
  END LOOP;

  UPDATE zendingen SET aantal_colli = v_aantal_aangemaakt WHERE id = p_zending_id;

  RETURN v_aantal_aangemaakt;
END;
$function$


CREATE OR REPLACE FUNCTION public.gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT gewicht_per_m2_kg FROM kwaliteiten WHERE code = p_kwaliteit_code;
$function$


CREATE OR REPLACE FUNCTION public.groepen_met_nieuwe_ongeplande_stukken(p_window_minuten integer DEFAULT 360)
 RETURNS TABLE(kwaliteit_code text, kleur_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  -- Case 1 (mig 552): recentelijk aangemaakte stukken zonder rol of IO-claim.
  -- Tijdsfilter: aangemaakt binnen p_window_minuten (default 360 min = 6 uur).
  SELECT DISTINCT
    orr.maatwerk_kwaliteit_code::TEXT,
    orr.maatwerk_kleur_code::TEXT
  FROM snijplannen sn
  JOIN order_regels orr ON sn.order_regel_id = orr.id
  WHERE sn.status = 'Gepland'
    AND sn.rol_id IS NULL
    AND sn.verwacht_inkooporder_regel_id IS NULL
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
    AND sn.snijden_uit_standaardmaat = false
    AND sn.created_at > NOW() - (p_window_minuten || ' minutes')::INTERVAL

  UNION

  -- Case 2 (mig 553): stukken die al ongeplaatst zijn (elke leeftijd) terwijl
  -- er beschikbare rollen van dezelfde kwaliteit/kleur aanwezig zijn.
  -- Geen tijdsfilter: zolang materiaal beschikbaar is én stukken wachten,
  -- hoort de groep in de prioriteitspass. Reden: nieuwe rollen kunnen uren of
  -- dagen geleden zijn binnengekomen en de willekeurige sweep heeft de groep
  -- statistisch wel geraakt maar de planning toch niet afgerond (lock contention,
  -- verdringingscheck, of transiënte fout). Zonder dit filter blijft zo'n groep
  -- in de willekeurige roulatie terwijl direct actie mogelijk was.
  SELECT DISTINCT
    orr.maatwerk_kwaliteit_code::TEXT,
    orr.maatwerk_kleur_code::TEXT
  FROM snijplannen sn
  JOIN order_regels orr ON sn.order_regel_id = orr.id
  JOIN rollen ro
    ON  ro.kwaliteit_code = orr.maatwerk_kwaliteit_code
    AND (   ro.kleur_code = orr.maatwerk_kleur_code
         OR ro.kleur_code = orr.maatwerk_kleur_code || '.0'
         OR ro.kleur_code = regexp_replace(orr.maatwerk_kleur_code, '\.0$', ''))
    AND ro.status IN ('beschikbaar', 'reststuk')
    AND ro.snijden_gestart_op IS NULL
  WHERE sn.status = 'Gepland'
    AND sn.rol_id IS NULL
    AND sn.verwacht_inkooporder_regel_id IS NULL
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
    AND sn.snijden_uit_standaardmaat = false

  ORDER BY 1, 2
$function$


CREATE OR REPLACE FUNCTION public.handmatige_keuzes_voor_order(p_order_id bigint)
 RETURNS TABLE(order_regel_id bigint, bron text, artikelnr text, inkooporder_regel_id bigint, aantal integer, omschrijving text, verwacht_datum date)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    r.order_regel_id,
    r.bron,
    r.fysiek_artikelnr      AS artikelnr,
    r.inkooporder_regel_id,
    r.aantal,
    COALESCE(p.omschrijving, r.fysiek_artikelnr) AS omschrijving,
    io.verwacht_datum
  FROM order_reserveringen r
  JOIN order_regels reg ON reg.id = r.order_regel_id
  LEFT JOIN producten p ON p.artikelnr = r.fysiek_artikelnr
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE reg.order_id = p_order_id
    AND r.status = 'actief'
    AND r.is_handmatig = TRUE
    AND r.fysiek_artikelnr IS NOT NULL
  ORDER BY r.order_regel_id, r.bron, r.fysiek_artikelnr;
$function$


CREATE OR REPLACE FUNCTION public.herallocateer_orderregel(p_order_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr            TEXT;
  v_te_leveren           INTEGER;
  v_is_maatwerk          BOOLEAN;
  v_order_id             BIGINT;
  v_order_status         order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad          INTEGER;
  v_resterend            INTEGER;
  v_handmatig_totaal     INTEGER;
  v_stuks_artikelnr      TEXT;
  v_stuks_per_doos       INTEGER;
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

  -- Eindstatus-guards: verzonden/geannuleerd → claims afsluiten
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = CASE WHEN v_order_status = 'Verzonden' THEN 'verzonden' ELSE 'released' END,
           updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Concept-guard verwijderd (mig 543): allocatie draait normaal voor Concept-orders.
  -- Status blijft 'Concept' via derive_wacht_status no-touch (mig 540).
  -- Operationele blokkeringen (snijplannen, herplan-sweep) blijven via andere guards.

  -- Doos→stuks vertaling (mig 408)
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;

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

  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad — enige automatische stap in de korte vorm.
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  -- Resterend tekort blijft open — geen Stap 1.5/2 in deze korte vorm.

  PERFORM herwaardeer_order_status(v_order_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.herallocateer_orderregel_auto(p_order_regel_id bigint)
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

  -- Doos→stuks vertaling (mig 408)
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;

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

  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad
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
       WHERE ir.artikelnr = v_artikelnr
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
$function$


CREATE OR REPLACE FUNCTION public.herbereken_combi_groep(p_debiteur_nr integer, p_adres_norm text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF p_debiteur_nr IS NULL THEN RETURN; END IF;
  FOR v_order_id IN
    SELECT o.id
      FROM orders o
      JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     WHERE o.debiteur_nr = p_debiteur_nr
       AND _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) = p_adres_norm
       AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
       AND o.combi_levering_override = FALSE
       AND d.combi_levering = TRUE
       AND NOT is_dropship_order(o.id)
  LOOP
    PERFORM herbereken_wacht_status(v_order_id, FALSE);
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.herbereken_klant_tiers()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    WITH klant_ranking AS (
        SELECT
            d.debiteur_nr,
            COALESCE(SUM(o.totaal_bedrag), 0) AS omzet,
            PERCENT_RANK() OVER (ORDER BY COALESCE(SUM(o.totaal_bedrag), 0) DESC) AS ranking
        FROM debiteuren d
        LEFT JOIN orders o ON o.debiteur_nr = d.debiteur_nr
            AND o.orderdatum >= date_trunc('year', CURRENT_DATE)
            AND o.status != 'Geannuleerd'
        WHERE d.status = 'Actief'
        GROUP BY d.debiteur_nr
    )
    UPDATE debiteuren SET
        tier = CASE
            WHEN kr.ranking <= 0.10 THEN 'Gold'
            WHEN kr.ranking <= 0.30 THEN 'Silver'
            ELSE 'Bronze'
        END,
        omzet_ytd = kr.omzet
    FROM klant_ranking kr
    WHERE debiteuren.debiteur_nr = kr.debiteur_nr;
END;
$function$


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
$function$


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


CREATE OR REPLACE FUNCTION public.herstel_colli_pick(p_zending_colli_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS DISTINCT FROM 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;
  UPDATE zending_colli
     SET pick_uitkomst  = 'open',
         pick_opmerking = NULL
   WHERE id = p_zending_colli_id AND pick_uitkomst = 'niet_gevonden';
END;
$function$


CREATE OR REPLACE FUNCTION public.herstel_vastgelopen_hst(p_minuten integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$function$


CREATE OR REPLACE FUNCTION public.herstel_vastgelopen_rhenus(p_minuten integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE rhenus_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$function$


CREATE OR REPLACE FUNCTION public.herstel_vastgelopen_verhoek(p_minuten integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE verhoek_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$function$


CREATE OR REPLACE FUNCTION public.herstel_vastgelopen_verzending(p_vervoerder_code text, p_minuten integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND vervoerder_code = p_vervoerder_code
     AND updated_at < now() - make_interval(mins => p_minuten)
     AND transport_bevestigd_op IS NULL;   -- anker = al aangemeld → niet opnieuw versturen
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$function$


CREATE OR REPLACE FUNCTION public.herwaardeer_claims_voor_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_regel_id IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND NOT is_admin_pseudo(artikelnr)  -- Mig 273 (ADR-0018, was IN-lijst mig 263)
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.herwaardeer_combi_levering_verzendregel(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_is_dropship        BOOLEAN;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mig 555: order al fysiek onderweg (in pickronde/deels verzonden) of in
  -- een eindstatus — nooit meer aankomen aan de VERZEND-regel.
  IF v_order.status IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_is_dropship := is_dropship_order(p_order_id);

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT v_is_dropship;

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  -- Mig 568: een dropship-order krijgt via dit mechanisme NOOIT een
  -- VERZEND-regel — de dropship-kostenregel is al de verzendcomponent.
  IF v_moet_wachten OR v_order.afhalen OR v_is_dropship THEN
    IF v_bestaande_regel_id IS NOT NULL AND (v_moet_wachten OR v_order.afhalen) THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  -- Mig 556: COALESCE-fallback 500 (was 0) — zelfde SHIPPING_THRESHOLD-default
  -- als applyShippingLogic (frontend/src/lib/constants/shipping.ts).
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 500);

  IF v_moet_verzendregel AND v_bestaande_regel_id IS NULL THEN
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_regelnummer
      FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, prijs, korting_pct, bedrag
    ) VALUES (
      p_order_id, v_regelnummer, 'VERZEND', 'Verzendkosten',
      1, 1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0)
    );
  ELSIF NOT v_moet_verzendregel AND v_bestaande_regel_id IS NOT NULL THEN
    DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.herwaardeer_order_status(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  -- Order-lifecycle (mig 218): bepaalt Wacht op X / Nieuw via _apply_transitie.
  PERFORM herbereken_wacht_status(p_order_id);

  -- Reservering (mig 153): schuift orders.afleverdatum vooruit naar laatste IO-claim.
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.huidige_actor_email()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    (auth.uid())::text
  )
$function$


CREATE OR REPLACE FUNCTION public.huidige_vertegenw_code()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT vertegenw_code FROM vertegenwoordiger_login WHERE user_id = auth.uid();
$function$


CREATE OR REPLACE FUNCTION public.import_productie_only_order(p_header jsonb, p_regels jsonb)
 RETURNS TABLE(order_nr text, was_existing boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_oud_nr   BIGINT  := (p_header->>'oud_order_nr')::BIGINT;
  v_deb_in   INTEGER := NULLIF(p_header->>'debiteur_nr', '')::INTEGER;
  v_deb      INTEGER;
  v_order_id BIGINT;
  v_order_nr TEXT;
  v_regel    JSONB;
  v_kwal     TEXT;
  v_kleur    TEXT;
  v_artikelnr TEXT;
BEGIN
  IF v_oud_nr IS NULL THEN
    RAISE EXCEPTION 'import_productie_only_order: oud_order_nr verplicht';
  END IF;

  SELECT o.id, o.order_nr
    INTO v_order_id, v_order_nr
    FROM orders o
   WHERE o.oud_order_nr = v_oud_nr;

  IF FOUND THEN
    RETURN QUERY SELECT v_order_nr, true;
    RETURN;
  END IF;

  SELECT d.debiteur_nr
    INTO v_deb
    FROM debiteuren d
   WHERE d.debiteur_nr = v_deb_in;

  IF NOT FOUND THEN
    v_deb := 900000;
  END IF;

  v_order_nr := 'OUD-' || v_oud_nr::TEXT;

  INSERT INTO orders (
    order_nr, debiteur_nr, orderdatum, afleverdatum, status,
    bron_systeem, oud_order_nr, alleen_productie, lever_type
  )
  VALUES (
    v_order_nr,
    v_deb,
    COALESCE((p_header->>'orderdatum')::DATE, CURRENT_DATE),
    (p_header->>'afleverdatum')::DATE,
    'In productie'::order_status,
    'oud_systeem',
    v_oud_nr,
    true,
    'week'::lever_type
  )
  RETURNING id INTO v_order_id;

  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    v_kwal  := v_regel->>'maatwerk_kwaliteit_code';
    v_kleur := v_regel->>'maatwerk_kleur_code';

    -- Zoek het matchende 'rol'-broadloomproduct (zelfde (kwaliteit, kleur)). Bij
    -- meerdere: deterministisch actief/meest-op-voorraad. Geen match => NULL.
    v_artikelnr := NULL;
    IF v_kwal IS NOT NULL AND v_kwal <> '' AND v_kleur IS NOT NULL AND v_kleur <> '' THEN
      SELECT p.artikelnr
        INTO v_artikelnr
        FROM producten p
       WHERE p.product_type = 'rol'
         AND p.kwaliteit_code = v_kwal
         AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(v_kleur)
       ORDER BY p.actief DESC NULLS LAST, p.voorraad DESC NULLS LAST, p.artikelnr
       LIMIT 1;
    END IF;

    INSERT INTO order_regels (
      order_id,
      artikelnr,
      regelnummer,
      omschrijving,
      orderaantal,
      te_leveren,
      korting_pct,
      is_maatwerk,
      maatwerk_kwaliteit_code,
      maatwerk_kleur_code,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
      maatwerk_afwerking,
      maatwerk_vorm,
      snijden_uit_standaardmaat,
      maatwerk_instructies
    )
    VALUES (
      v_order_id,
      v_artikelnr,
      COALESCE((v_regel->>'regelnummer')::INTEGER, 1),
      COALESCE(v_regel->>'omschrijving', 'Maatwerk'),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),
      0,
      true,
      v_kwal,
      v_kleur,
      (v_regel->>'maatwerk_lengte_cm')::INTEGER,
      (v_regel->>'maatwerk_breedte_cm')::INTEGER,
      NULLIF(v_regel->>'maatwerk_afwerking', ''),
      NULLIF(v_regel->>'maatwerk_vorm', ''),
      COALESCE((v_regel->>'snijden_uit_standaardmaat')::BOOLEAN, false),
      v_regel->>'maatwerk_instructies'
    );
  END LOOP;

  RETURN QUERY SELECT v_order_nr, false;
END;
$function$


CREATE OR REPLACE FUNCTION public.io_regel_ruimte(p_io_regel_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_te_leveren NUMERIC;
  v_eenheid TEXT;
  v_geclaimd INTEGER;
BEGIN
  SELECT te_leveren_m, eenheid INTO v_te_leveren, v_eenheid
  FROM inkooporder_regels WHERE id = p_io_regel_id;

  IF v_eenheid IS DISTINCT FROM 'stuks' THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(aantal), 0) INTO v_geclaimd
  FROM order_reserveringen
  WHERE inkooporder_regel_id = p_io_regel_id
    AND bron = 'inkooporder_regel'
    AND status = 'actief';

  RETURN GREATEST(0, FLOOR(COALESCE(v_te_leveren, 0))::INTEGER - v_geclaimd);
END;
$function$


CREATE OR REPLACE FUNCTION public.is_admin_pseudo(p_artikelnr text)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE(
    (SELECT is_pseudo FROM producten WHERE artikelnr = p_artikelnr),
    FALSE
  )
$function$


CREATE OR REPLACE FUNCTION public.is_bug_beheerder()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.jwt() ->> 'email', '') = 'miguel@aiprogression.nl';
$function$


CREATE OR REPLACE FUNCTION public.is_dropship_order(p_order_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM order_regels r
      JOIN producten p ON p.artikelnr = r.artikelnr
     WHERE r.order_id = p_order_id
       AND p.is_dropship
  );
$function$


CREATE OR REPLACE FUNCTION public.is_eu_land(p_iso2 text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_iso2 = ANY(ARRAY[
    'NL','BE','DE','FR','LU','AT','IT','ES','PL','CZ','DK','SE','FI','IE',
    'PT','SK','HU','GR','SI','EE','LV','LT','BG','RO','HR','CY','MT'
  ]);
$function$


CREATE OR REPLACE FUNCTION public.is_externe_vertegenwoordiger()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM vertegenwoordiger_login WHERE user_id = auth.uid());
$function$


CREATE OR REPLACE FUNCTION public.iso_week_plus(p_datum date, p_weken integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_doel DATE;
BEGIN
  IF p_datum IS NULL THEN RETURN NULL; END IF;
  v_doel := p_datum + (COALESCE(p_weken, 0) * 7);
  RETURN to_char(v_doel, 'IYYY-"W"IW');
END;
$function$


CREATE OR REPLACE FUNCTION public.kan_deelzending(p_order_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(d.deelleveringen_toegestaan, FALSE) OR o.lever_modus = 'deelleveringen'
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;
$function$


CREATE OR REPLACE FUNCTION public.kandidaat_rollen_voor_conversie(p_kwaliteit_code text, p_kleur_code text, p_lengte_cm integer, p_breedte_cm integer, p_afwerking text DEFAULT NULL::text, p_vorm text DEFAULT 'rechthoek'::text)
 RETURNS TABLE(rol_id bigint, rolnummer text, breedte_cm integer, lengte_cm integer, status text, kwaliteit_code text, kleur_code text, is_exact boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH stuk AS (
    SELECT
      p_lengte_cm + stuk_snij_marge_cm(p_afwerking, p_vorm, p_lengte_cm, p_breedte_cm, k.standaard_breedte_cm) AS benodigd_lengte_cm,
      p_breedte_cm + stuk_snij_marge_cm(p_afwerking, p_vorm, p_lengte_cm, p_breedte_cm, k.standaard_breedte_cm) AS benodigd_breedte_cm
    FROM (SELECT 1) dummy
    LEFT JOIN kwaliteiten k ON k.code = p_kwaliteit_code
  ),
  paren AS (
    SELECT p.target_kwaliteit_code, p.target_kleur_code, p.is_zelf
    FROM uitwisselbare_paren(p_kwaliteit_code, p_kleur_code) p
  )
  SELECT
    ro.id AS rol_id,
    ro.rolnummer,
    ro.breedte_cm,
    ro.lengte_cm,
    ro.status,
    ro.kwaliteit_code,
    ro.kleur_code,
    p.is_zelf AS is_exact
  FROM stuk s
  JOIN paren p ON true
  JOIN rollen ro
    ON ro.kwaliteit_code = p.target_kwaliteit_code
   AND ro.kleur_code IN (p.target_kleur_code, p.target_kleur_code || '.0')
  WHERE ro.status IN ('beschikbaar', 'reststuk', 'in_snijplan')
    AND ro.snijden_gestart_op IS NULL
    AND (
      (ro.breedte_cm >= s.benodigd_breedte_cm AND ro.lengte_cm >= s.benodigd_lengte_cm)
      OR (ro.breedte_cm >= s.benodigd_lengte_cm AND ro.lengte_cm >= s.benodigd_breedte_cm)
    )
  ORDER BY is_exact DESC, ro.rolnummer;
$function$


CREATE OR REPLACE FUNCTION public.kandidaat_rollen_voor_handmatige_toewijzing(p_snijplan_id bigint)
 RETURNS TABLE(rol_id bigint, rolnummer text, breedte_cm integer, lengte_cm integer, status text, kwaliteit_code text, kleur_code text, is_exact boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH stuk AS (
    SELECT
      orr.maatwerk_kwaliteit_code AS kwaliteit_code,
      orr.maatwerk_kleur_code AS kleur_code,
      sn.lengte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm, sn.lengte_cm, sn.breedte_cm, k.standaard_breedte_cm) AS benodigd_lengte_cm,
      sn.breedte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm, sn.lengte_cm, sn.breedte_cm, k.standaard_breedte_cm) AS benodigd_breedte_cm
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
    LEFT JOIN kwaliteiten k ON k.code = orr.maatwerk_kwaliteit_code
    WHERE sn.id = p_snijplan_id
  ),
  paren AS (
    SELECT p.target_kwaliteit_code, p.target_kleur_code, p.is_zelf
    FROM stuk s, uitwisselbare_paren(s.kwaliteit_code, s.kleur_code) p
  )
  SELECT
    ro.id AS rol_id,
    ro.rolnummer,
    ro.breedte_cm,
    ro.lengte_cm,
    ro.status,
    ro.kwaliteit_code,
    ro.kleur_code,
    p.is_zelf AS is_exact
  FROM stuk s
  JOIN paren p ON true
  JOIN rollen ro
    ON ro.kwaliteit_code = p.target_kwaliteit_code
   AND ro.kleur_code IN (p.target_kleur_code, p.target_kleur_code || '.0')
  WHERE ro.status IN ('beschikbaar', 'reststuk', 'in_snijplan')
    AND ro.snijden_gestart_op IS NULL
    AND (
      (ro.breedte_cm >= s.benodigd_breedte_cm AND ro.lengte_cm >= s.benodigd_lengte_cm)
      OR (ro.breedte_cm >= s.benodigd_lengte_cm AND ro.lengte_cm >= s.benodigd_breedte_cm)
    )
  ORDER BY is_exact DESC, ro.rolnummer;
$function$


CREATE OR REPLACE FUNCTION public.keur_snijvoorstel_goed(p_voorstel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status TEXT;
  v_invalid_plannen INTEGER;
  v_invalid_rollen INTEGER;
  r RECORD;
BEGIN
  SELECT status INTO v_status
  FROM snijvoorstellen
  WHERE id = p_voorstel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijvoorstel % niet gevonden', p_voorstel_id;
  END IF;

  IF v_status <> 'concept' THEN
    RAISE EXCEPTION 'Snijvoorstel kan alleen goedgekeurd worden vanuit status "concept" (huidige status: %)', v_status;
  END IF;

  -- Snijplannen moeten nog "onaangetast" zijn: status = 'Gepland' of 'Snijden'
  -- met rol_id IS NULL (na release, voor nieuwe toewijzing).
  SELECT COUNT(*) INTO v_invalid_plannen
  FROM snijvoorstel_plaatsingen sp
  JOIN snijplannen sn ON sn.id = sp.snijplan_id
  WHERE sp.voorstel_id = p_voorstel_id
    AND (sn.status NOT IN ('Gepland', 'Snijden') OR sn.rol_id IS NOT NULL);

  IF v_invalid_plannen > 0 THEN
    RAISE EXCEPTION 'Niet alle snijplannen zijn nog onaangetast — % plan(nen) gewijzigd sinds voorstel', v_invalid_plannen;
  END IF;

  SELECT COUNT(*) INTO v_invalid_rollen
  FROM snijvoorstel_plaatsingen sp
  JOIN rollen ro ON ro.id = sp.rol_id
  WHERE sp.voorstel_id = p_voorstel_id
    AND (
      ro.status NOT IN ('beschikbaar', 'reststuk', 'in_snijplan')
      OR (ro.status = 'in_snijplan' AND ro.snijden_gestart_op IS NOT NULL)
    );

  IF v_invalid_rollen > 0 THEN
    RAISE EXCEPTION 'Niet alle rollen zijn bruikbaar — % rol(len) inmiddels gewijzigd of al in productie', v_invalid_rollen;
  END IF;

  PERFORM ro.id
  FROM snijvoorstel_plaatsingen sp
  JOIN rollen ro ON ro.id = sp.rol_id
  WHERE sp.voorstel_id = p_voorstel_id
  FOR UPDATE OF ro;

  -- Zet snijplannen op 'Gepland' (niet 'Snijden' — die komt pas bij start_snijden_rol).
  FOR r IN
    SELECT snijplan_id, rol_id, positie_x_cm, positie_y_cm, geroteerd
    FROM snijvoorstel_plaatsingen
    WHERE voorstel_id = p_voorstel_id
  LOOP
    UPDATE snijplannen
    SET rol_id = r.rol_id,
        positie_x_cm = r.positie_x_cm,
        positie_y_cm = r.positie_y_cm,
        geroteerd = r.geroteerd,
        status = 'Gepland'
    WHERE id = r.snijplan_id;
  END LOOP;

  UPDATE rollen
  SET status = 'in_snijplan'
  WHERE id IN (
    SELECT DISTINCT rol_id
    FROM snijvoorstel_plaatsingen
    WHERE voorstel_id = p_voorstel_id
  );

  UPDATE snijvoorstellen
  SET status = 'goedgekeurd'
  WHERE id = p_voorstel_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.klanten_voor_betaalconditie(p_code text)
 RETURNS TABLE(debiteur_nr integer, naam text, plaats text, status text, betaalconditie text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    d.debiteur_nr,
    d.naam,
    d.plaats,
    d.status,
    d.betaalconditie
  FROM debiteuren d
  WHERE d.betaalconditie IS NOT NULL
    AND d.betaalconditie ~ '^\s*\d+\s*-'
    AND trim(split_part(d.betaalconditie, '-', 1)) = p_code
  ORDER BY d.naam;
$function$


CREATE OR REPLACE FUNCTION public.kleuren_voor_kwaliteit(p_kwaliteit text)
 RETURNS TABLE(kleur_code text, kleur_label text, omschrijving text, verkoopprijs_m2 numeric, kostprijs_m2 numeric, gewicht_per_m2_kg numeric, max_breedte_cm integer, artikelnr text, karpi_code text, aantal_rollen integer, beschikbaar_m2 numeric, equiv_rollen integer, equiv_m2 numeric, equiv_kwaliteit_code text, equiv_artikelnr text, equiv_m2_prijs numeric)
 LANGUAGE sql
 STABLE
AS $function$
WITH
kwaliteit_density AS (
  SELECT gewicht_per_m2_kg FROM kwaliteiten WHERE code = p_kwaliteit
),
kleur_universe AS (
  SELECT kc FROM (
    SELECT mp.kleur_code AS kc FROM maatwerk_m2_prijzen mp
      WHERE mp.kwaliteit_code = p_kwaliteit
    UNION
    SELECT p.kleur_code FROM producten p
      WHERE p.kwaliteit_code = p_kwaliteit
        AND p.kleur_code IS NOT NULL
        AND p.actief = true
    UNION
    SELECT u.kleur_code FROM kwaliteit_kleur_uitwisselgroepen u
      WHERE u.kwaliteit_code = p_kwaliteit
  ) s
  WHERE kc IS NOT NULL
),
eigen_rollen AS (
  SELECT r.kleur_code,
         COUNT(*)::INTEGER                         AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM rollen r
  WHERE r.kwaliteit_code = p_kwaliteit
    AND r.status = 'beschikbaar'
    AND r.kleur_code IS NOT NULL
  GROUP BY r.kleur_code
),
uitwissel_koppel AS (
  SELECT u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND u2.kwaliteit_code <> u1.kwaliteit_code
  WHERE u1.kwaliteit_code = p_kwaliteit
),
uit_rollen_agg AS (
  SELECT uk.onze_kleur,
         uk.uit_kwaliteit,
         uk.uit_kleur,
         COUNT(r.id)::INTEGER                      AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM uitwissel_koppel uk
  LEFT JOIN rollen r
    ON r.kwaliteit_code = uk.uit_kwaliteit
   AND r.kleur_code = uk.uit_kleur
   AND r.status = 'beschikbaar'
  GROUP BY uk.onze_kleur, uk.uit_kwaliteit, uk.uit_kleur
),
beste_uitwissel AS (
  SELECT DISTINCT ON (ura.onze_kleur)
    ura.onze_kleur,
    ura.uit_kwaliteit,
    ura.uit_kleur,
    ura.aantal,
    ura.m2
  FROM uit_rollen_agg ura
  WHERE ura.aantal > 0
  ORDER BY ura.onze_kleur, ura.m2 DESC, ura.uit_kwaliteit
),
uit_maatwerk_artikel AS (
  SELECT bu.onze_kleur,
         (
           SELECT p.artikelnr
           FROM producten p
           WHERE p.kwaliteit_code = bu.uit_kwaliteit
             AND p.kleur_code = bu.uit_kleur
             AND p.actief = true
             AND (p.product_type = 'overig'
                  OR p.karpi_code   ILIKE '%maatwerk%'
                  OR p.omschrijving ILIKE '%maatwerk%')
           ORDER BY
             (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
             (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
             (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
             p.artikelnr
           LIMIT 1
         ) AS artikelnr
  FROM beste_uitwissel bu
),
uit_m2_prijs AS (
  SELECT bu.onze_kleur,
         COALESCE(
           (SELECT mp.verkoopprijs_m2 FROM maatwerk_m2_prijzen mp
             WHERE mp.kwaliteit_code = bu.uit_kwaliteit AND mp.kleur_code = bu.uit_kleur LIMIT 1),
           (SELECT p.verkoopprijs FROM producten p
             WHERE p.kwaliteit_code = bu.uit_kwaliteit
               AND p.kleur_code = bu.uit_kleur
               AND p.actief = true
               AND (p.product_type = 'overig'
                    OR p.karpi_code   ILIKE '%maatwerk%'
                    OR p.omschrijving ILIKE '%maatwerk%')
             ORDER BY
               (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
               (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
               (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
               p.artikelnr
             LIMIT 1)
         ) AS prijs
  FROM beste_uitwissel bu
),
rol_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.artikelnr,
         p.karpi_code,
         p.omschrijving
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.product_type = 'rol'
    AND p.actief = true
  ORDER BY p.kleur_code, p.artikelnr
),
eigen_maatwerk_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.verkoopprijs
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.actief = true
    AND (p.product_type = 'overig'
         OR p.karpi_code   ILIKE '%maatwerk%'
         OR p.omschrijving ILIKE '%maatwerk%')
  ORDER BY
    p.kleur_code,
    (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
    (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
    p.artikelnr
)
SELECT
  ku.kc                                          AS kleur_code,
  REPLACE(ku.kc, '.0', '')                       AS kleur_label,
  COALESCE(ra.omschrijving, '')                  AS omschrijving,
  COALESCE(mp.verkoopprijs_m2, ema.verkoopprijs) AS verkoopprijs_m2,
  mp.kostprijs_m2                                AS kostprijs_m2,
  (SELECT gewicht_per_m2_kg FROM kwaliteit_density) AS gewicht_per_m2_kg,
  mp.max_breedte_cm                              AS max_breedte_cm,
  ra.artikelnr                                   AS artikelnr,
  ra.karpi_code                                  AS karpi_code,
  COALESCE(er.aantal, 0)                         AS aantal_rollen,
  COALESCE(er.m2, 0)                             AS beschikbaar_m2,
  COALESCE(bu.aantal, 0)                         AS equiv_rollen,
  COALESCE(bu.m2, 0)                             AS equiv_m2,
  bu.uit_kwaliteit                               AS equiv_kwaliteit_code,
  uma.artikelnr                                  AS equiv_artikelnr,
  ump.prijs                                      AS equiv_m2_prijs
FROM kleur_universe ku
LEFT JOIN maatwerk_m2_prijzen mp
       ON mp.kwaliteit_code = p_kwaliteit AND mp.kleur_code = ku.kc
LEFT JOIN rol_artikel ra             ON ra.kleur_code = ku.kc
LEFT JOIN eigen_rollen er            ON er.kleur_code = ku.kc
LEFT JOIN beste_uitwissel bu         ON bu.onze_kleur = ku.kc
LEFT JOIN uit_maatwerk_artikel uma   ON uma.onze_kleur = ku.kc
LEFT JOIN uit_m2_prijs ump           ON ump.onze_kleur = ku.kc
LEFT JOIN eigen_maatwerk_artikel ema ON ema.kleur_code = ku.kc
ORDER BY ku.kc;
$function$


CREATE OR REPLACE FUNCTION public.koppel_edi_afleveradres(p_bericht_id bigint, p_debiteur_nr integer, p_afleveradres_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payload     JSONB;
  v_richting    TEXT;
  v_berichttype TEXT;
  v_gln_afl     TEXT;
  v_adres_deb   INTEGER;
  v_adres_gln   TEXT;
  v_botst_id    BIGINT;
  v_order_id    BIGINT;
BEGIN
  -- Bericht ophalen
  SELECT payload_parsed, richting, berichttype
    INTO v_payload, v_richting, v_berichttype
    FROM edi_berichten
   WHERE id = p_bericht_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'EDI-bericht % niet gevonden of zonder geparseerde payload', p_bericht_id;
  END IF;
  IF v_richting <> 'in' OR v_berichttype <> 'order' THEN
    RAISE EXCEPTION 'Koppelen kan alleen voor een inkomende order (bericht % is %/%)',
      p_bericht_id, v_richting, v_berichttype;
  END IF;

  v_gln_afl := NULLIF(v_payload->'header'->>'gln_afleveradres', '');
  IF v_gln_afl IS NULL THEN
    RAISE EXCEPTION 'Bericht % heeft geen aflever-GLN in de header — koppelen op afleveradres niet mogelijk',
      p_bericht_id;
  END IF;

  -- Afleveradres moet bij de gekozen debiteur horen
  SELECT debiteur_nr, gln_afleveradres
    INTO v_adres_deb, v_adres_gln
    FROM afleveradressen WHERE id = p_afleveradres_id;
  IF v_adres_deb IS NULL THEN
    RAISE EXCEPTION 'Afleveradres % bestaat niet', p_afleveradres_id;
  END IF;
  IF v_adres_deb <> p_debiteur_nr THEN
    RAISE EXCEPTION 'Afleveradres % hoort bij debiteur %, niet bij gekozen debiteur %',
      p_afleveradres_id, v_adres_deb, p_debiteur_nr;
  END IF;

  -- Guard: overschrijf geen bestaande ándere GLN op het gekozen adres (stille
  -- data-mutatie voorkomen — operator koos mogelijk de verkeerde vestiging).
  IF v_adres_gln IS NOT NULL AND v_adres_gln <> v_gln_afl THEN
    RAISE EXCEPTION 'Afleveradres % heeft al GLN % — koppel aan een ander adres of corrigeer eerst',
      p_afleveradres_id, v_adres_gln;
  END IF;

  -- Guard: een GLN is fysiek uniek aan één adres. Weiger als hij al ergens anders hangt.
  SELECT id INTO v_botst_id
    FROM afleveradressen
   WHERE gln_afleveradres = v_gln_afl
     AND id <> p_afleveradres_id
   LIMIT 1;
  IF v_botst_id IS NOT NULL THEN
    RAISE EXCEPTION 'Aflever-GLN % is al gekoppeld aan afleveradres % — los dat eerst op',
      v_gln_afl, v_botst_id;
  END IF;

  -- Onthoud de GLN op het gekozen afleveradres
  UPDATE afleveradressen
     SET gln_afleveradres = v_gln_afl
   WHERE id = p_afleveradres_id
     AND gln_afleveradres IS DISTINCT FROM v_gln_afl;

  -- Debiteur aan het bericht koppelen + foutstatus opschonen
  UPDATE edi_berichten
     SET debiteur_nr = p_debiteur_nr,
         status = 'Verwerkt',
         error_msg = NULL
   WHERE id = p_bericht_id;

  -- Order aanmaken (of bestaande teruggeven). create_edi_order matcht het
  -- afleveradres op de zojuist geschreven GLN en zet de adres-snapshot.
  v_order_id := create_edi_order(p_bericht_id, v_payload, p_debiteur_nr);

  RETURN v_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.koppel_edi_debiteur_alias(p_bericht_id bigint, p_debiteur_nr integer, p_gln text, p_reden text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payload     JSONB;
  v_richting    TEXT;
  v_berichttype TEXT;
  v_deb_status  TEXT;
  v_gln         TEXT := NULLIF(btrim(p_gln), '');
  v_botst_deb   INTEGER;
  v_order_id    BIGINT;
BEGIN
  SELECT payload_parsed, richting, berichttype
    INTO v_payload, v_richting, v_berichttype
    FROM edi_berichten
   WHERE id = p_bericht_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'EDI-bericht % niet gevonden of zonder geparseerde payload', p_bericht_id;
  END IF;
  IF v_richting <> 'in' OR v_berichttype <> 'order' THEN
    RAISE EXCEPTION 'Koppelen kan alleen voor een inkomende order (bericht % is %/%)',
      p_bericht_id, v_richting, v_berichttype;
  END IF;
  IF v_gln IS NULL THEN
    RAISE EXCEPTION 'Geen GLN opgegeven om als alias vast te leggen';
  END IF;

  SELECT status INTO v_deb_status FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF v_deb_status IS NULL THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  -- Guard: GLN mag niet al aan een ándere debiteur hangen (als alias of hoofd-GLN).
  SELECT debiteur_nr INTO v_botst_deb
    FROM debiteur_gln_aliassen
   WHERE gln IN (v_gln, v_gln || '.0') AND debiteur_nr <> p_debiteur_nr
   LIMIT 1;
  IF v_botst_deb IS NOT NULL THEN
    RAISE EXCEPTION 'GLN % is al alias van debiteur % — corrigeer dat eerst', v_gln, v_botst_deb;
  END IF;

  SELECT debiteur_nr INTO v_botst_deb
    FROM debiteuren
   WHERE gln_bedrijf IN (v_gln, v_gln || '.0') AND debiteur_nr <> p_debiteur_nr
   LIMIT 1;
  IF v_botst_deb IS NOT NULL THEN
    RAISE EXCEPTION 'GLN % is het hoofd-GLN van debiteur % — koppel daar de order aan', v_gln, v_botst_deb;
  END IF;

  -- Alias vastleggen (idempotent: zelfde GLN → geen dubbele rij).
  INSERT INTO debiteur_gln_aliassen (debiteur_nr, gln, rol, reden)
  VALUES (p_debiteur_nr, v_gln, 'gefactureerd', p_reden)
  ON CONFLICT (gln) DO NOTHING;

  -- Debiteur aan het bericht koppelen + foutstatus opschonen.
  UPDATE edi_berichten
     SET debiteur_nr = p_debiteur_nr,
         status = 'Verwerkt',
         error_msg = NULL
   WHERE id = p_bericht_id;

  -- Order aanmaken (of bestaande teruggeven). create_edi_order valt zonder
  -- afleveradres-match terug op het debiteur-adres als afl-snapshot.
  v_order_id := create_edi_order(p_bericht_id, v_payload, p_debiteur_nr);

  RETURN v_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.koppel_orderregel_aan_io(p_order_regel_id bigint, p_io_regel_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_io_te_leveren_m   NUMERIC;
  v_io_gebruikt_cm    INTEGER;
  v_resterend_cm      NUMERIC;
  v_totaal_bijdrage   INTEGER := 0;
  v_afwerking         TEXT;
  v_vorm              TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: zie stuk_snij_marge_cm (mig 464)
  v_marge             NUMERIC;
  v_bijdrage          INTEGER;
  v_stuk              RECORD;
  v_te_koppelen_ids   BIGINT[];
  v_oud_io_ids        BIGINT[];
  v_oud_io_bijdrages  INTEGER[];
  v_i                 INTEGER;
BEGIN
  -- ── Stap 1: verzamel stuks die van status wisselen ───────────────────────
  -- (stuks die al aan dezelfde IO zitten worden overgeslagen)
  FOR v_stuk IN
    SELECT sp.id, sp.breedte_cm, sp.lengte_cm,
           sp.verwacht_inkooporder_regel_id AS oud_io_id,
           oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
           COALESCE(k.standaard_breedte_cm, 400) AS standaard_breedte_cm
    FROM snijplannen sp
    JOIN order_regels oreg ON oreg.id = sp.order_regel_id
    LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
    LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
    WHERE sp.order_regel_id = p_order_regel_id
      AND sp.rol_id IS NULL
      AND sp.status IN ('Wacht', 'Gepland', 'Wacht op inkoop')
      AND (sp.verwacht_inkooporder_regel_id IS NULL
           OR sp.verwacht_inkooporder_regel_id <> p_io_regel_id)
    ORDER BY sp.id
    FOR UPDATE OF sp
  LOOP
    -- MARGE-2.5CM: bijdrage = placed_breedte_cm (Y-as, lente-richting)
    v_marge := stuk_snij_marge_cm(
      v_stuk.maatwerk_afwerking, v_stuk.maatwerk_vorm,
      v_stuk.lengte_cm, v_stuk.breedte_cm,
      v_stuk.standaard_breedte_cm);
    v_bijdrage := ROUND(v_stuk.breedte_cm::NUMERIC + v_marge)::INTEGER;

    v_te_koppelen_ids   := array_append(v_te_koppelen_ids, v_stuk.id);
    v_oud_io_ids        := array_append(v_oud_io_ids, v_stuk.oud_io_id);
    v_oud_io_bijdrages  := array_append(v_oud_io_bijdrages, v_bijdrage);
    v_totaal_bijdrage   := v_totaal_bijdrage + v_bijdrage;
  END LOOP;

  IF array_length(v_te_koppelen_ids, 1) IS NULL THEN
    -- Alle stuks al gekoppeld aan deze IO, of geen koppelbare stuks
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'geen_stuks_te_koppelen');
  END IF;

  -- ── Stap 2: valideer + vergrendel de IO-regel ────────────────────────────
  SELECT ir.te_leveren_m, ir.snijplan_gebruikte_lengte_cm
  INTO v_io_te_leveren_m, v_io_gebruikt_cm
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE ir.id = p_io_regel_id
    AND ir.eenheid = 'm'
    AND io.status IN ('Besteld', 'Deels ontvangen')
  FOR UPDATE OF ir;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'io_niet_gevonden:IO-regel % is niet gevonden of niet open', p_io_regel_id;
  END IF;

  v_resterend_cm := (v_io_te_leveren_m * 100) - v_io_gebruikt_cm;

  -- ── Stap 3: capaciteitscheck (conservatief: som van bijdrages) ───────────
  IF v_resterend_cm < v_totaal_bijdrage THEN
    RAISE EXCEPTION 'onvoldoende_ruimte:IO heeft %.1f m resterend, % stukken vereisen %.1f m (conservatief)',
      v_resterend_cm / 100.0,
      array_length(v_te_koppelen_ids, 1),
      v_totaal_bijdrage / 100.0;
  END IF;

  -- ── Stap 4: release stuks van hun oude IO (als anders) ───────────────────
  FOR v_i IN 1 .. array_length(v_te_koppelen_ids, 1)
  LOOP
    IF v_oud_io_ids[v_i] IS NOT NULL AND v_oud_io_ids[v_i] <> p_io_regel_id THEN
      UPDATE inkooporder_regels
      SET snijplan_gebruikte_lengte_cm =
            GREATEST(0, snijplan_gebruikte_lengte_cm - v_oud_io_bijdrages[v_i])
      WHERE id = v_oud_io_ids[v_i];
    END IF;
  END LOOP;

  -- ── Stap 5: koppel alle stuks aan de nieuwe IO ───────────────────────────
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = p_io_regel_id,
      status = 'Wacht op inkoop'
  WHERE id = ANY(v_te_koppelen_ids);

  -- ── Stap 6: update de IO-teller in één keer ──────────────────────────────
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm = snijplan_gebruikte_lengte_cm + v_totaal_bijdrage
  WHERE id = p_io_regel_id;

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'aantal_stuks', array_length(v_te_koppelen_ids, 1),
    'totaal_bijdrage_cm', v_totaal_bijdrage,
    'resterend_cm', v_resterend_cm - v_totaal_bijdrage
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.koppel_snijplan_aan_io(p_snijplan_id bigint, p_io_regel_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sp_status         TEXT;
  v_sp_rol_id         BIGINT;
  v_sp_oud_io_id      BIGINT;
  v_sp_breedte_cm     INTEGER;
  v_sp_lengte_cm      INTEGER;
  v_afwerking         TEXT;
  v_vorm              TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: stuk_snij_marge_cm geeft 2.5 voor rond/ovaal (mig 464);
  -- wijzig die functie als de werkvloer-marge verandert, niet hier.
  v_marge             NUMERIC;
  v_bijdrage_cm       INTEGER;
  v_io_te_leveren_m   NUMERIC;
  v_io_gebruikt_cm    INTEGER;
  v_resterend_cm      NUMERIC;
BEGIN
  -- ── Stap 1: haal stuk op + vergrendel ───────────────────────────────────
  SELECT sp.status, sp.rol_id, sp.verwacht_inkooporder_regel_id,
         sp.breedte_cm, sp.lengte_cm,
         oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
         COALESCE(k.standaard_breedte_cm, 400)
  INTO v_sp_status, v_sp_rol_id, v_sp_oud_io_id,
       v_sp_breedte_cm, v_sp_lengte_cm,
       v_afwerking, v_vorm,
       v_standaard_breedte
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
  WHERE sp.id = p_snijplan_id
  FOR UPDATE OF sp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snijplan_niet_gevonden:Stuk % bestaat niet', p_snijplan_id;
  END IF;

  IF v_sp_rol_id IS NOT NULL THEN
    RAISE EXCEPTION 'stuk_heeft_rol:Stuk % heeft al een rol — gebruik Verplaatsen', p_snijplan_id;
  END IF;

  IF v_sp_status NOT IN ('Wacht', 'Gepland', 'Wacht op inkoop') THEN
    RAISE EXCEPTION 'ongeldige_status:Stuk % heeft status % — kan niet koppelen',
      p_snijplan_id, v_sp_status;
  END IF;

  -- Al gekoppeld aan dezelfde IO → no-op
  IF v_sp_oud_io_id = p_io_regel_id THEN
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'al_gekoppeld');
  END IF;

  -- ── Stap 2: bijdrage berekenen ───────────────────────────────────────────
  -- MARGE-2.5CM: stuk_snij_marge_cm(afwerking, vorm, lengte, breedte, std_breedte)
  -- Wijzig mig 464 (stuk_snij_marge_cm) als de marge-waarde verandert.
  v_marge := stuk_snij_marge_cm(v_afwerking, v_vorm,
    v_sp_lengte_cm, v_sp_breedte_cm,
    v_standaard_breedte);
  -- bijdrage = placed_breedte_cm (Y-as = rollengterichting = lengte verbruikt van IO)
  v_bijdrage_cm := ROUND(v_sp_breedte_cm::NUMERIC + v_marge)::INTEGER;

  -- ── Stap 3: valideer de nieuwe IO-regel + vergrendel ────────────────────
  SELECT ir.te_leveren_m, ir.snijplan_gebruikte_lengte_cm
  INTO v_io_te_leveren_m, v_io_gebruikt_cm
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE ir.id = p_io_regel_id
    AND ir.eenheid = 'm'
    AND io.status IN ('Besteld', 'Deels ontvangen')
  FOR UPDATE OF ir;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'io_niet_gevonden:IO-regel % is niet gevonden of niet open', p_io_regel_id;
  END IF;

  v_resterend_cm := (v_io_te_leveren_m * 100) - v_io_gebruikt_cm;

  -- ── Stap 4: capaciteitscheck ─────────────────────────────────────────────
  -- Als het stuk al aan een andere IO zat, telt die vrijgave NIET mee voor de
  -- nieuwe IO (andere IO = andere teller). Dus: check puur de nieuwe IO.
  IF v_resterend_cm < v_bijdrage_cm THEN
    RAISE EXCEPTION 'onvoldoende_ruimte:IO heeft %.1f m resterend, stuk heeft %.1f m nodig (conservatief)',
      v_resterend_cm / 100.0, v_bijdrage_cm / 100.0;
  END IF;

  -- ── Stap 5: release van de oude IO (als aanwezig en anders) ─────────────
  IF v_sp_oud_io_id IS NOT NULL AND v_sp_oud_io_id <> p_io_regel_id THEN
    UPDATE inkooporder_regels
    SET snijplan_gebruikte_lengte_cm =
          GREATEST(0, snijplan_gebruikte_lengte_cm - v_bijdrage_cm)
    WHERE id = v_sp_oud_io_id;
  END IF;

  -- ── Stap 6: koppel het stuk aan de nieuwe IO ─────────────────────────────
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = p_io_regel_id,
      status = 'Wacht op inkoop'
  WHERE id = p_snijplan_id;

  -- ── Stap 7: verhoog het gebruik op de nieuwe IO ──────────────────────────
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm = snijplan_gebruikte_lengte_cm + v_bijdrage_cm
  WHERE id = p_io_regel_id;

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'bijdrage_cm', v_bijdrage_cm,
    'resterend_cm', v_resterend_cm - v_bijdrage_cm
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.levertijd_fit_check(p_regel_ids bigint[], p_gewenste_week text)
 RETURNS TABLE(regel_id bigint, haalbaar boolean, reden text, eerstvolgend_haalbaar text)
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
  v_cap_per_week     INTEGER;
  v_marge_pct        INTEGER;
  v_max_stuks        INTEGER;
  v_buffer_werkdagen INTEGER;
BEGIN
  -- 1) Config lezen (één keer; defaults bij ontbrekende keys)
  SELECT
    COALESCE((waarde->>'capaciteit_per_week')::INTEGER, 450),
    COALESCE((waarde->>'capaciteit_marge_pct')::INTEGER, 0),
    COALESCE((waarde->>'logistieke_buffer_dagen')::INTEGER, 2)
  INTO v_cap_per_week, v_marge_pct, v_buffer_werkdagen
  FROM app_config
  WHERE sleutel = 'productie_planning'
  LIMIT 1;

  -- Fallback als rij ontbreekt
  v_cap_per_week     := COALESCE(v_cap_per_week, 450);
  v_marge_pct        := COALESCE(v_marge_pct, 0);
  v_buffer_werkdagen := COALESCE(v_buffer_werkdagen, 2);
  v_max_stuks        := GREATEST(0, FLOOR(v_cap_per_week * (1 - v_marge_pct / 100.0))::INTEGER);

  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels             oreg ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd    v    ON v.order_regel_id = i.regel_id
  ),
  -- Maatwerk-bezetting per ISO-week (globale pool — productie_groep V2-backlog)
  bezetting_per_week AS (
    -- S1 (code-review ADR-0020): iso_week_plus = exact dezelfde to_char-bron
    -- als de weken_iterator (geen format-drift in de join). make_date(jaar,1,4)
    -- ligt gegarandeerd in ISO-week 1 van dat jaar. planning_week BETWEEN 1
    -- AND 53 containt garbage-data (week 53 in een 52-weken-jaar zou anders
    -- stil naar (jaar+1)-W01 lekken → capaciteit-overschatting → vals haalbaar).
    SELECT
      iso_week_plus(make_date(planning_jaar, 1, 4), planning_week - 1) AS iso_week,
      COUNT(*) AS huidig_stuks
    FROM snijplannen
    WHERE status IN ('Wacht', 'Gepland', 'Snijden')
      AND gesneden_datum IS NULL
      AND planning_week IS NOT NULL
      AND planning_jaar IS NOT NULL
      AND planning_week BETWEEN 1 AND 53
    GROUP BY planning_jaar, planning_week
  ),
  -- 12 weken vooruit-iterator vanaf p_gewenste_week (lex-vergelijk via ISO-string)
  weken_iterator AS (
    SELECT
      to_char(date_trunc('week', current_date)::date + (n * 7)::INTEGER,
              'IYYY-"W"IW') AS iso_week,
      n AS offset_weken
    FROM generate_series(0, 12) AS n
  ),
  -- Per regel: eerstvolgende ISO-week ≥ p_gewenste_week met capaciteit-ruimte
  eerstvolgend_maatwerk AS (
    SELECT
      i.iso_week,
      i.offset_weken,
      (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM weken_iterator i
    LEFT JOIN bezetting_per_week b ON b.iso_week = i.iso_week
    WHERE i.iso_week >= p_gewenste_week
      AND (v_max_stuks - COALESCE(b.huidig_stuks, 0)) > 0
    ORDER BY i.iso_week ASC
    LIMIT 1
  ),
  -- Capaciteit van de specifieke gewenste-week (voor haalbaar-bool)
  gewenste_week_capaciteit AS (
    SELECT (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM (SELECT p_gewenste_week AS iso_week) g
    LEFT JOIN bezetting_per_week b ON b.iso_week = g.iso_week
  )
  SELECT
    rd.regel_id,
    CASE
      -- Maatwerk: capaciteit-match
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE((SELECT ruimte > 0 FROM gewenste_week_capaciteit), TRUE)
      -- Voorraad-pad: sentinel 'voorraad' = altijd haalbaar
      WHEN rd.verwachte_leverweek = 'voorraad' THEN TRUE
      -- Geen view-rij + geen status → conservatief haalbaar
      WHEN rd.verwachte_leverweek IS NULL AND rd.levertijd_status IS NULL THEN TRUE
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN FALSE
      WHEN rd.verwachte_leverweek IS NOT NULL
        THEN rd.verwachte_leverweek <= p_gewenste_week
      ELSE TRUE
    END AS haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        CASE
          WHEN COALESCE((SELECT ruimte > 0 FROM gewenste_week_capaciteit), TRUE)
            THEN NULL
          ELSE 'snij-capaciteit vol in week ' || p_gewenste_week
        END
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN 'wacht op nieuwe inkoop'
      WHEN rd.verwachte_leverweek IS NOT NULL AND rd.verwachte_leverweek > p_gewenste_week
        THEN CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr
          ELSE 'op inkoop'
        END
      WHEN rd.levertijd_status = 'op_inkoop' THEN
        CASE WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr ELSE 'op inkoop' END
      ELSE NULL
    END AS reden,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE(
          (SELECT iso_week FROM eerstvolgend_maatwerk),
          p_gewenste_week
        )
      WHEN rd.verwachte_leverweek = 'voorraad' THEN p_gewenste_week
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN NULL
      WHEN rd.verwachte_leverweek IS NOT NULL THEN rd.verwachte_leverweek
      ELSE p_gewenste_week
    END AS eerstvolgend_haalbaar
  FROM regel_data rd;
END;
$function$


CREATE OR REPLACE FUNCTION public.levertijd_snelste_haalbaar(p_regel_ids bigint[])
 RETURNS TABLE(regel_id bigint, snelste_haalbaar text, spoed_uitleg text)
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
  v_cap_per_week     INTEGER;
  v_marge_pct        INTEGER;
  v_max_stuks        INTEGER;
  v_buffer_werkdagen INTEGER;
  v_huidige_week     TEXT;
BEGIN
  -- 1) Config (idem als fit_check)
  SELECT
    COALESCE((waarde->>'capaciteit_per_week')::INTEGER, 450),
    COALESCE((waarde->>'capaciteit_marge_pct')::INTEGER, 0),
    COALESCE((waarde->>'logistieke_buffer_dagen')::INTEGER, 2)
  INTO v_cap_per_week, v_marge_pct, v_buffer_werkdagen
  FROM app_config
  WHERE sleutel = 'productie_planning'
  LIMIT 1;

  v_cap_per_week     := COALESCE(v_cap_per_week, 450);
  v_marge_pct        := COALESCE(v_marge_pct, 0);
  v_buffer_werkdagen := COALESCE(v_buffer_werkdagen, 2);
  v_max_stuks        := GREATEST(0, FLOOR(v_cap_per_week * (1 - v_marge_pct / 100.0))::INTEGER);
  v_huidige_week     := to_char(current_date, 'IYYY-"W"IW');

  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels             oreg ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd    v    ON v.order_regel_id = i.regel_id
  ),
  bezetting_per_week AS (
    -- S1 (code-review ADR-0020): iso_week_plus = exact dezelfde to_char-bron
    -- als de weken_iterator (geen format-drift in de join). make_date(jaar,1,4)
    -- ligt gegarandeerd in ISO-week 1 van dat jaar. planning_week BETWEEN 1
    -- AND 53 containt garbage-data (week 53 in een 52-weken-jaar zou anders
    -- stil naar (jaar+1)-W01 lekken → capaciteit-overschatting → vals haalbaar).
    SELECT
      iso_week_plus(make_date(planning_jaar, 1, 4), planning_week - 1) AS iso_week,
      COUNT(*) AS huidig_stuks
    FROM snijplannen
    WHERE status IN ('Wacht', 'Gepland', 'Snijden')
      AND gesneden_datum IS NULL
      AND planning_week IS NOT NULL
      AND planning_jaar IS NOT NULL
      AND planning_week BETWEEN 1 AND 53
    GROUP BY planning_jaar, planning_week
  ),
  -- Scan 12 weken vooruit vanaf huidige_week + buffer-werkdagen (≈ kalenderdagen)
  -- We benaderen werkdagen → kalenderdagen × (7/5) en flooren naar week.
  -- Voor de RPC is de granulariteit week, dus week-vooruit is voldoende.
  weken_iterator AS (
    SELECT
      to_char(date_trunc('week', current_date)::date + (n * 7)::INTEGER,
              'IYYY-"W"IW') AS iso_week,
      n AS offset_weken
    FROM generate_series(0, 12) AS n
  ),
  -- Eerstvolgende week ≥ huidige met ruimte (voor maatwerk-tak)
  snelste_maatwerk AS (
    SELECT
      i.iso_week,
      i.offset_weken,
      (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM weken_iterator i
    LEFT JOIN bezetting_per_week b ON b.iso_week = i.iso_week
    WHERE (v_max_stuks - COALESCE(b.huidig_stuks, 0)) > 0
    ORDER BY i.iso_week ASC
    LIMIT 1
  )
  SELECT
    rd.regel_id,
    CASE
      -- Maatwerk: eerstvolgende week met ruimte (fallback: huidige + 2 weken zoals stub)
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE(
          (SELECT iso_week FROM snelste_maatwerk),
          to_char(current_date + INTERVAL '2 weeks', 'IYYY-"W"IW')
        )
      WHEN rd.verwachte_leverweek = 'voorraad'
        THEN v_huidige_week
      WHEN rd.verwachte_leverweek IS NULL THEN NULL
      ELSE rd.verwachte_leverweek
    END AS snelste_haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        CASE
          WHEN (SELECT offset_weken FROM snelste_maatwerk) IS NULL
            THEN 'snij-planning vol komende 12 weken — pessimistische schatting'
          WHEN (SELECT offset_weken FROM snelste_maatwerk) = 0
            THEN 'spoed-slot: capaciteit beschikbaar deze week'
          WHEN (SELECT offset_weken FROM snelste_maatwerk) = 1
            THEN 'eerstvolgende vrije snij-week'
          ELSE 'eerstvolgende vrije snij-week (' || (SELECT offset_weken FROM snelste_maatwerk) || ' weken vooruit)'
        END
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad onmiddellijk'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop'
        THEN 'wacht op nieuwe inkoop — geen ETA bekend'
      WHEN rd.verwachte_leverweek IS NOT NULL THEN
        CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'eerstvolgende IO ' || rd.eerste_io_nr
          ELSE 'eerstvolgende inkoop'
        END
      ELSE NULL
    END AS spoed_uitleg
  FROM regel_data rd;
END;
$function$


CREATE OR REPLACE FUNCTION public.lock_orderregel_vervoerder()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.vervoerder_code IS NOT DISTINCT FROM OLD.vervoerder_code THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
     WHERE zr.order_regel_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'Vervoerder van orderregel % kan niet meer worden gewijzigd: er bestaat al een zending voor deze regel',
      NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.log_edi_inkomend(p_transactie_id text, p_berichttype text, p_payload_raw text, p_payload_parsed jsonb, p_debiteur_nr integer, p_is_test boolean, p_initial_status edi_bericht_status DEFAULT 'Verwerkt'::edi_bericht_status)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  -- Check op bestaande rij (idempotent)
  SELECT id INTO v_id FROM edi_berichten
   WHERE transactie_id = p_transactie_id AND richting = 'in';

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO edi_berichten (
    richting, berichttype, status, transactie_id,
    debiteur_nr, payload_raw, payload_parsed, is_test, sent_at
  ) VALUES (
    'in', p_berichttype, p_initial_status, p_transactie_id,
    p_debiteur_nr, p_payload_raw, p_payload_parsed, p_is_test, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.log_externe_payload(p_kanaal text, p_payload_raw text, p_bron text DEFAULT NULL::text, p_externe_id text DEFAULT NULL::text, p_content_type text DEFAULT NULL::text, p_headers jsonb DEFAULT NULL::jsonb, p_payload_json jsonb DEFAULT NULL::jsonb, p_richting text DEFAULT 'in'::text, p_order_id bigint DEFAULT NULL::bigint, p_status text DEFAULT 'ontvangen'::text, p_fout text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO externe_payloads (
    kanaal, bron, externe_id, richting, content_type, headers,
    payload_raw, payload_json, order_id, status, fout,
    verwerkt_op
  ) VALUES (
    p_kanaal, p_bron, p_externe_id, COALESCE(p_richting, 'in'), p_content_type, p_headers,
    p_payload_raw, p_payload_json, p_order_id, COALESCE(p_status, 'ontvangen'), p_fout,
    -- Outbound calls leveren meteen een eindstatus → meteen verwerkt_op stempelen.
    CASE WHEN COALESCE(p_status, 'ontvangen') IN ('verwerkt', 'fout') THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.log_inkomende_payload(p_kanaal text, p_payload_raw text, p_bron text DEFAULT NULL::text, p_externe_id text DEFAULT NULL::text, p_content_type text DEFAULT NULL::text, p_headers jsonb DEFAULT NULL::jsonb, p_payload_json jsonb DEFAULT NULL::jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT log_externe_payload(
    p_kanaal, p_payload_raw, p_bron, p_externe_id, p_content_type, p_headers, p_payload_json
  );
$function$


CREATE OR REPLACE FUNCTION public.maak_colli_bundel(p_zending_id bigint, p_colli_ids bigint[], p_gewicht_kg numeric DEFAULT NULL::numeric, p_lengte_cm integer DEFAULT NULL::integer, p_breedte_cm integer DEFAULT NULL::integer, p_pallet_type text DEFAULT NULL::text, p_hoogte_cm integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status          TEXT;
  v_vervoerder      TEXT;
  v_handmatig       BOOLEAN;
  v_aantal_kinderen INTEGER;
  v_valid_count     INTEGER;
  v_gewicht         NUMERIC;
  v_lengte          INTEGER;
  v_breedte         INTEGER;
  v_volgnr          INTEGER;
  v_bundel_id       BIGINT;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  -- Mig 421: bundelen mag tijdens de pickronde ('Picken') én erna ('Klaar voor verzending').
  IF v_status NOT IN ('Picken', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Bundelen kan alleen tijdens of net na de pickronde (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  SELECT handmatig_aanmelden INTO v_handmatig FROM vervoerders WHERE code = v_vervoerder;
  IF NOT COALESCE(v_handmatig, FALSE) THEN
    RAISE EXCEPTION 'Colli-bundeling is alleen toegestaan voor bundel-vervoerders (zending % -> %)',
      p_zending_id, COALESCE(v_vervoerder, '(geen)');
  END IF;

  -- Mig 485/489/491: pallet-type alleen EP/SP/MP/PLH (HST) of PLTS/HPLT (Rhenus).
  -- De CHECK op de kolom borgt dit ook; deze RAISE geeft een leesbare melding vóór de INSERT.
  IF p_pallet_type IS NOT NULL AND p_pallet_type NOT IN ('EP', 'SP', 'MP', 'PLH', 'PLTS', 'HPLT') THEN
    RAISE EXCEPTION 'Onbekend pallet-type % (verwacht EP/SP/MP/PLH voor HST of PLTS/HPLT voor Rhenus)', p_pallet_type;
  END IF;

  v_aantal_kinderen := COALESCE(array_length(p_colli_ids, 1), 0);
  IF v_aantal_kinderen < 2 THEN
    RAISE EXCEPTION 'Een bundel vereist minstens 2 colli (gekregen: %)', v_aantal_kinderen;
  END IF;

  -- Alle opgegeven colli moeten bij deze zending horen, zelf geen bundel zijn en
  -- nog niet gebundeld zijn.
  SELECT COUNT(*) INTO v_valid_count
    FROM zending_colli
   WHERE id = ANY(p_colli_ids)
     AND zending_id = p_zending_id
     AND is_bundel = FALSE
     AND bundel_colli_id IS NULL;
  IF v_valid_count <> v_aantal_kinderen THEN
    RAISE EXCEPTION 'Niet alle colli zijn geldig (zending %, geen bundel, nog niet gebundeld): % van % geldig',
      p_zending_id, v_valid_count, v_aantal_kinderen;
  END IF;

  -- Gewicht = som, maat = max van de kinderen; expliciete parameters winnen.
  SELECT COALESCE(p_gewicht_kg, SUM(gewicht_kg)),
         COALESCE(p_lengte_cm,  MAX(lengte_cm)),
         COALESCE(p_breedte_cm, MAX(breedte_cm))
    INTO v_gewicht, v_lengte, v_breedte
    FROM zending_colli
   WHERE id = ANY(p_colli_ids);

  -- Mig 489: Rhenus-pallet draagt een VASTE footprint (depth=lengte, width=breedte),
  -- niet de max-van-de-rollen. Vult alleen als de caller geen expliciete maat gaf
  -- (expliciete param wint nog — de frontend stuurt sinds mig 490 de footprint mee).
  -- EP/SP/MP/PLH (HST) blijven op max — HST prijst op PackageUnitID, niet op dims.
  IF p_pallet_type = 'PLTS' THEN
    v_lengte  := COALESCE(p_lengte_cm, 80);
    v_breedte := COALESCE(p_breedte_cm, 120);
  ELSIF p_pallet_type = 'HPLT' THEN
    v_lengte  := COALESCE(p_lengte_cm, 80);
    v_breedte := COALESCE(p_breedte_cm, 60);
  END IF;

  IF COALESCE(v_gewicht, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-gewicht moet > 0 zijn (carrier-preflight); kreeg %', v_gewicht;
  END IF;
  IF COALESCE(v_lengte, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-lengte moet > 0 zijn (carrier-preflight); kreeg %', v_lengte;
  END IF;

  SELECT COALESCE(MAX(colli_nr), 0) + 1 INTO v_volgnr
    FROM zending_colli WHERE zending_id = p_zending_id;

  INSERT INTO zending_colli (
    zending_id, colli_nr, order_regel_id, rol_id, sscc, gewicht_kg,
    omschrijving_snapshot, klant_omschrijving_snapshot, lengte_cm, breedte_cm, hoogte_cm, aantal,
    is_bundel, pallet_type
  ) VALUES (
    p_zending_id, v_volgnr, NULL, NULL, genereer_sscc(), v_gewicht,
    NULL, 'BUNDEL — ' || v_aantal_kinderen || ' colli', v_lengte, v_breedte, p_hoogte_cm, 1,
    TRUE, p_pallet_type
  ) RETURNING id INTO v_bundel_id;

  UPDATE zending_colli SET bundel_colli_id = v_bundel_id WHERE id = ANY(p_colli_ids);

  RETURN v_bundel_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.maak_creditfactuur(p_factuur_id bigint, p_reden text DEFAULT NULL::text, p_factuur_regel_ids bigint[] DEFAULT NULL::bigint[], p_deelcredit_regels jsonb DEFAULT NULL::jsonb, p_los_bedrag numeric DEFAULT NULL::numeric, p_los_bedrag_incl_btw boolean DEFAULT NULL::boolean, p_los_reden text DEFAULT NULL::text, p_voorraad_bijwerken boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orig               facturen%ROWTYPE;
  v_nieuwe_id          BIGINT;
  v_nieuwe_nr          TEXT;
  v_subtotaal          NUMERIC;
  v_btw_bedrag         NUMERIC;
  v_btw_pct            NUMERIC;
  v_bedrag_excl        NUMERIC;
  v_is_volledig        BOOLEAN;
  v_reeds_gecrediteerd NUMERIC;
  v_credit_totaal      NUMERIC;
BEGIN
  v_is_volledig := (
    p_factuur_regel_ids  IS NULL AND
    p_deelcredit_regels  IS NULL AND
    p_los_bedrag         IS NULL
  );

  SELECT * INTO v_orig FROM facturen WHERE id = p_factuur_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_orig.credit_voor_factuur_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factuur % is zelf al een creditfactuur — kan niet opnieuw gecrediteerd worden', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_is_volledig AND EXISTS (
    SELECT 1 FROM facturen WHERE credit_voor_factuur_id = p_factuur_id
  ) THEN
    RAISE EXCEPTION 'Factuur % is al (deels) gecrediteerd; gebruik deelcredit of los bedrag', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_btw_pct := CASE
    WHEN v_orig.btw_verlegd = TRUE THEN 0
    ELSE COALESCE(v_orig.btw_percentage, 0)
  END;

  IF p_los_bedrag IS NOT NULL THEN
    IF p_los_bedrag_incl_btw = TRUE THEN
      v_bedrag_excl := ROUND(p_los_bedrag / (1 + v_btw_pct / 100), 2);
    ELSE
      v_bedrag_excl := p_los_bedrag;
    END IF;
    v_subtotaal  := v_bedrag_excl;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    SELECT COALESCE(SUM(
      ROUND(
        fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100),
        2
      )
    ), 0) INTO v_subtotaal
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);

  ELSIF v_is_volledig THEN
    v_subtotaal  := ABS(v_orig.subtotaal);
    v_btw_bedrag := ABS(v_orig.btw_bedrag);

  ELSE
    SELECT COALESCE(SUM(ABS(bedrag)), 0) INTO v_subtotaal
      FROM factuur_regels
     WHERE id = ANY(p_factuur_regel_ids) AND factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  END IF;

  SELECT COALESCE(SUM(ABS(totaal)), 0) INTO v_reeds_gecrediteerd
    FROM facturen WHERE credit_voor_factuur_id = p_factuur_id;
  v_credit_totaal := v_subtotaal + v_btw_bedrag;

  IF v_reeds_gecrediteerd + v_credit_totaal > ABS(v_orig.totaal) + 0.01 THEN
    RAISE EXCEPTION
      'Creditbedrag (€%.2f) overschrijdt het resterende kredietlimiet (€%.2f — debetbedrag €%.2f, al gecrediteerd €%.2f)',
      v_credit_totaal,
      ABS(v_orig.totaal) - v_reeds_gecrediteerd,
      ABS(v_orig.totaal),
      v_reeds_gecrediteerd
      USING ERRCODE = 'check_violation';
  END IF;

  v_nieuwe_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    opmerkingen, btw_nummer, btw_verlegd, btw_regeling,
    credit_voor_factuur_id
  ) VALUES (
    v_nieuwe_nr, v_orig.debiteur_nr, CURRENT_DATE, v_orig.vervaldatum, 'Concept',
    -v_subtotaal, v_orig.btw_percentage, -v_btw_bedrag, -(v_subtotaal + v_btw_bedrag),
    v_orig.fact_naam, v_orig.fact_adres, v_orig.fact_postcode, v_orig.fact_plaats, v_orig.fact_land,
    COALESCE(p_reden, 'Creditfactuur voor ' || v_orig.factuur_nr),
    v_orig.btw_nummer, v_orig.btw_verlegd, v_orig.btw_regeling,
    p_factuur_id
  ) RETURNING id INTO v_nieuwe_id;

  IF p_los_bedrag IS NOT NULL THEN
    -- order_regel_id = NULL: geen order-regelkoppeling (los bedrag, niet aan een specifieke
    -- orderregel gebonden). order_id ook NULL: geen order-koppeling.
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_nieuwe_id, NULL, NULL, 1,
      COALESCE(p_los_reden, 'Creditering (los bedrag)'),
      1, -v_bedrag_excl, 0, -v_bedrag_excl, v_orig.btw_percentage
    );

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    -- order_regel_id = NULL: de UNIQUE-index staat één rij per order_regel_id toe;
    -- de originele factuurregel bezet die sleutel al. order_id wél kopiëren.
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, klant_referentie,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    )
    SELECT
      v_nieuwe_id, NULL, fr.order_id,
      ROW_NUMBER() OVER (ORDER BY fr.regelnummer),
      fr.artikelnr, fr.omschrijving, fr.omschrijving_2,
      fr.uw_referentie, fr.order_nr, fr.klant_referentie,
      dc.aantal, fr.prijs, fr.korting_pct,
      -ROUND(fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100), 2),
      fr.btw_percentage
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;

  ELSIF v_is_volledig THEN
    -- order_regel_id = NULL: zelfde reden als deelcredit. order_id kopiëren.
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, klant_referentie,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    )
    SELECT
      v_nieuwe_id, NULL, fr.order_id,
      ROW_NUMBER() OVER (ORDER BY fr.regelnummer),
      fr.artikelnr, fr.omschrijving, fr.omschrijving_2,
      fr.uw_referentie, fr.order_nr, fr.klant_referentie,
      fr.aantal, fr.prijs, fr.korting_pct, -ABS(fr.bedrag),
      fr.btw_percentage
    FROM factuur_regels fr
    WHERE fr.factuur_id = p_factuur_id;

  ELSE
    -- Modus A: geselecteerde regels. order_regel_id = NULL (UNIQUE-constraint).
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, klant_referentie,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    )
    SELECT
      v_nieuwe_id, NULL, fr.order_id,
      ROW_NUMBER() OVER (ORDER BY fr.regelnummer),
      fr.artikelnr, fr.omschrijving, fr.omschrijving_2,
      fr.uw_referentie, fr.order_nr, fr.klant_referentie,
      fr.aantal, fr.prijs, fr.korting_pct, -ABS(fr.bedrag),
      fr.btw_percentage
    FROM factuur_regels fr
    WHERE fr.id = ANY(p_factuur_regel_ids) AND fr.factuur_id = p_factuur_id;
  END IF;

  IF p_voorraad_bijwerken THEN
    -- Hoog voorraad op én herbereken vrije_voorraad via de centrale functie.
    UPDATE producten p
    SET voorraad = voorraad + sub.aantal
    FROM (
      SELECT fr.artikelnr, SUM(ABS(fr.aantal)) AS aantal
      FROM factuur_regels fr
      WHERE fr.factuur_id = v_nieuwe_id
        AND fr.artikelnr IS NOT NULL
        AND NOT COALESCE((SELECT is_pseudo FROM producten WHERE artikelnr = fr.artikelnr), FALSE)
      GROUP BY fr.artikelnr
    ) sub
    WHERE p.artikelnr = sub.artikelnr;

    PERFORM herbereken_product_reservering(fr.artikelnr)
    FROM factuur_regels fr
    WHERE fr.factuur_id = v_nieuwe_id
      AND fr.artikelnr IS NOT NULL
      AND NOT COALESCE((SELECT is_pseudo FROM producten WHERE artikelnr = fr.artikelnr), FALSE);
  END IF;

  RETURN v_nieuwe_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.maak_reststuk(p_rol_id bigint, p_lengte_cm integer, p_breedte_cm integer)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rol rollen%ROWTYPE;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
BEGIN
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;

  IF v_rol.id IS NULL THEN
    RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id;
  END IF;

  v_reststuk_nr := volgend_nummer('REST');

  INSERT INTO rollen (
    rolnummer, artikelnr, karpi_code, omschrijving,
    lengte_cm, breedte_cm, oppervlak_m2,
    vvp_m2, waarde,
    kwaliteit_code, kleur_code, zoeksleutel,
    status, locatie_id, oorsprong_rol_id, reststuk_datum
  )
  VALUES (
    v_reststuk_nr,
    v_rol.artikelnr, v_rol.karpi_code,
    'Reststuk van ' || v_rol.rolnummer,
    p_lengte_cm, p_breedte_cm,
    ROUND(p_lengte_cm::NUMERIC * p_breedte_cm::NUMERIC / 10000, 2),
    v_rol.vvp_m2,
    ROUND(p_lengte_cm::NUMERIC * p_breedte_cm::NUMERIC / 10000 * COALESCE(v_rol.vvp_m2, 0), 2),
    v_rol.kwaliteit_code, v_rol.kleur_code, v_rol.zoeksleutel,
    'reststuk', v_rol.locatie_id, p_rol_id, now()
  )
  RETURNING id INTO v_reststuk_id;

  -- Log the mutation
  INSERT INTO voorraad_mutaties (rol_id, type, lengte_cm, breedte_cm, referentie_id, referentie_type, notitie)
  VALUES (v_reststuk_id, 'reststuk', p_lengte_cm, p_breedte_cm, p_rol_id, 'rol', 'Reststuk aangemaakt van rol ' || v_rol.rolnummer);

  RETURN v_reststuk_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.manco_niet_leverbaar(p_order_regel_id bigint, p_corrigeer_voorraad boolean DEFAULT true, p_reden text DEFAULT NULL::text, p_actie text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_actie := COALESCE(p_actie, CASE WHEN v_land = 'NL' THEN 'backorder' ELSE 'annuleren' END);

  SELECT COALESCE(SUM(zr.manco_aantal), 0) INTO v_manco_qty
    FROM zending_regels zr WHERE zr.order_regel_id = p_order_regel_id;
  IF v_manco_qty <= 0 THEN v_manco_qty := 1; END IF;

  -- Voorraad-correctie (spookvoorraad weg). Maatwerk slaat dit over.
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
$function$


CREATE OR REPLACE FUNCTION public.manco_terug_naar_pickship(p_order_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_order_id BIGINT; v_status order_status;
BEGIN
  SELECT ore.order_id, o.status INTO v_order_id, v_status
    FROM order_regels ore JOIN orders o ON o.id = ore.order_id
   WHERE ore.id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE order_regels
     SET pick_backorder_sinds = NULL, pick_backorder_reden = NULL
   WHERE id = p_order_regel_id;

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (v_order_id, 'manco_terug_naar_pickship', v_status,
          jsonb_build_object('order_regel_id', p_order_regel_id, 'migratie', 516));

  PERFORM herbereken_wacht_status(v_order_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_achteraf_verzonden(p_order_id bigint, p_verzenddatum date DEFAULT CURRENT_DATE, p_afhalen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status              order_status;
  v_order_nr            TEXT;
  v_zending_id          BIGINT;
  v_zending_nr          TEXT;
  v_affected_rollen     BIGINT[];
  v_io_regel_ids        BIGINT[];
  v_herbereken_ids      TEXT[];
  v_artikel             TEXT;
  v_zend_id             BIGINT;
  -- voor de verzonden-claims-loop
  v_regel_id            BIGINT;
  v_artikelnr           TEXT;
  v_te_leveren          INTEGER;
  v_stuks_artikelnr     TEXT;
  v_stuks_per_doos      INTEGER;
  v_reserveer_artikelnr TEXT;
  v_reserveer_aantal    INTEGER;
BEGIN
  -- ── §A: Validatie + row-lock ───────────────────────────────────────────────
  SELECT o.status, o.order_nr
    INTO v_status, v_order_nr
    FROM orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % niet gevonden', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status IN ('Verzonden', 'Geannuleerd', 'Deels verzonden') THEN
    RAISE EXCEPTION
      'Order % heeft status "%" en kan niet als afgehandeld worden gemarkeerd.',
      v_order_nr, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hard block: snijmachine is fysiek bezig
  IF EXISTS (
    SELECT 1
      FROM snijplannen sp
      JOIN order_regels oreg ON oreg.id = sp.order_regel_id
     WHERE oreg.order_id = p_order_id
       AND sp.status IN ('Snijden', 'Gesneden')
  ) THEN
    RAISE EXCEPTION
      'Order % heeft snijplannen in uitvoering (status "Snijden" of "Gesneden"). '
      'Stop de snijplanning eerst voordat je de order als afgehandeld markeert.',
      v_order_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hard block: actieve pickronde (labels geprint, carrier genotificeerd)
  IF EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = p_order_id
       AND z.status IN ('Picken', 'Klaar voor verzending')
  ) THEN
    RAISE EXCEPTION
      'Order % heeft een actieve pickronde (status "Picken" of "Klaar voor verzending"). '
      'Annuleer eerst de pickronde voordat je de order als afgehandeld markeert.',
      v_order_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── §B: Snijplannen annuleren + rollen vrijgeven + IO-snapshots wissen ─────
  -- Spiegelt trg_order_events_snijplan_release (mig 290/442) maar direct,
  -- zonder een 'geannuleerd'-event_type te schieten (we gaan naar Verzonden).
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = p_order_id
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.rol_id, sp.verwacht_inkooporder_regel_id
  )
  SELECT
    COALESCE(
      ARRAY_AGG(DISTINCT rol_id)
        FILTER (WHERE rol_id IS NOT NULL),
      ARRAY[]::BIGINT[]
    ),
    COALESCE(
      ARRAY_AGG(DISTINCT verwacht_inkooporder_regel_id)
        FILTER (WHERE verwacht_inkooporder_regel_id IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_affected_rollen, v_io_regel_ids
    FROM cancelled;

  -- Rollen vrijgeven die hun laatste actieve snijplan verloren
  -- NOT EXISTS-guard: rol kan nog andere (niet-geannuleerde) stukken bedienen
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status             = CASE
                                  WHEN ro.oorsprong_rol_id IS NOT NULL
                                  THEN 'reststuk'
                                  ELSE 'beschikbaar'
                                END,
           snijden_gestart_op = NULL
     WHERE ro.id = ANY(v_affected_rollen)
       AND ro.status = 'in_snijplan'
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn
          WHERE sn.rol_id = ro.id
            AND sn.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  -- IO-claim-snapshots wissen (inkooporder_regels.snijplan_gebruikte_lengte_cm)
  -- Spiegelt het claim-wis-deel van release_wacht_op_inkoop_stukken (mig 438/445):
  -- de stukken zijn Geannuleerd dus de IO-lengte-claim verdwijnt volledig.
  IF COALESCE(array_length(v_io_regel_ids, 1), 0) > 0 THEN
    UPDATE inkooporder_regels
       SET snijplan_gebruikte_lengte_cm = 0
     WHERE id = ANY(v_io_regel_ids);
  END IF;

  -- ── §C: Actieve reserveringen wissen → herberekenen → verzonden-claims ─────
  -- 1. Verzamel alle fysieke artikelnrs die actieve claims hebben (voor
  --    herberekening vrije_voorraad ná de delete).
  SELECT COALESCE(ARRAY_AGG(DISTINCT r.fysiek_artikelnr), ARRAY[]::TEXT[])
    INTO v_herbereken_ids
    FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
   WHERE oreg.order_id = p_order_id
     AND r.status = 'actief';

  -- 2. Delete alle actieve claims (voorraad + IO)
  DELETE FROM order_reserveringen r
   USING order_regels oreg
   WHERE oreg.id = r.order_regel_id
     AND oreg.order_id = p_order_id
     AND r.status = 'actief';

  -- 3. Herbereken vrije_voorraad voor geraakte artikelen
  --    (geeft IO-bezetting vrij zodat andere orders die IO kunnen claimen)
  IF COALESCE(array_length(v_herbereken_ids, 1), 0) > 0 THEN
    FOREACH v_artikel IN ARRAY v_herbereken_ids LOOP
      PERFORM herbereken_product_reservering(v_artikel);
    END LOOP;
  END IF;

  -- 4. Aanmaken verzonden-claims (mirrort §C van registreer_achteraf_order):
  --    status='verzonden' zodat vrije_voorraad correct daalt voor toekomstige orders.
  FOR v_regel_id, v_artikelnr, v_te_leveren IN
    SELECT oreg.id, oreg.artikelnr, oreg.te_leveren
      FROM order_regels oreg
     WHERE oreg.order_id = p_order_id
       AND oreg.artikelnr IS NOT NULL
       AND NOT COALESCE(oreg.is_vrije_regel, FALSE)
       AND NOT is_admin_pseudo(oreg.artikelnr)
       AND COALESCE(oreg.te_leveren, 0) > 0
  LOOP
    -- Doos-artikel? → reserve op stuks_artikelnr × stuks_per_doos (mig 408)
    SELECT stuks_artikelnr, stuks_per_doos
      INTO v_stuks_artikelnr, v_stuks_per_doos
      FROM producten
     WHERE artikelnr = v_artikelnr;

    IF v_stuks_artikelnr IS NOT NULL AND v_stuks_per_doos IS NOT NULL THEN
      v_reserveer_artikelnr := v_stuks_artikelnr;
      v_reserveer_aantal    := v_te_leveren * v_stuks_per_doos;
    ELSE
      v_reserveer_artikelnr := v_artikelnr;
      v_reserveer_aantal    := v_te_leveren;
    END IF;

    INSERT INTO order_reserveringen (
      order_regel_id, fysiek_artikelnr,
      bron, status, aantal, is_handmatig
    ) VALUES (
      v_regel_id,
      v_reserveer_artikelnr,
      'voorraad',
      'verzonden',
      v_reserveer_aantal,
      FALSE
    ) ON CONFLICT DO NOTHING;

    PERFORM herbereken_product_reservering(v_reserveer_artikelnr);
  END LOOP;

  -- ── §D: Gepland-deelzendingen verwijderen ────────────────────────────────
  -- Status='Gepland' = deelzending aangemaakt maar nog niet gestart (mig 477).
  -- Veilig te verwijderen: er zijn geen labels geprint, geen carrier-notificatie.
  -- Verwijder in de juiste FK-volgorde (spiegelt annuleer_pickronde, mig 398).
  FOR v_zend_id IN
    SELECT z.id
      FROM zendingen z
      JOIN zending_orders zo ON zo.zending_id = z.id
     WHERE zo.order_id = p_order_id
       AND z.status    = 'Gepland'
  LOOP
    DELETE FROM zending_colli  WHERE zending_id = v_zend_id;
    DELETE FROM zending_regels WHERE zending_id = v_zend_id;
    DELETE FROM zending_orders WHERE zending_id = v_zend_id;
    DELETE FROM zendingen      WHERE id         = v_zend_id;
  END LOOP;

  -- ── §E: Phantom-zending aanmaken ─────────────────────────────────────────
  -- Factuur-trigger (enqueue_factuur_voor_event, mig 474) leest zending_orders
  -- om zending_id te vinden → zonder een zending geen factuur_queue-entry.
  -- gereed_op=NULL → DESADV-sweep (bouw-verzendbericht-edi) vuurt niet.
  -- status='Gepland' → verschijnt niet in Pick & Ship start-tab.
  -- Trigger trg_zending_set_m2m_a_ins maakt automatisch een zending_orders-rij.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr,
    order_id,
    status,
    vervoerder_code,
    verzenddatum,
    is_deelzending,
    aantal_colli,
    totaal_gewicht_kg
  ) VALUES (
    v_zending_nr,
    p_order_id,
    'Gepland',
    NULL,
    p_verzenddatum,
    FALSE,
    0,
    0
  ) RETURNING id INTO v_zending_id;

  -- ── §F: Order bijwerken naar Verzonden ───────────────────────────────────
  UPDATE orders
     SET status       = 'Verzonden',
         verzonden_at = p_verzenddatum::TIMESTAMPTZ,
         is_achteraf  = TRUE,
         afleverdatum = p_verzenddatum,
         afhalen      = p_afhalen
   WHERE id = p_order_id;

  -- ── §G: order_events → triggert factuur_queue ────────────────────────────
  -- event_type='pickronde_voltooid' + status_na='Verzonden' is de exacte
  -- combinatie die enqueue_factuur_voor_event (mig 474) afhandelt.
  -- Andere listeners op order_events reageren NIET op dit event:
  --   • trg_order_events_reservering_release → alleen 'geannuleerd'
  --   • trg_order_events_snijplan_release    → alleen 'geannuleerd'
  --   • trg_order_events_zending_release     → alleen 'geannuleerd'
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na, metadata
  ) VALUES (
    p_order_id,
    'pickronde_voltooid',
    'Verzonden',
    'Verzonden',
    jsonb_build_object(
      'achteraf',        TRUE,
      'verzenddatum',    p_verzenddatum,
      'afhalen',         p_afhalen,
      'bestaande_order', TRUE
    )
  );

  RETURN jsonb_build_object(
    'order_id',   p_order_id,
    'order_nr',   v_order_nr,
    'zending_id', v_zending_id,
    'zending_nr', v_zending_nr
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_afleveradres_gecontroleerd(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sinds  TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT afl_gln_ongekoppeld_sinds, status
    INTO v_sinds, v_status
    FROM orders
   WHERE id = p_order_id;

  IF v_sinds IS NULL THEN
    RETURN; -- no-op: order is niet geblokkeerd op de GLN-gate
  END IF;

  UPDATE orders
     SET afl_gln_gecontroleerd_op = now()
   WHERE id = p_order_id
     AND afl_gln_gecontroleerd_op IS NULL;

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (
    p_order_id,
    'afleveradres_gln_gecontroleerd',
    v_status,
    jsonb_build_object('ongekoppeld_sinds', v_sinds, 'migratie', 535)
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_btw_regeling_geaccepteerd(p_factuur_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sinds TIMESTAMPTZ;
BEGIN
  SELECT btw_controle_nodig_sinds INTO v_sinds
    FROM facturen WHERE id = p_factuur_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id;
  END IF;

  IF v_sinds IS NULL THEN
    RETURN; -- no-op-guard
  END IF;

  UPDATE facturen SET btw_controle_nodig_sinds = NULL WHERE id = p_factuur_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_colli_niet_gevonden(p_zending_colli_id bigint, p_opmerking text DEFAULT NULL::text, p_picker_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS NULL THEN
    RAISE EXCEPTION 'zending_colli % bestaat niet', p_zending_colli_id;
  END IF;
  IF v_zending_st <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'niet_gevonden',
         pick_opmerking  = p_opmerking,
         gepickt_at      = NULL,
         gepickt_door_id = p_picker_id
   WHERE id = p_zending_colli_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_deels_verzonden(p_order_id bigint, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan niet meer op Deels verzonden', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_huidig = 'Deels verzonden' THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'deels_verzonden',
    p_status_na           := 'Deels verzonden',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_edi_ack(p_id bigint, p_ack_status integer, p_ack_details text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE edi_berichten
     SET ack_status = p_ack_status,
         ack_details = p_ack_details,
         acked_at = now(),
         status = CASE
           WHEN p_ack_status = 0 THEN 'Verwerkt'::edi_bericht_status
           WHEN p_ack_status = 1 THEN 'Fout'::edi_bericht_status
           ELSE status
         END,
         error_msg = CASE
           WHEN p_ack_status = 1 THEN p_ack_details
           ELSE error_msg
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_edi_fout(p_id bigint, p_error text, p_max_retries integer DEFAULT 3)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM edi_berichten WHERE id = p_id;

  UPDATE edi_berichten
     SET retry_count = retry_count + 1,
         error_msg = p_error,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::edi_bericht_status
           ELSE 'Wachtrij'::edi_bericht_status
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_edi_verstuurd(p_id bigint, p_transactie_id text, p_payload_raw text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE edi_berichten
     SET status = 'Verstuurd',
         transactie_id = p_transactie_id,
         payload_raw = p_payload_raw,
         sent_at = now(),
         error_msg = NULL
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_externe_payload_verwerkt(p_id bigint, p_status text DEFAULT 'verwerkt'::text, p_order_id bigint DEFAULT NULL::bigint, p_fout text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE externe_payloads
     SET status      = p_status,
         order_id    = COALESCE(p_order_id, order_id),
         fout        = p_fout,
         verwerkt_op = now()
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_geannuleerd(p_order_id bigint, p_reden text, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig = 'Verzonden' THEN
    RAISE EXCEPTION 'Verzonden order % kan niet meer worden geannuleerd', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'geannuleerd',
    p_status_na           := 'Geannuleerd',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id,
    p_reden               := p_reden
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_hst_fout(p_id bigint, p_error text, p_request_payload jsonb DEFAULT NULL::jsonb, p_response_payload jsonb DEFAULT NULL::jsonb, p_response_http_code integer DEFAULT NULL::integer, p_max_retries integer DEFAULT 3)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM hst_transportorders WHERE id = p_id;

  UPDATE hst_transportorders
     SET retry_count = retry_count + 1,
         error_msg = p_error,
         request_payload = COALESCE(p_request_payload, request_payload),
         response_payload = p_response_payload,
         response_http_code = p_response_http_code,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::hst_transportorder_status
           ELSE 'Wachtrij'::hst_transportorder_status
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_hst_verstuurd(p_id bigint, p_extern_transport_order_id text, p_extern_tracking_number text, p_request_payload jsonb, p_response_payload jsonb, p_response_http_code integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Verstuurd',
         extern_transport_order_id = p_extern_transport_order_id,
         extern_tracking_number = p_extern_tracking_number,
         request_payload = p_request_payload,
         response_payload = p_response_payload,
         response_http_code = p_response_http_code,
         sent_at = now(),
         error_msg = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Tracking + status doorzetten naar zending
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_extern_tracking_number, p_extern_transport_order_id),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_hst_verstuurd(p_id bigint, p_extern_transport_order_id text, p_extern_tracking_number text, p_request_payload jsonb, p_response_payload jsonb, p_response_http_code integer, p_pdf_path text DEFAULT NULL::text, p_pdf_uploaded_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Verstuurd',
         extern_transport_order_id = p_extern_transport_order_id,
         extern_tracking_number    = p_extern_tracking_number,
         request_payload           = p_request_payload,
         response_payload          = p_response_payload,
         response_http_code        = p_response_http_code,
         pdf_path                  = COALESCE(p_pdf_path, pdf_path),
         pdf_uploaded_at           = COALESCE(p_pdf_uploaded_at, pdf_uploaded_at),
         sent_at                   = now(),
         error_msg                 = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Tracking + status doorzetten naar zending (ongewijzigd t.o.v. mig 171)
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_extern_tracking_number, p_extern_transport_order_id),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_inkomende_payload_verwerkt(p_id bigint, p_status text DEFAULT 'verwerkt'::text, p_order_id bigint DEFAULT NULL::bigint, p_fout text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT markeer_externe_payload_verwerkt(p_id, p_status, p_order_id, p_fout);
$function$


CREATE OR REPLACE FUNCTION public.markeer_levertijd_herbevestigd(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE orders
     SET levertijd_wijziging_te_bevestigen_sinds = NULL
   WHERE id = p_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_order_edi_bevestigd(p_order_id bigint)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  UPDATE orders
     SET edi_bevestigd_op = v_now
   WHERE id = p_order_id
     AND edi_bevestigd_op IS NULL;

  -- Als de UPDATE geen rij raakte: orde was al bevestigd → return de bestaande timestamp
  IF NOT FOUND THEN
    SELECT edi_bevestigd_op INTO v_now FROM orders WHERE id = p_order_id;
  END IF;

  RETURN v_now;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_pickronde_gestart(p_order_id bigint, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan geen pickronde meer starten', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_huidig IN ('In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_gestart',
    p_status_na           := 'In pickronde',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  -- Mig 565 (ADR-0040): eigen order = no-op (no-touch), maar de groep-cascade
  -- herevalueert de Combi-levering-siblings die zonder deze order mogelijk
  -- weer onder de vrachtvrije-drempel zakken.
  PERFORM herbereken_wacht_status(p_order_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_prijs_geaccepteerd(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status order_status;
  v_sinds  TIMESTAMPTZ;
BEGIN
  SELECT status, prijs_ontbreekt_sinds
    INTO v_status, v_sinds
    FROM orders WHERE id = p_order_id;

  UPDATE orders
     SET prijs_ontbreekt_sinds = NULL
   WHERE id = p_order_id;

  INSERT INTO order_events (order_id, event_type, status_na, actor_auth_user_id, metadata)
  VALUES (
    p_order_id,
    'prijs_geaccepteerd',
    v_status,
    auth.uid(),
    jsonb_build_object(
      'geaccepteerd_sinds', v_sinds,
      'migratie',           393,
      'gedaan_door',        huidige_actor_email()
    )
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_rhenus_fout(p_id bigint, p_error text, p_request_xml text DEFAULT NULL::text, p_max_retries integer DEFAULT 3)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM rhenus_transportorders WHERE id = p_id;

  UPDATE rhenus_transportorders
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         request_xml = COALESCE(p_request_xml, request_xml),
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::rhenus_transportorder_status
           ELSE 'Wachtrij'::rhenus_transportorder_status
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_rhenus_verstuurd(p_id bigint, p_bestandsnaam text, p_xml_storage_path text, p_request_xml text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE rhenus_transportorders
     SET status           = 'Verstuurd',
         bestandsnaam     = p_bestandsnaam,
         xml_storage_path = p_xml_storage_path,
         request_xml      = p_request_xml,
         sent_at          = now(),
         error_msg        = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Status doorzetten naar zending (mig 171-patroon). Geen track_trace:
  -- het RHE-formaat kent geen T&T-slot.
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_transport_bevestigd(p_id bigint, p_extern_referentie text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE verzend_wachtrij
     SET transport_bevestigd_op = COALESCE(transport_bevestigd_op, now()),
         extern_referentie      = COALESCE(p_extern_referentie, extern_referentie)
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_transportorder_fout(p_id bigint, p_error text, p_max_retries integer DEFAULT 3)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM verzend_wachtrij WHERE id = p_id;

  UPDATE verzend_wachtrij
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::verzend_status
           ELSE 'Wachtrij'::verzend_status
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_transportorder_verstuurd(p_id bigint, p_extern_referentie text, p_track_trace text, p_document_pad text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE verzend_wachtrij
     SET status                 = 'Verstuurd',
         extern_referentie      = p_extern_referentie,
         track_trace            = COALESCE(p_track_trace, track_trace),
         document_pad           = COALESCE(p_document_pad, document_pad),
         transport_bevestigd_op = COALESCE(transport_bevestigd_op, now()),
         sent_at                = now(),
         error_msg              = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_track_trace, track_trace),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_verhoek_fout(p_id bigint, p_error text, p_request_xml text DEFAULT NULL::text, p_max_retries integer DEFAULT 3)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM verhoek_transportorders WHERE id = p_id;

  UPDATE verhoek_transportorders
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         request_xml = COALESCE(p_request_xml, request_xml),
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::verhoek_transportorder_status
           ELSE 'Wachtrij'::verhoek_transportorder_status
         END
   WHERE id = p_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_verhoek_verstuurd(p_id bigint, p_bestandsnaam text, p_xml_storage_path text, p_track_trace_id text, p_request_xml text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE verhoek_transportorders
     SET status           = 'Verstuurd',
         bestandsnaam     = p_bestandsnaam,
         xml_storage_path = p_xml_storage_path,
         track_trace_id   = p_track_trace_id,
         request_xml      = p_request_xml,
         sent_at          = now(),
         error_msg        = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Track & trace + status doorzetten naar zending (mig 171-patroon).
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_track_trace_id, track_trace),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_verwerkt_gezien()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE bug_meldingen
     SET verwerkt_gezien_op = now()
   WHERE gemeld_door = v_uid
     AND status = 'Verwerkt'
     AND verwerkt_gezien_op IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$


CREATE OR REPLACE FUNCTION public.markeer_verzonden(p_order_id bigint, p_actor_medewerker_id bigint DEFAULT NULL::bigint, p_actor_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Geannuleerde order % kan niet op Verzonden worden gezet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_voltooid',
    p_status_na           := 'Verzonden',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.markeer_zending_afgehaald(p_zending_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_afhalen BOOLEAN;
  v_status  zending_status;
BEGIN
  SELECT o.afhalen, z.status
    INTO v_afhalen, v_status
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;

  IF v_status IS NULL THEN RETURN 'zending_niet_gevonden'; END IF;
  IF v_status <> 'Klaar voor verzending' THEN RETURN 'verkeerde_status'; END IF;
  IF NOT COALESCE(v_afhalen, FALSE) THEN RETURN 'geen_afhaal_order'; END IF;

  UPDATE zendingen
     SET status = 'Afgehaald'
   WHERE id = p_zending_id
     AND status = 'Klaar voor verzending';

  RETURN 'afgehaald';
END;
$function$


CREATE OR REPLACE FUNCTION public.match_edi_artikel(p_gtin text, p_artikelcode text)
 RETURNS TABLE(artikelnr text, omschrijving text, verkoopprijs numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_eerste_token TEXT;
  v_rest         TEXT;
BEGIN
  -- 1a. GTIN-match exact
  IF p_gtin IS NOT NULL AND p_gtin <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 1b. GTIN-match met ".0"-suffix tolerantie (defensief — trigger zou dit
    --     normaliter al hebben opgeruimd, maar als een rij ooit binnenkomt
    --     zonder de trigger te triggeren, hier nog een vangnet).
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin || '.0'
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Volledige artikelcode → artikelnr
  IF p_artikelcode IS NOT NULL AND p_artikelcode <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.artikelnr = p_artikelcode
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. Eerste token (vóór spatie) → artikelnr — mét maat-suffix-guard (mig 348):
    --    bevat de rest-tekst een maat-patroon of vorm-woord, dan zou een
    --    token-match die informatie stilzwijgend droppen → bewust géén match,
    --    zodat de regel als ongematcht ("Actie vereist") landt.
    v_eerste_token := split_part(p_artikelcode, ' ', 1);
    IF v_eerste_token <> '' AND v_eerste_token <> p_artikelcode THEN
      v_rest := trim(substr(p_artikelcode, length(v_eerste_token) + 1));
      IF v_rest ~* '\d+\s*[x×]\s*\d+'
         OR v_rest ~* '\y(rund|rond|ovaal|oval)\y' THEN
        RETURN;  -- maat-/vorm-suffix-guard: operator moet beoordelen
      END IF;

      RETURN QUERY
      SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
        FROM producten p
       WHERE p.artikelnr = v_eerste_token
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  RETURN;
END;
$function$


CREATE OR REPLACE FUNCTION public.match_klant_po(p_extractie jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_btw             text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,btw_nummer}',''), '[^A-Za-z0-9]', '', 'g'));
  v_email           text  := lower(trim(coalesce(p_extractie#>>'{afzender,email}','')));
  v_email_domein    text;
  v_naam_norm       text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,naam}',''), '\s+', ' ', 'g'));
  v_debiteur_nr     integer;
  v_debiteur_zeker  boolean := false;
  v_cnt             integer;
  v_regel           jsonb;
  v_regels_out      jsonb := '[]'::jsonb;
  v_kwaliteit       text;
  v_kleur           text;
  v_artikelnr       text;
  v_is_maatwerk     boolean;
  v_regel_zeker     boolean;
BEGIN
  IF position('@' in v_email) > 0 THEN
    v_email_domein := split_part(v_email, '@', 2);
  END IF;

  -- ---- Debiteur: btw > e-maildomein > exacte naam, telkens precies 1 hit ----
  -- alleen actieve debiteuren (geen archief-false-positives)
  IF v_btw <> '' THEN
    SELECT debiteur_nr INTO v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(btw_nummer,''), '[^A-Za-z0-9]', '', 'g')) = v_btw
      AND status = 'Actief'
    LIMIT 2;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_email_domein IS NOT NULL AND v_email_domein <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE status = 'Actief'
      AND (   lower(coalesce(email_factuur,'')) LIKE '%@'||v_email_domein
           OR lower(coalesce(email_overig,''))  LIKE '%@'||v_email_domein
           OR lower(coalesce(email_2,''))       LIKE '%@'||v_email_domein);
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_naam_norm <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(naam,''), '\s+', ' ', 'g')) = v_naam_norm
      AND status = 'Actief';
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  -- ---- Regels ----
  FOR v_regel IN SELECT * FROM jsonb_array_elements(coalesce(p_extractie->'regels','[]'::jsonb))
  LOOP
    v_kwaliteit := NULL; v_kleur := NULL; v_artikelnr := NULL;
    v_is_maatwerk := false; v_regel_zeker := false;

    -- Kleurcode = numeriek deel uit kleur_tekst ("Iron Grey 15" -> 15).
    v_kleur := nullif((regexp_match(coalesce(v_regel->>'kleur_tekst',''), '(\d{1,3})\s*$'))[1], '');

    -- 1. Klant-artikelnr (gescoped op debiteur).
    IF v_debiteur_zeker AND coalesce(v_regel->>'klant_artikelnr','') <> '' THEN
      SELECT artikelnr INTO v_artikelnr
      FROM klant_artikelnummers
      WHERE debiteur_nr = v_debiteur_nr
        AND lower(trim(klant_artikel)) = lower(trim(v_regel->>'klant_artikelnr'))
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN v_regel_zeker := true; END IF;
    END IF;

    -- 2. Kwaliteit via klanteigen naam (reverse lookup benaming -> code),
    --    debiteur- OF inkoopgroep-scoped (mig 200: XOR debiteur_nr/inkoopgroep_code).
    --    Precedentie volgt klanteigen_namen-resolutie: klant boven inkoopgroep,
    --    kleur-specifiek boven kleur-NULL-fallback. Daarna exacte kwaliteitsnaam.
    IF v_artikelnr IS NULL AND coalesce(v_regel->>'kwaliteit_tekst','') <> '' THEN
      IF v_debiteur_zeker THEN
        SELECT kn.kwaliteit_code INTO v_kwaliteit
        FROM klanteigen_namen kn
        WHERE (
              kn.debiteur_nr = v_debiteur_nr
           OR kn.inkoopgroep_code = (SELECT inkoopgroep_code FROM debiteuren WHERE debiteur_nr = v_debiteur_nr)
          )
          AND lower(trim(kn.benaming)) = lower(trim(v_regel->>'kwaliteit_tekst'))
          AND (kn.kleur_code IS NULL OR kn.kleur_code = v_kleur)
        ORDER BY (kn.debiteur_nr IS NOT NULL) DESC, kn.kleur_code NULLS LAST
        LIMIT 1;
      END IF;
      IF v_kwaliteit IS NULL THEN
        SELECT k.code INTO v_kwaliteit
        FROM kwaliteiten k
        WHERE lower(trim(k.omschrijving)) = lower(trim(v_regel->>'kwaliteit_tekst'))
        LIMIT 1;
      END IF;
    END IF;

    -- 3. Catalogus-product op (kwaliteit, kleur, maat) -> artikelnr; anders maatwerk.
    IF v_artikelnr IS NULL AND v_kwaliteit IS NOT NULL AND v_kleur IS NOT NULL THEN
      SELECT p.artikelnr INTO v_artikelnr
      FROM producten p
      WHERE p.kwaliteit_code = v_kwaliteit
        AND p.kleur_code = v_kleur
        AND p.actief = true
        AND p.lengte_cm = nullif(v_regel->>'lengte_cm','')::int
        AND p.breedte_cm = nullif(v_regel->>'breedte_cm','')::int
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN
        v_regel_zeker := true;
      ELSIF (v_regel->>'lengte_cm') IS NOT NULL AND (v_regel->>'breedte_cm') IS NOT NULL THEN
        v_is_maatwerk := true;
        v_regel_zeker := true;  -- maatwerk-specs zijn zeker (kw+kl+maat resolved)
      END IF;
    END IF;

    v_regels_out := v_regels_out || jsonb_build_object(
      'aantal',            v_regel->'aantal',
      'ruwe_omschrijving', v_regel->>'ruwe_omschrijving',
      'artikelnr',         v_artikelnr,
      'is_maatwerk',       v_is_maatwerk,
      'maatwerk_kwaliteit_code', CASE WHEN v_is_maatwerk THEN v_kwaliteit END,
      'maatwerk_kleur_code',     CASE WHEN v_is_maatwerk THEN v_kleur END,
      'lengte_cm',         v_regel->'lengte_cm',
      'breedte_cm',        v_regel->'breedte_cm',
      'vorm_tekst',        v_regel->>'vorm_tekst',
      'prijs',             v_regel->'prijs',
      'korting_pct',       v_regel->'korting_pct',
      'zeker',             v_regel_zeker
    );
  END LOOP;

  RETURN jsonb_build_object(
    'debiteur', jsonb_build_object('debiteur_nr', v_debiteur_nr, 'zeker', v_debiteur_zeker),
    'klant_referentie', p_extractie->>'klant_referentie',
    'leverdatum_tekst', p_extractie->>'leverdatum_tekst',
    'spoed', coalesce((p_extractie->>'spoed')::boolean, false),
    'afleveradres', p_extractie->'afleveradres',
    'factuuradres', p_extractie->'factuuradres',
    'regels', v_regels_out
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.matcht_regel(p_conditie jsonb, p_land text, p_kleinste_zijde integer, p_gewicht_kg numeric, p_debiteur_nr integer, p_inkoopgroep text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_landen      TEXT[];
  v_land_norm   TEXT;
  v_min         INTEGER;
  v_max         INTEGER;
  v_g_max       NUMERIC;
  v_g_min       NUMERIC;
  v_debs        INTEGER[];
  v_groepen     TEXT[];
BEGIN
  -- Lege conditie → fallback-regel, altijd match
  IF p_conditie IS NULL OR p_conditie = '{}'::JSONB THEN
    RETURN TRUE;
  END IF;

  -- land: TEXT[] of single string. Beide zijden door normaliseer_land zodat
  -- 'NL' / 'Nederland' / 'BELGIE' / 'BE' onderling matchen (mig 214).
  IF p_conditie ? 'land' THEN
    SELECT array_agg(normaliseer_land(value::TEXT)) INTO v_landen
      FROM jsonb_array_elements_text(p_conditie->'land') AS value;
    v_land_norm := normaliseer_land(p_land);
    IF v_land_norm IS NULL OR NOT (v_land_norm = ANY(v_landen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_min: zending kleinste-zijde >= waarde
  IF p_conditie ? 'kleinste_zijde_cm_min' THEN
    v_min := (p_conditie->>'kleinste_zijde_cm_min')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde < v_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_max: zending kleinste-zijde <= waarde
  IF p_conditie ? 'kleinste_zijde_cm_max' THEN
    v_max := (p_conditie->>'kleinste_zijde_cm_max')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde > v_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_max
  IF p_conditie ? 'gewicht_kg_max' THEN
    v_g_max := (p_conditie->>'gewicht_kg_max')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg > v_g_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_min
  IF p_conditie ? 'gewicht_kg_min' THEN
    v_g_min := (p_conditie->>'gewicht_kg_min')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg < v_g_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- debiteur_nrs
  IF p_conditie ? 'debiteur_nrs' THEN
    SELECT array_agg((value::TEXT)::INTEGER) INTO v_debs
      FROM jsonb_array_elements_text(p_conditie->'debiteur_nrs') AS value;
    IF p_debiteur_nr IS NULL OR NOT (p_debiteur_nr = ANY(v_debs)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- inkoopgroep_codes
  IF p_conditie ? 'inkoopgroep_codes' THEN
    SELECT array_agg(value::TEXT) INTO v_groepen
      FROM jsonb_array_elements_text(p_conditie->'inkoopgroep_codes') AS value;
    IF p_inkoopgroep IS NULL OR NOT (p_inkoopgroep = ANY(v_groepen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Onbekende sleutels: negeren (forward-compat).
  RETURN TRUE;
END;
$function$


CREATE OR REPLACE FUNCTION public.meld_zending_handmatig_aan(p_zending_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status      TEXT;
  v_vervoerder  TEXT;
  v_geraakt     INTEGER;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Aanmelden kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  -- Vervroeg de wachtende rij naar nu (de normale flow heeft 'm al ge-enqueued).
  UPDATE verzend_wachtrij
     SET beschikbaar_op = now()
   WHERE zending_id = p_zending_id AND status = 'Wachtrij';
  GET DIAGNOSTICS v_geraakt = ROW_COUNT;

  IF v_geraakt > 0 THEN
    RETURN 'vervroegd_naar_nu';
  END IF;

  -- Geen wachtende rij (edge: trigger niet gevuurd) → alsnog enqueuen ÉN meteen
  -- vervroegen. enqueue_zending_naar_vervoerder zet beschikbaar_op op de cutoff
  -- (16:00); die moet hier alsnog naar now(), anders wacht "Nu aanmelden" tóch
  -- tot de batch — tegengesteld aan de belofte.
  PERFORM enqueue_zending_naar_vervoerder(p_zending_id, TRUE);
  UPDATE verzend_wachtrij
     SET beschikbaar_op = now()
   WHERE zending_id = p_zending_id AND status = 'Wachtrij';
  RETURN 'enqueued_en_vervroegd';
END;
$function$


CREATE OR REPLACE FUNCTION public.normaliseer_kleur_code(code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT regexp_replace(COALESCE(code, ''), '\.0+$', '')
$function$


CREATE OR REPLACE FUNCTION public.normaliseer_land(p_land text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_land IS NULL THEN RETURN NULL; END IF;

  v_clean := upper(btrim(p_land));
  IF v_clean = '' THEN RETURN NULL; END IF;

  v_clean := translate(
    v_clean,
    'ÁÀÂÄÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'AAAAAACEEEEIIIINOOOOOUUUUY'
  );

  v_clean := regexp_replace(v_clean, '\s+', ' ', 'g');

  IF length(v_clean) = 2 THEN
    RETURN v_clean;
  END IF;

  RETURN CASE v_clean
    WHEN 'NEDERLAND'         THEN 'NL'
    WHEN 'HOLLAND'           THEN 'NL'
    WHEN 'NETHERLANDS'       THEN 'NL'
    WHEN 'THE NETHERLANDS'   THEN 'NL'
    WHEN 'BELGIE'            THEN 'BE'
    WHEN 'BELGIUM'           THEN 'BE'
    WHEN 'BELGIQUE'          THEN 'BE'
    WHEN 'DUITSLAND'         THEN 'DE'
    WHEN 'GERMANY'           THEN 'DE'
    WHEN 'DEUTSCHLAND'       THEN 'DE'
    WHEN 'FRANKRIJK'         THEN 'FR'
    WHEN 'FRANCE'            THEN 'FR'
    WHEN 'LUXEMBURG'         THEN 'LU'
    WHEN 'LUXEMBOURG'        THEN 'LU'
    WHEN 'OOSTENRIJK'        THEN 'AT'
    WHEN 'AUSTRIA'           THEN 'AT'
    WHEN 'OSTERREICH'        THEN 'AT'
    WHEN 'ZWITSERLAND'       THEN 'CH'
    WHEN 'SWITZERLAND'       THEN 'CH'
    WHEN 'SCHWEIZ'           THEN 'CH'
    WHEN 'ITALIE'            THEN 'IT'
    WHEN 'ITALY'             THEN 'IT'
    WHEN 'ITALIA'            THEN 'IT'
    WHEN 'SPANJE'            THEN 'ES'
    WHEN 'SPAIN'             THEN 'ES'
    WHEN 'ESPANA'            THEN 'ES'
    WHEN 'POLEN'             THEN 'PL'
    WHEN 'POLAND'            THEN 'PL'
    WHEN 'POLSKA'            THEN 'PL'
    WHEN 'TSJECHIE'          THEN 'CZ'
    WHEN 'CZECH REPUBLIC'    THEN 'CZ'
    WHEN 'CZECHIA'           THEN 'CZ'
    WHEN 'DENEMARKEN'        THEN 'DK'
    WHEN 'DENMARK'           THEN 'DK'
    WHEN 'DANMARK'           THEN 'DK'
    WHEN 'ZWEDEN'            THEN 'SE'
    WHEN 'SWEDEN'            THEN 'SE'
    WHEN 'SVERIGE'           THEN 'SE'
    WHEN 'NOORWEGEN'         THEN 'NO'
    WHEN 'NORWAY'            THEN 'NO'
    WHEN 'NORGE'             THEN 'NO'
    WHEN 'ENGELAND'          THEN 'GB'
    WHEN 'GROOTBRITTANNIE'   THEN 'GB'
    WHEN 'GROOT-BRITTANNIE'  THEN 'GB'
    WHEN 'UK'                THEN 'GB'
    WHEN 'UNITED KINGDOM'    THEN 'GB'
    WHEN 'IERLAND'           THEN 'IE'
    WHEN 'IRELAND'           THEN 'IE'
    -- Mig 454: resterende EU-lidstaten (bron: backfill-lijst mig 164).
    WHEN 'PORTUGAL'          THEN 'PT'
    WHEN 'SLOVAKIA'          THEN 'SK'
    WHEN 'SLOWAKIJE'         THEN 'SK'
    WHEN 'HUNGARY'           THEN 'HU'
    WHEN 'HONGARIJE'         THEN 'HU'
    WHEN 'MAGYARORSZAG'      THEN 'HU'
    WHEN 'GREECE'            THEN 'GR'
    WHEN 'GRIEKENLAND'       THEN 'GR'
    WHEN 'ELLAS'             THEN 'GR'
    WHEN 'SLOVENIA'          THEN 'SI'
    WHEN 'SLOVENIE'          THEN 'SI'
    WHEN 'ESTONIA'           THEN 'EE'
    WHEN 'ESTLAND'           THEN 'EE'
    WHEN 'LATVIA'            THEN 'LV'
    WHEN 'LETLAND'           THEN 'LV'
    WHEN 'LITHUANIA'         THEN 'LT'
    WHEN 'LITOUWEN'          THEN 'LT'
    WHEN 'BULGARIA'          THEN 'BG'
    WHEN 'BULGARIJE'         THEN 'BG'
    WHEN 'ROMANIA'           THEN 'RO'
    WHEN 'ROEMENIE'          THEN 'RO'
    WHEN 'CROATIA'           THEN 'HR'
    WHEN 'KROATIE'           THEN 'HR'
    WHEN 'CYPRUS'            THEN 'CY'
    WHEN 'MALTA'             THEN 'MT'
    WHEN 'FINLAND'           THEN 'FI'
    WHEN 'SUOMI'             THEN 'FI'
    ELSE v_clean
  END;
END;
$function$


CREATE OR REPLACE FUNCTION public.ontgrendel_allocatie_keuze(p_order_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  SELECT order_id INTO v_order_id FROM order_regels WHERE id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND is_handmatig = true;

  PERFORM herallocateer_orderregel(p_order_regel_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.ontgrendel_handmatige_toewijzing(p_snijplan_id bigint)
 RETURNS TABLE(kwaliteit_code text, kleur_code text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_oude_rol_id BIGINT;
  v_kwaliteit TEXT;
  v_kleur TEXT;
BEGIN
  SELECT sn.rol_id, orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
    INTO v_oude_rol_id, v_kwaliteit, v_kleur
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
   WHERE sn.id = p_snijplan_id
   FOR UPDATE OF sn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijplan % niet gevonden', p_snijplan_id;
  END IF;

  IF v_oude_rol_id IS NOT NULL THEN
    PERFORM 1 FROM rollen WHERE id = v_oude_rol_id AND snijden_gestart_op IS NOT NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'Rol is al fysiek onder het mes — kan niet meer ontgrendeld worden';
    END IF;
  END IF;

  UPDATE snijplannen
     SET rol_id = NULL,
         positie_x_cm = NULL,
         positie_y_cm = NULL,
         geroteerd = false,
         is_handmatig_toegewezen = false
   WHERE id = p_snijplan_id;

  IF v_oude_rol_id IS NOT NULL THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = v_oude_rol_id
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn2
          WHERE sn2.rol_id = v_oude_rol_id
            AND sn2.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  RETURN QUERY SELECT v_kwaliteit, v_kleur;
END;
$function$


CREATE OR REPLACE FUNCTION public.ontkoppel_snijplan_van_io(p_snijplan_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sp_status     TEXT;
  v_sp_rol_id     BIGINT;
  v_sp_oud_io_id  BIGINT;
  v_sp_breedte_cm INTEGER;
  v_sp_lengte_cm  INTEGER;
  v_afwerking     TEXT;
  v_vorm          TEXT;
  v_standaard_breedte INTEGER;
  -- MARGE-2.5CM: zie stuk_snij_marge_cm (mig 464)
  v_marge         NUMERIC;
  v_bijdrage_cm   INTEGER;
  v_sp_order_regel_id BIGINT;  -- voor clearing arm (Beslissing 2)
BEGIN
  -- Haal stuk op + vergrendel
  SELECT sp.status, sp.rol_id, sp.verwacht_inkooporder_regel_id,
         sp.breedte_cm, sp.lengte_cm, sp.order_regel_id,
         oreg.maatwerk_afwerking, oreg.maatwerk_vorm,
         COALESCE(k.standaard_breedte_cm, 400)
  INTO v_sp_status, v_sp_rol_id, v_sp_oud_io_id,
       v_sp_breedte_cm, v_sp_lengte_cm, v_sp_order_regel_id,
       v_afwerking, v_vorm, v_standaard_breedte
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  LEFT JOIN producten p   ON p.artikelnr = oreg.artikelnr
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
  WHERE sp.id = p_snijplan_id
  FOR UPDATE OF sp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snijplan_niet_gevonden:Stuk % bestaat niet', p_snijplan_id;
  END IF;

  -- Geen IO-claim → no-op
  IF v_sp_oud_io_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'gewijzigd', false,
      'reden', 'geen_io_claim');
  END IF;

  -- MARGE-2.5CM: zelfde formule als bij koppelen
  v_marge := stuk_snij_marge_cm(v_afwerking, v_vorm,
    v_sp_lengte_cm, v_sp_breedte_cm,
    v_standaard_breedte);
  v_bijdrage_cm := ROUND(v_sp_breedte_cm::NUMERIC + v_marge)::INTEGER;

  -- Release van de IO-teller
  UPDATE inkooporder_regels
  SET snijplan_gebruikte_lengte_cm =
        GREATEST(0, snijplan_gebruikte_lengte_cm - v_bijdrage_cm)
  WHERE id = v_sp_oud_io_id;

  -- Reset het stuk
  UPDATE snijplannen
  SET verwacht_inkooporder_regel_id = NULL,
      status = 'Wacht'
  WHERE id = p_snijplan_id;

  -- Beslissing 2 — clearing arm:
  -- Na ontkoppeling: als de orderregel niet meer volledig gedekt is (≥1 stuk
  -- heeft geen rol_id én geen verwacht_inkooporder_regel_id, het nu-reset stuk
  -- zelf telt mee), wis dan een automatisch gezette verzendweek.
  -- Handmatig gezette weken (verzendweek_bron='handmatig') worden NOOIT gewist.
  -- Het EXISTS-subquery leest de state NADAT het huidige stuk gereset is,
  -- dus vindt altijd minstens het huidige stuk als ongedekt → correct.
  UPDATE order_regels
  SET verzendweek      = NULL,
      verzendweek_bron = NULL
  WHERE id = v_sp_order_regel_id
    AND verzendweek_bron = 'automatisch_voorraad'
    AND EXISTS (
      SELECT 1 FROM snijplannen sp2
      WHERE sp2.order_regel_id = v_sp_order_regel_id
        AND sp2.status <> 'Geannuleerd'
        AND sp2.rol_id IS NULL
        AND sp2.verwacht_inkooporder_regel_id IS NULL
    );

  RETURN jsonb_build_object(
    'ok', true,
    'gewijzigd', true,
    'vrijgegeven_cm', v_bijdrage_cm
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.open_maatwerkvraag_orders(p_kwaliteit text, p_kleur text)
 RETURNS TABLE(snijplan_id bigint, snijplan_nr text, status text, snij_lengte_cm integer, snij_breedte_cm integer, bruto_m2 numeric, besteld_kwaliteit_code text, besteld_kleur_code text, order_id bigint, order_nr text, afleverdatum date, debiteur_nr integer, klant_naam text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    so.id                                                                          AS snijplan_id,
    so.snijplan_nr,
    so.status::TEXT                                                                AS status,
    so.snij_lengte_cm,
    so.snij_breedte_cm,
    ((LEAST(so.snij_lengte_cm, so.snij_breedte_cm)::NUMERIC / 100.0)
       * (COALESCE(k.standaard_breedte_cm, 400)::NUMERIC / 100.0))::NUMERIC        AS bruto_m2,
    so.kwaliteit_code                                                              AS besteld_kwaliteit_code,
    regexp_replace(so.kleur_code, '\.0+$', '')                                     AS besteld_kleur_code,
    so.order_id,
    so.order_nr,
    so.afleverdatum,
    so.debiteur_nr,
    so.klant_naam
  FROM snijplanning_overzicht so
  LEFT JOIN kwaliteiten k ON k.code = so.kwaliteit_code
  WHERE so.status IN ('Wacht'::snijplan_status,
                      'Gepland'::snijplan_status,
                      'Snijden'::snijplan_status)
    AND so.snij_lengte_cm  IS NOT NULL
    AND so.snij_breedte_cm IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM uitwisselbare_paren(p_kwaliteit, p_kleur) up
      WHERE up.target_kwaliteit_code = so.kwaliteit_code
        AND up.target_kleur_code     = regexp_replace(so.kleur_code, '\.0+$', '')
    )
  ORDER BY
    so.afleverdatum ASC NULLS LAST,
    so.snijplan_nr  ASC;
$function$


CREATE OR REPLACE FUNCTION public.pauzeer_snijden_rol(p_rol_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_gesneden_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_gesneden_count
  FROM snijplannen
  WHERE rol_id = p_rol_id AND status = 'Gesneden';

  IF v_gesneden_count > 0 THEN
    RAISE EXCEPTION 'Kan rol % niet pauzeren: er zijn al % stuk(ken) met status Gesneden', p_rol_id, v_gesneden_count;
  END IF;

  UPDATE snijplannen
  SET status = 'Gepland'
  WHERE rol_id = p_rol_id AND status = 'Snijden';

  UPDATE rollen
  SET snijden_gestart_op = NULL,
      snijden_gestart_door = NULL
  WHERE id = p_rol_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.portal_login(p_email text, p_wachtwoord text)
 RETURNS TABLE(portal_token uuid, leverancier_naam text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT l.portal_token, l.naam
  FROM   leveranciers l
  WHERE  lower(l.portal_email) = lower(trim(p_email))
    AND  l.portal_wachtwoord_hash IS NOT NULL
    AND  l.portal_wachtwoord_hash = extensions.crypt(p_wachtwoord, l.portal_wachtwoord_hash)
    AND  l.actief       = TRUE
    AND  l.portal_token IS NOT NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.producten_gewicht_derive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_density NUMERIC;
BEGIN
  -- NULL-veilig: NOT IN evalueert bij NULL naar NULL (valt dóór) — een
  -- type-loos product mag nooit stil een gederiveerd gewicht krijgen.
  IF NEW.product_type IS NULL OR NEW.product_type NOT IN ('vast', 'staaltje') THEN
    RETURN NEW;
  END IF;
  IF NEW.lengte_cm IS NULL OR NEW.breedte_cm IS NULL
     OR NEW.kwaliteit_code IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT gewicht_per_m2_kg INTO v_density
    FROM kwaliteiten WHERE code = NEW.kwaliteit_code;
  IF v_density IS NULL OR v_density <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.vorm = 'rond' THEN
    NEW.gewicht_kg := ROUND(PI()::NUMERIC * POWER(NEW.lengte_cm::NUMERIC / 200.0, 2) * v_density, 2);
  ELSE
    NEW.gewicht_kg := ROUND((NEW.lengte_cm::NUMERIC * NEW.breedte_cm::NUMERIC / 10000.0) * v_density, 2);
  END IF;
  NEW.gewicht_uit_kwaliteit := true;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.producten_karpi_code_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_is_maatwerk_patroon BOOLEAN;
BEGIN
  -- (1) Alleen handhaven op INSERT, of op UPDATEs die een bewaakte kolom
  --     daadwerkelijk wijzigen. Een legacy rij (karpi_code NULL) waarvan
  --     alleen voorraad/locatie/etc. muteert, passeert hier altijd.
  IF TG_OP = 'UPDATE'
     AND NEW.karpi_code   IS NOT DISTINCT FROM OLD.karpi_code
     AND NEW.product_type IS NOT DISTINCT FROM OLD.product_type
     AND NEW.omschrijving IS NOT DISTINCT FROM OLD.omschrijving THEN
    RETURN NEW;
  END IF;

  -- (2) Vrijstellingen: admin-pseudo nooit bewaakt.
  IF COALESCE(NEW.is_pseudo, FALSE) THEN
    RETURN NEW;
  END IF;

  -- NULL-veilig: NEW.omschrijving kan NULL zijn; zonder COALESCE zou de
  -- regex NULL opleveren en zou de overig/staaltje/NULL-vrijstelling in
  -- stap (3) via NULL-propagatie overgeslagen worden (NOT NULL = NULL →
  -- branch niet genomen → onterecht KA359 voor een vrijgesteld product).
  v_is_maatwerk_patroon := COALESCE(NEW.omschrijving, '') ~ '^[A-Z]+[0-9]+MAATWERK$';

  -- (3) Buiten scope: overig/staaltje (of type NULL) zonder MAATWERK-patroon.
  IF NOT v_is_maatwerk_patroon
     AND (NEW.product_type IS NULL OR NEW.product_type NOT IN ('rol', 'vast')) THEN
    RETURN NEW;
  END IF;

  -- (4) karpi_code aanwezig → klaar.
  IF NEW.karpi_code IS NOT NULL AND btrim(NEW.karpi_code) <> '' THEN
    RETURN NEW;
  END IF;

  -- (5) MAATWERK-patroon: afleiden volgens catalogus-conventie (mig 356a).
  --     N.B.: mig 356a weigerde een afgeleide code die al op een ANDER
  --     product stond (duplicaat-guard in de backfill); deze trigger kent
  --     die weigering bewust NIET en wijst de afgeleide code gewoon toe.
  --     Acceptabel omdat (a) er geen unique constraint op karpi_code staat,
  --     en (b) een botsing alleen kan ontstaan bij dezelfde
  --     kwaliteit+kleur-combinatie — data die dan sowieso al ambigu is en
  --     beter handmatig opgeschoond wordt dan hier hard geblokkeerd.
  IF v_is_maatwerk_patroon THEN
    IF NEW.kwaliteit_code IS NOT NULL AND btrim(NEW.kwaliteit_code) <> ''
       AND NEW.kleur_code IS NOT NULL AND btrim(NEW.kleur_code) <> '' THEN
      NEW.karpi_code := NEW.kwaliteit_code || NEW.kleur_code || 'MAATWERK';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Karpi-code is verplicht voor MAATWERK-artikel % en kan niet afgeleid worden: vul kwaliteit- en kleurcode (of de Karpi-code zelf) in.',
      NEW.artikelnr
      USING ERRCODE = 'KA359';
  END IF;

  -- (6) rol/vast zonder karpi_code: hard weigeren, geen stille afleiding.
  RAISE EXCEPTION 'Karpi-code is verplicht voor producten van type ''%'' (artikelnr %): vul de Karpi-code in.',
    NEW.product_type, NEW.artikelnr
    USING ERRCODE = 'KA359';
END;
$function$


CREATE OR REPLACE FUNCTION public.producten_normaliseer_ean_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.ean_code IS NULL OR NEW.ean_code = '' THEN
    RETURN NEW;
  END IF;

  -- Strip trailing ".0" of ".00" enz. (resultaat van Excel float-import)
  IF NEW.ean_code ~ '\.0+$' THEN
    NEW.ean_code := regexp_replace(NEW.ean_code, '\.0+$', '');
  END IF;

  -- Strip whitespace die soms in copy-paste imports sluipt
  NEW.ean_code := TRIM(BOTH FROM NEW.ean_code);

  -- Lege string na trimming → NULL (semantisch correcter dan empty TEXT)
  IF NEW.ean_code = '' THEN
    NEW.ean_code := NULL;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(p_zending_id bigint, p_factuur_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id            BIGINT;
  v_factuur_nr            TEXT;
  v_zending               zendingen%ROWTYPE;
  v_debiteur              debiteuren%ROWTYPE;
  v_eerste_order          orders%ROWTYPE;
  v_btw_regeling          RECORD;
  v_btw_pct               NUMERIC(5,2);
  v_betaaltermijn_dagen   INTEGER := 30;
  v_aantal_te_factureren  INTEGER;
  v_order_ids             BIGINT[];
  v_subtotaal             NUMERIC(12,2);
  v_btw_bedrag            NUMERIC(12,2);
  v_totaal                NUMERIC(12,2);
  v_bundel_subtotaal      NUMERIC(12,2);
  v_is_afhalen            BOOLEAN;
  v_vk                    RECORD;
  -- Toeslag (mig 529/532)
  v_toeslag_bedrag        NUMERIC(12,2) := 0;
  v_toeslag_omschrijving  TEXT          := NULL;
  v_toeslag_actief        BOOLEAN       := FALSE;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  -- Mig 550 (hersteld van mig 456/518): eerste order als representatief
  -- afleverland. Bundel-zending is al gegroepeerd op genormaliseerd adres, dus
  -- gemengd-land-binnen-1-bundel is een laag restrisico.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land,
      v_debiteur.land,
      v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom,
      v_debiteur.btw_nummer,
      v_debiteur.btw_percentage
    );

  v_btw_pct := v_btw_regeling.effectief_pct;
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- Toeslag-activatie (mig 532): geldig als toeslag_actief=TRUE EN ALLE orders
  -- in de zending zijn aangemaakt binnen de periode begindatum..einddatum.
  -- BOOL_AND over lege set = NULL → FALSE → geen toeslag (veilig).
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND (
        SELECT BOOL_AND(
            o.created_at::date >= COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
            AND o.created_at::date <= COALESCE(v_debiteur.toeslag_einddatum, 'infinity'::date)
        )
        FROM orders o WHERE o.id = ANY(v_order_ids)
    );

  -- No-op-guard: faal vroeg als alle regels al gefactureerd zijn.
  -- pick_backorder-filter (mig 518/hersteld): regels met actieve
  -- backorder-markering worden nooit gefactureerd — gelijk aan finaliseer.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Header: nieuw Concept of hergebruik (verse rebuild op bestaande factuur_id).
  IF p_factuur_id IS NULL THEN
    v_factuur_nr := volgend_nummer('FACT');
    INSERT INTO facturen (
      factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
      subtotaal, btw_percentage, btw_bedrag, totaal,
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd, btw_regeling, btw_controle_nodig_sinds,
      toeslag_bedrag, toeslag_omschrijving, toeslag_procent
    ) VALUES (
      v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
      CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
      0, v_btw_pct, 0, 0,
      COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      v_debiteur.land,
      v_debiteur.btw_nummer,
      (v_btw_regeling.regeling = 'eu_b2b_icl'),
      v_btw_regeling.regeling,
      CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
      0, NULL, NULL
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage           = v_btw_pct,
      btw_verlegd              = (v_btw_regeling.regeling = 'eu_b2b_icl'),
      btw_regeling             = v_btw_regeling.regeling,
      btw_controle_nodig_sinds = CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
      vervaldatum              = factuurdatum + v_betaaltermijn_dagen,
      fact_naam                = COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      fact_adres               = COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      fact_postcode            = COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      fact_plaats              = COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      fact_land                = v_debiteur.land,
      btw_nummer               = v_debiteur.btw_nummer,
      toeslag_bedrag           = 0,
      toeslag_omschrijving     = NULL,
      toeslag_procent          = NULL
     WHERE id = v_factuur_id;
  END IF;

  -- Product- + VERZEND-orderregels (1 factuur-regel per order × regel).
  -- BUNDELKORTING/DREMPELKORTING → hieronder als korting-factuurregels.
  -- TOESLAG (pseudo-orderregel) → eigen totaal-sectie (mig 529).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Product-subtotaal (excl. VERZEND) = grondslag voor toeslag + drempel-check.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels
   WHERE factuur_id = v_factuur_id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  -- Korting-FACTUURregels (DREMPELKORTING/BUNDELKORTING).
  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- 1) DREMPELKORTING op order[1]
    IF v_vk.status = 'gratis_drempel' AND v_aantal_verzend_regels > 0 THEN
      SELECT order_nr, klant_referentie
        INTO v_target_order_nr, v_target_uw_referentie
        FROM orders WHERE id = v_order_ids[1];

      v_korting_regelnr := v_korting_regelnr + 1;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        uw_referentie, order_nr,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        v_target_uw_referentie, v_target_order_nr,
        1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
      );
    END IF;

    -- 2) BUNDELKORTING per order[2..N]
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT order_nr, klant_referentie
          INTO v_target_order_nr, v_target_uw_referentie
          FROM orders WHERE id = v_target_order_id;

        v_korting_regelnr := v_korting_regelnr + 1;
        INSERT INTO factuur_regels (
          factuur_id, order_id, order_regel_id, regelnummer,
          artikelnr, omschrijving,
          uw_referentie, order_nr,
          aantal, prijs, korting_pct, bedrag, btw_percentage
        ) VALUES (
          v_factuur_id, v_target_order_id, NULL, v_korting_regelnr,
          'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          v_target_uw_referentie, v_target_order_nr,
          1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
        );
      END LOOP;
    END IF;
  END;

  -- Toeslag-berekening (mig 529): grondslag = v_bundel_subtotaal (product excl. VERZEND).
  IF v_toeslag_actief THEN
    v_toeslag_bedrag := ROUND(v_bundel_subtotaal * v_debiteur.toeslag_procent / 100, 2);
    v_toeslag_omschrijving := REPLACE(
      v_debiteur.toeslag_omschrijving,
      '{percentage}',
      REPLACE(
        REGEXP_REPLACE(v_debiteur.toeslag_procent::TEXT, '\.?0+$', ''),
        '.', ','
      )
    );
  END IF;

  -- Eindtotalen (BTW over subtotaal + toeslag; gedragsneutraal als toeslag=0).
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  v_btw_bedrag := ROUND((v_subtotaal + v_toeslag_bedrag) * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_toeslag_bedrag + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal            = v_subtotaal,
         btw_bedrag           = v_btw_bedrag,
         totaal               = v_totaal,
         toeslag_bedrag       = v_toeslag_bedrag,
         toeslag_omschrijving = v_toeslag_omschrijving,
         toeslag_procent      = CASE WHEN v_toeslag_actief THEN v_debiteur.toeslag_procent ELSE NULL END
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.recover_stuck_factuur_queue()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE factuur_queue
    SET status = 'pending', processing_started_at = NULL
  WHERE status = 'processing'
    AND processing_started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$


CREATE OR REPLACE FUNCTION public.registreer_achteraf_order(p_order jsonb, p_regels jsonb, p_verzenddatum date DEFAULT CURRENT_DATE, p_afhalen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_nr         TEXT;
  v_order_id         BIGINT;
  v_debiteur_nr      INTEGER;
  v_prijslijst_nr    TEXT;
  v_zending_nr       TEXT;
  v_zending_id       BIGINT;
  v_regel            JSONB;
  v_artikelnr        TEXT;
  v_is_vrije         BOOLEAN;
  v_is_pseudo        BOOLEAN;
  v_te_leveren       INTEGER;
  v_stuks_artikelnr  TEXT;
  v_stuks_per_doos   INTEGER;
  v_reserveer_artikelnr TEXT;
  v_reserveer_aantal INTEGER;
BEGIN
  v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

  -- Prijslijst-check: zelfde gate als create_order_with_lines
  SELECT prijslijst_nr INTO v_prijslijst_nr
    FROM debiteuren
   WHERE debiteur_nr = v_debiteur_nr;

  IF v_prijslijst_nr IS NULL THEN
    RAISE EXCEPTION
      'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
      v_debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_order_nr := volgend_nummer('ORD');

  -- ── §A: INSERT orders direct als Verzonden ──────────────────────────────
  INSERT INTO orders (
    order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
    week, vertegenw_code, betaler, inkooporganisatie,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email,
    afhalen,
    lever_type,
    status,
    verzonden_at,
    is_achteraf
  ) VALUES (
    v_order_nr,
    v_debiteur_nr,
    COALESCE((p_order->>'orderdatum')::DATE, p_verzenddatum),
    p_verzenddatum,
    p_order->>'klant_referentie',
    p_order->>'week',
    p_order->>'vertegenw_code',
    (p_order->>'betaler')::INTEGER,
    p_order->>'inkooporganisatie',
    p_order->>'fact_naam', p_order->>'fact_adres',
    p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
    NULLIF(p_order->>'fact_email', ''),
    p_order->>'afl_naam', p_order->>'afl_naam_2',
    p_order->>'afl_adres', p_order->>'afl_postcode',
    p_order->>'afl_plaats', p_order->>'afl_land',
    NULLIF(p_order->>'afl_email', ''),
    p_afhalen,
    COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
    'Verzonden',
    p_verzenddatum::TIMESTAMPTZ,
    TRUE
  ) RETURNING id INTO v_order_id;

  -- ── §B: INSERT order_regels ─────────────────────────────────────────────
  -- trg_orderregel_herallocateer vuurt maar doet early-return (order=Verzonden,
  -- geen actieve claims om om te zetten → no-op). Reserveringen volgen in §C.
  INSERT INTO order_regels (
    order_id, regelnummer, artikelnr, karpi_code,
    omschrijving, omschrijving_2, orderaantal, te_leveren,
    prijs, korting_pct, bedrag, gewicht_kg,
    fysiek_artikelnr, omstickeren,
    is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
    maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
    maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
    maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
    maatwerk_kwaliteit_code, maatwerk_kleur_code,
    klant_referentie,
    is_vrije_regel
  )
  SELECT
    v_order_id,
    (r->>'regelnummer')::INTEGER,
    r->>'artikelnr',
    r->>'karpi_code',
    r->>'omschrijving',
    r->>'omschrijving_2',
    (r->>'orderaantal')::INTEGER,
    (r->>'te_leveren')::INTEGER,
    (r->>'prijs')::NUMERIC,
    COALESCE((r->>'korting_pct')::NUMERIC, 0),
    (r->>'bedrag')::NUMERIC,
    (r->>'gewicht_kg')::NUMERIC,
    r->>'fysiek_artikelnr',
    COALESCE((r->>'omstickeren')::BOOLEAN, false),
    FALSE,  -- geen maatwerk in retroactieve orders
    NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL,
    NULLIF(r->>'klant_referentie', ''),
    COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_regels) AS r;

  -- ── §C: Voorraad-reserveringen (status='verzonden') ─────────────────────
  -- Elk niet-pseudo, niet-vrije, niet-NULL-artikelnr-regel krijgt een 'verzonden'
  -- reservering zodat vrije_voorraad correct daalt (mig 468: herbereken_product_
  -- reservering telt 'actief' én 'verzonden').
  -- Doos-artikelen: reserve op stuks_artikelnr (spiegelt herallocateer, mig 408).
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    v_artikelnr  := v_regel->>'artikelnr';
    v_is_vrije   := COALESCE((v_regel->>'is_vrije_regel')::BOOLEAN, FALSE);
    v_te_leveren := COALESCE((v_regel->>'te_leveren')::INTEGER, 0);

    -- Sla pseudo-artikelen, vrije regels, NULL-artikelnr en 0-aantallen over
    CONTINUE WHEN v_artikelnr IS NULL;
    CONTINUE WHEN v_is_vrije;
    CONTINUE WHEN v_te_leveren <= 0;
    v_is_pseudo  := is_admin_pseudo(v_artikelnr);
    CONTINUE WHEN v_is_pseudo;

    -- Doos-artikel? → reserve op stuks_artikelnr × stuks_per_doos (mig 408)
    SELECT stuks_artikelnr, stuks_per_doos
      INTO v_stuks_artikelnr, v_stuks_per_doos
      FROM producten
     WHERE artikelnr = v_artikelnr;

    IF v_stuks_artikelnr IS NOT NULL AND v_stuks_per_doos IS NOT NULL THEN
      v_reserveer_artikelnr := v_stuks_artikelnr;
      v_reserveer_aantal    := v_te_leveren * v_stuks_per_doos;
    ELSE
      v_reserveer_artikelnr := v_artikelnr;
      v_reserveer_aantal    := v_te_leveren;
    END IF;

    -- Zoek order_regel_id op voor de FK
    -- fysiek_artikelnr = het daadwerkelijk gereserveerde artikel (na doos→stuks
    -- vertaling). Geen apart artikelnr-kolom in order_reserveringen (mig 468).
    INSERT INTO order_reserveringen (
      order_regel_id, fysiek_artikelnr,
      bron, status, aantal, is_handmatig
    )
    SELECT
      orr.id,
      v_reserveer_artikelnr,
      'voorraad',
      'verzonden',
      v_reserveer_aantal,
      FALSE
    FROM order_regels orr
    WHERE orr.order_id = v_order_id
      AND orr.artikelnr = v_artikelnr
      AND COALESCE(orr.is_vrije_regel, FALSE) = FALSE
    ORDER BY orr.regelnummer
    LIMIT 1;

    -- Herbereken vrije_voorraad voor dit artikel
    PERFORM herbereken_product_reservering(v_reserveer_artikelnr);
  END LOOP;

  -- ── §D: Phantom zending ─────────────────────────────────────────────────
  -- Factuur-trigger (enqueue_factuur_voor_event, mig 474) leest zending_orders
  -- om zending_id te vinden → zonder phantom zending geen factuur_queue entry.
  -- gereed_op=NULL → DESADV-sweep (bouw-verzendbericht-edi) vuurt niet.
  -- status='Klaar voor verzending' → verschijnt niet in Pick & Ship start-tab.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr,
    order_id,  -- NOT NULL legacy-kolom; trigger trg_zending_set_m2m_a_ins
               -- maakt automatisch een zending_orders-rij aan.
    status,
    vervoerder_code,
    verzenddatum,
    is_deelzending,
    aantal_colli,
    totaal_gewicht_kg
  ) VALUES (
    v_zending_nr,
    v_order_id,
    'Gepland',  -- NIET 'Klaar voor verzending': die status triggert
                -- fn_zending_klaar_voor_verzending → enqueue_zending_naar_vervoerder
                -- én fn_zending_set_gereed_op → gereed_op=now() → DESADV-sweep
                -- vuurt voor EDI-partners. 'Gepland' is veilig (factuur-trigger
                -- leest zending_orders, niet de zending-status).
    NULL,   -- geen vervoerder (retroactief, al verzonden)
    p_verzenddatum,
    FALSE,
    0,
    0
  ) RETURNING id INTO v_zending_id;

  -- zending_orders rij wordt automatisch aangemaakt door trigger
  -- trg_zending_set_m2m_a_ins (ON CONFLICT DO NOTHING) — geen expliciete INSERT nodig.

  -- ── §E: order_events → triggert factuur_queue ───────────────────────────
  -- event_type='pickronde_voltooid' + status_na='Verzonden' is de exacte
  -- combinatie die enqueue_factuur_voor_event (mig 474) afhandelt.
  -- Andere triggers die op order_events luisteren reageren NIET op dit event:
  --   • trg_order_events_reservering_release → alleen 'geannuleerd'
  --   • trg_order_events_snijplan_release    → alleen 'geannuleerd'
  --   • trg_order_events_zending_release     → alleen 'geannuleerd'
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na, metadata
  ) VALUES (
    v_order_id,
    'pickronde_voltooid',
    'Verzonden',  -- status_voor = zelfde (order was al Verzonden bij aanmaak)
    'Verzonden',
    jsonb_build_object('achteraf', TRUE, 'verzenddatum', p_verzenddatum, 'afhalen', p_afhalen)
  );

  RETURN jsonb_build_object(
    'id',          v_order_id,
    'order_nr',    v_order_nr,
    'zending_id',  v_zending_id,
    'zending_nr',  v_zending_nr
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.release_claims_voor_io_regel(p_io_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orderregel_id BIGINT;
BEGIN
  FOR v_orderregel_id IN
    SELECT DISTINCT order_regel_id FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
  LOOP
    PERFORM herallocateer_orderregel(v_orderregel_id);
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.release_gepland_stukken(p_kwaliteit_code text, p_kleur_code text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_released        INTEGER    := 0;
  v_affected_rollen BIGINT[]   := ARRAY[]::BIGINT[];
  v_kleur_varianten TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  WITH cleared AS (
    UPDATE snijplannen sn
       SET rol_id       = NULL,
           positie_x_cm = NULL,
           positie_y_cm = NULL,
           geroteerd    = false
      FROM order_regels orr,
           rollen        ro
     WHERE sn.order_regel_id          = orr.id
       AND sn.rol_id                  = ro.id
       AND sn.status                  = 'Gepland'
       AND ro.snijden_gestart_op      IS NULL
       AND orr.maatwerk_kwaliteit_code = p_kwaliteit_code
       AND orr.maatwerk_kleur_code     = ANY(v_kleur_varianten)
       -- Mig 453 (Fase 4): handmatig vergrendelde stukken nooit loslaten.
       AND NOT sn.is_handmatig_toegewezen
    RETURNING sn.id AS snijplan_id, ro.id AS rol_id
  )
  SELECT COUNT(*)::INTEGER,
         COALESCE(ARRAY_AGG(DISTINCT rol_id), ARRAY[]::BIGINT[])
    INTO v_released, v_affected_rollen
    FROM cleared;

  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = ANY(v_affected_rollen)
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn
          WHERE sn.rol_id = ro.id
            AND sn.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  RETURN v_released;
END;
$function$


CREATE OR REPLACE FUNCTION public.release_snijplan_lock(p_kwaliteit text, p_kleur text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM snijplan_locks
  WHERE kwaliteit_code = p_kwaliteit AND kleur_code = p_kleur;
END;
$function$


CREATE OR REPLACE FUNCTION public.release_wacht_op_inkoop_stukken(p_kwaliteit_code text, p_kleur_code text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_released         INTEGER  := 0;
  v_affected_regels   BIGINT[] := ARRAY[]::BIGINT[];
  v_kleur_varianten   TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  WITH te_clearen AS (
    SELECT sn.id AS snijplan_id, sn.verwacht_inkooporder_regel_id AS regel_id
      FROM snijplannen sn
      JOIN order_regels orr ON orr.id = sn.order_regel_id
     WHERE sn.status                  = 'Wacht op inkoop'
       AND orr.maatwerk_kwaliteit_code = p_kwaliteit_code
       AND orr.maatwerk_kleur_code     = ANY(v_kleur_varianten)
  ),
  cleared AS (
    UPDATE snijplannen sn
       SET status = 'Wacht',
           verwacht_inkooporder_regel_id = NULL
     WHERE sn.id IN (SELECT snijplan_id FROM te_clearen)
    RETURNING sn.id
  )
  SELECT (SELECT COUNT(*) FROM cleared)::INTEGER,
         COALESCE(
           (SELECT ARRAY_AGG(DISTINCT regel_id) FROM te_clearen WHERE regel_id IS NOT NULL),
           ARRAY[]::BIGINT[]
         )
    INTO v_released, v_affected_regels;

  -- Exacte-kwaliteit-matching (zie plan-scope): een inkooporder_regel wordt
  -- in v1 maar door één (kwaliteit,kleur)-groep geclaimd, dus hier veilig op
  -- 0 terugzetten i.p.v. aftrekken.
  IF COALESCE(array_length(v_affected_regels, 1), 0) > 0 THEN
    UPDATE inkooporder_regels
       SET snijplan_gebruikte_lengte_cm = 0
     WHERE id = ANY(v_affected_regels);
  END IF;

  RETURN v_released;
END;
$function$


CREATE OR REPLACE FUNCTION public.resolve_klanteigen_naam(p_debiteur_nr integer, p_kwaliteit_code text, p_kleur_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  WITH klant_kleur AS (
    SELECT benaming, 1 AS prio
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND p_kleur_code IS NOT NULL
      AND kleur_code = p_kleur_code
    LIMIT 1
  ),
  klant_kwal AS (
    SELECT benaming, 2 AS prio
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NULL
    LIMIT 1
  ),
  groep_kleur AS (
    SELECT k.benaming, 3 AS prio
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND k.kwaliteit_code = p_kwaliteit_code
      AND p_kleur_code IS NOT NULL
      AND k.kleur_code = p_kleur_code
    LIMIT 1
  ),
  groep_kwal AS (
    SELECT k.benaming, 4 AS prio
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND k.kwaliteit_code = p_kwaliteit_code
      AND k.kleur_code IS NULL
    LIMIT 1
  )
  SELECT benaming FROM (
    SELECT * FROM klant_kleur
    UNION ALL SELECT * FROM klant_kwal
    UNION ALL SELECT * FROM groep_kleur
    UNION ALL SELECT * FROM groep_kwal
  ) hits
  ORDER BY prio
  LIMIT 1;
$function$


CREATE OR REPLACE FUNCTION public.resolve_klanteigen_namen_voor_debiteur(p_debiteur_nr integer)
 RETURNS TABLE(kwaliteit_code text, kleur_code text, benaming text, bron text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH klant AS (
    SELECT k.kwaliteit_code, k.kleur_code, k.benaming, 'klant'::TEXT AS bron
    FROM klanteigen_namen k
    WHERE k.debiteur_nr = p_debiteur_nr
  ),
  groep AS (
    SELECT k.kwaliteit_code, k.kleur_code, k.benaming, 'inkoopgroep'::TEXT AS bron
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND NOT EXISTS (
        SELECT 1 FROM klant kl
        WHERE kl.kwaliteit_code = k.kwaliteit_code
          AND kl.kleur_code IS NOT DISTINCT FROM k.kleur_code
      )
  )
  SELECT kwaliteit_code, kleur_code, benaming, bron FROM klant
  UNION ALL
  SELECT kwaliteit_code, kleur_code, benaming, bron FROM groep;
$function$


CREATE OR REPLACE FUNCTION public.rol_handmatig_bewerken(p_rol_id bigint, p_lengte_cm integer, p_breedte_cm integer, p_locatie_id bigint, p_status text, p_reden text, p_medewerker text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol     rollen%ROWTYPE;
  v_opp_na  NUMERIC;
  v_delta   NUMERIC;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0
     OR p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige afmetingen: % x %', p_lengte_cm, p_breedte_cm;
  END IF;
  IF p_status IN ('gereserveerd','in_snijplan') THEN
    RAISE EXCEPTION 'Status % mag niet handmatig gezet worden (claim-integriteit).',
      p_status;
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF v_rol.status IN ('gereserveerd','in_snijplan','verkocht','gesneden') THEN
    RAISE EXCEPTION
      'Rol % kan niet bewerkt worden: status is % (hangt aan snijplan/claim).',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_opp_na := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);
  v_delta  := v_opp_na - COALESCE(v_rol.oppervlak_m2, 0);

  UPDATE rollen
  SET lengte_cm   = p_lengte_cm,
      breedte_cm  = p_breedte_cm,
      oppervlak_m2 = v_opp_na,
      locatie_id  = p_locatie_id,
      status      = p_status
  WHERE id = p_rol_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'bewerken', v_delta,
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'locatie_id', v_rol.locatie_id),
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp_na, 'status', p_status, 'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.rol_handmatig_toevoegen(p_artikelnr text, p_rol_type rol_type, p_lengte_cm integer, p_breedte_cm integer, p_locatie_id bigint, p_in_magazijn_sinds date, p_rolnummer text, p_reden text, p_medewerker text DEFAULT NULL::text)
 RETURNS TABLE(rol_id bigint, rolnummer text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product   RECORD;
  v_opp       NUMERIC;
  v_rolnr     TEXT;
  v_seq       INTEGER := 1;
  v_nieuw_id  BIGINT;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige lengte: %', p_lengte_cm;
  END IF;
  IF p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige breedte: %', p_breedte_cm;
  END IF;

  SELECT p.karpi_code, p.omschrijving, p.verkoopprijs AS vvp_m2,
         p.kwaliteit_code, p.kleur_code, p.zoeksleutel
    INTO v_product
  FROM producten p WHERE p.artikelnr = p_artikelnr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend artikelnr: %', p_artikelnr;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_rolnr := NULLIF(TRIM(COALESCE(p_rolnummer, '')), '');
  IF v_rolnr IS NULL THEN
    LOOP
      v_rolnr := 'CORR-' || p_artikelnr || '-' || v_seq;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr);
      v_seq := v_seq + 1;
    END LOOP;
  ELSIF EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr) THEN
    RAISE EXCEPTION 'Rolnummer % bestaat al.', v_rolnr;
  END IF;

  v_opp := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);

  INSERT INTO rollen (
    rolnummer, artikelnr, karpi_code, omschrijving,
    lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
    kwaliteit_code, kleur_code, zoeksleutel,
    status, rol_type, locatie_id, reststuk_datum, in_magazijn_sinds
  ) VALUES (
    v_rolnr, p_artikelnr, v_product.karpi_code, v_product.omschrijving,
    p_lengte_cm, p_breedte_cm, v_opp, v_product.vvp_m2,
    v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
    'beschikbaar', p_rol_type, p_locatie_id, NOW(),
    COALESCE(p_in_magazijn_sinds, CURRENT_DATE)
  )
  RETURNING id INTO v_nieuw_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    v_nieuw_id, v_rolnr, p_artikelnr, 'toevoegen', v_opp,
    NULL,
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp, 'rol_type', p_rol_type, 'status', 'beschikbaar',
      'in_magazijn_sinds', COALESCE(p_in_magazijn_sinds, CURRENT_DATE),
      'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );

  rol_id := v_nieuw_id;
  rolnummer := v_rolnr;
  RETURN NEXT;
END;
$function$


CREATE OR REPLACE FUNCTION public.rol_verwijderen(p_rol_id bigint, p_reden text, p_medewerker text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol rollen%ROWTYPE;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF NOT (
        v_rol.status = 'beschikbaar'
     OR (v_rol.rol_type = 'reststuk'
         AND v_rol.status NOT IN
             ('gereserveerd','in_snijplan','verkocht','gesneden'))
  ) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: status is %.',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE rol_id = p_rol_id) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: zit in een snijplan.',
      v_rol.rolnummer;
  END IF;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'verwijderen',
    -COALESCE(v_rol.oppervlak_m2, 0),
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'rol_type', v_rol.rol_type, 'locatie_id', v_rol.locatie_id,
      'in_magazijn_sinds', v_rol.in_magazijn_sinds),
    NULL, TRIM(p_reden), p_medewerker
  );

  BEGIN
    DELETE FROM rollen WHERE id = p_rol_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION
      'Rol % kan niet hard verwijderd worden: er zijn historische '
      'voorraad-mutaties of koppelingen aan deze rol.', v_rol.rolnummer;
  END;
END;
$function$


CREATE OR REPLACE FUNCTION public.rollen_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT json_build_object(
    'totaal', COUNT(*) FILTER (WHERE status NOT IN ('verkocht','gesneden')),
    'totaal_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE status NOT IN ('verkocht','gesneden')), 0),
    'volle_rollen', COUNT(*) FILTER (WHERE rol_type = 'volle_rol' AND status NOT IN ('verkocht','gesneden')),
    'volle_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE rol_type = 'volle_rol' AND status NOT IN ('verkocht','gesneden')), 0),
    'aangebroken', COUNT(*) FILTER (WHERE rol_type = 'aangebroken' AND status NOT IN ('verkocht','gesneden')),
    'aangebroken_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE rol_type = 'aangebroken' AND status NOT IN ('verkocht','gesneden')), 0),
    'reststukken', COUNT(*) FILTER (WHERE rol_type = 'reststuk' AND status NOT IN ('verkocht','gesneden')),
    'reststukken_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE rol_type = 'reststuk' AND status NOT IN ('verkocht','gesneden')), 0),
    'leeg_op', COUNT(*) FILTER (WHERE status = 'verkocht' OR lengte_cm = 0)
  ) FROM rollen;
$function$


CREATE OR REPLACE FUNCTION public.ruim_edi_demo_data()
 RETURNS TABLE(verwijderde_orders integer, verwijderde_berichten integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_orders    INTEGER := 0;
  v_berichten INTEGER := 0;
BEGIN
  -- 1. Eerst alle test-EDI-berichten verwijderen. Hiermee worden ook de
  --    uitgaande orderbev-rijen weggehaald die naar de demo-orders verwijzen
  --    (FK edi_berichten.order_id → orders.id).
  WITH del AS (
    DELETE FROM edi_berichten
     WHERE is_test = TRUE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_berichten FROM del;

  -- 2. Daarna de orders die via demo of upload zijn aangemaakt.
  --    CASCADE ruimt order_regels + order_reserveringen mee.
  WITH del AS (
    DELETE FROM orders
     WHERE bron_systeem = 'edi'
       AND (bron_order_id LIKE 'DEMO-%' OR bron_order_id LIKE 'UPLOAD-%')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_orders FROM del;

  RETURN QUERY SELECT v_orders, v_berichten;
END;
$function$


CREATE OR REPLACE FUNCTION public.selecteer_vervoerder_voor_zending(p_zending_id bigint)
 RETURNS TABLE(gekozen_vervoerder_code text, gekozen_service_code text, keuze_uitleg jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_attr   RECORD;
  v_regel  RECORD;
  v_eval   JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT * INTO v_attr FROM evalueer_zending_attributes(p_zending_id);

  v_eval := jsonb_build_object(
    'strategie',          'regels_v1',
    'land',               v_attr.afl_land,
    'kleinste_zijde_cm',  v_attr.kleinste_zijde_cm,
    'totaal_gewicht_kg',  v_attr.totaal_gewicht_kg,
    'debiteur_nr',        v_attr.debiteur_nr,
    'inkoopgroep',        v_attr.inkoopgroep_code
  );

  FOR v_regel IN
    SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie, vsr.service_code, vsr.notitie
      FROM vervoerder_selectie_regels vsr
      JOIN vervoerders v ON v.code = vsr.vervoerder_code
     WHERE vsr.actief = TRUE
       AND v.actief    = TRUE
     ORDER BY vsr.prio ASC, vsr.id ASC
  LOOP
    IF matcht_regel(
         v_regel.conditie,
         v_attr.afl_land,
         v_attr.kleinste_zijde_cm,
         v_attr.totaal_gewicht_kg,
         v_attr.debiteur_nr,
         v_attr.inkoopgroep_code
       )
    THEN
      RETURN QUERY SELECT
        v_regel.vervoerder_code,
        v_regel.service_code,
        v_eval || jsonb_build_object(
          'match_regel_id',     v_regel.id,
          'match_prio',         v_regel.prio,
          'match_conditie',     v_regel.conditie,
          'match_notitie',      v_regel.notitie
        );
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    NULL::TEXT,
    NULL::TEXT,
    v_eval || jsonb_build_object('reden', 'geen_matchende_regel');
END;
$function$


CREATE OR REPLACE FUNCTION public.set_allocatie_keuze(p_order_regel_id bigint, p_keuzes jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_keuze JSONB;
  v_bron TEXT;
  v_artikelnr TEXT;
  v_io_regel_id BIGINT;
  v_aantal INTEGER;
  v_orderregel_artikelnr TEXT;
  v_order_id BIGINT;
  v_io_ruimte INTEGER;
BEGIN
  SELECT artikelnr, order_id INTO v_orderregel_artikelnr, v_order_id
    FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;

  -- Release alle actieve claims voor deze regel (handmatig én niet-handmatig)
  -- — mirrort set_uitwisselbaar_claims (mig 154/403), nu ook bron='inkooporder_regel'.
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief';

  IF p_keuzes IS NOT NULL THEN
    FOR v_keuze IN SELECT * FROM jsonb_array_elements(p_keuzes) LOOP
      v_bron := v_keuze->>'bron';
      v_aantal := (v_keuze->>'aantal')::INTEGER;
      IF v_aantal IS NULL OR v_aantal <= 0 THEN CONTINUE; END IF;

      IF v_bron = 'voorraad' THEN
        v_artikelnr := v_keuze->>'artikelnr';
        IF v_artikelnr IS NULL OR v_artikelnr = v_orderregel_artikelnr THEN CONTINUE; END IF;
        INSERT INTO order_reserveringen
          (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
        VALUES
          (p_order_regel_id, 'voorraad', v_aantal, v_artikelnr, true);

      ELSIF v_bron = 'inkooporder_regel' THEN
        v_io_regel_id := (v_keuze->>'inkooporder_regel_id')::BIGINT;
        v_artikelnr := v_keuze->>'artikelnr';
        IF v_io_regel_id IS NULL THEN CONTINUE; END IF;
        -- Capaciteit-guard: claim nooit meer dan er werkelijk vrij is op de
        -- IO-regel (mirrort allocator stap 2's io_regel_ruimte-gebruik).
        v_io_ruimte := io_regel_ruimte(v_io_regel_id);
        IF v_aantal > v_io_ruimte THEN
          RAISE EXCEPTION
            'Gekozen aantal (%) overschrijdt de beschikbare ruimte (%) op inkooporder_regel %',
            v_aantal, v_io_ruimte, v_io_regel_id;
        END IF;
        INSERT INTO order_reserveringen
          (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr, is_handmatig)
        VALUES
          (p_order_regel_id, 'inkooporder_regel', v_io_regel_id, v_aantal,
           COALESCE(v_artikelnr, v_orderregel_artikelnr), true);
      END IF;
    END LOOP;
  END IF;

  -- Restant na de bevestigde keuze mag verder automatisch cascaderen (eigen
  -- voorraad + eigen IO) — zelfde semantiek als vandaag al bij
  -- set_uitwisselbaar_claims, nu expliciet via de _auto-vorm.
  PERFORM herallocateer_orderregel_auto(p_order_regel_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.set_bijgewerkt_op()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.bijgewerkt_op = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_bug_status(p_id bigint, p_status bug_melding_status, p_opgelost text DEFAULT NULL::text, p_testen text DEFAULT NULL::text)
 RETURNS bug_meldingen
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      bug_meldingen;
  v_is_admin BOOLEAN := is_bug_beheerder();
  v_uid      UUID    := auth.uid();
BEGIN
  SELECT * INTO v_row FROM bug_meldingen WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bug-melding % bestaat niet', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_status = 'Geaccepteerd' THEN
    -- Accepteren mag de melder zelf (of de beheerder), alleen vanuit 'Verwerkt'.
    IF v_row.gemeld_door IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de melder kan een melding accepteren';
    END IF;
    IF v_row.status <> 'Verwerkt' THEN
      RAISE EXCEPTION 'Een melding kan alleen vanuit "Verwerkt" geaccepteerd worden';
    END IF;
  ELSE
    -- 'Open' / 'Verwerkt' (verwerken + terugzetten): alleen de beheerder.
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de beheerder kan deze status zetten';
    END IF;
  END IF;

  UPDATE bug_meldingen
     SET status            = p_status,
         verwerkt_op       = CASE
                               WHEN p_status = 'Verwerkt' THEN now()
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_op
                             END,
         -- Notitie alleen schrijven bij verwerken; bij terugzetten wissen;
         -- bij accepteren ongemoeid laten (melder ziet de toelichting nog).
         verwerkt_opgelost = CASE
                               WHEN p_status = 'Verwerkt' THEN NULLIF(btrim(p_opgelost), '')
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_opgelost
                             END,
         verwerkt_testen   = CASE
                               WHEN p_status = 'Verwerkt' THEN NULLIF(btrim(p_testen), '')
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_testen
                             END,
         -- Nieuwe verwerking = ongezien voor de melder (teller licht weer op).
         -- Open wist de stempel; accepteren impliceert dat de melder het zag.
         verwerkt_gezien_op = CASE
                               WHEN p_status = 'Verwerkt'    THEN NULL
                               WHEN p_status = 'Open'        THEN NULL
                               WHEN p_status = 'Geaccepteerd' THEN now()
                               ELSE verwerkt_gezien_op
                             END,
         geaccepteerd_op   = CASE WHEN p_status = 'Geaccepteerd' THEN now() ELSE NULL END
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END; $function$


CREATE OR REPLACE FUNCTION public.set_edi_berichten_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_edi_handelspartner_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_facturen_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_hst_to_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_inkoop_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_locatie_voor_orderregel(p_order_regel_id integer, p_code text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code TEXT;
  v_id BIGINT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Magazijnlocatie-code mag niet leeg zijn';
  END IF;

  -- Stap 1: vind of maak magazijn-locatie. Hergebruikt dezelfde idempotente
  -- logica als create_or_get_magazijn_locatie (mig 169).
  SELECT id INTO v_id FROM magazijn_locaties WHERE code = v_code;
  IF v_id IS NULL THEN
    INSERT INTO magazijn_locaties (code, omschrijving, type, actief)
    VALUES (v_code, NULL, 'rek', true)
    RETURNING id INTO v_id;
  END IF;

  -- Stap 2: koppel locatie-code aan de ingepakte snijplan-regel(s) van deze
  -- orderregel. Snijplannen.locatie is een TEXT-kolom (geen FK) — dat blijft
  -- in V1 zo (zie ADR-0002 "Niet in scope: schema-migratie naar FK").
  UPDATE snijplannen
  SET locatie = v_code
  WHERE order_regel_id = p_order_regel_id
    AND status = 'Ingepakt';

  RETURN v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_orderregel_vervoerder_override_voor_order(p_order_id bigint, p_vervoerder_code text)
 RETURNS TABLE(orderregel_id bigint, resultaat text, reden text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_afhalen      BOOLEAN;
  v_regel        RECORD;
BEGIN
  -- Validatie: order bestaat.
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Validatie: vervoerder bestaat (als niet-NULL).
  IF p_vervoerder_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE code = p_vervoerder_code) THEN
    RAISE EXCEPTION 'Vervoerder % bestaat niet', p_vervoerder_code;
  END IF;

  -- Afhalen-orders: geen vervoerder zetten — retourneer één informatierij.
  SELECT o.afhalen INTO v_afhalen FROM orders o WHERE o.id = p_order_id;
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY SELECT
      NULL::BIGINT,
      'overgeslagen_afhalen'::TEXT,
      'Order is afhalen — geen vervoerder zetten'::TEXT;
    RETURN;
  END IF;

  -- Per-regel: probeer override te zetten.
  -- De lock-trigger uit mig 219 (trg_lock_orderregel_vervoerder) blokkeert
  -- UPDATE als de regel al in een open zending zit via een restrict_violation.
  -- We vangen die exception per-regel op zodat geblokkeerde regels als typed
  -- resultaat terugkomen in plaats van de hele transactie te falen.
  FOR v_regel IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    BEGIN
      UPDATE order_regels
         SET vervoerder_code = p_vervoerder_code
       WHERE id = v_regel.id;
      orderregel_id := v_regel.id;
      resultaat     := 'gezet';
      reden         := NULL;
      RETURN NEXT;
    EXCEPTION
      WHEN restrict_violation THEN
        orderregel_id := v_regel.id;
        resultaat     := 'geblokkeerd_door_zending';
        reden         := SQLERRM;
        RETURN NEXT;
    END;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_regel_verzendweek(p_regel_id bigint, p_verzendweek text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE order_regels
     SET verzendweek = p_verzendweek,
         verzendweek_bron = CASE WHEN p_verzendweek IS NULL THEN NULL ELSE 'handmatig' END
   WHERE id = p_regel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_regel_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_rhenus_to_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_uitwisselbaar_claims(p_order_regel_id bigint, p_keuzes jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_keuze JSONB;
  v_artikelnr TEXT;
  v_aantal INTEGER;
  v_orderregel_artikelnr TEXT;
BEGIN
  SELECT artikelnr INTO v_orderregel_artikelnr
  FROM order_regels WHERE id = p_order_regel_id;

  -- Release alle bestaande HANDMATIGE claims voor deze orderregel
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND is_handmatig = true;

  -- Release ook alle NIET-handmatige claims zodat de INSERT van handmatige claims
  -- hieronder niet botst met auto-alias-claims die de INSERT-trigger op order_regels
  -- al heeft aangemaakt (mig 403). herallocateer_orderregel aan het einde herplaatst
  -- ze voor het deel dat niet door handmatige claims gedekt wordt.
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  -- Maak nieuwe handmatige claims aan
  IF p_keuzes IS NOT NULL THEN
    FOR v_keuze IN SELECT * FROM jsonb_array_elements(p_keuzes) LOOP
      v_artikelnr := v_keuze->>'artikelnr';
      v_aantal := (v_keuze->>'aantal')::INTEGER;

      -- Skip eigen artikelnr (gebruik gewone allocator) en lege/0-aantallen
      IF v_artikelnr IS NULL OR v_aantal IS NULL OR v_aantal <= 0
         OR v_artikelnr = v_orderregel_artikelnr THEN
        CONTINUE;
      END IF;

      INSERT INTO order_reserveringen
        (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
      VALUES
        (p_order_regel_id, 'voorraad', v_aantal, v_artikelnr, true);
    END LOOP;
  END IF;

  -- Triggert allocator voor het resterende (eigen voorraad + IO, na aftrek handmatig)
  PERFORM herallocateer_orderregel(p_order_regel_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.set_verhoek_to_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_vervoerders_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_verzend_wachtrij_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.set_zendingen_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.simuleer_dekking(p_artikelnr text, p_te_leveren integer, p_uitwisselbaar_keuzes jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(direct integer, uitwisselbaar integer, io_tekort integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_te_leveren INT := COALESCE(p_te_leveren, 0);
  v_vrij INT := 0;
  v_uitwisselbaar_totaal INT := 0;
  v_direct INT;
  v_uitwisselbaar INT;
  v_io_tekort INT;
BEGIN
  -- Geen artikelnr of geen positieve hoeveelheid → splitsing is (0,0,0).
  -- Spiegelt de isVasteMaat-guard in berekenRegelDekking.
  IF p_artikelnr IS NULL OR v_te_leveren <= 0 THEN
    RETURN QUERY SELECT 0::INT, 0::INT, 0::INT;
    RETURN;
  END IF;

  -- Stap 1: vrije voorraad eigen artikel. Sentinel -1 excludeert geen
  -- bestaande orderregel — pure what-if over de huidige claim-staat.
  v_vrij := voorraad_beschikbaar_voor_artikel(p_artikelnr, -1::BIGINT);

  -- Stap 2: som van handmatige uitwisselbaar-keuzes uit JSONB-array.
  IF p_uitwisselbaar_keuzes IS NOT NULL
     AND jsonb_typeof(p_uitwisselbaar_keuzes) = 'array' THEN
    SELECT COALESCE(SUM(GREATEST(0, COALESCE((elem->>'aantal')::INT, 0))), 0)
      INTO v_uitwisselbaar_totaal
      FROM jsonb_array_elements(p_uitwisselbaar_keuzes) AS elem
     WHERE elem->>'artikelnr' IS NOT NULL;
  END IF;

  -- Stap 3: splitsing zoals in berekenRegelDekking.
  v_direct := GREATEST(0, LEAST(v_vrij, v_te_leveren));
  v_uitwisselbaar := GREATEST(0, LEAST(v_uitwisselbaar_totaal, v_te_leveren - v_direct));
  v_io_tekort := GREATEST(0, v_te_leveren - v_direct - v_uitwisselbaar);

  RETURN QUERY SELECT v_direct, v_uitwisselbaar, v_io_tekort;
END;
$function$


CREATE OR REPLACE FUNCTION public.snijplan_wacht_naar_snijden()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'Wacht' THEN
    NEW.status := 'Gepland';
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.snijplanning_groepen_gefilterd(p_tot_datum date DEFAULT NULL::date)
 RETURNS TABLE(kwaliteit_code text, kleur_code text, totaal_stukken integer, totaal_orders integer, totaal_m2 double precision, totaal_gesneden integer, vroegste_afleverdatum date, totaal_snijden integer, totaal_snijden_gepland integer, totaal_fysiek_snijden integer, totaal_status_gesneden integer, totaal_in_confectie integer, totaal_gereed integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    so.kwaliteit_code,
    so.kleur_code,
    COUNT(*)::INTEGER AS totaal_stukken,
    COUNT(DISTINCT so.order_id)::INTEGER AS totaal_orders,
    ROUND(SUM(so.snij_lengte_cm::NUMERIC * so.snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
    COUNT(*) FILTER (WHERE so.status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
    MIN(so.afleverdatum) FILTER (WHERE so.status NOT IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed', 'Geannuleerd')) AS vroegste_afleverdatum,
    -- totaal_snijden = alles in de pipeline (Gepland + Snijden). Pre-089
    -- telde dit alleen 'Snijden', maar na splitsing is dat incompleet.
    COUNT(*) FILTER (WHERE so.status IN ('Gepland', 'Snijden'))::INTEGER AS totaal_snijden,
    -- totaal_snijden_gepland = subset met rol_id gezet (klaar voor snijden).
    COUNT(*) FILTER (WHERE so.status IN ('Gepland', 'Snijden') AND so.rol_id IS NOT NULL)::INTEGER AS totaal_snijden_gepland,
    -- totaal_fysiek_snijden = alleen status='Snijden' (nieuw veld, voor monitoring).
    COUNT(*) FILTER (WHERE so.status = 'Snijden')::INTEGER AS totaal_fysiek_snijden,
    COUNT(*) FILTER (WHERE so.status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
    COUNT(*) FILTER (WHERE so.status = 'In confectie')::INTEGER AS totaal_in_confectie,
    COUNT(*) FILTER (WHERE so.status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.kwaliteit_code, so.kleur_code
  ORDER BY so.kwaliteit_code, so.kleur_code;
$function$


CREATE OR REPLACE FUNCTION public.snijplanning_kpis_gefilterd(p_tot_datum date DEFAULT NULL::date)
 RETURNS TABLE(binnen_horizon bigint, deze_week_te_snijden bigint, deze_week_gesneden bigint)
 LANGUAGE sql
 STABLE
AS $function$
  WITH grenzen AS (
    SELECT
      date_trunc('week', CURRENT_DATE)::DATE                 AS deze_week_ma,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE  AS deze_week_zo,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::DATE  AS volgende_week_ma,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '13 days')::DATE AS volgende_week_zo
  )
  SELECT
    COUNT(*) FILTER (
      WHERE so.status IN ('Gepland', 'Snijden')
        AND (p_tot_datum IS NULL OR so.afleverdatum IS NULL OR so.afleverdatum <= p_tot_datum)
    ) AS binnen_horizon,
    COUNT(*) FILTER (
      WHERE so.status IN ('Gepland', 'Snijden')
        AND so.afleverdatum BETWEEN g.volgende_week_ma AND g.volgende_week_zo
    ) AS deze_week_te_snijden,
    COUNT(*) FILTER (
      WHERE so.status = 'Gesneden'
        AND so.gesneden_op::DATE BETWEEN g.deze_week_ma AND g.deze_week_zo
    ) AS deze_week_gesneden
  FROM snijplanning_overzicht so
  CROSS JOIN grenzen g;
$function$


CREATE OR REPLACE FUNCTION public.snijplanning_status_counts_gefilterd(p_tot_datum date DEFAULT NULL::date)
 RETURNS TABLE(status text, aantal bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    so.status::TEXT,
    COUNT(*) AS aantal
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND so.status NOT IN ('Geannuleerd')
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.status
  HAVING COUNT(*) > 0;
$function$


CREATE OR REPLACE FUNCTION public.snijplanning_tekort_analyse()
 RETURNS TABLE(kwaliteit_code text, kleur_code text, heeft_collectie boolean, uitwisselbare_codes text[], aantal_beschikbaar integer, totaal_beschikbaar_m2 numeric, max_lange_zijde_cm integer, max_korte_zijde_cm integer, grootste_onpassend_stuk_lange_cm integer, grootste_onpassend_stuk_korte_cm integer, aantal_fysiek_bezet integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH groepen AS (
    SELECT DISTINCT so.kwaliteit_code, so.kleur_code
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.kwaliteit_code IS NOT NULL
      AND so.kleur_code     IS NOT NULL
  ),
  -- Per snijden-groep: alle uitwissel-paren via canonieke seam.
  paren AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      up.target_kwaliteit_code AS target_kw,
      up.target_kleur_code     AS target_kl_norm,
      up.is_zelf
    FROM groepen g
    CROSS JOIN LATERAL uitwisselbare_paren(g.kwaliteit_code, g.kleur_code) up
  ),
  zusters AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      EXISTS (
        SELECT 1 FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
          AND NOT p.is_zelf
      ) AS heeft_collectie,
      (SELECT ARRAY_AGG(DISTINCT p.target_kw ORDER BY p.target_kw)
         FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
      ) AS codes
    FROM groepen g
  ),
  rollen_per_groep AS (
    SELECT
      p.kwaliteit_code,
      p.kleur_code,
      r.id                                AS rol_id,
      GREATEST(r.lengte_cm, r.breedte_cm) AS rol_lange,
      LEAST(r.lengte_cm, r.breedte_cm)    AS rol_korte,
      COALESCE(r.oppervlak_m2, 0)         AS m2
    FROM paren p
    JOIN rollen r
      ON r.status IN ('beschikbaar', 'reststuk')
     AND r.kwaliteit_code = p.target_kw
     AND normaliseer_kleur_code(r.kleur_code) = p.target_kl_norm
     AND r.lengte_cm  > 0
     AND r.breedte_cm > 0
  ),
  -- NIEUW (mig 462): fysiek aanwezige maar al toegewezen rollen, zelfde
  -- (kwaliteit,kleur)+uitwisselbare-paren-scope als rollen_per_groep.
  fysiek_bezette_rollen AS (
    SELECT
      p.kwaliteit_code,
      p.kleur_code,
      r.id AS rol_id
    FROM paren p
    JOIN rollen r
      ON r.status IN ('in_snijplan', 'verkocht')
     AND r.kwaliteit_code = p.target_kw
     AND normaliseer_kleur_code(r.kleur_code) = p.target_kl_norm
  ),
  fysiek_bezet_agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER AS aantal
    FROM fysiek_bezette_rollen
    GROUP BY kwaliteit_code, kleur_code
  ),
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC   AS totaal_m2
    FROM rollen_per_groep
    GROUP BY kwaliteit_code, kleur_code
  ),
  best_rol AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, rol_lange, rol_korte
    FROM rollen_per_groep
    ORDER BY kwaliteit_code, kleur_code, rol_korte DESC, rol_lange DESC
  ),
  stuk_checks AS (
    SELECT so.kwaliteit_code,
           so.kleur_code,
           GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm) AS stuk_lange,
           LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm) AS stuk_korte,
           EXISTS (
             SELECT 1 FROM rollen_per_groep rpg
             WHERE rpg.kwaliteit_code = so.kwaliteit_code
               AND rpg.kleur_code     = so.kleur_code
               AND rpg.rol_lange >= GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)
               AND rpg.rol_korte >= LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)
           ) AS past
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.snij_lengte_cm  IS NOT NULL
      AND so.snij_breedte_cm IS NOT NULL
      AND so.snij_lengte_cm  > 0
      AND so.snij_breedte_cm > 0
  ),
  grootste_onpassend AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, stuk_lange, stuk_korte
    FROM stuk_checks
    WHERE past = FALSE
    ORDER BY kwaliteit_code, kleur_code, stuk_lange DESC, stuk_korte DESC
  )
  SELECT z.kwaliteit_code,
         z.kleur_code,
         z.heeft_collectie,
         z.codes,
         COALESCE(agg.aantal,    0),
         COALESCE(agg.totaal_m2, 0),
         COALESCE(br.rol_lange,  0)::INTEGER AS max_lange_zijde_cm,
         COALESCE(br.rol_korte,  0)::INTEGER AS max_korte_zijde_cm,
         COALESCE(go.stuk_lange, 0)::INTEGER AS grootste_onpassend_stuk_lange_cm,
         COALESCE(go.stuk_korte, 0)::INTEGER AS grootste_onpassend_stuk_korte_cm,
         COALESCE(fb.aantal,     0)          AS aantal_fysiek_bezet
  FROM zusters z
  LEFT JOIN agg                   ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code  = z.kwaliteit_code AND br.kleur_code  = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code  = z.kwaliteit_code AND go.kleur_code  = z.kleur_code
  LEFT JOIN fysiek_bezet_agg   fb ON fb.kwaliteit_code  = z.kwaliteit_code AND fb.kleur_code  = z.kleur_code;
$function$


CREATE OR REPLACE FUNCTION public.snijplanning_wacht_op_inkoop_analyse()
 RETURNS TABLE(kwaliteit_code text, kleur_code text, inkooporder_regel_id bigint, inkooporder_nr text, leverancier_naam text, verwacht_datum date, te_leveren_m numeric, te_leveren_m2 numeric, gebruikte_lengte_cm integer, resterend_lengte_cm integer, resterend_m2 numeric, aantal_stukken integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    orr.maatwerk_kwaliteit_code AS kwaliteit_code,
    orr.maatwerk_kleur_code     AS kleur_code,
    ir.id                       AS inkooporder_regel_id,
    io.inkooporder_nr,
    l.naam                      AS leverancier_naam,
    COALESCE(ir.verwacht_datum, io.verwacht_datum) AS verwacht_datum,
    ir.te_leveren_m,
    CASE WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
      THEN ir.te_leveren_m * k.standaard_breedte_cm / 100.0
      ELSE 0
    END AS te_leveren_m2,
    ir.snijplan_gebruikte_lengte_cm AS gebruikte_lengte_cm,
    GREATEST((ir.te_leveren_m * 100)::INTEGER - ir.snijplan_gebruikte_lengte_cm, 0) AS resterend_lengte_cm,
    CASE WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
      THEN GREATEST((ir.te_leveren_m * 100)::INTEGER - ir.snijplan_gebruikte_lengte_cm, 0)
             * k.standaard_breedte_cm / 10000.0
      ELSE 0
    END AS resterend_m2,
    COUNT(sn.id)::INTEGER AS aantal_stukken
  FROM snijplannen sn
  JOIN order_regels orr        ON orr.id = sn.order_regel_id
  JOIN inkooporder_regels ir   ON ir.id  = sn.verwacht_inkooporder_regel_id
  JOIN inkooporders io         ON io.id  = ir.inkooporder_id
  LEFT JOIN leveranciers l     ON l.id   = io.leverancier_id
  LEFT JOIN kwaliteiten k      ON k.code = orr.maatwerk_kwaliteit_code
  WHERE sn.status = 'Wacht op inkoop'
  GROUP BY orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code, ir.id, io.inkooporder_nr,
           l.naam, COALESCE(ir.verwacht_datum, io.verwacht_datum), ir.te_leveren_m,
           k.standaard_breedte_cm, ir.snijplan_gebruikte_lengte_cm;
$function$


CREATE OR REPLACE FUNCTION public.sscc_check_digit(p_data text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_sum    INTEGER := 0;
  v_pos    INTEGER;
  v_digit  INTEGER;
  v_factor INTEGER;
  v_len    INTEGER := length(p_data);
BEGIN
  IF p_data !~ '^\d+$' THEN
    RAISE EXCEPTION 'sscc_check_digit verwacht numerieke string, kreeg %', p_data;
  END IF;
  -- Itereer van links naar rechts; bepaal factor o.b.v. positie van rechts
  FOR v_pos IN 1..v_len LOOP
    v_digit := substring(p_data FROM v_pos FOR 1)::INTEGER;
    -- Positie vanaf rechts (1-based): v_len - v_pos + 1
    -- Oneven (1,3,5...) → factor 3; even (2,4,6...) → factor 1
    IF ((v_len - v_pos + 1) % 2) = 1 THEN
      v_factor := 3;
    ELSE
      v_factor := 1;
    END IF;
    v_sum := v_sum + v_digit * v_factor;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;
END;
$function$


CREATE OR REPLACE FUNCTION public.start_confectie(p_snijplan_id bigint)
 RETURNS snijplannen
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row snijplannen;
BEGIN
  UPDATE snijplannen
     SET status = 'In confectie'
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie (of bestaat niet)', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.start_deelzending(p_order_id bigint, p_regel_ids bigint[], p_picker_id bigint, p_override_reden text DEFAULT NULL::text)
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

  -- Mig 567 (ADR-0040/Anker 4): een Combi-levering-wachtende order mag niet
  -- via een deelzending stilletjes ontsnappen — de bedoelde route is de
  -- order-override ("Toch verzenden met verzendkosten"), die de status, de
  -- VERZEND-regel én de siblings netjes herwaardeert (mig 561).
  IF v_order.status = 'Wacht op combi-levering' THEN
    RAISE EXCEPTION 'Order % wacht op Combi-levering (vrachtvrije drempel nog niet gehaald). Zet eerst "Toch verzenden met verzendkosten" (combi-levering-override) aan op de order voordat je een deelzending start.', v_order.order_nr
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

  -- (c) Geen regel al in actieve zending?
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

  -- Vervoerder bepalen
  SELECT evpo.effectief_code, evpo.effectief_service
    INTO v_vervoerder, v_service
    FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
   WHERE evpo.orderregel_id = ANY(p_regel_ids)
   ORDER BY evpo.orderregel_id ASC
   LIMIT 1;

  -- Maak de deelzending aan — mig 477: 'Gepland', nog niet 'Picken'.
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

  INSERT INTO zending_orders (zending_id, order_id)
  VALUES (v_zending_id, p_order_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.id = ANY(p_regel_ids)
     AND COALESCE(ore.orderaantal, 0) > 0;

  PERFORM genereer_zending_colli(v_zending_id);

  -- Audit-event: deelzending AANGEMAAKT — mig 506: gedaan_door toegevoegd.
  INSERT INTO order_events (order_id, event_type, status_voor, status_na, actor_auth_user_id, metadata)
  SELECT
    p_order_id,
    'deelzending_gestart',
    v_order.status,
    v_order.status,
    auth.uid(),
    jsonb_build_object(
      'zending_id',   v_zending_id,
      'zending_nr',   v_zending_nr,
      'regel_ids',    p_regel_ids,
      'vervoerder',   v_vervoerder,
      'gedaan_door',  huidige_actor_email()
    ) || CASE
      WHEN COALESCE(btrim(p_override_reden), '') <> ''
        THEN jsonb_build_object('deelleveringen_override_reden', btrim(p_override_reden))
      ELSE '{}'::jsonb
    END;

  RETURN QUERY SELECT v_zending_id, v_zending_nr, v_vervoerder;
END;
$function$


CREATE OR REPLACE FUNCTION public.start_pickronden(p_order_ids bigint[], p_picker_id bigint, p_force_solo_ids bigint[] DEFAULT '{}'::bigint[])
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

  -- Mig 555: de bundel-expansie-tak neemt een order uit
  -- voorgestelde_zending_bundels alleen over als die zelf ook
  -- pick_ship_zichtbaar is — een niet-klare hitchhiker mag niet ongevraagd
  -- de hele start_pickronden-aanroep blokkeren (zie migratie-header).
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
      JOIN order_pickbaarheid opb ON opb.order_id = pid
     WHERE b.aantal_orders >= 2
       AND b.order_ids && (SELECT array_agg(oid) FROM bundel_eligible)
       AND pid <> ALL(v_force_solo)
       AND opb.pick_ship_zichtbaar
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

  -- Geen-vervoerder guard (mig 373)
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

  -- Intake-gate-poort (mig 395/396)
  PERFORM _valideer_intake_gates(v_alle_orders);

  -- Pickbaarheid-guard (mig 466) — sinds mig 555 vrijwel altijd een no-op
  -- voor bundel-hitchhikers (die worden nu al bij de uitbreiding uitgesloten).
  -- Blijft staan als defense-in-depth voor de EXPLICIET meegegeven orders
  -- (p_order_ids/p_force_solo_ids), bv. bij een stale frontend-selectie.
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

  -- Mig 477: promoot bestaande 'Gepland'-deelzendingen naar 'Picken'
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

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × jaar_week × solo_marker)
  --
  -- Mig 536: jaar_week terug in GROUP BY, maar met 1-week-vooruit-clamp:
  --   afleverdatum <= volgende week → huidige week; verder weg → eigen week.
  -- Concreet: Wk 26+27+28 → één zending; Wk 31 → eigen zending.
  --
  -- Mig 477/479: WHERE NOT pv.is_locked AND orp.is_pickbaar ongewijzigd.
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
        -- Mig 536 clamp: zelfde logica als de view
        CASE
          WHEN verzendweek_voor_datum(o.afleverdatum)
                 <= verzendweek_voor_datum((CURRENT_DATE + INTERVAL '7 days')::DATE)
          THEN verzendweek_voor_datum(CURRENT_DATE)
          ELSE verzendweek_voor_datum(o.afleverdatum)
        END                                            AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
        JOIN orderregel_pickbaarheid orp ON orp.order_regel_id = pv.orderregel_id
       WHERE NOT pv.is_locked
         AND orp.is_pickbaar
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
$function$


CREATE OR REPLACE FUNCTION public.start_productie_rol(p_rol_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE snijplannen
  SET status = 'In productie'
  WHERE rol_id = p_rol_id
    AND status = 'Gepland';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$


CREATE OR REPLACE FUNCTION public.start_snijden_rol(p_rol_id bigint, p_gebruiker text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE rollen
  SET snijden_gestart_op = NOW(),
      snijden_gestart_door = p_gebruiker
  WHERE id = p_rol_id
    AND snijden_gestart_op IS NULL;

  -- Alle Gepland-stukken op deze rol naar Snijden promoveren.
  UPDATE snijplannen
  SET status = 'Snijden'
  WHERE rol_id = p_rol_id
    AND status = 'Gepland';
END;
$function$


CREATE OR REPLACE FUNCTION public.stel_portal_credentials_in(p_leverancier_id integer, p_email text, p_wachtwoord text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF length(trim(p_wachtwoord)) < 6 THEN
    RAISE EXCEPTION 'Wachtwoord moet minimaal 6 tekens zijn';
  END IF;
  UPDATE leveranciers SET
    portal_email           = lower(trim(p_email)),
    portal_wachtwoord_hash = extensions.crypt(p_wachtwoord, extensions.gen_salt('bf', 10))
  WHERE id = p_leverancier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leverancier % niet gevonden', p_leverancier_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.sticker_ean_voor_kw_kl(p_kwaliteit_code text, p_kleur_code text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  WITH maatwerk_match AS (
    SELECT p.ean_code, p.artikelnr
    FROM producten p
    WHERE p.kwaliteit_code = p_kwaliteit_code
      AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(p_kleur_code)
      AND p.karpi_code LIKE '%MAATWERK'
      AND p.ean_code IS NOT NULL
      AND p.ean_code <> ''
    ORDER BY p.artikelnr
    LIMIT 1
  ),
  rol_match AS (
    SELECT p.ean_code, p.artikelnr
    FROM producten p
    WHERE p.kwaliteit_code = p_kwaliteit_code
      AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(p_kleur_code)
      AND p.ean_code IS NOT NULL
      AND p.ean_code <> ''
    ORDER BY p.artikelnr
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT ean_code FROM maatwerk_match),
    (SELECT ean_code FROM rol_match)
  );
$function$


CREATE OR REPLACE FUNCTION public.stuk_snij_marge_cm(afwerking text, vorm text, lengte_cm integer DEFAULT NULL::integer, breedte_cm integer DEFAULT NULL::integer, standaard_breedte_cm integer DEFAULT NULL::integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO' THEN 6 ELSE 0 END,
    CASE
      WHEN standaard_breedte_cm IS NOT NULL
       AND lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL
       AND LEAST(lengte_cm, breedte_cm) = standaard_breedte_cm
        THEN 0
      WHEN lower(COALESCE(vorm, '')) IN (
        'rond', 'ovaal',
        'organisch_a', 'organisch_b_sp',
        'pebble', 'ellips', 'afgeronde_hoeken'
      ) THEN 2.5
      ELSE 0
    END
  );
$function$


CREATE OR REPLACE FUNCTION public.sync_besteld_inkoop_voor_artikel(p_artikelnr text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_totaal NUMERIC;
  v_breedte_cm INTEGER;
  v_product_type TEXT;
  v_waarde INTEGER;
BEGIN
  IF p_artikelnr IS NULL THEN RETURN; END IF;

  -- Totaal openstaand, ongeacht eenheid (meters of stuks)
  SELECT COALESCE(SUM(GREATEST(r.te_leveren_m, 0)), 0)
    INTO v_totaal
  FROM inkooporder_regels r
  JOIN inkooporders o ON o.id = r.inkooporder_id
  WHERE r.artikelnr = p_artikelnr
    AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');

  SELECT p.product_type, k.standaard_breedte_cm
    INTO v_product_type, v_breedte_cm
  FROM producten p
  LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  -- Rol-producten: meters omrekenen naar m2 voor consistentie met voorraad-waarden
  -- Overige product_types (vast/staaltje/overig): aantal stuks direct gebruiken
  IF v_product_type = 'rol' AND v_breedte_cm IS NOT NULL AND v_breedte_cm > 0 THEN
    v_waarde := ROUND(v_totaal * v_breedte_cm / 100.0);
  ELSE
    v_waarde := ROUND(v_totaal);
  END IF;

  UPDATE producten
  SET besteld_inkoop = v_waarde
  WHERE artikelnr = p_artikelnr;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_order_afleverdatum_eta(p_order_id bigint, p_trigger_regel_id bigint DEFAULT NULL::bigint, p_trigger_door text DEFAULT NULL::text, p_oude_afleverdatum date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.sync_order_afleverdatum_met_claims(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_huidige DATE;
  v_oude DATE;
  v_status order_status;
  v_claim_datum DATE;
  v_standaard DATE;
  v_heeft_swap_event BOOLEAN;
  v_heeft_recent_conflict BOOLEAN;
BEGIN
  SELECT afleverdatum, status, standaard_afleverdatum_berekend
    INTO v_huidige, v_status, v_standaard
  FROM orders WHERE id = p_order_id;

  v_oude := v_huidige;

  -- Eindstatussen niet aanraken (mig 354: + 'Maatwerk afgerond', mig 327)
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending', 'Maatwerk afgerond') THEN
    RETURN;
  END IF;

  v_claim_datum := bereken_late_claim_afleverdatum(p_order_id);
  IF v_claim_datum IS NULL THEN
    RETURN;
  END IF;

  -- Bestaand gedrag: schuif alleen vooruit (later), nooit terug naar eerdere datum
  IF v_huidige IS NULL OR v_claim_datum > v_huidige THEN
    UPDATE orders
       SET afleverdatum = v_claim_datum,
           week = to_char(v_claim_datum, 'IW')
     WHERE id = p_order_id;
    v_huidige := v_claim_datum;
  END IF;

  -- Mig 298 (ADR-0027 Ingreep 5): post-swap-deadline-conflict-detectie
  IF v_standaard IS NOT NULL
     AND v_huidige IS NOT NULL
     AND v_huidige > v_standaard THEN

    SELECT EXISTS (
      SELECT 1 FROM order_events
       WHERE order_id = p_order_id
         AND event_type = 'claim_geswapt_weg'
    ) INTO v_heeft_swap_event;

    IF v_heeft_swap_event THEN
      -- Dedup-guard: 24u-venster. Voorkomt event-spam bij meerdere allocator-
      -- herwaarderingen binnen dezelfde werkstroom.
      SELECT EXISTS (
        SELECT 1 FROM order_events
         WHERE order_id = p_order_id
           AND event_type = 'deadline_conflict_na_swap'
           AND created_at > (now() - INTERVAL '24 hours')
      ) INTO v_heeft_recent_conflict;

      IF NOT v_heeft_recent_conflict THEN
        INSERT INTO order_events (order_id, event_type, status_na, metadata)
        VALUES (
          p_order_id,
          'deadline_conflict_na_swap',
          v_status,  -- geen status-overgang, kopieer huidige
          jsonb_build_object(
            'oude_afleverdatum', v_oude,
            'nieuwe_afleverdatum', v_huidige,
            'standaard', v_standaard,
            'adr', '0027',
            'migratie', 298
          )
        );
      END IF;
    END IF;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_order_heeft_unmatched_regels()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id BIGINT;
  v_heeft BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_regels WHERE order_id = v_order_id AND artikelnr IS NULL
  ) INTO v_heeft;

  UPDATE orders
     SET heeft_unmatched_regels = v_heeft
   WHERE id = v_order_id
     AND heeft_unmatched_regels IS DISTINCT FROM v_heeft;

  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_vrije_voorraad()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.vrije_voorraad := COALESCE(NEW.voorraad, 0) - COALESCE(NEW.gereserveerd, 0) - COALESCE(NEW.backorder, 0);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_zending_colli_aggregaten()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_zending_id BIGINT;
BEGIN
  v_zending_id := COALESCE(NEW.zending_id, OLD.zending_id);
  UPDATE zendingen z
  SET aantal_colli = (
        SELECT COUNT(*)
        FROM zending_colli c
        WHERE c.zending_id = v_zending_id
          AND c.bundel_colli_id IS NULL
      ),
      totaal_gewicht_kg = (
        SELECT COALESCE(SUM(c.gewicht_kg), 0)
        FROM zending_colli c
        WHERE c.zending_id = v_zending_id
          AND c.bundel_colli_id IS NULL
      )
  WHERE z.id = v_zending_id;
  RETURN NULL; -- AFTER-trigger: returnwaarde wordt genegeerd
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_debiteuren_combi_levering_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF NEW.combi_levering IS DISTINCT FROM OLD.combi_levering THEN
    FOR v_order_id IN
      SELECT id FROM orders
       WHERE debiteur_nr = NEW.debiteur_nr
         AND status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
    LOOP
      PERFORM herwaardeer_combi_levering_verzendregel(v_order_id);
      PERFORM herbereken_wacht_status(v_order_id, FALSE);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_default_fysiek_artikelnr()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.fysiek_artikelnr IS NULL THEN
    SELECT artikelnr INTO NEW.fysiek_artikelnr
    FROM order_regels WHERE id = NEW.order_regel_id;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_fn_regel_vroegst_leverbaar()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_regel_id BIGINT;
BEGIN
  v_regel_id := COALESCE(NEW.order_regel_id, OLD.order_regel_id);
  IF v_regel_id IS NOT NULL THEN
    UPDATE order_regels
       SET vroegst_leverbaar = bereken_vroegst_leverbaar(v_regel_id)
     WHERE id = v_regel_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_fn_snijplan_herbereken_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id         BIGINT;
  v_alleen_productie BOOLEAN;
BEGIN
  SELECT orr.order_id, COALESCE(o.alleen_productie, false)
    INTO v_order_id, v_alleen_productie
    FROM order_regels orr
    JOIN orders o ON o.id = orr.order_id
   WHERE orr.id = NEW.order_regel_id;

  -- Geen order of productie-only → niet aanraken (zie header).
  IF v_order_id IS NULL OR v_alleen_productie THEN
    RETURN NEW;
  END IF;

  -- Order-fase = afleiding van productie- én claim-state. herbereken_wacht_status
  -- (SECURITY DEFINER) no-toucht eindstatussen/pickronde-fases en schrijft via
  -- _apply_transitie. Geen recursie: het raakt orders/order_events, nooit
  -- snijplannen.
  PERFORM herbereken_wacht_status(v_order_id);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_inkooporder_status_release()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.status = 'Geannuleerd' AND OLD.status <> 'Geannuleerd' THEN
    FOR v_regel_id IN
      SELECT id FROM inkooporder_regels WHERE inkooporder_id = NEW.id
    LOOP
      PERFORM release_claims_voor_io_regel(v_regel_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_io_regel_insert_swap_evaluate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.eenheid IS DISTINCT FROM 'stuks' THEN
    RETURN NEW;
  END IF;

  -- A5 fix (ADR-0027 V1 = expliciet GEEN cascade):
  --   Heralloceer alleen orderregels met daadwerkelijk dekking-tekort. Beperk
  --   tot status 'Wacht op inkoop' (mig 470: geen IO-claim, wel voorraad-
  --   tekort). Orders in 'Wacht op voorraad' hebben al een IO-claim —
  --   herevaluatie daar zou een keten van re-allocaties triggeren die
  --   feitelijk cascade-swap creëert, wat in V1 expliciet uitgesloten is.
  --   Verder: alleen regels met effectief tekort (te_leveren > SUM(actieve
  --   claims)) — anders is herallocatie idempotent maar zinloos extra werk.
  FOR v_regel_id IN
    SELECT oreg.id
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
     WHERE oreg.artikelnr = NEW.artikelnr
       AND COALESCE(oreg.is_maatwerk, false) = false
       AND COALESCE(oreg.te_leveren, 0) > 0
       AND o.status = 'Wacht op inkoop'
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
$function$


CREATE OR REPLACE FUNCTION public.trg_kwaliteit_gewicht_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE producten p
  SET
    gewicht_kg = CASE
      WHEN p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL THEN
        CASE p.vorm
          WHEN 'rond' THEN ROUND(PI()::NUMERIC * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * NEW.gewicht_per_m2_kg, 2)
          ELSE          ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * NEW.gewicht_per_m2_kg, 2)
        END
      ELSE p.gewicht_kg
    END,
    gewicht_uit_kwaliteit = (
      p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL
    )
  WHERE p.kwaliteit_code = NEW.code
    AND p.product_type IN ('vast', 'staaltje');

  UPDATE order_regels ore
  SET gewicht_kg = CASE
    WHEN NEW.gewicht_per_m2_kg IS NOT NULL AND ore.maatwerk_oppervlak_m2 IS NOT NULL
      THEN ROUND(ore.maatwerk_oppervlak_m2 * NEW.gewicht_per_m2_kg, 2)
    ELSE NULL
  END
  FROM orders o
  WHERE ore.order_id = o.id
    AND ore.maatwerk_kwaliteit_code = NEW.code
    AND ore.is_maatwerk = true
    AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_levertijd_status_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Geen snapshot of geen afleverdatum: label is onbepaald
  IF NEW.afleverdatum IS NULL OR NEW.standaard_afleverdatum_berekend IS NULL THEN
    NEW.levertijd_status := NULL;
    RETURN NEW;
  END IF;

  IF NEW.afleverdatum < NEW.standaard_afleverdatum_berekend THEN
    NEW.levertijd_status := 'eerder_dan_standaard';
  ELSIF NEW.afleverdatum > NEW.standaard_afleverdatum_berekend THEN
    NEW.levertijd_status := 'later_dan_standaard';
  ELSE
    NEW.levertijd_status := 'standaard';
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_lock_zending_bundel_sleutel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN IF NEW.afhalen = TRUE THEN RETURN NEW; END IF; IF EXISTS (SELECT 1 FROM zending_orders zo JOIN zendingen z ON z.id = zo.zending_id WHERE zo.order_id = NEW.id AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')) OR EXISTS (SELECT 1 FROM zendingen z WHERE z.order_id = NEW.id AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')) THEN RAISE EXCEPTION 'Order % is gelocked: actieve bundel-zending bestaat al — wijziging van afleverdatum/afleveradres/debiteur niet toegestaan', NEW.id USING ERRCODE = 'restrict_violation'; END IF; RETURN NEW; END $function$


CREATE OR REPLACE FUNCTION public.trg_order_events_reservering_release()
 RETURNS trigger
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
$function$


CREATE OR REPLACE FUNCTION public.trg_order_events_snijplan_release()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_affected_rollen   BIGINT[] := ARRAY[]::BIGINT[];
  v_groepen_json      JSONB    := '[]'::jsonb;
  v_groep             RECORD;
  v_cfg               JSONB;
  v_url               TEXT;
  v_auth              TEXT;
BEGIN
  -- Defensief, ook al filtert de trigger-WHEN al.
  IF NEW.event_type <> 'geannuleerd' THEN
    RETURN NEW;
  END IF;

  -- Alle nog-levende snijplannen van de order → Geannuleerd. ONGEACHT
  -- voortgang (Wacht/Gepland/Snijden/Gesneden/…): een geannuleerde order is
  -- dood. rol_id/verwacht_inkooporder_regel_id blijven behouden als
  -- audit-spoor; de status-filter sluit ze overal correct uit.
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = NEW.order_id
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.rol_id, sp.verwacht_inkooporder_regel_id,
              oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code
  )
  SELECT
    COALESCE(ARRAY_AGG(DISTINCT rol_id) FILTER (WHERE rol_id IS NOT NULL),
             ARRAY[]::BIGINT[]),
    COALESCE(
      jsonb_agg(DISTINCT jsonb_build_object(
        'kwaliteit_code', maatwerk_kwaliteit_code,
        'kleur_code',     maatwerk_kleur_code
      )) FILTER (
        WHERE verwacht_inkooporder_regel_id IS NOT NULL
          AND maatwerk_kwaliteit_code IS NOT NULL
          AND maatwerk_kleur_code     IS NOT NULL
      ),
      '[]'::jsonb
    )
    INTO v_affected_rollen, v_groepen_json
    FROM cancelled;

  -- Geraakte rollen die hun laatste actieve snijplan verloren → terug naar
  -- reststuk (afgeleide rol) of beschikbaar, met schone lei. De NOT EXISTS-
  -- guard beschermt rollen die nog een ander (niet-geannuleerd) order
  -- bedienen — patroon uit release_gepland_stukken (mig 133).
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END,
           snijden_gestart_op = NULL
     WHERE ro.id = ANY(v_affected_rollen)
       AND ro.status = 'in_snijplan'
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn
          WHERE sn.rol_id = ro.id
            AND sn.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  -- Mig 442: geannuleerde stukken die op een "Wacht op inkoop"-claim stonden
  -- → her-trigger auto-plan-groep voor hun (kwaliteit, kleur), zodat de claim
  -- + snijplan_gebruikte_lengte_cm-snapshot vanaf nul herberekend wordt.
  IF jsonb_array_length(v_groepen_json) > 0 THEN
    SELECT waarde INTO v_cfg FROM app_config WHERE sleutel = 'snijplanning.auto_planning';
    IF v_cfg IS NOT NULL AND COALESCE((v_cfg->>'enabled')::boolean, false) THEN
      v_url  := v_cfg->>'edge_url';
      v_auth := v_cfg->>'auth_header';
      IF v_url IS NOT NULL AND v_auth IS NOT NULL THEN
        FOR v_groep IN
          SELECT * FROM jsonb_to_recordset(v_groepen_json) AS x(kwaliteit_code TEXT, kleur_code TEXT)
        LOOP
          BEGIN
            PERFORM net.http_post(
              url     := v_url,
              headers := jsonb_build_object(
                           'Content-Type',  'application/json',
                           'Authorization', v_auth
                         ),
              body    := jsonb_build_object(
                           'kwaliteit_code', v_groep.kwaliteit_code,
                           'kleur_code',     v_groep.kleur_code
                         )
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Auto-plan trigger (order-annulering, wacht-op-inkoop) faalde voor %/%: %',
              v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
          END;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_order_events_zending_release()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_zending_id BIGINT;
  v_regel_ids  BIGINT[];
BEGIN
  IF NEW.event_type <> 'geannuleerd' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(id) INTO v_regel_ids
    FROM order_regels WHERE order_id = NEW.order_id;

  IF v_regel_ids IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_zending_id IN
    SELECT DISTINCT z.id
      FROM zendingen z
      JOIN zending_orders zo ON zo.zending_id = z.id
     WHERE zo.order_id = NEW.order_id
       AND z.status IN ('Gepland', 'Picken')
  LOOP
    DELETE FROM zending_colli
     WHERE zending_id = v_zending_id
       AND order_regel_id = ANY(v_regel_ids);

    DELETE FROM zending_regels
     WHERE zending_id = v_zending_id
       AND order_regel_id = ANY(v_regel_ids);

    DELETE FROM zending_orders
     WHERE zending_id = v_zending_id
       AND order_id = NEW.order_id;

    IF NOT EXISTS (SELECT 1 FROM zending_orders WHERE zending_id = v_zending_id) THEN
      -- Geannuleerde order was de enige op deze zending — de hele zending vervalt.
      DELETE FROM zendingen WHERE id = v_zending_id;
    ELSE
      -- Bundel: andere order(s) blijven op deze zending staan. Herberekenen
      -- wat overblijft (zelfde stijl als start_pickronden's eigen INSERT).
      UPDATE zendingen z
         SET aantal_colli = (
               SELECT COUNT(*)::INTEGER FROM zending_colli WHERE zending_id = z.id
             ),
             totaal_gewicht_kg = (
               SELECT NULLIF(ROUND(COALESCE(SUM(gewicht_kg), 0), 2), 0)
                 FROM zending_colli WHERE zending_id = z.id
             )
       WHERE z.id = v_zending_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_orderregel_herallocateer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Alle claims worden vanzelf cascade-deleted door FK ON DELETE CASCADE.
    -- Producten.gereserveerd resync gebeurt via trigger C.
    RETURN OLD;
  END IF;

  -- Mig 273 (ADR-0018, was hardcoded IN-lijst in mig 266): admin-pseudo-
  -- producten kennen geen voorraad/IO-allocatie. Skip om N²-recursie via
  -- herallocateer_orderregel → herwaardeer_order_status → herwaardeer_claims_voor_order
  -- → herallocateer_orderregel te voorkomen.
  IF is_admin_pseudo(NEW.artikelnr) THEN
    RETURN NEW;
  END IF;

  -- Trigger op zowel artikelnr- als te_leveren-wijziging
  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_orders_combi_levering_override_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.combi_levering_override IS DISTINCT FROM OLD.combi_levering_override THEN
    PERFORM herwaardeer_combi_levering_verzendregel(NEW.id);
    PERFORM herbereken_wacht_status(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_product_gewicht_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE order_regels ore
  SET gewicht_kg = NEW.gewicht_kg
  FROM orders o
  WHERE ore.order_id = o.id
    AND ore.artikelnr = NEW.artikelnr
    AND ore.is_maatwerk = false
    AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_reservering_sync_producten()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikel_new TEXT;
  v_artikel_old TEXT;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- NEW.fysiek_artikelnr is gevuld door BEFORE-trigger trg_default_fysiek_artikelnr
    v_artikel_new := NEW.fysiek_artikelnr;
    IF v_artikel_new IS NOT NULL THEN
      PERFORM herbereken_product_reservering(v_artikel_new);
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_artikel_old := OLD.fysiek_artikelnr;
    IF v_artikel_old IS NOT NULL AND v_artikel_old IS DISTINCT FROM v_artikel_new THEN
      PERFORM herbereken_product_reservering(v_artikel_old);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_rollen_default_in_magazijn_sinds()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_created TEXT;
BEGIN
  IF NEW.in_magazijn_sinds IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_created := to_jsonb(NEW) ->> 'created_at';

  NEW.in_magazijn_sinds := COALESCE(
    NULLIF(v_created, '')::timestamptz::date,
    NEW.reststuk_datum::date,
    CURRENT_DATE
  );
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_set_rol_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.rol_type := bereken_rol_type(NEW.artikelnr, NEW.breedte_cm, NEW.lengte_cm, NEW.oorsprong_rol_id);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_snijplan_rol_toegewezen_auto_verzendweek()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_weken_voorraad INTEGER;
  v_weken_io       INTEGER;
  v_max_io_datum   DATE;
  v_kandidaat      DATE;
BEGIN
  -- Niets relevant gezet (noch rol, noch IO-koppeling) -> niets te doen.
  IF NEW.rol_id IS NULL AND NEW.verwacht_inkooporder_regel_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bij UPDATE alleen reageren als een van de twee dekkingsvelden echt wijzigde.
  IF TG_OP = 'UPDATE'
     AND OLD.rol_id IS NOT DISTINCT FROM NEW.rol_id
     AND OLD.verwacht_inkooporder_regel_id IS NOT DISTINCT FROM NEW.verwacht_inkooporder_regel_id
  THEN
    RETURN NEW;
  END IF;

  -- "Volledig gedekt": geen niet-geannuleerd sibling-stuk zonder rol ÉN zonder IO-koppeling.
  IF EXISTS (
    SELECT 1 FROM snijplannen sp2
    WHERE sp2.order_regel_id = NEW.order_regel_id
      AND sp2.status <> 'Geannuleerd'
      AND sp2.rol_id IS NULL
      AND sp2.verwacht_inkooporder_regel_id IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((waarde->>'maatwerk_voorraad_levertijd_weken')::INTEGER, 7)
    INTO v_weken_voorraad
  FROM app_config WHERE sleutel = 'productie_planning';

  SELECT COALESCE((waarde->>'inkoop_buffer_weken_maatwerk')::INTEGER, 2)
    INTO v_weken_io
  FROM app_config WHERE sleutel = 'order_config';

  -- Kritiekste (laatste) IO-ETA onder de siblings die via inkoop gedekt zijn.
  SELECT MAX(ior.verwacht_datum)
    INTO v_max_io_datum
  FROM snijplannen sp3
  JOIN inkooporder_regels ior ON ior.id = sp3.verwacht_inkooporder_regel_id
  WHERE sp3.order_regel_id = NEW.order_regel_id
    AND sp3.status <> 'Geannuleerd';

  v_kandidaat := (CURRENT_DATE + (v_weken_voorraad || ' weeks')::INTERVAL)::DATE;
  IF v_max_io_datum IS NOT NULL THEN
    v_kandidaat := GREATEST(v_kandidaat, (v_max_io_datum + (v_weken_io || ' weeks')::INTERVAL)::DATE);
  END IF;

  UPDATE order_regels
  SET verzendweek = verzendweek_voor_datum(v_kandidaat),
      verzendweek_bron = 'automatisch_voorraad'
  WHERE id = NEW.order_regel_id
    AND is_maatwerk = TRUE
    AND verzendweek IS NULL;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_sync_besteld_inkoop()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_besteld_inkoop_voor_artikel(OLD.artikelnr);
    RETURN OLD;
  END IF;
  PERFORM sync_besteld_inkoop_voor_artikel(NEW.artikelnr);
  IF TG_OP = 'UPDATE' AND OLD.artikelnr IS DISTINCT FROM NEW.artikelnr THEN
    PERFORM sync_besteld_inkoop_voor_artikel(OLD.artikelnr);
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_sync_doos_vrije_voorraad()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE producten
  SET
    voorraad        = FLOOR(COALESCE(NEW.voorraad, 0)::NUMERIC / stuks_per_doos)::INTEGER,
    vrije_voorraad  = FLOOR(COALESCE(NEW.vrije_voorraad, 0)::NUMERIC / stuks_per_doos)::INTEGER,
    gereserveerd    = 0,
    backorder       = 0
  WHERE stuks_artikelnr = NEW.artikelnr;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_zending_set_m2m()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    INSERT INTO zending_orders (zending_id, order_id)
    VALUES (NEW.id, NEW.order_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $function$


CREATE OR REPLACE FUNCTION public.trg_zending_set_verzendweek()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_week TEXT;
BEGIN
  -- Alleen vullen als nog niet handmatig gezet (start_pickronden_bundel zet hem
  -- al expliciet uit v_jaar_week — dan is NEW.verzendweek niet NULL).
  IF NEW.verzendweek IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Probeer eerste order via M2M; valt terug op zendingen.order_id voor
  -- legacy-paden (zending_orders is pas in mig 222 gekomen).
  SELECT verzendweek_voor_datum(o.afleverdatum)
    INTO v_week
    FROM zending_orders zo
    JOIN orders o ON o.id = zo.order_id
   WHERE zo.zending_id = NEW.id
     AND o.afleverdatum IS NOT NULL
   ORDER BY zo.order_id
   LIMIT 1;

  IF v_week IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT verzendweek_voor_datum(o.afleverdatum)
      INTO v_week
      FROM orders o
     WHERE o.id = NEW.order_id
       AND o.afleverdatum IS NOT NULL;
  END IF;

  NEW.verzendweek := v_week;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_inkoop_regel_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_io_regels nir
      JOIN producten p ON p.artikelnr = nir.artikelnr
     WHERE nir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger (inkoop-regel update) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_inkoop_status_wijziging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_inkooporders nio
      JOIN oude_inkooporders   oio ON oio.id = nio.id
      JOIN inkooporder_regels  ir  ON ir.inkooporder_id = nio.id
      JOIN producten           p   ON p.artikelnr       = ir.artikelnr
     WHERE nio.status IS DISTINCT FROM oio.status
       AND ir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger (inkoop-status) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_nieuwe_inkoop_regels()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RAISE WARNING 'Auto-plan trigger (nieuwe inkoop-regel): edge_url/auth_header ontbreken in app_config.snijplanning.auto_planning — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_io_regels nir
      JOIN producten p ON p.artikelnr = nir.artikelnr
     WHERE nir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger (nieuwe inkoop-regel) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_nieuwe_rollen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RAISE WARNING 'Auto-plan trigger: edge_url/auth_header ontbreken in app_config.snijplanning.auto_planning — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT kwaliteit_code, kleur_code
      FROM nieuwe_rollen
     WHERE status IN ('beschikbaar', 'reststuk')
       AND kwaliteit_code IS NOT NULL
       AND kleur_code    IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_nieuwe_snijplannen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RAISE WARNING 'Auto-plan trigger (snijplannen): edge_url/auth_header ontbreken — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT orr.maatwerk_kwaliteit_code AS kwaliteit_code,
                    orr.maatwerk_kleur_code     AS kleur_code
      FROM nieuwe_snijplannen ns
      JOIN order_regels orr ON orr.id = ns.order_regel_id
     WHERE ns.rol_id IS NULL
       AND orr.maatwerk_kwaliteit_code IS NOT NULL
       AND orr.maatwerk_kleur_code     IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger (snijplannen) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.trigger_auto_plan_voor_rol_status_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT nr.kwaliteit_code, nr.kleur_code
      FROM nieuwe_rollen  nr
      JOIN oude_rollen    oldr ON oldr.id = nr.id
     WHERE nr.status   IN ('beschikbaar', 'reststuk')
       AND oldr.status NOT IN ('beschikbaar', 'reststuk')
       AND nr.kwaliteit_code IS NOT NULL
       AND nr.kleur_code     IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger (rol status) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.uitwisselbare_kwaliteiten(p_code text)
 RETURNS TABLE(code text, omschrijving text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT k.code, k.omschrijving
    FROM kwaliteiten k
    WHERE k.collectie_id = (
        SELECT k2.collectie_id FROM kwaliteiten k2 WHERE k2.code = p_code
    )
    AND k.collectie_id IS NOT NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.uitwisselbare_paren(p_kwaliteit_code text, p_kleur_code text)
 RETURNS TABLE(target_kwaliteit_code text, target_kleur_code text, is_zelf boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH coll AS (
    SELECT collectie_id
    FROM kwaliteiten
    WHERE code = p_kwaliteit_code
      AND collectie_id IS NOT NULL
  )
  -- Alle kwaliteiten in dezelfde collectie als input → kandidaat-aliassen.
  -- De target-kleur is per definitie de genormaliseerde input-kleur (de
  -- aliassing-regel werkt op identieke kleur-nummers, niet op cross-color).
  SELECT
    k.code                                AS target_kwaliteit_code,
    normaliseer_kleur_code(p_kleur_code)  AS target_kleur_code,
    (k.code = p_kwaliteit_code)           AS is_zelf
  FROM coll c
  JOIN kwaliteiten k ON k.collectie_id = c.collectie_id

  UNION

  -- Self-row als vangnet: input verschijnt altijd minstens één keer, ook
  -- wanneer de kwaliteit geen collectie_id heeft. Callers die "alleen
  -- partners" willen filteren op `WHERE NOT is_zelf`.
  SELECT
    p_kwaliteit_code,
    normaliseer_kleur_code(p_kleur_code),
    true;
$function$


CREATE OR REPLACE FUNCTION public.uitwisselbare_partners()
 RETURNS TABLE(kwaliteit_code text, kleur_code text, partner_kwaliteit_code text, partner_kleur_code text, partner_rollen integer, partner_m2 numeric)
 LANGUAGE sql
 STABLE
AS $function$
SELECT
  u1.kwaliteit_code                                                           AS kwaliteit_code,
  u1.kleur_code                                                               AS kleur_code,
  u2.kwaliteit_code                                                           AS partner_kwaliteit_code,
  u2.kleur_code                                                               AS partner_kleur_code,
  COALESCE(COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0), 0)::INTEGER         AS partner_rollen,
  COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS partner_m2
FROM kwaliteit_kleur_uitwisselgroepen u1
JOIN kwaliteit_kleur_uitwisselgroepen u2
  ON u2.basis_code = u1.basis_code
 AND u2.variant_nr = u1.variant_nr
 AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
LEFT JOIN rollen r
  ON r.kwaliteit_code = u2.kwaliteit_code
 AND r.kleur_code = u2.kleur_code
 AND r.status NOT IN ('verkocht', 'gesneden')
GROUP BY u1.kwaliteit_code, u1.kleur_code, u2.kwaliteit_code, u2.kleur_code
ORDER BY u1.kwaliteit_code, u1.kleur_code, partner_m2 DESC, u2.kwaliteit_code;
$function$


CREATE OR REPLACE FUNCTION public.update_order_totalen()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_order_id BIGINT := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
    UPDATE orders SET
        aantal_regels = (
            SELECT COUNT(*) FROM order_regels WHERE order_id = v_order_id
        ),
        totaal_bedrag = (
            SELECT COALESCE(SUM(bedrag), 0) FROM order_regels WHERE order_id = v_order_id
        ),
        totaal_gewicht = (
            SELECT COALESCE(SUM(gewicht_kg * orderaantal), 0)
            FROM order_regels WHERE order_id = v_order_id
        )
    WHERE id = v_order_id;

    RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.update_order_with_lines(p_order_id bigint, p_header jsonb, p_regels jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_blokkerende_status TEXT;
    v_te_verwijderen_ids BIGINT[];
    v_snijplan_ids       BIGINT[];
    v_oud_debiteur_nr    INTEGER;
    v_oud_adres_norm     TEXT;
BEGIN
    -- Mig 566: snapshot vóór de header-UPDATE hieronder afl_*/debiteur_nr
    -- overschrijft — nodig om na afloop te detecteren of de order naar een
    -- andere Combi-levering-groep is verhuisd.
    SELECT o.debiteur_nr,
           _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
      INTO v_oud_debiteur_nr, v_oud_adres_norm
      FROM orders o WHERE o.id = p_order_id;

    -- ── Header ──────────────────────────────────────────────────────────────
    UPDATE orders SET
        klant_referentie = p_header->>'klant_referentie',
        afleverdatum = (p_header->>'afleverdatum')::DATE,
        week = p_header->>'week',
        vertegenw_code = p_header->>'vertegenw_code',
        betaler = (p_header->>'betaler')::INTEGER,
        inkooporganisatie = p_header->>'inkooporganisatie',
        fact_naam = p_header->>'fact_naam', fact_adres = p_header->>'fact_adres',
        fact_postcode = p_header->>'fact_postcode', fact_plaats = p_header->>'fact_plaats',
        fact_land = p_header->>'fact_land',
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land',
        lever_modus = CASE
          WHEN p_header ? 'lever_modus'
            THEN NULLIF(p_header->>'lever_modus', '')
          ELSE lever_modus
        END,
        combi_levering_override = CASE
          WHEN p_header ? 'combi_levering_override'
            THEN COALESCE((p_header->>'combi_levering_override')::BOOLEAN, false)
          ELSE combi_levering_override
        END
    WHERE id = p_order_id;

    -- ── Bepaal welke orderregels verdwijnen ──────────────────────────────────
    SELECT ARRAY(
        SELECT id FROM order_regels
        WHERE order_id = p_order_id
          AND id NOT IN (
              SELECT (r->>'id')::BIGINT
              FROM jsonb_array_elements(p_regels) r
              WHERE (r->>'id') IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM order_regels oreg2
                    WHERE oreg2.id = (r->>'id')::BIGINT
                      AND oreg2.order_id = p_order_id
                )
          )
    ) INTO v_te_verwijderen_ids;

    IF array_length(v_te_verwijderen_ids, 1) > 0 THEN

        -- ── Guard: blokkeer als snijplan al in uitvoering ──────────────────
        SELECT sp.status INTO v_blokkerende_status
        FROM snijplannen sp
        WHERE sp.order_regel_id = ANY(v_te_verwijderen_ids)
          AND sp.status NOT IN ('Wacht', 'Gepland', 'Geannuleerd')
        LIMIT 1;

        IF v_blokkerende_status IS NOT NULL THEN
            RAISE EXCEPTION
              'Orderregel heeft een snijplan in uitvoering (status: %). Annuleer het snijplan eerst.',
              v_blokkerende_status
              USING ERRCODE = 'foreign_key_violation';
        END IF;

        -- ── Verzamel te-verwijderen snijplan IDs (vroege status) ───────────
        SELECT ARRAY(
            SELECT id FROM snijplannen
            WHERE order_regel_id = ANY(v_te_verwijderen_ids)
              AND status IN ('Wacht', 'Gepland', 'Geannuleerd')
        ) INTO v_snijplan_ids;

        IF array_length(v_snijplan_ids, 1) > 0 THEN
            -- Eerst de tabellen die naar snijplannen verwijzen opruimen
            DELETE FROM snijvoorstel_plaatsingen
            WHERE snijplan_id = ANY(v_snijplan_ids);

            DELETE FROM confectie_orders
            WHERE snijplan_id = ANY(v_snijplan_ids);

            -- Dan de snijplannen zelf
            DELETE FROM snijplannen
            WHERE id = ANY(v_snijplan_ids);
        END IF;

    END IF;

    -- ── 1. DELETE orderregels die niet meer in p_regels staan ───────────────
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id = ANY(v_te_verwijderen_ids);

    -- ── 2. UPDATE bestaande regels in-place ─────────────────────────────────
    UPDATE order_regels SET
        regelnummer           = (r->>'regelnummer')::INTEGER,
        artikelnr             = r->>'artikelnr',
        karpi_code            = r->>'karpi_code',
        omschrijving          = r->>'omschrijving',
        omschrijving_2        = r->>'omschrijving_2',
        orderaantal           = (r->>'orderaantal')::INTEGER,
        te_leveren            = (r->>'te_leveren')::INTEGER,
        prijs                 = (r->>'prijs')::NUMERIC,
        korting_pct           = COALESCE((r->>'korting_pct')::NUMERIC, 0),
        bedrag                = (r->>'bedrag')::NUMERIC,
        gewicht_kg            = (r->>'gewicht_kg')::NUMERIC,
        fysiek_artikelnr      = r->>'fysiek_artikelnr',
        omstickeren           = COALESCE((r->>'omstickeren')::BOOLEAN, false),
        is_maatwerk           = COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        maatwerk_vorm         = r->>'maatwerk_vorm',
        maatwerk_lengte_cm    = (r->>'maatwerk_lengte_cm')::INTEGER,
        maatwerk_breedte_cm   = (r->>'maatwerk_breedte_cm')::INTEGER,
        maatwerk_afwerking    = r->>'maatwerk_afwerking',
        maatwerk_band_kleur   = r->>'maatwerk_band_kleur',
        maatwerk_instructies  = r->>'maatwerk_instructies',
        maatwerk_m2_prijs     = (r->>'maatwerk_m2_prijs')::NUMERIC,
        maatwerk_kostprijs_m2 = (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        maatwerk_oppervlak_m2 = (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        maatwerk_vorm_toeslag = (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        maatwerk_afwerking_prijs = (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        maatwerk_diameter_cm  = (r->>'maatwerk_diameter_cm')::INTEGER,
        maatwerk_kwaliteit_code = r->>'maatwerk_kwaliteit_code',
        maatwerk_kleur_code   = r->>'maatwerk_kleur_code',
        klant_referentie      = NULLIF(r->>'klant_referentie', ''),
        is_vrije_regel        = COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r
    WHERE order_regels.order_id = p_order_id
      AND (r->>'id') IS NOT NULL
      AND order_regels.id = (r->>'id')::BIGINT;

    -- ── 3. INSERT nieuwe regels ──────────────────────────────────────────────
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie,
        is_vrije_regel
    )
    SELECT
        p_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', ''),
        COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r
    WHERE (r->>'id') IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM order_regels
           WHERE id = (r->>'id')::BIGINT AND order_id = p_order_id
       );

    -- Mig 566: élke edit (ook prijs-only/regel-delete) herevalueert de
    -- eigen status + de (nieuwe) groep (herbereken_wacht_status cascadet
    -- standaard, mig 559)...
    PERFORM herbereken_wacht_status(p_order_id);
    -- ...en bij een groeps-verhuizing ook de achtergelaten oude groep, die
    -- de normale cascade niet meer bereikt (de order zelf zit er niet meer in).
    IF v_oud_debiteur_nr IS DISTINCT FROM (SELECT debiteur_nr FROM orders WHERE id = p_order_id)
       OR v_oud_adres_norm IS DISTINCT FROM (
         SELECT _normaliseer_afleveradres(afl_adres, afl_postcode, afl_land)
           FROM orders WHERE id = p_order_id)
    THEN
        PERFORM herbereken_combi_groep(v_oud_debiteur_nr, v_oud_adres_norm);
    END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_regel_eta(p_regel_id bigint, p_verwacht_datum date, p_door text, p_leverancier_id bigint DEFAULT NULL::bigint, p_portal_token uuid DEFAULT NULL::uuid, p_notitie text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_leverancier_id     BIGINT;
  v_order_id           BIGINT;
  v_oude_afleverdatum  DATE;
  v_inkooporder_id     BIGINT;
  v_max_regel_datum    DATE;
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
  WHERE id = p_regel_id
  RETURNING inkooporder_id INTO v_inkooporder_id;

  -- ── NIEUW (mig 523): propageer MAX(regel.verwacht_datum) naar order-niveau ──
  -- De /inkoop-pagina toont inkooporders.verwacht_datum. Zonder deze stap is wat
  -- de leverancier via het portal invoert niet zichtbaar op het inkoopoverzicht.
  -- MAX over ALLE regels van de IO (niet alleen open) zodat een volledige IO die
  -- al gedeeltelijk ontvangen is de juiste einddatum toont.
  SELECT MAX(verwacht_datum)
    INTO v_max_regel_datum
    FROM inkooporder_regels
   WHERE inkooporder_id = v_inkooporder_id
     AND verwacht_datum IS NOT NULL;

  IF v_max_regel_datum IS NOT NULL THEN
    UPDATE inkooporders
       SET verwacht_datum = v_max_regel_datum,
           -- leverweek afleiden als "W/YYYY" (ISO, geen leading zero) zodat de
           -- display consistent blijft met de import-notatie ("30/2026" etc.)
           leverweek = to_char(v_max_regel_datum, 'IW')::int::text
                       || '/' || to_char(v_max_regel_datum, 'IYYY')
     WHERE id = v_inkooporder_id;
  END IF;
  -- ── einde nieuw blok ────────────────────────────────────────────────────────

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
$function$


CREATE OR REPLACE FUNCTION public.update_reservering_bij_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_artikelnr TEXT;
    v_fysiek    TEXT;
BEGIN
  FOR v_artikelnr, v_fysiek IN
    SELECT DISTINCT artikelnr, fysiek_artikelnr
    FROM order_regels
    WHERE order_id = NEW.id
      AND artikelnr IS NOT NULL
  LOOP
    PERFORM herbereken_product_reservering(COALESCE(v_fysiek, v_artikelnr));
    IF v_fysiek IS NOT NULL AND v_fysiek IS DISTINCT FROM v_artikelnr THEN
      PERFORM herbereken_product_reservering(v_artikelnr);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_reservering_bij_orderregel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.artikelnr IS NOT NULL THEN
    PERFORM herbereken_product_reservering(COALESCE(OLD.fysiek_artikelnr, OLD.artikelnr));
    IF OLD.fysiek_artikelnr IS NOT NULL AND OLD.fysiek_artikelnr IS DISTINCT FROM OLD.artikelnr THEN
      PERFORM herbereken_product_reservering(OLD.artikelnr);
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.artikelnr IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR OLD.artikelnr IS DISTINCT FROM NEW.artikelnr
       OR OLD.fysiek_artikelnr IS DISTINCT FROM NEW.fysiek_artikelnr
       OR OLD.te_leveren IS DISTINCT FROM NEW.te_leveren THEN
      PERFORM herbereken_product_reservering(COALESCE(NEW.fysiek_artikelnr, NEW.artikelnr));
      IF NEW.fysiek_artikelnr IS NOT NULL AND NEW.fysiek_artikelnr IS DISTINCT FROM NEW.artikelnr THEN
        PERFORM herbereken_product_reservering(NEW.artikelnr);
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.upsert_klanteigen_naam(p_debiteur_nr integer, p_inkoopgroep_code text, p_kwaliteit_code text, p_kleur_code text, p_benaming text, p_omschrijving text DEFAULT NULL::text, p_leverancier text DEFAULT NULL::text, p_bron text DEFAULT 'ui'::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  IF (p_debiteur_nr IS NULL) = (p_inkoopgroep_code IS NULL) THEN
    RAISE EXCEPTION 'precies één van debiteur_nr / inkoopgroep_code moet gevuld zijn';
  END IF;

  IF p_debiteur_nr IS NOT NULL THEN
    SELECT id INTO v_id
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NOT DISTINCT FROM p_kleur_code;
  ELSE
    SELECT id INTO v_id
    FROM klanteigen_namen
    WHERE inkoopgroep_code = p_inkoopgroep_code
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NOT DISTINCT FROM p_kleur_code;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO klanteigen_namen (
      debiteur_nr, inkoopgroep_code, kwaliteit_code, kleur_code,
      benaming, omschrijving, leverancier, bron
    ) VALUES (
      p_debiteur_nr, p_inkoopgroep_code, p_kwaliteit_code, p_kleur_code,
      p_benaming, p_omschrijving, p_leverancier, p_bron
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE klanteigen_namen
       SET benaming     = p_benaming,
           omschrijving = COALESCE(p_omschrijving, omschrijving),
           leverancier  = COALESCE(p_leverancier, leverancier),
           bron         = COALESCE(p_bron, bron)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $function$


CREATE OR REPLACE FUNCTION public.verwerk_concept_queue(p_max_batch integer DEFAULT 10)
 RETURNS TABLE(queue_id bigint, factuur_id bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r     RECORD;
  v_fid BIGINT;
BEGIN
  FOR r IN
    SELECT q.id, q.zending_id
      FROM factuur_queue q
     WHERE q.status = 'pending'
       AND q.factuur_id IS NULL
       AND q.zending_id IS NOT NULL
     ORDER BY q.created_at ASC
     LIMIT p_max_batch
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_fid := projecteer_concept_factuur(r.zending_id, NULL);
      UPDATE factuur_queue SET factuur_id = v_fid WHERE id = r.id;
      queue_id := r.id; factuur_id := v_fid;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Eén kapotte rij mag de batch niet laten falen; laat 'm pending (zonder
      -- concept) en log via last_error. Fase 2 raakt 'm niet zonder factuur_id.
      UPDATE factuur_queue
         SET last_error = 'concept-projectie: ' || SQLERRM
       WHERE id = r.id;
    END;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.verwerp_snijvoorstel(p_voorstel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM snijvoorstellen
  WHERE id = p_voorstel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijvoorstel % niet gevonden', p_voorstel_id;
  END IF;

  IF v_status <> 'concept' THEN
    RAISE EXCEPTION 'Alleen concept-voorstellen kunnen verworpen worden (huidige status: %)', v_status;
  END IF;

  UPDATE snijvoorstellen
  SET status = 'verworpen'
  WHERE id = p_voorstel_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.verwijder_bug_melding(p_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      bug_meldingen;
  v_is_admin BOOLEAN := is_bug_beheerder();
  v_uid      UUID    := auth.uid();
BEGIN
  SELECT * INTO v_row FROM bug_meldingen WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bug-melding % bestaat niet', p_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Alleen de melder zelf of de beheerder mag verwijderen.
  IF v_row.gemeld_door IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Alleen de melder of de beheerder kan een melding verwijderen';
  END IF;

  DELETE FROM bug_meldingen WHERE id = p_id;

  RETURN v_row.bijlage_path;
END; $function$


CREATE OR REPLACE FUNCTION public.verwijder_colli_bundel(p_bundel_colli_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_zending_id BIGINT;
  v_is_bundel  BOOLEAN;
  v_status     TEXT;
BEGIN
  SELECT zending_id, is_bundel INTO v_zending_id, v_is_bundel
    FROM zending_colli WHERE id = p_bundel_colli_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colli % bestaat niet', p_bundel_colli_id; END IF;
  IF NOT COALESCE(v_is_bundel, FALSE) THEN
    RAISE EXCEPTION 'Colli % is geen bundel — ontbundelen kan niet', p_bundel_colli_id;
  END IF;

  SELECT status INTO v_status FROM zendingen WHERE id = v_zending_id;
  -- Mig 421: ontbundelen mag tijdens de pickronde ('Picken') én erna ('Klaar voor verzending').
  IF v_status NOT IN ('Picken', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Ontbundelen kan alleen tijdens of net na de pickronde (zending % staat op %)',
      v_zending_id, v_status;
  END IF;

  DELETE FROM zending_colli WHERE id = p_bundel_colli_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.verwijder_portal_toegang(p_leverancier_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE leveranciers
  SET portal_email = NULL, portal_wachtwoord_hash = NULL
  WHERE id = p_leverancier_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.verzendkosten_voor_bundel(p_debiteur_nr integer, p_bundel_subtotaal numeric, p_is_afhalen boolean)
 RETURNS TABLE(te_betalen numeric, status text, reden text)
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
  v_d debiteuren%ROWTYPE;
BEGIN
  IF p_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr is verplicht';
  END IF;

  SELECT * INTO v_d FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF COALESCE(p_is_afhalen, FALSE) THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_afhalen'::TEXT,
      'Afhalen — geen verzendkosten'::TEXT;
    RETURN;
  END IF;

  IF v_d.gratis_verzending THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_klantafspraak'::TEXT,
      'Gratis volgens klantafspraak'::TEXT;
    RETURN;
  END IF;

  IF v_d.verzend_drempel IS NOT NULL
     AND COALESCE(p_bundel_subtotaal, 0) >= v_d.verzend_drempel THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_drempel'::TEXT,
      format('Gratis vanaf €%s', to_char(v_d.verzend_drempel, 'FM999999.00'))::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_d.verzendkosten, 0)::NUMERIC(8,2),
    'betaald'::TEXT,
    'Standaard verzendkosten'::TEXT;
END;
$function$


CREATE OR REPLACE FUNCTION public.verzendweek_voor_datum(p_datum date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- to_char IYYY = ISO-jaar (waar week 1 hoort), IW = ISO-weeknummer
  -- (1..53). NULL-input → NULL output zodat aanroepers expliciet kunnen
  -- filteren op orders zonder afleverdatum.
  SELECT CASE
    WHEN p_datum IS NULL THEN NULL
    ELSE to_char(p_datum, 'IYYY') || '-W' || to_char(p_datum, 'IW')
  END;
$function$


CREATE OR REPLACE FUNCTION public.volgend_nummer(p_type text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_jaar   INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_seq    TEXT    := LOWER(p_type) || '_' || v_jaar || '_seq';
    v_nr     BIGINT;
    v_nr_str TEXT;
BEGIN
    BEGIN
        EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_nr;
    EXCEPTION WHEN undefined_table THEN
        INSERT INTO nummering (type, jaar, laatste_nummer)
        VALUES (p_type, v_jaar, 1)
        ON CONFLICT (type, jaar)
        DO UPDATE SET laatste_nummer = nummering.laatste_nummer + 1
        RETURNING laatste_nummer INTO v_nr;
    END;

    -- Nieuwe FACT-nummering: YYYYNNNNNN (6 cijfers, geen prefix/streepje).
    -- Oud: FACT-2026-0184 → Nieuw: 2026000185.
    -- > 999999: LPAD heeft geen maximum, dus 7+ cijfers gaan gewoon goed.
    IF p_type = 'FACT' THEN
        v_nr_str := v_nr::TEXT;
        IF LENGTH(v_nr_str) < 6 THEN
            v_nr_str := LPAD(v_nr_str, 6, '0');
        END IF;
        RETURN v_jaar::TEXT || v_nr_str;
    END IF;

    -- Overige types: bestaand gedrag (PREFIX-YYYY-NNNN).
    -- Anti-truncation: LPAD alleen als < 4 digits (mig 116).
    v_nr_str := v_nr::TEXT;
    IF LENGTH(v_nr_str) < 4 THEN
        v_nr_str := LPAD(v_nr_str, 4, '0');
    END IF;

    RETURN p_type || '-' || v_jaar || '-' || v_nr_str;
END;
$function$


CREATE OR REPLACE FUNCTION public.volgende_batch_moment(p_cutoff time without time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_lokaal_nu TIMESTAMP;   -- Amsterdamse wandklok (timestamp zonder tz)
  v_dag       DATE;
BEGIN
  IF p_cutoff IS NULL THEN RETURN NULL; END IF;

  v_lokaal_nu := now() AT TIME ZONE 'Europe/Amsterdam';
  v_dag       := v_lokaal_nu::date;

  -- Vandaag bruikbaar alleen als werkdag (ISODOW 1..5) én cutoff nog niet voorbij.
  IF NOT (EXTRACT(ISODOW FROM v_dag) BETWEEN 1 AND 5)
     OR v_lokaal_nu::time >= p_cutoff THEN
    v_dag := werkdag_plus_n(v_dag, 1);  -- eerstvolgende werkdag (skipt weekend)
  END IF;

  -- Lokale (Amsterdamse) cutoff terug naar timestamptz (DST-correct).
  RETURN (v_dag + p_cutoff) AT TIME ZONE 'Europe/Amsterdam';
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_confectie(p_snijplan_id bigint, p_afgerond boolean DEFAULT true, p_ingepakt boolean DEFAULT false, p_locatie text DEFAULT NULL::text)
 RETURNS snijplannen
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row          snijplannen;
  v_nu           TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN     := p_afgerond OR p_ingepakt;  -- ingepakt impliceert afgerond
  v_order_id     BIGINT;
  v_open         INTEGER;
BEGIN
  UPDATE snijplannen
     SET confectie_afgerond_op = CASE WHEN v_eff_afgerond THEN v_nu ELSE NULL END,
         ingepakt_op           = CASE WHEN p_ingepakt THEN v_nu ELSE NULL END,
         locatie               = CASE
                                   WHEN p_locatie IS NULL THEN locatie
                                   WHEN trim(p_locatie) = '' THEN NULL
                                   ELSE trim(p_locatie)
                                 END,
         status                = CASE
                                   WHEN p_ingepakt    THEN 'Ingepakt'::snijplan_status
                                   WHEN v_eff_afgerond THEN 'In confectie'::snijplan_status
                                   ELSE                    'Gesneden'::snijplan_status
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden'::snijplan_status,
                    'In confectie'::snijplan_status,
                    'Gereed'::snijplan_status,
                    'Ingepakt'::snijplan_status)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed/Ingepakt', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- NA-STAP (productie-only): order naar 'Maatwerk afgerond' als ALLE snijplannen
  -- van de order confectie-afgerond zijn. Strikt geguard op alleen_productie.
  -- Mig 347: via _apply_transitie (ADR-0006) zodat de transitie een
  -- order_events-rij krijgt; was directe UPDATE (mig 330).
  IF v_eff_afgerond THEN
    SELECT orr.order_id INTO v_order_id
      FROM order_regels orr WHERE orr.id = v_row.order_regel_id;

    IF EXISTS (SELECT 1 FROM orders o
               WHERE o.id = v_order_id AND o.alleen_productie = true
                 AND o.status <> 'Maatwerk afgerond'::order_status) THEN
      SELECT count(*) INTO v_open
        FROM snijplannen sp
        JOIN order_regels orr ON orr.id = sp.order_regel_id
       WHERE orr.order_id = v_order_id
         AND sp.confectie_afgerond_op IS NULL;

      IF v_open = 0 THEN
        PERFORM _apply_transitie(
          v_order_id,
          'maatwerk_afgerond'::order_event_type,
          'Maatwerk afgerond'::order_status,
          p_reden => 'Alle snijplannen confectie-afgerond (productie-only, afhandelen in Basta)'
        );
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_pickronde(p_zending_id bigint, p_picker_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_huidig             zending_status;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
  v_verzonden_zend     INTEGER;
  v_onverzonde_regels  INTEGER;
  v_bundel_orders      BIGINT[];
  v_resterend_colli    INTEGER;
  v_ng                 RECORD;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status INTO v_huidig FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)',
      p_zending_id, v_huidig;
  END IF;

  -- (a) Niet-gevonden colli's → markeer orderregel als manco (gate), zet de
  -- permanente order-marker, log audit, en houd de regel als MANCO op de zending.
  FOR v_ng IN
    SELECT zc.id AS colli_id, zc.order_regel_id, zc.pick_opmerking
      FROM zending_colli zc
     WHERE zc.zending_id = p_zending_id
       AND zc.pick_uitkomst = 'niet_gevonden'
       AND zc.order_regel_id IS NOT NULL
  LOOP
    UPDATE order_regels
       SET pick_backorder_sinds = COALESCE(pick_backorder_sinds, now()),
           pick_backorder_reden = v_ng.pick_opmerking,
           pick_backorder_geannuleerd_op = NULL
     WHERE id = v_ng.order_regel_id;

    -- Permanente order-marker + audit (status_na = huidige order-status).
    UPDATE orders o
       SET manco_sinds = COALESCE(o.manco_sinds, now())
      FROM order_regels ore
     WHERE ore.id = v_ng.order_regel_id AND o.id = ore.order_id;

    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    SELECT ore.order_id, 'manco_gedetecteerd', o.status,
           jsonb_build_object('order_regel_id', v_ng.order_regel_id,
                              'zending_id', p_zending_id,
                              'reden', v_ng.pick_opmerking, 'migratie', 516)
      FROM order_regels ore JOIN orders o ON o.id = ore.order_id
     WHERE ore.id = v_ng.order_regel_id;

    -- Houd de regel als MANCO op de zending (geleverd 0 op de pakbon); colli weg.
    UPDATE zending_regels
       SET aantal       = GREATEST(0, aantal - 1),
           manco_aantal = manco_aantal + 1
     WHERE zending_id = p_zending_id
       AND order_regel_id = v_ng.order_regel_id;
    DELETE FROM zending_colli WHERE id = v_ng.colli_id;
  END LOOP;

  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli
                          WHERE zending_id = p_zending_id AND is_bundel = FALSE)
   WHERE id = p_zending_id;

  -- Bron-orders via M2M (mig 222 canoniek), met legacy order_id-fallback.
  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;
  IF v_bundel_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_bundel_orders FROM zendingen WHERE id = p_zending_id;
  END IF;

  -- (b) Lege zending (alle colli niet gevonden)? Niets te verzenden → verwijder de
  -- zending (zoals annuleer_pickronde, mig 398). De manco-regel(s) houden de order
  -- uit Pick & Ship tot ze op de Manco-werklijst beoordeeld zijn.
  SELECT COUNT(*) INTO v_resterend_colli
    FROM zending_colli WHERE zending_id = p_zending_id AND is_bundel = FALSE;

  IF v_resterend_colli = 0 THEN
    DELETE FROM zending_colli  WHERE zending_id = p_zending_id;
    DELETE FROM zending_regels WHERE zending_id = p_zending_id;
    DELETE FROM zending_orders WHERE zending_id = p_zending_id;
    DELETE FROM zendingen      WHERE id = p_zending_id;
    IF v_bundel_orders IS NOT NULL THEN
      FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
        SELECT COUNT(*) INTO v_open_zendingen
          FROM zendingen z
         WHERE z.status IN ('Gepland', 'Picken')
           AND (z.order_id = v_order_id
                OR z.id IN (SELECT zo.zending_id FROM zending_orders zo
                             WHERE zo.order_id = v_order_id));
        IF v_open_zendingen = 0 AND EXISTS (
          SELECT 1 FROM orders WHERE id = v_order_id AND status = 'In pickronde'
        ) THEN
          PERFORM _apply_transitie(
            p_order_id            := v_order_id,
            p_event_type          := 'pickronde_teruggedraaid',
            p_status_na           := 'Klaar voor picken',
            p_actor_medewerker_id := p_picker_id,
            p_reden               := 'Alle colli niet gevonden — naar manco'
          );
        END IF;
        PERFORM herbereken_wacht_status(v_order_id);
      END LOOP;
    END IF;
    RETURN p_zending_id;
  END IF;

  -- Resterende colli: voltooi normaal (identiek aan mig 413 vanaf hier).
  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_verzonden_zend
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN CONTINUE; END IF;

    IF v_open_zendingen = 0 THEN
      -- (c) Tel onverzonden, niet-pseudo, niet-geannuleerde regels. Een gegate
      -- manco-regel telt mee (gate gezet); een regel zonder gepickte (aantal>0)
      -- zending_regel ook → order blijft Deels verzonden.
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

      IF v_onverzonde_regels > 0 THEN
        PERFORM markeer_deels_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      ELSE
        PERFORM markeer_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      END IF;

    ELSIF v_verzonden_zend >= 1 THEN
      PERFORM markeer_deels_verzonden(
        p_order_id            := v_order_id,
        p_actor_medewerker_id := p_picker_id
      );
    END IF;
  END LOOP;

  RETURN p_zending_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_pickronden(p_zending_ids bigint[], p_picker_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(zending_id bigint, zending_nr text, ok boolean, reden text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id BIGINT;
  v_nr TEXT;
BEGIN
  -- Picker éénmaal hard valideren (mig 394: NULL toegestaan = niet vastgelegd).
  -- Een niet-bestaande/inactieve picker is een caller-fout, geen per-zending-
  -- conditie — zonder deze pre-check zou élke zending in z'n eigen block falen
  -- met dezelfde melding (alle rijen ok=FALSE), wat de echte oorzaak verbergt.
  PERFORM _valideer_picker(p_picker_id);

  IF p_zending_ids IS NULL OR array_length(p_zending_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- DISTINCT: een bundel-zending hoort bij meerdere orders; de UI selecteert op
  -- order-niveau en kan dezelfde zending dus dubbel meesturen. Eén voltooiing
  -- per fysieke zending.
  FOR v_id IN SELECT DISTINCT u FROM unnest(p_zending_ids) AS u LOOP
    SELECT z.zending_nr INTO v_nr FROM zendingen z WHERE z.id = v_id;

    BEGIN
      PERFORM voltooi_pickronde(v_id, p_picker_id);
      zending_id := v_id;
      zending_nr := v_nr;
      ok         := TRUE;
      reden      := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      zending_id := v_id;
      zending_nr := v_nr;
      ok         := FALSE;
      reden      := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_snijplan_rol(p_rol_id bigint, p_gesneden_door text DEFAULT NULL::text)
 RETURNS TABLE(reststuk_id bigint, reststuk_rolnummer text, reststuk_lengte_cm integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_nieuw_rolnummer TEXT;
  v_reststuk_id BIGINT;
  v_min_reststuk_cm INTEGER := 50; -- minimale lengte om reststuk aan te maken
BEGIN
  -- 1. Lock en haal rol op
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id;
  END IF;

  IF v_rol.status <> 'in_snijplan' THEN
    RAISE EXCEPTION 'Rol % heeft status "%" — kan alleen "in_snijplan" rollen voltooien', p_rol_id, v_rol.status;
  END IF;

  -- 2. Bereken gebruikte lengte op basis van geplaatste snijplannen
  SELECT COALESCE(MAX(positie_y_cm + breedte_cm), 0)
  INTO v_gebruikte_lengte
  FROM snijvoorstel_plaatsingen
  WHERE rol_id = p_rol_id
    AND voorstel_id IN (SELECT id FROM snijvoorstellen WHERE status = 'goedgekeurd');

  -- Fallback: bereken uit snijplannen direct
  IF v_gebruikte_lengte = 0 THEN
    SELECT COALESCE(MAX(positie_y_cm +
      CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END
    ), 0)
    INTO v_gebruikte_lengte
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gepland';
  END IF;

  v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));

  -- 3. Markeer alle geplande snijplannen op deze rol als 'Gesneden'
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status = 'Gepland';

  -- 4. Maak reststuk aan als er genoeg over is
  IF v_rest_lengte >= v_min_reststuk_cm THEN
    -- Genereer rolnummer voor reststuk
    v_nieuw_rolnummer := v_rol.rolnummer || '-REST';

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, oorsprong_rol_id, reststuk_datum
    ) VALUES (
      v_nieuw_rolnummer,
      v_rol.artikelnr,
      v_rol.karpi_code,
      v_rol.omschrijving,
      v_rest_lengte,
      v_rol.breedte_cm,
      ROUND((v_rest_lengte * v_rol.breedte_cm)::NUMERIC / 10000, 2),
      v_rol.kwaliteit_code,
      v_rol.kleur_code,
      v_rol.zoeksleutel,
      'reststuk',
      p_rol_id,
      NOW()
    )
    RETURNING id INTO v_reststuk_id;

    -- 5. Originele rol markeren als gesneden (volledig verwerkt)
    UPDATE rollen
    SET status = 'gesneden',
        lengte_cm = CEIL(v_gebruikte_lengte)
    WHERE id = p_rol_id;

    RETURN QUERY SELECT v_reststuk_id, v_nieuw_rolnummer, v_rest_lengte;
  ELSE
    -- Geen bruikbaar reststuk — rol volledig verwerkt
    UPDATE rollen
    SET status = 'gesneden'
    WHERE id = p_rol_id;

    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, NULL::INTEGER;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_snijplan_rol(p_rol_id bigint, p_gesneden_door text DEFAULT NULL::text, p_override_rest_lengte integer DEFAULT NULL::integer, p_reststukken jsonb DEFAULT NULL::jsonb, p_snijplan_ids bigint[] DEFAULT NULL::bigint[], p_aangebroken_lengte integer DEFAULT NULL::integer)
 RETURNS TABLE(reststuk_id bigint, reststuk_rolnummer text, reststuk_lengte_cm integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
  v_idx INTEGER;
  v_created INTEGER;
  v_rect JSONB;
  v_rect_breedte INTEGER;
  v_rect_lengte INTEGER;
  v_afgevinkt_count INTEGER;
  v_prijs_per_m2 NUMERIC;
  v_gesneden_m2 NUMERIC;
  v_reststuk_m2 NUMERIC;
  v_afval_m2 NUMERIC;
  v_aangebroken_m2 NUMERIC;
  v_aangebroken BOOLEAN := (p_aangebroken_lengte IS NOT NULL AND p_aangebroken_lengte >= 100);
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _reststuk_out (
    reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER
  ) ON COMMIT DROP;
  DELETE FROM _reststuk_out;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- ---------------------------------------------------------------------
  -- 1. Snijplan-status updates (identiek aan 088)
  -- ---------------------------------------------------------------------
  IF p_snijplan_ids IS NULL THEN
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden';
  ELSE
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND id = ANY(p_snijplan_ids);

    UPDATE snijplannen
    SET status = 'Wacht',
        rol_id = NULL,
        positie_x_cm = NULL,
        positie_y_cm = NULL,
        geroteerd = FALSE
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND NOT (id = ANY(p_snijplan_ids));

    SELECT COUNT(*) INTO v_afgevinkt_count
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '1 second'
      AND id = ANY(p_snijplan_ids);
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. Rol-status: aangebroken (verkort) of gesneden (oud gedrag)
  -- ---------------------------------------------------------------------
  IF v_aangebroken THEN
    INSERT INTO voorraad_mutaties (rol_id, type, lengte_voor_cm, lengte_na_cm, reden, medewerker)
    VALUES (p_rol_id, 'aangebroken', v_rol.lengte_cm, p_aangebroken_lengte,
            'Rol aangebroken na snijden (volle breedte overgebleven)', p_gesneden_door);

    UPDATE rollen
    SET lengte_cm = p_aangebroken_lengte,
        oppervlak_m2 = ROUND(p_aangebroken_lengte * breedte_cm / 10000.0, 2),
        waarde = CASE
          WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
          THEN ROUND((p_aangebroken_lengte * v_rol.breedte_cm / 10000.0)
                     * (v_rol.waarde / v_rol.oppervlak_m2), 2)
          ELSE waarde
        END,
        status = 'beschikbaar',
        snijden_gestart_op = NULL,
        snijden_voltooid_op = NULL,
        snijden_gestart_door = NULL
    WHERE id = p_rol_id;
  ELSE
    IF p_snijplan_ids IS NULL
       OR (array_length(p_snijplan_ids, 1) IS NOT NULL AND array_length(p_snijplan_ids, 1) > 0) THEN
      UPDATE rollen
      SET status = 'gesneden',
          snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    ELSE
      UPDATE rollen
      SET snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- 3. Reststukken JSONB-flow (identiek aan 088 incl. waarde-toerekening)
  -- ---------------------------------------------------------------------
  IF p_reststukken IS NOT NULL AND jsonb_array_length(p_reststukken) > 0 THEN
    v_idx := 0;
    v_created := 0;
    FOR v_rect IN SELECT * FROM jsonb_array_elements(p_reststukken)
    LOOP
      v_idx := v_idx + 1;
      v_rect_breedte := (v_rect->>'breedte_cm')::INTEGER;
      v_rect_lengte := (v_rect->>'lengte_cm')::INTEGER;

      IF LEAST(v_rect_breedte, v_rect_lengte) < 70
         OR GREATEST(v_rect_breedte, v_rect_lengte) < 140 THEN
        CONTINUE;
      END IF;

      v_reststuk_nr := v_rol.rolnummer || '-R' || v_idx::TEXT;

      INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code,
                          lengte_cm, breedte_cm, oppervlak_m2, status,
                          oorsprong_rol_id, reststuk_datum, waarde)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rect_lengte, v_rect_breedte,
              ROUND(v_rect_lengte * v_rect_breedte / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE,
              CASE WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
                   THEN ROUND((v_rect_lengte * v_rect_breedte / 10000.0)
                              * (v_rol.waarde / v_rol.oppervlak_m2), 2)
                   ELSE NULL END)
      RETURNING id INTO v_reststuk_id;

      INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rect_lengte);
      v_created := v_created + 1;
    END LOOP;

    IF v_created = 0 THEN
      INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
    END IF;
  ELSIF v_aangebroken THEN
    -- Aangebroken zonder extra reststukken: geen aparte reststuk-rol.
    INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
  ELSE
    -- -------------------------------------------------------------------
    -- 3b. Fallback (oud gedrag): 1 end-of-roll reststuk via positie-calc.
    -- -------------------------------------------------------------------
    SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
    INTO v_gebruikte_lengte
    FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

    IF p_override_rest_lengte IS NOT NULL THEN
      v_rest_lengte := GREATEST(0, p_override_rest_lengte);
    ELSE
      v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
    END IF;

    IF v_rest_lengte >= 100 THEN
      v_reststuk_nr := v_rol.rolnummer || '-R';
      INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                          oppervlak_m2, status, oorsprong_rol_id, reststuk_datum, waarde)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rest_lengte, v_rol.breedte_cm,
              ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE,
              CASE WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
                   THEN ROUND((v_rest_lengte * v_rol.breedte_cm / 10000.0)
                              * (v_rol.waarde / v_rol.oppervlak_m2), 2)
                   ELSE NULL END)
      RETURNING id INTO v_reststuk_id;

      INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rest_lengte);
    ELSE
      INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. Kostentoerekening per zojuist afgevinkt snijplan (088).
  -- Bij aangebroken: trek aangebroken_m² af van afval_m² zodat de gesneden
  -- stukken niet ten onrechte de hele overgebleven lengte betalen.
  -- ---------------------------------------------------------------------
  IF v_rol.oppervlak_m2 IS NOT NULL AND v_rol.oppervlak_m2 > 0
     AND v_rol.waarde IS NOT NULL THEN

    v_prijs_per_m2 := v_rol.waarde / v_rol.oppervlak_m2;

    SELECT COALESCE(SUM(lengte_cm * breedte_cm / 10000.0), 0)
    INTO v_gesneden_m2
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '5 seconds';

    SELECT COALESCE(SUM(oppervlak_m2), 0)
    INTO v_reststuk_m2
    FROM rollen
    WHERE oorsprong_rol_id = p_rol_id
      AND reststuk_datum = CURRENT_DATE;

    v_aangebroken_m2 := CASE
      WHEN v_aangebroken
      THEN ROUND(p_aangebroken_lengte * v_rol.breedte_cm / 10000.0, 2)
      ELSE 0
    END;

    v_afval_m2 := GREATEST(0,
      v_rol.oppervlak_m2 - v_gesneden_m2 - v_reststuk_m2 - v_aangebroken_m2
    );

    IF v_gesneden_m2 > 0 THEN
      UPDATE snijplannen sp
      SET grondstofkosten_m2 = ROUND(
            (sp.lengte_cm * sp.breedte_cm / 10000.0)
            + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2),
            4),
          inkoopprijs_m2 = v_prijs_per_m2,
          grondstofkosten = ROUND(
            ((sp.lengte_cm * sp.breedte_cm / 10000.0)
             + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2))
            * v_prijs_per_m2,
            2)
      WHERE sp.rol_id = p_rol_id
        AND sp.status = 'Gesneden'
        AND sp.gesneden_op >= NOW() - INTERVAL '5 seconds';
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM _reststuk_out;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_snijplan_rol(p_rol_id bigint, p_gesneden_door text DEFAULT NULL::text, p_override_rest_lengte integer DEFAULT NULL::integer)
 RETURNS TABLE(reststuk_id bigint, reststuk_rolnummer text, reststuk_lengte_cm integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
BEGIN
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- Markeer alle snijplannen op deze rol als Gesneden
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status = 'Snijden';

  SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
  INTO v_gebruikte_lengte
  FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

  IF p_override_rest_lengte IS NOT NULL THEN
    v_rest_lengte := GREATEST(0, p_override_rest_lengte);
  ELSE
    v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
  END IF;

  UPDATE rollen SET status = 'gesneden' WHERE id = p_rol_id;

  IF v_rest_lengte >= 100 THEN
    v_reststuk_nr := v_rol.rolnummer || '-R';
    INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                        oppervlak_m2, status, oorsprong_rol_id, reststuk_datum)
    VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
            v_rest_lengte, v_rol.breedte_cm,
            ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
            'beschikbaar', p_rol_id, CURRENT_DATE)
    RETURNING id INTO v_reststuk_id;

    RETURN QUERY SELECT v_reststuk_id, v_reststuk_nr, v_rest_lengte;
  ELSE
    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, NULL::INTEGER;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.voltooi_snijplan_rol(p_rol_id bigint, p_gesneden_door text DEFAULT NULL::text, p_override_rest_lengte integer DEFAULT NULL::integer, p_reststukken jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(reststuk_id bigint, reststuk_rolnummer text, reststuk_lengte_cm integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
  v_idx INTEGER;
  v_created INTEGER;
  v_rect JSONB;
  v_rect_breedte INTEGER;
  v_rect_lengte INTEGER;
BEGIN
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- Markeer alle snijplannen op deze rol als Gesneden
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status = 'Snijden';

  UPDATE rollen SET status = 'gesneden' WHERE id = p_rol_id;

  -- ---------------------------------------------------------------------
  -- Nieuwe flow: expliciete lijst van reststuk-rechthoeken
  -- ---------------------------------------------------------------------
  IF p_reststukken IS NOT NULL AND jsonb_array_length(p_reststukken) > 0 THEN
    v_idx := 0;
    v_created := 0;
    FOR v_rect IN SELECT * FROM jsonb_array_elements(p_reststukken)
    LOOP
      v_idx := v_idx + 1;
      v_rect_breedte := (v_rect->>'breedte_cm')::INTEGER;
      v_rect_lengte := (v_rect->>'lengte_cm')::INTEGER;

      -- Harde drempel: min 70x140 cm (kleiner = afval)
      IF LEAST(v_rect_breedte, v_rect_lengte) < 70
         OR GREATEST(v_rect_breedte, v_rect_lengte) < 140 THEN
        CONTINUE;
      END IF;

      v_reststuk_nr := v_rol.rolnummer || '-R' || v_idx::TEXT;

      INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code,
                          lengte_cm, breedte_cm, oppervlak_m2, status,
                          oorsprong_rol_id, reststuk_datum)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rect_lengte, v_rect_breedte,
              ROUND(v_rect_lengte * v_rect_breedte / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE)
      RETURNING id INTO v_reststuk_id;

      reststuk_id := v_reststuk_id;
      reststuk_rolnummer := v_reststuk_nr;
      reststuk_lengte_cm := v_rect_lengte;
      v_created := v_created + 1;
      RETURN NEXT;
    END LOOP;

    -- Als geen enkele rect kwalificeerde, geef een lege row terug (compat)
    IF v_created = 0 THEN
      reststuk_id := NULL;
      reststuk_rolnummer := NULL;
      reststuk_lengte_cm := NULL;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------
  -- Fallback: oud gedrag (1 end-of-roll reststuk, threshold 100 cm)
  -- ---------------------------------------------------------------------
  SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
  INTO v_gebruikte_lengte
  FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

  IF p_override_rest_lengte IS NOT NULL THEN
    v_rest_lengte := GREATEST(0, p_override_rest_lengte);
  ELSE
    v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
  END IF;

  IF v_rest_lengte >= 100 THEN
    v_reststuk_nr := v_rol.rolnummer || '-R';
    INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                        oppervlak_m2, status, oorsprong_rol_id, reststuk_datum)
    VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
            v_rest_lengte, v_rol.breedte_cm,
            ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
            'beschikbaar', p_rol_id, CURRENT_DATE)
    RETURNING id INTO v_reststuk_id;

    reststuk_id := v_reststuk_id;
    reststuk_rolnummer := v_reststuk_nr;
    reststuk_lengte_cm := v_rest_lengte;
    RETURN NEXT;
  ELSE
    reststuk_id := NULL;
    reststuk_rolnummer := NULL;
    reststuk_lengte_cm := NULL;
    RETURN NEXT;
  END IF;
END;
$function$


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
$function$


CREATE OR REPLACE FUNCTION public.voorraadposities(p_kwaliteit text DEFAULT NULL::text, p_kleur text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS TABLE(kwaliteit_code text, kleur_code text, product_naam text, eigen_volle_rollen integer, eigen_aangebroken_rollen integer, eigen_reststuk_rollen integer, eigen_totaal_m2 numeric, rollen jsonb, partners jsonb, beste_partner jsonb, besteld_m numeric, besteld_m2 numeric, besteld_orders_count integer, eerstvolgende_leverweek text, eerstvolgende_verwacht_datum date, eerstvolgende_m numeric, eerstvolgende_m2 numeric, bruto_maatwerkvraag_m2 numeric, vrij_voor_nieuw_maatwerk_m2 numeric, gereserveerd_migratie_m2 numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
  input AS (
    SELECT
      NULLIF(p_kwaliteit, '')                                         AS norm_kwaliteit,
      regexp_replace(COALESCE(NULLIF(p_kleur, ''), ''), '\.0+$', '')  AS norm_kleur_raw,
      NULLIF(p_search, '')                                            AS norm_search
  ),
  input_flag AS (
    SELECT
      norm_kwaliteit,
      NULLIF(norm_kleur_raw, '')                                     AS norm_kleur,
      norm_search,
      (norm_kwaliteit IS NOT NULL AND NULLIF(norm_kleur_raw,'') IS NOT NULL) AS is_single
    FROM input
  ),
  eigen AS (
    SELECT
      r.kwaliteit_code                                       AS kwaliteit_code,
      regexp_replace(r.kleur_code, '\.0+$', '')              AS kleur_code,
      COUNT(*) FILTER (WHERE r.rol_type = 'volle_rol')::INT  AS volle_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'aangebroken')::INT AS aangebroken_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'reststuk')::INT   AS reststuk_rollen,
      COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC              AS totaal_m2,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',                r.id,
            'rolnummer',         r.rolnummer,
            'artikelnr',         r.artikelnr,
            'kwaliteit_code',    r.kwaliteit_code,
            'kleur_code',        regexp_replace(r.kleur_code, '\.0+$', ''),
            'lengte_cm',         r.lengte_cm,
            'breedte_cm',        r.breedte_cm,
            'oppervlak_m2',      r.oppervlak_m2,
            'status',            r.status,
            'rol_type',          r.rol_type,
            'locatie',           ml.code,
            'oorsprong_rol_id',  r.oorsprong_rol_id,
            'reststuk_datum',    r.reststuk_datum,
            'in_magazijn_sinds', r.in_magazijn_sinds
          )
          ORDER BY r.in_magazijn_sinds ASC NULLS FIRST, r.rol_type ASC, r.rolnummer ASC
        ),
        '[]'::jsonb
      )                                                       AS rollen_json
    FROM rollen r
    LEFT JOIN magazijn_locaties ml ON ml.id = r.locatie_id
    WHERE r.status NOT IN ('verkocht', 'gesneden')
      AND r.oppervlak_m2 > 0
      AND r.kwaliteit_code IS NOT NULL
      AND r.kleur_code     IS NOT NULL
    GROUP BY r.kwaliteit_code, regexp_replace(r.kleur_code, '\.0+$', '')
  ),
  -- Actieve migratie-blokkering per (kwaliteit, genormaliseerde kleur), in m².
  -- Strip = volle rolbreedte × gereserveerde_lengte_cm; m² = breedte_cm/100 × lengte_cm/100.
  -- Groeperingssleutel komt uit de ROL (r.kwaliteit_code/r.kleur_code), niet uit
  -- de gedenormaliseerde mb-kolommen: de breedte komt al van de rol, dus de m²
  -- hoort onder de kwaliteit/kleur van de rol — correct-by-construction, geen
  -- afhankelijkheid van mogelijk-afwijkende mb.kwaliteit_code/kleur_code.
  geblokkeerd AS (
    SELECT
      r.kwaliteit_code                                   AS kwaliteit_code,
      regexp_replace(r.kleur_code, '\.0+$', '')          AS norm_kleur,
      SUM(r.breedte_cm::NUMERIC / 100 * mb.gereserveerde_lengte_cm::NUMERIC / 100) AS m2
    FROM migratie_blokkering mb
    JOIN rollen r ON r.id = mb.rol_id
    WHERE mb.status = 'actief'
      -- Zelfde rol-universum als de `eigen`-CTE (waar we van aftrekken): een rol
      -- die al 'verkocht'/'gesneden' is telt niet meer mee in eigen_totaal_m2, dus
      -- mag z'n blokkering-m² ook niet van de overige rollen afgetrokken worden.
      AND r.status NOT IN ('verkocht', 'gesneden')
    GROUP BY r.kwaliteit_code, regexp_replace(r.kleur_code, '\.0+$', '')
  ),
  partners_raw AS (
    SELECT
      up.kwaliteit_code                                          AS kwaliteit_code,
      regexp_replace(up.kleur_code, '\.0+$', '')                 AS kleur_code,
      up.partner_kwaliteit_code                                  AS p_kw,
      regexp_replace(up.partner_kleur_code, '\.0+$', '')         AS p_kl,
      COALESCE(up.partner_rollen, 0)::INTEGER                    AS p_rollen,
      COALESCE(up.partner_m2, 0)::NUMERIC                        AS p_m2
    FROM uitwisselbare_partners() up
  ),
  partners_agg AS (
    SELECT
      pr.kwaliteit_code,
      pr.kleur_code,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kwaliteit_code', pr.p_kw,
            'kleur_code',     pr.p_kl,
            'rollen',         pr.p_rollen,
            'm2',             pr.p_m2
          )
          ORDER BY pr.p_m2 DESC, pr.p_kw ASC, pr.p_kl ASC
        ) FILTER (WHERE pr.p_kw IS NOT NULL),
        '[]'::jsonb
      ) AS partners_json
    FROM partners_raw pr
    GROUP BY pr.kwaliteit_code, pr.kleur_code
  ),
  besteld AS (
    SELECT
      bk.kwaliteit_code                                 AS kwaliteit_code,
      regexp_replace(bk.kleur_code, '\.0+$', '')        AS kleur_code,
      COALESCE(bk.besteld_m, 0)::NUMERIC                AS b_m,
      COALESCE(bk.besteld_m2, 0)::NUMERIC               AS b_m2,
      COALESCE(bk.orders_count, 0)::INTEGER             AS b_count,
      bk.eerstvolgende_leverweek                        AS b_week,
      bk.eerstvolgende_verwacht_datum                   AS b_datum,
      COALESCE(bk.eerstvolgende_m,  0)::NUMERIC         AS b_eerstvolg_m,
      COALESCE(bk.eerstvolgende_m2, 0)::NUMERIC         AS b_eerstvolg_m2
    FROM besteld_per_kwaliteit_kleur() bk
  ),
  -- ADR-0026: bruto-maatwerkvraag per (bestelde kw, genormaliseerde kleur).
  -- Snijplannen in open statussen × maatwerk-regel × kwaliteit voor
  -- standaard_breedte_cm van de BESTELDE kwaliteit (niet die van de rol).
  -- Formule: min(l,b)/100 × COALESCE(standaard_breedte_cm, 400)/100.
  snijplan_vraag_per_paar AS (
    SELECT
      oreg.maatwerk_kwaliteit_code                       AS kwaliteit_code,
      regexp_replace(oreg.maatwerk_kleur_code, '\.0+$', '') AS kleur_code,
      SUM(
        (LEAST(sp.lengte_cm, sp.breedte_cm)::NUMERIC / 100.0)
        * (COALESCE(k.standaard_breedte_cm, 400)::NUMERIC / 100.0)
      )::NUMERIC                                         AS bruto_m2
    FROM snijplannen sp
    JOIN order_regels oreg ON oreg.id = sp.order_regel_id
    LEFT JOIN kwaliteiten k ON k.code = oreg.maatwerk_kwaliteit_code
    WHERE sp.status IN ('Wacht'::snijplan_status,
                        'Gepland'::snijplan_status,
                        'Snijden'::snijplan_status)
      AND oreg.is_maatwerk = TRUE
      AND oreg.maatwerk_kwaliteit_code IS NOT NULL
      AND oreg.maatwerk_kleur_code     IS NOT NULL
      AND sp.lengte_cm  IS NOT NULL
      AND sp.breedte_cm IS NOT NULL
    GROUP BY oreg.maatwerk_kwaliteit_code,
             regexp_replace(oreg.maatwerk_kleur_code, '\.0+$', '')
  ),
  product_naam_per_paar AS (
    SELECT DISTINCT ON (p.kwaliteit_code, regexp_replace(p.kleur_code, '\.0+$', ''))
      p.kwaliteit_code                                  AS kwaliteit_code,
      regexp_replace(p.kleur_code, '\.0+$', '')         AS kleur_code,
      p.omschrijving                                    AS naam
    FROM producten p
    WHERE p.kwaliteit_code IS NOT NULL
      AND p.kleur_code     IS NOT NULL
    ORDER BY p.kwaliteit_code, regexp_replace(p.kleur_code, '\.0+$', ''), p.artikelnr
  ),
  joined AS (
    SELECT
      COALESCE(e.kwaliteit_code, p.kwaliteit_code, b.kwaliteit_code) AS kw,
      COALESCE(e.kleur_code,     p.kleur_code,     b.kleur_code)     AS kl,
      COALESCE(e.volle_rollen, 0)            AS volle_rollen,
      COALESCE(e.aangebroken_rollen, 0)      AS aangebroken_rollen,
      COALESCE(e.reststuk_rollen, 0)         AS reststuk_rollen,
      COALESCE(e.totaal_m2, 0)::NUMERIC      AS eigen_m2,
      COALESCE(e.rollen_json, '[]'::jsonb)   AS rollen_json,
      COALESCE(p.partners_json, '[]'::jsonb) AS partners_json,
      COALESCE(b.b_m, 0)::NUMERIC            AS b_m,
      COALESCE(b.b_m2, 0)::NUMERIC           AS b_m2,
      COALESCE(b.b_count, 0)::INTEGER        AS b_count,
      b.b_week                                AS b_week,
      b.b_datum                               AS b_datum,
      COALESCE(b.b_eerstvolg_m,  0)::NUMERIC AS b_eerstvolg_m,
      COALESCE(b.b_eerstvolg_m2, 0)::NUMERIC AS b_eerstvolg_m2
    FROM eigen e
    FULL OUTER JOIN partners_agg p
      ON p.kwaliteit_code = e.kwaliteit_code
     AND p.kleur_code     = e.kleur_code
    FULL OUTER JOIN besteld b
      ON b.kwaliteit_code = COALESCE(e.kwaliteit_code, p.kwaliteit_code)
     AND b.kleur_code     = COALESCE(e.kleur_code,     p.kleur_code)
  ),
  -- ADR-0026: familie-rollup. Voor elke (kw, kl) in joined: SUM over alle
  -- (target_kw, target_kl) in uitwisselbare_paren(kw, kl) van:
  --   - voorraad (eigen.totaal_m2)
  --   - bruto-maatwerkvraag (snijplan_vraag_per_paar.bruto_m2)
  -- Claims (`producten.gereserveerd`) bewust niet gesubtraheerd in V1 — zie
  -- header-comment over unit-mismatch (stuks vs m²). V2-backlog: ADR-0026.
  -- Eén LATERAL per (kw, kl) — niet per snijplan-rij (te duur).
  familie_aggr AS (
    SELECT
      j.kw                                               AS kwaliteit_code,
      j.kl                                               AS kleur_code,
      COALESCE(SUM(e2.totaal_m2),  0)::NUMERIC           AS familie_voorraad_m2,
      COALESCE(SUM(svpp.bruto_m2), 0)::NUMERIC           AS familie_bruto_m2
    FROM (SELECT DISTINCT kw, kl FROM joined WHERE kw IS NOT NULL AND kl IS NOT NULL) j
    CROSS JOIN LATERAL uitwisselbare_paren(j.kw, j.kl) up
    LEFT JOIN eigen e2
      ON e2.kwaliteit_code = up.target_kwaliteit_code
     AND e2.kleur_code     = up.target_kleur_code
    LEFT JOIN snijplan_vraag_per_paar svpp
      ON svpp.kwaliteit_code = up.target_kwaliteit_code
     AND svpp.kleur_code     = up.target_kleur_code
    GROUP BY j.kw, j.kl
  )
  SELECT
    j.kw                        AS kwaliteit_code,
    j.kl                        AS kleur_code,
    pn.naam                     AS product_naam,
    j.volle_rollen              AS eigen_volle_rollen,
    j.aangebroken_rollen        AS eigen_aangebroken_rollen,
    j.reststuk_rollen           AS eigen_reststuk_rollen,
    -- Ondergrens 0: geblokkeerd m² kan theoretisch hoger zijn dan de fysieke m²
    -- als het migratiescript de snijplan-aftrek onderschat; dan is 0 correct
    -- (alle lengte bezet). Root-cause-check: import/rapporten/migratie_ongedekt.csv.
    GREATEST(0, j.eigen_m2 - COALESCE(gb.m2, 0))::NUMERIC AS eigen_totaal_m2,
    j.rollen_json               AS rollen,
    j.partners_json             AS partners,
    CASE
      WHEN j.eigen_m2 = 0
       AND jsonb_array_length(j.partners_json) > 0
       AND COALESCE((j.partners_json -> 0 ->> 'm2')::NUMERIC, 0) > 0
      THEN j.partners_json -> 0
      ELSE NULL
    END                         AS beste_partner,
    j.b_m                       AS besteld_m,
    j.b_m2                      AS besteld_m2,
    j.b_count                   AS besteld_orders_count,
    j.b_week                    AS eerstvolgende_leverweek,
    j.b_datum                   AS eerstvolgende_verwacht_datum,
    j.b_eerstvolg_m             AS eerstvolgende_m,
    j.b_eerstvolg_m2            AS eerstvolgende_m2,
    COALESCE(fa.familie_bruto_m2, 0)::NUMERIC                                              AS bruto_maatwerkvraag_m2,
    (COALESCE(fa.familie_voorraad_m2, 0)
       - COALESCE(fa.familie_bruto_m2,  0))::NUMERIC                                       AS vrij_voor_nieuw_maatwerk_m2,
    COALESCE(gb.m2, 0)::NUMERIC                                                            AS gereserveerd_migratie_m2
  FROM joined j
  CROSS JOIN input_flag i
  LEFT JOIN product_naam_per_paar pn
    ON pn.kwaliteit_code = j.kw
   AND pn.kleur_code     = j.kl
  LEFT JOIN familie_aggr fa
    ON fa.kwaliteit_code = j.kw
   AND fa.kleur_code     = j.kl
  LEFT JOIN geblokkeerd gb
    ON gb.kwaliteit_code = j.kw
   AND gb.norm_kleur     = j.kl
  WHERE j.kw IS NOT NULL
    AND j.kl IS NOT NULL
    AND (
      (i.is_single
        AND j.kw = i.norm_kwaliteit
        AND j.kl = i.norm_kleur)
      OR
      (NOT i.is_single
        AND (j.eigen_m2 > 0
          OR j.volle_rollen > 0
          OR j.aangebroken_rollen > 0
          OR j.reststuk_rollen > 0)
        AND (i.norm_kwaliteit IS NULL OR j.kw ILIKE '%' || i.norm_kwaliteit || '%')
        AND (i.norm_kleur     IS NULL OR j.kl = i.norm_kleur)
        AND (i.norm_search    IS NULL
             OR (j.kw || '-' || j.kl) ILIKE '%' || i.norm_search || '%'
             OR COALESCE(pn.naam, '') ILIKE '%' || i.norm_search || '%')
      )
    );
$function$


CREATE OR REPLACE FUNCTION public.wijs_snijplan_handmatig_toe(p_snijplan_id bigint, p_rol_id bigint, p_positie_x_cm numeric, p_positie_y_cm numeric, p_geroteerd boolean)
 RETURNS TABLE(kwaliteit_code text, kleur_code text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_oude_rol_id BIGINT;
  v_status snijplan_status;
  v_kwaliteit TEXT;
  v_kleur TEXT;
BEGIN
  SELECT sn.rol_id, sn.status, orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
    INTO v_oude_rol_id, v_status, v_kwaliteit, v_kleur
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
   WHERE sn.id = p_snijplan_id
   FOR UPDATE OF sn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijplan % niet gevonden', p_snijplan_id;
  END IF;

  IF v_status NOT IN ('Wacht', 'Gepland', 'Wacht op inkoop') THEN
    RAISE EXCEPTION 'Snijplan % staat op status % — kan niet meer handmatig herplaatst worden', p_snijplan_id, v_status;
  END IF;

  PERFORM 1 FROM rollen ro
   WHERE ro.id = p_rol_id
     AND ro.status IN ('beschikbaar', 'reststuk', 'in_snijplan')
     AND ro.snijden_gestart_op IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % is niet bruikbaar (al in productie of niet beschikbaar)', p_rol_id;
  END IF;

  -- Eerst lospeuteren van de huidige toewijzing (mirrort release_gepland_stukken
  -- voor deze ene rij) — werkt zowel voor een auto-geplaatst als een al
  -- handmatig vergrendeld stuk. Bij Wacht-op-inkoop wordt de virtuele-rol-claim
  -- losgemaakt; de aggregaat-cleanup op inkooporder_regels.snijplan_gebruikte_lengte_cm
  -- gebeurt niet hier maar via de auto-plan-groep-trigger die de caller direct na
  -- deze RPC doet — dit stuk telt dan niet meer mee in die hertelling.
  UPDATE snijplannen
     SET rol_id = NULL,
         positie_x_cm = NULL,
         positie_y_cm = NULL,
         geroteerd = false,
         verwacht_inkooporder_regel_id = NULL
   WHERE id = p_snijplan_id;

  IF v_oude_rol_id IS NOT NULL THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = v_oude_rol_id
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn2
          WHERE sn2.rol_id = v_oude_rol_id
            AND sn2.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  UPDATE snijplannen
     SET rol_id = p_rol_id,
         positie_x_cm = p_positie_x_cm,
         positie_y_cm = p_positie_y_cm,
         geroteerd = p_geroteerd,
         status = 'Gepland',
         is_handmatig_toegewezen = true
   WHERE id = p_snijplan_id;

  UPDATE rollen
     SET status = 'in_snijplan'
   WHERE id = p_rol_id
     AND status <> 'in_snijplan';

  RETURN QUERY SELECT v_kwaliteit, v_kleur;
END;
$function$


CREATE OR REPLACE FUNCTION public.zet_order_in_combi_levering_wacht(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_debiteur_nr INTEGER;
BEGIN
  SELECT debiteur_nr INTO v_debiteur_nr FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE debiteuren SET combi_levering = TRUE WHERE debiteur_nr = v_debiteur_nr;

  -- Deze ene order kan zelf al een override hebben staan (bv. eerder bewust
  -- los verzonden) — dat moet uit, anders doet de nieuwe klant-instelling
  -- voor DEZE order niets.
  UPDATE orders SET combi_levering_override = FALSE WHERE id = p_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.zoek_equivalente_producten(p_artikelnr text, p_min_voorraad integer DEFAULT 0)
 RETURNS TABLE(artikelnr text, karpi_code text, omschrijving text, kwaliteit_code text, kleur_code text, vrije_voorraad integer, besteld_inkoop integer, verkoopprijs numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_collectie_id      BIGINT;
  v_kleur_code        TEXT;
  v_afmeting          TEXT;
  v_maatwerk_vorm_code TEXT;
BEGIN
  SELECT k.collectie_id,
         p.kleur_code,
         SUBSTRING(p.karpi_code FROM LENGTH(p.kwaliteit_code) + 1),
         p.maatwerk_vorm_code
    INTO v_collectie_id, v_kleur_code, v_afmeting, v_maatwerk_vorm_code
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = p_artikelnr;

  IF v_collectie_id IS NULL OR v_afmeting IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.artikelnr,
         p.karpi_code,
         p.omschrijving,
         p.kwaliteit_code,
         p.kleur_code,
         p.vrije_voorraad,
         p.besteld_inkoop,
         p.verkoopprijs
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND SUBSTRING(p.karpi_code FROM LENGTH(p.kwaliteit_code) + 1) = v_afmeting
     AND p.artikelnr   <> p_artikelnr
     AND p.actief       = true
     AND p.vrije_voorraad >= p_min_voorraad
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
   ORDER BY p.vrije_voorraad DESC;
END;
$function$


CREATE OR REPLACE FUNCTION public.zorg_voor_confectie_order(p_snijplan_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_snijplan RECORD;
BEGIN
  SELECT
    sp.id,
    sp.order_regel_id,
    sp.rol_id,
    ore.maatwerk_afwerking,
    ore.maatwerk_instructies
  INTO v_snijplan
  FROM snijplannen sp
  JOIN order_regels ore ON ore.id = sp.order_regel_id
  WHERE sp.id = p_snijplan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijplan % niet gevonden', p_snijplan_id;
  END IF;

  INSERT INTO confectie_orders (
    confectie_nr,
    order_regel_id,
    snijplan_id,
    rol_id,
    type_bewerking,
    instructies,
    scancode,
    status
  )
  SELECT
    volgend_nummer('CONF'),
    v_snijplan.order_regel_id,
    v_snijplan.id,
    v_snijplan.rol_id,
    confectie_bewerking_voor_afwerking(v_snijplan.maatwerk_afwerking),
    v_snijplan.maatwerk_instructies,
    genereer_scancode(),
    'Wacht op materiaal'
  WHERE NOT EXISTS (
    SELECT 1
    FROM confectie_orders co
    WHERE co.snijplan_id = v_snijplan.id
  );

  UPDATE confectie_orders
  SET
    rol_id = COALESCE(confectie_orders.rol_id, v_snijplan.rol_id),
    type_bewerking = COALESCE(
      NULLIF(confectie_orders.type_bewerking, ''),
      confectie_bewerking_voor_afwerking(v_snijplan.maatwerk_afwerking)
    ),
    instructies = COALESCE(confectie_orders.instructies, v_snijplan.maatwerk_instructies)
  WHERE confectie_orders.snijplan_id = v_snijplan.id;
END;
$function$

