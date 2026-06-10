-- Migratie 353: maatwerk-artikel-koppeling — backfill karpi_code + herstel 3 orderregels
--
-- Aanleiding (eigenaar-melding n.a.v. ORD-2026-0166): maatwerk-orderregels uit
-- Shopify/Lightspeed landden soms ZONDER artikelnr, terwijl de catalogus per
-- (kwaliteit, kleur) een generiek maatwerk-artikel heeft (omschrijving
-- `{KWAL}{KLEUR}MAATWERK`, bv. LAGO13MAATWERK = 553139998). Facturatie en EDI
-- lezen artikelnr — maatwerk moet dus altijd aan een productcode hangen.
--
-- Drie onderdelen:
--   (a) Backfill `producten.karpi_code` op generieke MAATWERK-artikelen
--       (oud-systeem-import zette die nooit; daardoor miste óók de
--       karpi_code-matchstap in product-matcher.ts). Met dubbel-guard:
--       waarden die al ergens als karpi_code bestaan of binnen de
--       kandidaten-set dubbel zouden worden, worden geskipt + NOTICE.
--   (b) Herstel ORD-2026-0118 regel 1+2 (LAGO/13, vorm organisch_b_sp,
--       artikelnr NULL door het vorm-pad dat vóór deze fix-package bewust
--       null teruggaf) → artikelnr van product 'LAGO13MAATWERK' (lookup).
--   (c) Herstel ORD-2026-0098 regel 1: maatwerk_kwaliteit_code 'LUXR17'
--       (kwaliteit+kleur aaneengeplakt door import_shopify_csv.py-regex
--       `^([A-Z]+\d*)`) → 'LUXR' + kleur '17', plus artikelnr via lookup
--       'LUXR17MAATWERK'.
--
-- Idempotent: alle updates raken alleen rijen die nog fout staan
-- (artikelnr IS NULL resp. kwaliteit nog 'LUXR17'); herdraaien = no-op.
-- Geen aannames over row counts: ontbrekende orders/producten → NOTICE+skip.
-- RAISE EXCEPTION alleen voor condities die deze migratie zelf controleert
-- (de kwaliteit-split die niet zou landen).

-- ============================================================================
-- (a) Backfill karpi_code op generieke maatwerk-artikelen
-- ============================================================================
DO $$
DECLARE
  v_unique_idx     BOOLEAN;
  v_kandidaten     INT;
  v_updated        INT;
  v_geskipt        INT;
  v_skip_voorbeeld TEXT;
BEGIN
  -- Informatief: bestaat er een unique index/constraint op producten.karpi_code?
  -- De duplicaat-guard hieronder draait hoe dan ook (goedkoop en veilig).
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
    WHERE t.relname = 'producten'
      AND i.indisunique
      AND a.attname = 'karpi_code'
  ) INTO v_unique_idx;
  RAISE NOTICE 'Mig 353a: unique index op producten.karpi_code aanwezig: %', v_unique_idx;

  DROP TABLE IF EXISTS _mig353_kandidaten;
  CREATE TEMP TABLE _mig353_kandidaten ON COMMIT DROP AS
  SELECT artikelnr, kwaliteit_code || kleur_code AS nieuwe_code
  FROM producten
  WHERE (karpi_code IS NULL OR karpi_code = '')
    AND omschrijving ILIKE '%MAATWERK'
    AND kwaliteit_code IS NOT NULL AND kleur_code IS NOT NULL
    AND is_pseudo = FALSE;

  SELECT COUNT(*) INTO v_kandidaten FROM _mig353_kandidaten;

  -- Skip-voorbeeld VÓÓR de update bepalen: na de update zou de EXISTS-check
  -- ook de zojuist gevulde rijen zelf matchen en alles als "geskipt" tonen.
  SELECT string_agg(s.artikelnr || '->' || s.nieuwe_code, ', ') INTO v_skip_voorbeeld
  FROM (
    SELECT k.artikelnr, k.nieuwe_code
    FROM _mig353_kandidaten k
    WHERE EXISTS (SELECT 1 FROM producten p2 WHERE p2.karpi_code = k.nieuwe_code)
       OR (SELECT COUNT(*) FROM _mig353_kandidaten k2 WHERE k2.nieuwe_code = k.nieuwe_code) > 1
    LIMIT 20
  ) s;

  -- Duplicaat-guard: skip codes die al als karpi_code bestaan, of die binnen
  -- de kandidaten-set zelf meermaals voorkomen (twee MAATWERK-producten met
  -- dezelfde kwaliteit+kleur zouden anders dezelfde code krijgen).
  UPDATE producten p
  SET karpi_code = k.nieuwe_code
  FROM _mig353_kandidaten k
  WHERE p.artikelnr = k.artikelnr
    AND NOT EXISTS (SELECT 1 FROM producten p2 WHERE p2.karpi_code = k.nieuwe_code)
    AND (SELECT COUNT(*) FROM _mig353_kandidaten k2 WHERE k2.nieuwe_code = k.nieuwe_code) = 1;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  v_geskipt := v_kandidaten - v_updated;
  RAISE NOTICE 'Mig 353a: % kandidaten, % karpi_codes backfilled, % geskipt (duplicaat-guard)',
    v_kandidaten, v_updated, v_geskipt;

  IF v_geskipt > 0 THEN
    RAISE NOTICE 'Mig 353a: geskipte codes (max 20): %', v_skip_voorbeeld;
  END IF;
