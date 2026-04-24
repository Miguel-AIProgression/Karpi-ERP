-- ============================================================================
-- REGRESSIETEST migratie 131 + 132: cross-kwaliteit release + tekort-analyse.
-- ============================================================================
--
-- Strategie: prik twee ECHTE kwaliteit-codes + een ECHTE debiteur + kleur uit
-- de productie-data, en bouw daarmee een mini-scenario. Alles binnen
-- `BEGIN; … ROLLBACK;` — geen blijvende wijzigingen, ook niet als een
-- RAISE EXCEPTION halverwege afbreekt.
--
-- Draai in Supabase SQL-editor. Succes = alleen NOTICES met 'OK'. Faal =
-- 'FAIL (letter)'.
--
-- Eis: minstens twee kwaliteiten bestaand in `kwaliteiten`, minstens één
-- debiteur in `debiteuren`. Voor een frisse Karpi-DB triviaal.

-- ----------------------------------------------------------------------------
-- Test 1: release_gepland_stukken respecteert cross-kwaliteit plaatsingen.
-- ----------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_kw_a          TEXT;
  v_kw_b          TEXT;
  v_art           TEXT;                     -- bestaand artikelnr (rollen.artikelnr NOT NULL + FK)
  v_kleur         TEXT := '9999';            -- onwaarschijnlijk kleur-nr
  v_debiteur_nr   INTEGER;
  v_rol_a         BIGINT;
  v_rol_b         BIGINT;
  v_order_id      BIGINT;
  v_regel_a       BIGINT;
  v_regel_b       BIGINT;
  v_snij_a        BIGINT;  -- A-stuk op B-rol (cross-kwaliteit)
  v_snij_b        BIGINT;  -- B-stuk op B-rol (zelfde-kwaliteit)
  v_released      INTEGER;
