-- Migratie 332: import_productie_only_order koppelt nu een product (artikelnr)
--
-- ACHTERGROND
-- Mig 329 liet order_regels.artikelnr bewust NULL ("productie-only heeft geen echt
-- artikel"). Gevolg: in de order-detail bleven Artikel + Karpi-code leeg, terwijl een
-- maatwerk-regel hoort te verwijzen naar het 'rol'-broadloomproduct (zelfde patroon
-- als auto_markeer_maatwerk: product_type='rol' => is_maatwerk). Deze migratie zoekt
-- per regel het matchende 'rol'-product op (kwaliteit_code + genormaliseerde kleur)
-- en vult artikelnr. Geen match (product ontbreekt) => artikelnr blijft NULL (zoals
-- voorheen) -- onschadelijk, mig 094 zet dan heeft_unmatched_regels.
--
-- VEILIG: artikelnr zetten op een maatwerk-regel vuurt trg_orderregel_herallocateer,
-- maar herallocateer_orderregel (mig 297) doet bij is_maatwerk=TRUE enkel claim-release
-- + RETURN -- geen voorraad/IO-claims. (De bestaande regels worden los ge-fixt via
-- scripts/fix_productie_only_artikelnr.sql; deze migratie dekt toekomstige imports.)
--
-- Idempotentie / status / debiteur-fallback: ongewijzigd t.o.v. mig 329.

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
$$;

COMMENT ON FUNCTION import_productie_only_order(JSONB, JSONB) IS
  'Idempotente import van een Basta-productie-order (mig 329, mig 332). '
  'Mig 332: koppelt per regel het matchende rol-broadloomproduct (artikelnr) op '
  '(kwaliteit_code + genormaliseerde kleur); geen match => artikelnr NULL. '
  'is_maatwerk=TRUE => allocator (mig 297) reserveert niets. Roept geen factuur/verzending aan.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- SMOKE-TEST: idempotentie + graceful NULL bij onbekende (kwaliteit, kleur).
-- 'ZZZZ' bestaat gegarandeerd niet als rol-product => artikelnr blijft NULL.
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  v_art TEXT;
BEGIN
  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999992, "afleverdatum": "2026-06-15"}'::jsonb,
    '[{"regelnummer":1,"orderaantal":1,
       "maatwerk_kwaliteit_code":"ZZZZ","maatwerk_kleur_code":"01",
       "maatwerk_lengte_cm":200,"maatwerk_breedte_cm":300,
       "maatwerk_afwerking":"B","maatwerk_vorm":"rechthoek"}]'::jsonb
  );
  ASSERT r.was_existing = false, 'Mig 332: eerste import was_existing=false verwacht';

  SELECT orr.artikelnr INTO v_art
    FROM order_regels orr JOIN orders o ON o.id = orr.order_id
   WHERE o.oud_order_nr = 99999992;
  ASSERT v_art IS NULL, 'Mig 332: onbekende kwaliteit => artikelnr NULL verwacht';

  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999992}'::jsonb, '[]'::jsonb);
  ASSERT r.was_existing = true, 'Mig 332: her-import was_existing=true verwacht';

  DELETE FROM snijplannen WHERE order_regel_id IN (
    SELECT orr.id FROM order_regels orr JOIN orders o ON o.id = orr.order_id
     WHERE o.oud_order_nr = 99999992);
  DELETE FROM orders WHERE oud_order_nr = 99999992;

  RAISE NOTICE 'Mig 332 OK: artikelnr-koppeling + idempotentie geverifieerd.';
END $$;
