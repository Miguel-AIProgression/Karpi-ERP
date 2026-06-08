-- Migratie 329: RPC import_productie_only_order — idempotente import van één Basta-order.
--
-- DOEL
-- Eén call per Basta-order: maakt order + order_regels aan. De bestaande
-- AFTER-INSERT-trigger auto_maak_snijplan (mig 274 + 328) maakt per maatwerk-stuk
-- automatisch een snijplan aan. Factuur/verzending/allocatie worden NIET aangeroepen
-- — productie-only orders zijn niet op Karpi-voorraad/inkoop geclaimd; facturatie
-- loopt via Basta.
--
-- IDEMPOTENTIE
-- Sleutel: orders.oud_order_nr (UNIQUE partial index uit mig 327).
-- Al bestaan? → retourneer de bestaande order_nr + was_existing=true zonder iets te schrijven.
--
-- STATUS
-- Direct INSERT met status='In productie' (geldige legacy-enum, zie CLAUDE.md).
-- Dit omzeilt de _apply_transitie-guard. Zie "Concern _apply_transitie" onderaan.
--
-- SMOKE-TEST
-- DO-blok onderaan valideert idempotentie én snijplan-aanmaak bij Miguels eerste run.
-- Cleanup-volgorde: eerst snijplannen (FK RESTRICT), dan orders (CASCADE → order_regels).
--
-- Zie ADR-0029 / docs/superpowers/plans/2026-06-08-productie-only-import-en-snijplanning.md

-- ============================================================================
-- RPC: import_productie_only_order
-- ============================================================================
--
-- p_header JSONB:
--   oud_order_nr   BIGINT  verplicht — Basta-ordernummer; idempotentie-sleutel
--   debiteur_nr    INT     optioneel — als NULL of onbekend → verzameldebiteur 900000
--   debiteur_naam  TEXT    optioneel — informatief, niet opgeslagen
--   orderdatum     DATE    optioneel — default CURRENT_DATE
--   afleverdatum   DATE    optioneel — mag NULL zijn (spec: nullable)
--
-- p_regels JSONB-array, per element:
--   regelnummer              INT     default 1
--   omschrijving             TEXT    default 'Maatwerk'
--   orderaantal              INT     default 1
--   maatwerk_kwaliteit_code  TEXT    optioneel
--   maatwerk_kleur_code      TEXT    optioneel
--   maatwerk_lengte_cm       INT     optioneel — nodig voor auto_maak_snijplan
--   maatwerk_breedte_cm      INT     optioneel — nodig voor auto_maak_snijplan
--   maatwerk_afwerking       TEXT    optioneel — FK-veilige code (B/SB/FE/SF/LO/VO/ON/ZO)
--   maatwerk_vorm            TEXT    optioneel — 'rechthoek'|'rond'|'ovaal'|NULL
--   snijden_uit_standaardmaat BOOL   default false
--   maatwerk_instructies     TEXT    optioneel
--
-- Returns: TABLE(order_nr TEXT, was_existing BOOLEAN)

CREATE OR REPLACE FUNCTION import_productie_only_order(p_header JSONB, p_regels JSONB)
RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oud_nr   BIGINT  := (p_header->>'oud_order_nr')::BIGINT;
  v_deb_in   INTEGER := NULLIF(p_header->>'debiteur_nr', '')::INTEGER;
  v_deb      INTEGER;
  v_order_id BIGINT;
  v_order_nr TEXT;
  v_regel    JSONB;
BEGIN
  -- Validatie: oud_order_nr is verplicht (idempotentie-sleutel).
  IF v_oud_nr IS NULL THEN
    RAISE EXCEPTION 'import_productie_only_order: oud_order_nr verplicht';
  END IF;

  -- Idempotentie: bestaat deze Basta-order al? Dan niets doen.
  SELECT o.id, o.order_nr
    INTO v_order_id, v_order_nr
    FROM orders o
   WHERE o.oud_order_nr = v_oud_nr;

  IF FOUND THEN
    RETURN QUERY SELECT v_order_nr, true;
    RETURN;
  END IF;

  -- Debiteur: gebruik echte debiteur als die bestaat, anders verzameldebiteur 900000.
  SELECT d.debiteur_nr
    INTO v_deb
    FROM debiteuren d
   WHERE d.debiteur_nr = v_deb_in;

  IF NOT FOUND THEN
    v_deb := 900000;
  END IF;

  v_order_nr := 'OUD-' || v_oud_nr::TEXT;

  -- Order aanmaken. Directe INSERT met status='In productie' (bewuste keuze — zie
  -- concern _apply_transitie in het kopregelblok). lever_type verplicht NOT NULL DEFAULT
  -- 'week'; wij zetten expliciet voor leesbaarheid.
  INSERT INTO orders (
    order_nr,
    debiteur_nr,
    orderdatum,
    afleverdatum,
    status,
    bron_systeem,
    oud_order_nr,
    alleen_productie,
    lever_type
  )
  VALUES (
    v_order_nr,
    v_deb,
    COALESCE((p_header->>'orderdatum')::DATE, CURRENT_DATE),
    (p_header->>'afleverdatum')::DATE,           -- nullable per spec
    'In productie'::order_status,
    'oud_systeem',
    v_oud_nr,
    true,
    'week'::lever_type
  )
  RETURNING id INTO v_order_id;

  -- Order_regels: één INSERT per element uit p_regels.
  -- De AFTER-INSERT-trigger auto_maak_snijplan (mig 274 + 328) maakt per maatwerk-stuk
  -- automatisch een snijplan aan (status 'Wacht'), inclusief snijden_uit_standaardmaat.
  -- artikelnr wordt NIET gevuld (productie-only heeft geen echt artikel);
  -- trigger mig 094 zet dan heeft_unmatched_regels=TRUE op de order — onschadelijk.
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    INSERT INTO order_regels (
      order_id,
      regelnummer,
      omschrijving,
      orderaantal,
      te_leveren,
      is_maatwerk,
      maatwerk_kwaliteit_code,
      maatwerk_kleur_code,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
      maatwerk_afwerking,
      maatwerk_vorm,
      snijden_uit_standaardmaat,
      maatwerk_instructies,
      productie_groep
    )
    VALUES (
      v_order_id,
      COALESCE((v_regel->>'regelnummer')::INTEGER, 1),
      COALESCE(v_regel->>'omschrijving', 'Maatwerk'),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),  -- te_leveren = orderaantal
      true,
      v_regel->>'maatwerk_kwaliteit_code',
      v_regel->>'maatwerk_kleur_code',
      (v_regel->>'maatwerk_lengte_cm')::INTEGER,
      (v_regel->>'maatwerk_breedte_cm')::INTEGER,
      NULLIF(v_regel->>'maatwerk_afwerking', ''),       -- FK → afwerking_types; NULL of geldige code
      NULLIF(v_regel->>'maatwerk_vorm', ''),             -- FK → maatwerk_vormen; NULL of geldige code
      COALESCE((v_regel->>'snijden_uit_standaardmaat')::BOOLEAN, false),
      v_regel->>'maatwerk_instructies',
      -- productie_groep: kwaliteit + kleur als korte groepeer-sleutel voor de snijplanner.
      COALESCE(v_regel->>'maatwerk_kwaliteit_code', '') || COALESCE(v_regel->>'maatwerk_kleur_code', '')
    );
  END LOOP;

  RETURN QUERY SELECT v_order_nr, false;
