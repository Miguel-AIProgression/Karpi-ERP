-- Zelf-test voor handmatige rol-CRUD (mig 291-293). Draai in de Supabase
-- SQL-editor. Verwacht: alle RAISE NOTICE eindigen op "OK", dan
-- "ALLE TESTS GESLAAGD". ROLLBACK aan het eind — geen data-mutatie.
BEGIN;

-- Seed: een rol-product (eenheid m). Hergebruik een bestaand artikel als het
-- er is; anders minimaal record. We gebruiken een vast test-artikelnr.
-- producten.kwaliteit_code heeft een FK naar kwaliteiten — eerst de
-- test-kwaliteit seeden (collectie_id mag NULL).
INSERT INTO kwaliteiten (code, omschrijving)
VALUES ('TST', 'TEST KWALITEIT (rol-crud zelftest)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO producten (artikelnr, karpi_code, omschrijving, verkoopprijs,
                       kwaliteit_code, kleur_code, zoeksleutel, product_type, actief)
VALUES ('TESTROLCRUD01', 'TESTROLCRUD01', 'TEST ROL CRUD', 10.00,
        'TST', '99', 'TST_99', 'rol', true)
ON CONFLICT (artikelnr) DO NOTHING;

DO $$
DECLARE
  v_rol_id BIGINT;
  v_rolnr  TEXT;
  v_opp    NUMERIC;
  v_audit  RECORD;
BEGIN
  -- 1. Toevoegen met expliciete in_magazijn_sinds + auto rolnummer.
  SELECT rol_id, rolnummer INTO v_rol_id, v_rolnr
  FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01', 'volle_rol'::rol_type, 1500, 400, NULL,
    DATE '2025-01-10', NULL, 'inventarisatie telfout', 'tester');
  ASSERT v_rol_id IS NOT NULL, 'toevoegen gaf geen rol_id';
  ASSERT v_rolnr LIKE 'CORR-TESTROLCRUD01-%', 'auto-rolnummer onverwacht: ' || v_rolnr;

  SELECT oppervlak_m2 INTO v_opp FROM rollen WHERE id = v_rol_id;
  ASSERT v_opp = ROUND(1500*400/10000.0, 2), 'oppervlak onjuist: ' || v_opp;
  RAISE NOTICE 'toevoegen-basis: OK';

  -- 2. in_magazijn_sinds exact opgeslagen.
  ASSERT (SELECT in_magazijn_sinds FROM rollen WHERE id = v_rol_id) = DATE '2025-01-10',
    'in_magazijn_sinds niet opgeslagen';
  RAISE NOTICE 'toevoegen-fifo-datum: OK';

  -- 3. Auditregel aanwezig met juiste delta.
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'toevoegen';
  ASSERT v_audit.id IS NOT NULL, 'geen auditregel voor toevoegen';
  ASSERT v_audit.oppervlak_delta_m2 = v_opp, 'audit-delta onjuist';
  ASSERT v_audit.reden = 'inventarisatie telfout', 'audit-reden onjuist';
  RAISE NOTICE 'toevoegen-audit: OK';

  -- 4. Lege reden geweigerd.
  BEGIN
    PERFORM rol_handmatig_toevoegen('TESTROLCRUD01','volle_rol'::rol_type,
      100,100,NULL,NULL,NULL,'   ','tester');
    RAISE EXCEPTION 'lege reden had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%reden%', 'verkeerde fout bij lege reden: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-lege-reden-geweigerd: OK';

  -- 5. Onbekend artikelnr geweigerd.
  BEGIN
    PERFORM rol_handmatig_toevoegen('BESTAATNIET','volle_rol'::rol_type,
      100,100,NULL,NULL,NULL,'x','tester');
    RAISE EXCEPTION 'onbekend artikel had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%TESTROLCRUD%' OR SQLERRM ILIKE '%artikel%',
      'verkeerde fout bij onbekend artikel: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-onbekend-artikel-geweigerd: OK';

  RAISE NOTICE 'TASK2 TESTS GESLAAGD';
END $$;

DO $$
DECLARE
  v_rol_id BIGINT;
  v_opp_voor NUMERIC;
  v_opp_na   NUMERIC;
  v_audit  RECORD;
