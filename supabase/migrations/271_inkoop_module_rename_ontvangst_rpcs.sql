-- Migratie 271: Inkoop-Module — hernoem ontvangst-RPCs naar Module-aligned namen
--
-- Strategie (ADR-0016): pure rename. Business-logic blijft identiek aan
-- de huidige boek_voorraad_ontvangst (mig 254-versie) en boek_ontvangst
-- (laatste definitie in mig 136). We hernoemen alleen:
--
--   boek_voorraad_ontvangst → boek_inkooporder_ontvangst_stuks
--   boek_ontvangst          → boek_inkooporder_ontvangst_rollen
--
-- Oude namen worden DEPRECATED thin wrappers die de nieuwe namen aanroepen.
-- Bestaande callers (frontend OntvangstBoekenDialog, Python-import) blijven
-- werken via de wrappers tot ze in Task 11+ omgezet zijn.
--
-- NIET aangeraakt:
-- - boek_io_ontvangst_claims (Reservering-Module sinds mig 254). Wordt aangeroepen
--   door boek_inkooporder_ontvangst_stuks via PERFORM; signature blijft
--   (p_io_regel_id BIGINT, p_aantal_ontvangen INT).
-- - Voorraad-bump op producten, rollen-INSERT, voorraad_mutaties-INSERT blijven
--   binnen de hernoemde RPCs geparkeerd (zie ADR-0016 open backlog: verhuist
--   naar toekomstige Voorraad/Producten-Module).

-- ============================================================
-- 1. boek_inkooporder_ontvangst_stuks — nieuwe Module-aligned naam
-- ============================================================
-- Body identiek aan boek_voorraad_ontvangst zoals gedefinieerd in mig 254
-- (regels 226-283 van 254_reservering_module_split.sql). Alleen functie-naam
-- veranderd.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_stuks(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT) IS
  'Inkoop-Module: boek stuks-ontvangst op een eenheid=stuks IO-regel. '
  'Body identiek aan boek_voorraad_ontvangst (mig 254). Delegeert claim-'
  'consume aan Reservering via PERFORM boek_io_ontvangst_claims. ADR-0016, mig 271.';

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT) TO authenticated;

-- ============================================================
-- 2. boek_inkooporder_ontvangst_rollen — nieuwe Module-aligned naam
-- ============================================================
-- Body identiek aan boek_ontvangst zoals gedefinieerd in mig 136
-- (laatste definitie in de 127/133/135/136-keten). Alleen functie-naam
-- veranderd. Geen claim-consume nodig — claims zijn alleen op
-- eenheid=stuks per ADR-0015.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT) AS $$
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
      status, inkooporder_regel_id, reststuk_datum
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW()
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Body '
  'identiek aan boek_ontvangst (mig 136, laatste in 127/133/135/136-keten). '
  'Geen claim-consume (claims zijn alleen op eenheid=stuks). ADR-0016, mig 271.';

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT) TO authenticated;

-- ============================================================
-- 3. DEPRECATED thin wrappers — 1 release lang
-- ============================================================
-- Verwijderen in vervolg-migratie nadat alle callers (frontend, Python) omgezet zijn.

CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
  PERFORM boek_inkooporder_ontvangst_stuks(p_regel_id, p_aantal, p_medewerker);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'DEPRECATED (ADR-0016, mig 271): thin wrapper rondom '
  'boek_inkooporder_ontvangst_stuks. Verwijderen in vervolg-migratie '
  'nadat callers zijn omgezet.';

CREATE OR REPLACE FUNCTION boek_ontvangst(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT) AS $$
BEGIN
  RETURN QUERY SELECT * FROM boek_inkooporder_ontvangst_rollen(p_regel_id, p_rollen, p_medewerker);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_ontvangst(BIGINT, JSONB, TEXT) IS
  'DEPRECATED (ADR-0016, mig 271): thin wrapper rondom '
  'boek_inkooporder_ontvangst_rollen. Verwijderen in vervolg-migratie '
  'nadat callers zijn omgezet.';

-- ============================================================
-- 4. Grants
-- ============================================================
-- Nieuwe functies hierboven al GRANT'ed direct na hun definitie.
-- Oude functies behouden hun grants via CREATE OR REPLACE (wijzigt grants niet).

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Smoke-test (na deployment in SQL Editor)
-- ============================================================
-- 1. Verifieer nieuwe functies bestaan:
--    SELECT routine_name FROM information_schema.routines
--     WHERE routine_schema='public' AND routine_name LIKE 'boek_inkooporder%';
--    Verwacht: 2 rijen (boek_inkooporder_ontvangst_stuks, boek_inkooporder_ontvangst_rollen).
--
-- 2. Verifieer oude wrappers nog werken:
--    SELECT routine_name FROM information_schema.routines
--     WHERE routine_schema='public' AND routine_name IN ('boek_voorraad_ontvangst', 'boek_ontvangst');
--    Verwacht: 2 rijen (DEPRECATED).
--
-- 3. Sanity-check signatures:
--    SELECT routine_name, pg_get_function_arguments(p.oid) AS args,
--           pg_get_function_result(p.oid) AS rettype
--      FROM information_schema.routines r
--      JOIN pg_proc p ON p.proname = r.routine_name
--     WHERE r.routine_schema='public'
--       AND r.routine_name IN ('boek_inkooporder_ontvangst_stuks',
--                              'boek_inkooporder_ontvangst_rollen',
--                              'boek_voorraad_ontvangst',
--                              'boek_ontvangst')
--     ORDER BY routine_name;

DO $$
BEGIN
  RAISE NOTICE 'Migratie 271 toegepast: Inkoop-Module RPC-rename (ADR-0016).';
  RAISE NOTICE '  + boek_inkooporder_ontvangst_stuks (NIEUW, body identiek aan boek_voorraad_ontvangst mig 254)';
  RAISE NOTICE '  + boek_inkooporder_ontvangst_rollen (NIEUW, body identiek aan boek_ontvangst mig 136)';
  RAISE NOTICE '  ~ boek_voorraad_ontvangst (DEPRECATED thin wrapper)';
  RAISE NOTICE '  ~ boek_ontvangst (DEPRECATED thin wrapper)';
  RAISE NOTICE 'Callers (frontend, Python-import) blijven werken via wrappers tot Task 11+.';
END $$;