END;
$$;

COMMENT ON FUNCTION import_productie_only_order(JSONB, JSONB) IS
  'Idempotente import van één Basta-productie-order (mig 329 / ADR-0029). '
  'Sleutel: orders.oud_order_nr. Al aanwezig → retourneert was_existing=true zonder schrijven. '
  'De AFTER-INSERT-trigger auto_maak_snijplan (mig 274+328) maakt per maatwerk-regel '
  'automatisch snijplannen aan. Roept geen allocator / _apply_transitie aan (bewust).';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- SMOKE-TEST (DO-blok): valideert idempotentie + snijplan-aanmaak bij eerste run.
-- Draait automatisch als onderdeel van de migratie.
--
-- CLEANUP-VOLGORDE (belangrijk):
--   snijplannen.order_regel_id FK → order_regels heeft GEEN ON DELETE CASCADE
--   (plain FK = RESTRICT). Directe DELETE FROM orders faalt dus als er snijplannen
--   bestaan. Correcte volgorde:
--     1. DELETE FROM snijplannen WHERE order_regel_id IN (regels van testorder)
--     2. DELETE FROM orders WHERE oud_order_nr = 99999991
--        → CASCADE verwijdert de order_regels automatisch
-- ============================================================================
DO $$
DECLARE
  r    RECORD;
  v_n1 TEXT;
BEGIN
  -- Stap 1: eerste import — moet nieuw zijn.
  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999991, "debiteur_nr": null, "afleverdatum": "2026-06-15"}'::jsonb,
    '[{"regelnummer":1,"omschrijving":"TEST","orderaantal":1,
       "maatwerk_kwaliteit_code":"TEST","maatwerk_kleur_code":"01",
       "maatwerk_lengte_cm":200,"maatwerk_breedte_cm":300,
       "maatwerk_afwerking":"B","maatwerk_vorm":"rechthoek",
       "snijden_uit_standaardmaat":false}]'::jsonb
  );
  v_n1 := r.order_nr;
  ASSERT r.was_existing = false,
    'Mig 329 smoke-test: eerste import moet was_existing=false geven';

  -- Stap 2: auto_maak_snijplan moet precies 1 snijplan hebben aangemaakt.
  ASSERT (
    SELECT count(*)
      FROM snijplannen sp
      JOIN order_regels orr ON orr.id = sp.order_regel_id
      JOIN orders o          ON o.id  = orr.order_id
     WHERE o.oud_order_nr = 99999991
  ) = 1,
    'Mig 329 smoke-test: auto_maak_snijplan moet precies 1 snijplan aanmaken';

  -- Stap 3: idempotentie — tweede import met zelfde oud_order_nr.
  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999991, "afleverdatum": "2026-06-15"}'::jsonb,
    '[]'::jsonb
  );
  ASSERT r.was_existing = true,
    'Mig 329 smoke-test: tweede import moet was_existing=true geven';
  ASSERT r.order_nr = v_n1,
    'Mig 329 smoke-test: zelfde order_nr bij her-import verwacht';

  -- Opruimen testdata.
  -- Volgorde: eerst snijplannen (FK RESTRICT op order_regel_id), dan orders
  -- (CASCADE verwijdert order_regels automatisch).
  DELETE FROM snijplannen
   WHERE order_regel_id IN (
     SELECT orr.id
       FROM order_regels orr
       JOIN orders o ON o.id = orr.order_id
      WHERE o.oud_order_nr = 99999991
   );
  DELETE FROM orders WHERE oud_order_nr = 99999991;

  RAISE NOTICE 'Mig 329 OK: idempotente import + snijplan-creatie geverifieerd.';
END $$;