BEGIN
  SELECT code INTO v_kw_a FROM kwaliteiten ORDER BY code LIMIT 1;
  SELECT code INTO v_kw_b FROM kwaliteiten WHERE code <> v_kw_a ORDER BY code LIMIT 1;
  SELECT debiteur_nr INTO v_debiteur_nr FROM debiteuren ORDER BY debiteur_nr LIMIT 1;
  SELECT artikelnr   INTO v_art FROM producten LIMIT 1;

  IF v_kw_a IS NULL OR v_kw_b IS NULL OR v_debiteur_nr IS NULL OR v_art IS NULL THEN
    RAISE EXCEPTION 'SETUP: onvoldoende bestaande data (kwaliteiten/debiteuren/producten)';
  END IF;

  -- Twee rollen: één per kwaliteit, zelfde kleur 9999.
  INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm, oppervlak_m2, status)
  VALUES ('TEST-R131-A', v_art, v_kw_a, v_kleur, 3000, 400, 120, 'beschikbaar'),
         ('TEST-R131-B', v_art, v_kw_b, v_kleur, 3000, 400, 120, 'beschikbaar');

  SELECT id INTO v_rol_a FROM rollen WHERE rolnummer = 'TEST-R131-A';
  SELECT id INTO v_rol_b FROM rollen WHERE rolnummer = 'TEST-R131-B';

  -- Order + twee maatwerk-regels: één per kwaliteit.
  INSERT INTO orders (order_nr, debiteur_nr, status, orderdatum)
  VALUES ('TEST-R131-ORD', v_debiteur_nr, 'Nieuw', CURRENT_DATE)
  RETURNING id INTO v_order_id;

  INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving,
                            maatwerk_kwaliteit_code, maatwerk_kleur_code,
                            maatwerk_lengte_cm, maatwerk_breedte_cm,
                            orderaantal, is_maatwerk)
  VALUES (v_order_id, 1, NULL, 'TEST maatwerk A', v_kw_a, v_kleur, 200, 200, 1, TRUE)
  RETURNING id INTO v_regel_a;

  INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving,
                            maatwerk_kwaliteit_code, maatwerk_kleur_code,
                            maatwerk_lengte_cm, maatwerk_breedte_cm,
                            orderaantal, is_maatwerk)
  VALUES (v_order_id, 2, NULL, 'TEST maatwerk B', v_kw_b, v_kleur, 200, 200, 1, TRUE)
  RETURNING id INTO v_regel_b;

  -- Ruim de auto-gegenereerde Wacht-snijplannen van `auto_maak_snijplan` op:
  -- we bouwen zelf de Gepland-snijplannen. Eén snijplan per order_regel is
  -- voldoende voor de testcontext.
  DELETE FROM snijplannen WHERE order_regel_id IN (v_regel_a, v_regel_b);

  -- Cross-kwaliteit: A-stuk op B-rol.
  INSERT INTO snijplannen (snijplan_nr, order_regel_id, rol_id, status,
                           lengte_cm, breedte_cm,
                           positie_x_cm, positie_y_cm, geroteerd)
  VALUES (volgend_nummer('SNIJ'), v_regel_a, v_rol_b, 'Gepland',
          200, 200, 0, 0, FALSE)
  RETURNING id INTO v_snij_a;

  -- Zelfde-kwaliteit: B-stuk op B-rol.
  INSERT INTO snijplannen (snijplan_nr, order_regel_id, rol_id, status,
                           lengte_cm, breedte_cm,
                           positie_x_cm, positie_y_cm, geroteerd)
  VALUES (volgend_nummer('SNIJ'), v_regel_b, v_rol_b, 'Gepland',
          200, 200, 0, 200, FALSE)
  RETURNING id INTO v_snij_b;

  UPDATE rollen SET status = 'in_snijplan' WHERE id = v_rol_b;

  -- ACTIE: release voor kwaliteit B (de ROL-kwaliteit van rol_b).
  v_released := release_gepland_stukken(v_kw_b, v_kleur);

  -- (A) Alleen het B-stuk is vrijgegeven.
  IF v_released <> 1 THEN
    RAISE EXCEPTION 'FAIL (A): release(%) gaf % terug, verwacht 1', v_kw_b, v_released;
  END IF;

  -- (B) A-stuk (cross-kwaliteit) behoudt rol_id.
  IF (SELECT rol_id FROM snijplannen WHERE id = v_snij_a) IS NULL THEN
    RAISE EXCEPTION 'FAIL (B): cross-kwaliteit A-stuk (%) verloor rol_id bij release(%) — bug nog aanwezig', v_kw_a, v_kw_b;
  END IF;

  -- (C) B-stuk is losgekoppeld.
  IF (SELECT rol_id FROM snijplannen WHERE id = v_snij_b) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL (C): B-stuk behield rol_id — release werkte niet';
  END IF;

  -- (D) B-rol blijft in_snijplan omdat A-stuk er nog op staat.
  IF (SELECT status FROM rollen WHERE id = v_rol_b) <> 'in_snijplan' THEN
    RAISE EXCEPTION 'FAIL (D): B-rol werd teruggezet terwijl cross-kwaliteit stuk er nog op staat';
  END IF;

  RAISE NOTICE 'OK — release(%) laat cross-kwaliteit stuk (% op %-rol) ongemoeid', v_kw_b, v_kw_a, v_kw_b;

  -- ACTIE 2: release voor kwaliteit A → moet cross-kwaliteit A-stuk wél vrijgeven.
  v_released := release_gepland_stukken(v_kw_a, v_kleur);

  IF v_released <> 1 THEN
    RAISE EXCEPTION 'FAIL (E): release(%) gaf % terug, verwacht 1', v_kw_a, v_released;
  END IF;

  IF (SELECT rol_id FROM snijplannen WHERE id = v_snij_a) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL (F): A-stuk behield rol_id na release(%)', v_kw_a;
  END IF;

  -- B-rol moet nu terug naar beschikbaar (geen stukken meer op).
  IF (SELECT status FROM rollen WHERE id = v_rol_b) <> 'beschikbaar' THEN
    RAISE EXCEPTION 'FAIL (G): B-rol zou beschikbaar moeten zijn (0 Gepland/Snijden/Gesneden stukken)';
  END IF;

  RAISE NOTICE 'OK — release(%) geeft cross-kwaliteit stuk vrij en reset rol correct', v_kw_a;