BEGIN
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed voor bewerken', 'tester');
  SELECT oppervlak_m2 INTO v_opp_voor FROM rollen WHERE id = v_rol_id;

  -- 1. Afmeting wijzigen herberekent oppervlak + auditregel met delta.
  PERFORM rol_handmatig_bewerken(v_rol_id, 1200, 400, NULL, 'beschikbaar',
    'meting gecorrigeerd', 'tester');
  SELECT oppervlak_m2 INTO v_opp_na FROM rollen WHERE id = v_rol_id;
  ASSERT v_opp_na = ROUND(1200*400/10000.0,2), 'oppervlak na bewerken onjuist';
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'bewerken';
  ASSERT v_audit.oppervlak_delta_m2 = v_opp_na - v_opp_voor, 'bewerk-delta onjuist';
  ASSERT v_audit.oud_json IS NOT NULL AND v_audit.nieuw_json IS NOT NULL,
    'oud/nieuw_json ontbreekt';
  RAISE NOTICE 'bewerken-afmeting+audit: OK';

  -- 2. Negatieve delta (kleiner maken).
  PERFORM rol_handmatig_bewerken(v_rol_id, 800, 400, NULL, 'beschikbaar',
    'krimp', 'tester');
  ASSERT (SELECT oppervlak_m2 FROM rollen WHERE id = v_rol_id)
       = ROUND(800*400/10000.0,2), 'negatieve delta onjuist';
  RAISE NOTICE 'bewerken-negatieve-delta: OK';

  -- 3. Status naar in_snijplan geweigerd.
  BEGIN
    PERFORM rol_handmatig_bewerken(v_rol_id, 800, 400, NULL, 'in_snijplan',
      'mag niet', 'tester');
    RAISE EXCEPTION 'status in_snijplan had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%in_snijplan%' OR SQLERRM ILIKE '%status%',
      'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'bewerken-status-geweigerd: OK';

  -- 4. Bewerken van een gereserveerde rol geweigerd.
  UPDATE rollen SET status = 'gereserveerd' WHERE id = v_rol_id;
  BEGIN
    PERFORM rol_handmatig_bewerken(v_rol_id, 900, 400, NULL, 'beschikbaar',
      'mag niet', 'tester');
    RAISE EXCEPTION 'bewerken gereserveerde rol had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%gereserveerd%' OR SQLERRM ILIKE '%snijplan%'
        OR SQLERRM ILIKE '%niet bewerk%', 'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'bewerken-gereserveerde-rol-geweigerd: OK';

  RAISE NOTICE 'TASK3 TESTS GESLAAGD';
END $$;

DO $$
DECLARE
  v_rol_id BIGINT;
  v_audit  RECORD;
BEGIN
  -- 1. Beschikbare rol mag verwijderd; auditregel blijft (rol_id behouden).
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed voor verwijderen', 'tester');
  PERFORM rol_verwijderen(v_rol_id, 'fysiek verlies', 'tester');
  ASSERT NOT EXISTS (SELECT 1 FROM rollen WHERE id = v_rol_id),
    'rol niet verwijderd';
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'verwijderen';
  ASSERT v_audit.id IS NOT NULL, 'geen auditregel voor verwijderen';
  ASSERT v_audit.oud_json IS NOT NULL, 'oud_json ontbreekt bij verwijderen';
  RAISE NOTICE 'verwijderen-beschikbaar+audit: OK';

  -- 2. Gereserveerde rol geweigerd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed gereserveerd', 'tester');
  UPDATE rollen SET status = 'gereserveerd' WHERE id = v_rol_id;
  BEGIN
    PERFORM rol_verwijderen(v_rol_id, 'mag niet', 'tester');
    RAISE EXCEPTION 'verwijderen gereserveerde rol had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%gereserveerd%' OR SQLERRM ILIKE '%niet verwijderd%',
      'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'verwijderen-gereserveerd-geweigerd: OK';

  -- 3. Los reststuk (status reststuk) zonder snijplan mag verwijderd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','reststuk'::rol_type, 80, 400, NULL,
    NULL, NULL, 'seed reststuk', 'tester');
  UPDATE rollen SET status = 'reststuk' WHERE id = v_rol_id;
  PERFORM rol_verwijderen(v_rol_id, 'reststuk opgeruimd', 'tester');
  ASSERT NOT EXISTS (SELECT 1 FROM rollen WHERE id = v_rol_id),
    'los reststuk niet verwijderd';
  RAISE NOTICE 'verwijderen-los-reststuk: OK';

  -- 4. Lege reden geweigerd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 500, 400, NULL,
    NULL, NULL, 'seed lege reden', 'tester');
  BEGIN
    PERFORM rol_verwijderen(v_rol_id, '  ', 'tester');
    RAISE EXCEPTION 'lege reden had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%reden%', 'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'verwijderen-lege-reden-geweigerd: OK';

  RAISE NOTICE 'ALLE TESTS GESLAAGD';
END $$;

ROLLBACK;