END $$;

-- ============================================================================
-- (b) ORD-2026-0118 regel 1+2 → artikelnr van LAGO13MAATWERK
-- ============================================================================
DO $$
DECLARE
  v_order_id  BIGINT;
  v_artikelnr TEXT;
  v_updated   INT;
BEGIN
  SELECT o.id INTO v_order_id FROM orders o WHERE o.order_nr = 'ORD-2026-0118';
  IF v_order_id IS NULL THEN
    RAISE NOTICE 'Mig 353b: ORD-2026-0118 niet gevonden — skip (niets te herstellen op deze omgeving)';
    RETURN;
  END IF;

  SELECT p.artikelnr INTO v_artikelnr
  FROM producten p WHERE p.omschrijving ILIKE 'LAGO13MAATWERK' LIMIT 1;
  IF v_artikelnr IS NULL THEN
    RAISE NOTICE 'Mig 353b: product LAGO13MAATWERK niet gevonden — skip artikelnr-herstel ORD-2026-0118';
    RETURN;
  END IF;

  UPDATE order_regels r
  SET artikelnr = v_artikelnr
  WHERE r.order_id = v_order_id
    AND r.regelnummer IN (1, 2)
    AND r.is_maatwerk
    AND r.artikelnr IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Mig 353b: ORD-2026-0118 — % regel(s) gekoppeld aan % (LAGO13MAATWERK)', v_updated, v_artikelnr;
END $$;

-- ============================================================================
-- (c) ORD-2026-0098 regel 1 → kwaliteit-split LUXR/17 + artikelnr LUXR17MAATWERK
-- ============================================================================
DO $$
DECLARE
  v_order_id  BIGINT;
  v_artikelnr TEXT;
  v_updated   INT;
  v_fout_kwal INT;
BEGIN
  SELECT o.id INTO v_order_id FROM orders o WHERE o.order_nr = 'ORD-2026-0098';
  IF v_order_id IS NULL THEN
    RAISE NOTICE 'Mig 353c: ORD-2026-0098 niet gevonden — skip (niets te herstellen op deze omgeving)';
    RETURN;
  END IF;

  -- Kwaliteit/kleur-split: altijd toepassen, ongeacht of het artikel bestaat.
  UPDATE order_regels r
  SET maatwerk_kwaliteit_code = 'LUXR',
      maatwerk_kleur_code     = '17'
  WHERE r.order_id = v_order_id
    AND r.regelnummer = 1
    AND r.maatwerk_kwaliteit_code = 'LUXR17';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Mig 353c: ORD-2026-0098 regel 1 — kwaliteit-split toegepast op % rij(en) (0 = al gefixt)', v_updated;

  -- Zelf-test op de conditie die deze migratie zelf controleert: na de update
  -- mag de samengeplakte code niet meer bestaan op deze regel.
  SELECT COUNT(*) INTO v_fout_kwal
  FROM order_regels r
  WHERE r.order_id = v_order_id
    AND r.regelnummer = 1
    AND r.maatwerk_kwaliteit_code = 'LUXR17';
  IF v_fout_kwal > 0 THEN
    RAISE EXCEPTION 'FAAL mig 353c: kwaliteit-split niet geland — ORD-2026-0098 regel 1 heeft nog LUXR17';
  END IF;

  -- Artikelnr via lookup; product kan ontbreken → NOTICE + skip (geen fail).
  SELECT p.artikelnr INTO v_artikelnr
  FROM producten p WHERE p.omschrijving ILIKE 'LUXR17MAATWERK' LIMIT 1;
  IF v_artikelnr IS NULL THEN
    RAISE NOTICE 'Mig 353c: product LUXR17MAATWERK niet gevonden — artikelnr blijft NULL op ORD-2026-0098 regel 1';
    RETURN;
  END IF;

  UPDATE order_regels r
  SET artikelnr = v_artikelnr
  WHERE r.order_id = v_order_id
    AND r.regelnummer = 1
    AND r.is_maatwerk
    AND r.artikelnr IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Mig 353c: ORD-2026-0098 regel 1 — % regel(s) gekoppeld aan % (LUXR17MAATWERK)', v_updated, v_artikelnr;
END $$;

-- ============================================================================
-- Zelf-test (informatief): geen maatwerk-regel zonder artikelnr meer op de
-- twee herstelde orders. Géén EXCEPTION — een ontbrekend catalogus-product
-- is geen conditie die deze migratie controleert (zie NOTICE-skips hierboven).
-- ============================================================================
DO $$
DECLARE
  v_rest INT;
  v_detail TEXT;
BEGIN
  SELECT COUNT(*), string_agg(o.order_nr || ' regel ' || r.regelnummer, ', ')
  INTO v_rest, v_detail
  FROM order_regels r
  JOIN orders o ON o.id = r.order_id
  WHERE o.order_nr IN ('ORD-2026-0098', 'ORD-2026-0118')
    AND r.is_maatwerk
    AND r.artikelnr IS NULL;

  IF v_rest = 0 THEN
    RAISE NOTICE 'Mig 353: zelf-test OK — geen maatwerk-regels zonder artikelnr meer op ORD-2026-0098/0118';
  ELSE
    RAISE NOTICE 'Mig 353: LET OP — nog % maatwerk-regel(s) zonder artikelnr: % (zie skip-NOTICEs hierboven)', v_rest, v_detail;
  END IF;
END $$;