END $$;

ROLLBACK;

-- ----------------------------------------------------------------------------
-- Test 2: snijplanning_tekort_analyse sluit placeholder-rollen (0×0) uit.
-- ----------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_kw            TEXT;
  v_art           TEXT;
  v_kleur         TEXT := '9998';
  v_debiteur_nr   INTEGER;
  v_order_id      BIGINT;
  v_regel_id      BIGINT;
  v_rij_aantal    INTEGER;
  v_rij_max_lang  INTEGER;
BEGIN
  SELECT code INTO v_kw FROM kwaliteiten WHERE collectie_id IS NULL ORDER BY code LIMIT 1;
  SELECT debiteur_nr INTO v_debiteur_nr FROM debiteuren ORDER BY debiteur_nr LIMIT 1;
  SELECT artikelnr   INTO v_art FROM producten LIMIT 1;

  IF v_kw IS NULL OR v_debiteur_nr IS NULL OR v_art IS NULL THEN
    RAISE EXCEPTION 'SETUP: onvoldoende bestaande data (kwaliteiten zonder collectie / debiteuren / producten)';
  END IF;

  -- Twee rollen: één placeholder (0×0), één echte (2500×400).
  INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm, oppervlak_m2, status)
  VALUES ('TEST-R132-PH',   v_art, v_kw, v_kleur, 0,    0,   0,   'beschikbaar'),
         ('TEST-R132-ECHT', v_art, v_kw, v_kleur, 2500, 400, 100, 'beschikbaar');

  -- Creëer een Wacht-stuk zodat de groep überhaupt in tekort_analyse verschijnt
  -- (tekort_analyse filtert op snijplanning_overzicht WHERE rol_id IS NULL).
  INSERT INTO orders (order_nr, debiteur_nr, status, orderdatum)
  VALUES ('TEST-R132-ORD', v_debiteur_nr, 'Nieuw', CURRENT_DATE)
  RETURNING id INTO v_order_id;

  INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving,
                            maatwerk_kwaliteit_code, maatwerk_kleur_code,
                            maatwerk_lengte_cm, maatwerk_breedte_cm,
                            orderaantal, is_maatwerk)
  VALUES (v_order_id, 1, NULL, 'TEST maatwerk PH', v_kw, v_kleur, 100, 100, 1, TRUE)
  RETURNING id INTO v_regel_id;

  -- `auto_maak_snijplan` heeft al een Wacht-snijplan aangemaakt voor deze regel
  -- (migratie 110). Dat is precies wat we nodig hebben — de groep verschijnt
  -- in tekort_analyse via `snijplanning_overzicht` WHERE rol_id IS NULL.

  -- Tekort-analyse moet 1 rol tellen (de echte), niet 2 (incl. placeholder).
  SELECT aantal_beschikbaar, max_lange_zijde_cm
    INTO v_rij_aantal, v_rij_max_lang
    FROM snijplanning_tekort_analyse()
   WHERE kwaliteit_code = v_kw AND kleur_code = v_kleur;

  IF v_rij_aantal IS NULL THEN
    RAISE EXCEPTION 'FAIL (H): tekort_analyse gaf geen rij terug voor %/%', v_kw, v_kleur;
  END IF;

  IF v_rij_aantal <> 1 THEN
    RAISE EXCEPTION 'FAIL (I): tekort_analyse telt % rollen, verwacht 1 (placeholder moet niet meegeteld)', v_rij_aantal;
  END IF;

  IF v_rij_max_lang <> 2500 THEN
    RAISE EXCEPTION 'FAIL (J): max_lange_zijde=% verwacht 2500 (placeholder 0×0 mag niet best-rol zijn)', v_rij_max_lang;
  END IF;

  RAISE NOTICE 'OK — snijplanning_tekort_analyse() negeert placeholder-rollen';
END $$;

ROLLBACK;
