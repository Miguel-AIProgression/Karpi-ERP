-- Zelf-test voor handmatige rol-CRUD (mig 291-293). Draai in de Supabase
-- SQL-editor. Verwacht: alle RAISE NOTICE eindigen op "OK", dan
-- "ALLE TESTS GESLAAGD". ROLLBACK aan het eind — geen data-mutatie.
BEGIN;

-- Seed: een rol-product (eenheid m). Hergebruik een bestaand artikel als het
-- er is; anders minimaal record. We gebruiken een vast test-artikelnr.
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

  SELECT oppervlak_m2, in_magazijn_sinds INTO v_opp, v_audit
  FROM rollen WHERE id = v_rol_id;
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
    ASSERT SQLERRM LIKE '%reden%', 'verkeerde fout bij lege reden: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-lege-reden-geweigerd: OK';

  -- 5. Onbekend artikelnr geweigerd.
  BEGIN
    PERFORM rol_handmatig_toevoegen('BESTAATNIET','volle_rol'::rol_type,
      100,100,NULL,NULL,NULL,'x','tester');
    RAISE EXCEPTION 'onbekend artikel had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%TESTROLCRUD%' OR SQLERRM LIKE '%artikel%',
      'verkeerde fout bij onbekend artikel: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-onbekend-artikel-geweigerd: OK';

  RAISE NOTICE 'TASK2 TESTS GESLAAGD';
END $$;

ROLLBACK;
