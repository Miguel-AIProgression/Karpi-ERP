-- Migratie 408: Antislip doos-stuks koppeling (Optie A — stuk als basiseenheid)
--
-- Architectuur:
--   • stuks-artikel = bron-van-waarheid voor voorraad (alle stuks staan hier)
--   • doos-artikel  = ordering vehicle; allocator vertaalt automatisch
--     1 doos → stuks_per_doos stuks op het stuks-artikel
--   • Trigger sync: doos.vrije_voorraad = floor(stuks.vrije_voorraad / stuks_per_doos)
--     → bestaande UI/order-form werkt zonder aanpassingen
--   • Inkoop-IOs voor antislip altijd op het STUKS-artikel aanmaken (in stuks)
--
-- Bedrijfsregel:
--   • Sommige klanten ontvangen doos-prijslijst, anderen stuks-prijslijst.
--     De koppeling per klant zit in prijslijst_regels (bestaand mechanisme).
--   • 25%-toeslag voor losse stuks is al verwerkt in verkoopprijs van stuks-artikelen.
--
-- Mapping doos → stuks:
--   900000005 (doos 20 st, 80×150)  → 900000020 | €120/20×1.25 = €7,50/stuk
--   900000006 (doos 15 st, 130×190) → 900000021 | €120/15×1.25 = €10,00/stuk
--   900000000 (doos 12 st, 160×230) → 900000022 | €132/12×1.25 = €13,75/stuk
--   900000001 (doos  8 st, 190×290) → 900000023 | €128/8×1.25  = €20,00/stuk
--   900000009 (doos  5 st, 240×340) → 900000024 | €115/5×1.25  = €28,75/stuk
--   900000015 (doos  4 st, 300×400) → TODO: stuks-artikel 900000025 nog aan te maken
--
-- Stuks-only (geen doos-equivalent):
--   900000018 (Antislip 60×110 cm)  → aparte klant-specifieke maat
--
-- Migraties: herallocateer_orderregel (mig 404 → 408)

-- ============================================================================
-- STAP 1: Kolommen toevoegen aan producten
-- ============================================================================

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS stuks_per_doos INTEGER CHECK (stuks_per_doos > 0),
  ADD COLUMN IF NOT EXISTS stuks_artikelnr TEXT REFERENCES producten(artikelnr) ON UPDATE CASCADE;

-- XOR-constraint: beide gezet of beide NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'check_doos_koppeling_volledig'
      AND table_name = 'producten'
  ) THEN
    ALTER TABLE producten ADD CONSTRAINT check_doos_koppeling_volledig
      CHECK (
        (stuks_artikelnr IS NULL) = (stuks_per_doos IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN producten.stuks_per_doos IS
  'Mig 408: aantal stuks per doos voor doos-artikelen. NULL = geen doos-koppeling. '
  'XOR met stuks_artikelnr: beide gezet of beide NULL (constraint check_doos_koppeling_volledig).';

COMMENT ON COLUMN producten.stuks_artikelnr IS
  'Mig 408: FK naar het corresponderende stuks-artikel. Alleen op doos-artikelen. '
  'Allocator (herallocateer_orderregel) vertaalt doos-orderregel → stuks-artikel × stuks_per_doos. '
  'Voorraad-bron-van-waarheid is ALTIJD het stuks-artikel; doos vrije_voorraad is afgeleid '
  'via trigger trg_sync_doos_vrije_voorraad. IOs altijd op stuks-artikel aanmaken (in stuks).';

-- ============================================================================
-- STAP 2: Stuks-artikelen aanmaken (ON CONFLICT = veilig bij herdraaien)
-- ============================================================================
-- Afleiden van kwaliteit_code, inkoopprijs etc. uit het bestaande doos-artikel.
-- Verkoopprijs = ROUND(doos_prijs / stuks_per_doos * 1.25, 2).

-- 80×150 cm — 20 stuks per doos, doospijs €120
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  karpi_code, lengte_cm, breedte_cm
)
SELECT
  '900000020',
  'Antislip 80x150 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  ROUND((120.00 / 20) * 1.25, 2),  -- €7,50
  ROUND(120.00 / 20, 2),            -- €6,00
  p.karpi_code,
  80,
  150
FROM producten p WHERE p.artikelnr = '900000005'
ON CONFLICT (artikelnr) DO NOTHING;

-- 130×190 cm — 15 stuks per doos, doosprijs €120
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  karpi_code, lengte_cm, breedte_cm
)
SELECT
  '900000021',
  'Antislip 130x190 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  ROUND((120.00 / 15) * 1.25, 2),  -- €10,00
  ROUND(120.00 / 15, 2),            -- €8,00
  p.karpi_code,
  130,
  190
FROM producten p WHERE p.artikelnr = '900000006'
ON CONFLICT (artikelnr) DO NOTHING;

-- 160×230 cm — 12 stuks per doos, doosprijs €132
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  karpi_code, lengte_cm, breedte_cm
)
SELECT
  '900000022',
  'Antislip 160x230 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  ROUND((132.00 / 12) * 1.25, 2),  -- €13,75
  ROUND(132.00 / 12, 2),            -- €11,00
  p.karpi_code,
  160,
  230
FROM producten p WHERE p.artikelnr = '900000000'
ON CONFLICT (artikelnr) DO NOTHING;

-- 190×290 cm — 8 stuks per doos, doosprijs €128
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  karpi_code, lengte_cm, breedte_cm
)
SELECT
  '900000023',
  'Antislip 190x290 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  ROUND((128.00 / 8) * 1.25, 2),   -- €20,00
  ROUND(128.00 / 8, 2),             -- €16,00
  p.karpi_code,
  190,
  290
FROM producten p WHERE p.artikelnr = '900000001'
ON CONFLICT (artikelnr) DO NOTHING;

-- 240×340 cm — 5 stuks per doos, doosprijs €115
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  karpi_code, lengte_cm, breedte_cm
)
SELECT
  '900000024',
  'Antislip 240x340 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  ROUND((115.00 / 5) * 1.25, 2),   -- €28,75
  ROUND(115.00 / 5, 2),             -- €23,00
  p.karpi_code,
  240,
  340
FROM producten p WHERE p.artikelnr = '900000009'
ON CONFLICT (artikelnr) DO NOTHING;

-- 60×110 cm — enkel per stuk (geen doos-equivalent in dit systeem)
INSERT INTO producten (
  artikelnr, omschrijving, product_type, actief,
  kwaliteit_code, kleur_code, zoeksleutel,
  verkoopprijs, inkoopprijs,
  lengte_cm, breedte_cm
)
SELECT
  '900000018',
  'Antislip 60x110 cm',
  'overig',
  true,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  NULL,   -- prijs nader te bepalen (geen doos-referentie)
  NULL,
  60,
  110
FROM producten p WHERE p.artikelnr = '900000005'  -- kwaliteit_code/kleur overnemen van 80×150
ON CONFLICT (artikelnr) DO NOTHING;

-- TODO: 300×400 cm (doos 900000015, 4 stuks, €160/doos → €50/stuk)
-- Stuks-artikel 900000025 apart aanmaken zodra de klant dit gaat afnemen.

-- ============================================================================
-- STAP 3: Doos→stuks koppeling instellen
-- ============================================================================

UPDATE producten SET stuks_artikelnr = '900000020', stuks_per_doos = 20 WHERE artikelnr = '900000005';
UPDATE producten SET stuks_artikelnr = '900000021', stuks_per_doos = 15 WHERE artikelnr = '900000006';
UPDATE producten SET stuks_artikelnr = '900000022', stuks_per_doos = 12 WHERE artikelnr = '900000000';
UPDATE producten SET stuks_artikelnr = '900000023', stuks_per_doos =  8 WHERE artikelnr = '900000001';
UPDATE producten SET stuks_artikelnr = '900000024', stuks_per_doos =  5 WHERE artikelnr = '900000009';
-- 900000015 (300×400) nog geen stuks-artikel → koppeling later toevoegen

-- ============================================================================
-- STAP 4: Trigger — doos vrije_voorraad sync vanuit stuks-artikel
-- ============================================================================
-- Wanneer het stuks-artikel een voorraad/vrije_voorraad-wijziging krijgt,
-- worden alle gekoppelde doos-artikelen automatisch bijgewerkt:
--   doos.voorraad        = floor(stuks.voorraad / stuks_per_doos)
--   doos.vrije_voorraad  = floor(stuks.vrije_voorraad / stuks_per_doos)
--   doos.gereserveerd    = 0 (doos heeft geen eigen claims)
--   doos.backorder       = 0 (backorder loopt via stuks-artikel)
--
-- Dit maakt de doos-artikel beschikbaarheid zichtbaar in de bestaande UI
-- zonder frontend-aanpassingen.
--
-- Anti-cascade: de trigger kijkt bij het bijwerken van een doos-artikel
-- naar `stuks_artikelnr = NEW.artikelnr`. Een doos-artikel heeft zelf
-- geen stuks_artikelnr-rijen die ernaar wijzen → cascade stopt na 1 stap.

CREATE OR REPLACE FUNCTION trg_sync_doos_vrije_voorraad()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_sync_doos_vrije_voorraad IS
  'Mig 408: synct doos-artikel voorraad/vrije_voorraad vanuit het stuks-artikel. '
  'Doos.vrije_voorraad = floor(stuks.vrije_voorraad / stuks_per_doos). '
  'Cascade-safe: doos-artikelen hebben geen eigen reverse-link die de trigger '
  'opnieuw zou activeren.';

DROP TRIGGER IF EXISTS trg_sync_doos_vrije_voorraad ON producten;
CREATE TRIGGER trg_sync_doos_vrije_voorraad
  AFTER UPDATE OF voorraad, vrije_voorraad ON producten
  FOR EACH ROW
  WHEN (
    OLD.voorraad        IS DISTINCT FROM NEW.voorraad OR
    OLD.vrije_voorraad  IS DISTINCT FROM NEW.vrije_voorraad
  )
  EXECUTE FUNCTION trg_sync_doos_vrije_voorraad();

-- ============================================================================
-- STAP 5: herallocateer_orderregel — doos→stuks vertaling
-- ============================================================================
-- Wijziging t.o.v. mig 404: voeg doos→stuks vertaling toe vóór de allocatie-
-- stappen. Als het artikel een stuks_artikelnr heeft (= doos-artikel):
--   • v_artikelnr  := stuks_artikelnr
--   • v_te_leveren := te_leveren × stuks_per_doos
-- De rest van de logica (stap 1, 1.5, 2) werkt ongewijzigd op het stuks-artikel.
-- order_reserveringen krijgt fysiek_artikelnr = stuks_artikelnr.
-- herbereken_product_reservering(stuks_artikelnr) werkt automatisch correct.

CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID AS $$
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
  -- Doos→stuks
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
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- ── Doos→stuks vertaling (mig 408) ────────────────────────────────────────
  -- Als het artikel een doos-artikel is (stuks_artikelnr IS NOT NULL), alloceer
  -- dan op het stuks-artikel met hoeveelheid te_leveren × stuks_per_doos.
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;
  -- ──────────────────────────────────────────────────────────────────────────

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

  -- Resterend te dekken na handmatige claims
  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad (na doos→stuks vertaling = stuks-artikel voorraad)
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
       WHERE ir.artikelnr = v_artikelnr  -- na vertaling = stuks_artikelnr
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herallocateer_orderregel IS
  'Idempotent: release niet-handmatige claims + alloceer opnieuw: '
  '(0) doos→stuks vertaling als artikel.stuks_artikelnr IS NOT NULL (mig 408): '
  '    v_artikelnr := stuks_artikelnr, v_te_leveren := te_leveren × stuks_per_doos; '
  '(1) eigen voorraad (na vertaling = stuks-artikel) → '
  '(1.5) alias voorraad (zelfde collectie+kleur+vorm, mig 336+404) → '
  '(2) eigen IO op stuks-artikel (IOs voor antislip altijd op stuks-artikel aanmaken). '
  'Handmatige uitwisselbaar-claims (is_handmatig=true) blijven staan. '
  'Migraties 145, 154, 336, 402, 404, 408.';

-- ============================================================================
-- STAP 6: Backfill — sync doos vrije_voorraad vanuit huidige stuks-voorraad
-- ============================================================================
-- Initieel de doos-artikelen bijwerken op basis van de huidige stuks-voorraad.
-- Na deze backfill wordt alles automatisch bijgehouden via de trigger.

UPDATE producten doos
SET
  voorraad       = FLOOR(COALESCE(stuks.voorraad, 0)::NUMERIC / doos.stuks_per_doos)::INTEGER,
  vrije_voorraad = FLOOR(COALESCE(stuks.vrije_voorraad, 0)::NUMERIC / doos.stuks_per_doos)::INTEGER,
  gereserveerd   = 0,
  backorder      = 0
FROM producten stuks
WHERE doos.stuks_artikelnr = stuks.artikelnr
  AND doos.stuks_per_doos IS NOT NULL;

-- ============================================================================
-- STAP 7: Grants + schema reload
-- ============================================================================

GRANT EXECUTE ON FUNCTION herallocateer_orderregel(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION trg_sync_doos_vrije_voorraad() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Smoke-tests na deployment (SQL Editor)
-- ============================================================================
-- 1. Kolommen aanwezig:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='producten' AND column_name IN ('stuks_per_doos','stuks_artikelnr');
--    Verwacht: 2 rijen.
--
-- 2. Koppelingen correct:
--    SELECT artikelnr, omschrijving, stuks_artikelnr, stuks_per_doos
--      FROM producten WHERE stuks_artikelnr IS NOT NULL ORDER BY artikelnr;
--    Verwacht: 5 rijen (900000000, 900000001, 900000005, 900000006, 900000009).
--
-- 3. Stuks-artikelen aangemaakt:
--    SELECT artikelnr, omschrijving, verkoopprijs
--      FROM producten WHERE artikelnr IN ('900000018','900000020','900000021','900000022','900000023','900000024')
--    ORDER BY artikelnr;
--    Verwacht: 6 rijen met correcte prijzen.
--
-- 4. Trigger werkt: UPDATE producten SET voorraad=100 WHERE artikelnr='900000020';
--    SELECT artikelnr, voorraad FROM producten WHERE artikelnr='900000005';
--    Verwacht: voorraad=5 (= floor(100/20)).
--
-- 5. Allocator doos-artikel: maak een test-order aan met doos-artikel 900000005,
--    orderaantal=2. Controleer in order_reserveringen:
--    SELECT * FROM order_reserveringen WHERE order_regel_id=<test_id>;
--    Verwacht: bron='voorraad', fysiek_artikelnr='900000020', aantal=40 (=2×20).

DO $$
BEGIN
  RAISE NOTICE 'Mig 408: Antislip doos-stuks koppeling aangebracht.';
  RAISE NOTICE '  + kolommen stuks_per_doos, stuks_artikelnr op producten';
  RAISE NOTICE '  + 5 stuks-artikelen aangemaakt (900000020-900000024) + 900000018';
  RAISE NOTICE '  + 5 doos-artikelen gekoppeld (900000000, 900000001, 900000005, 900000006, 900000009)';
  RAISE NOTICE '  + trigger trg_sync_doos_vrije_voorraad';
  RAISE NOTICE '  + herallocateer_orderregel bijgewerkt met doos→stuks vertaling (mig 408)';
  RAISE NOTICE '  ! INKOOP: maak IOs voor antislip altijd op het STUKS-artikel aan (in stuks).';
  RAISE NOTICE '  ! TODO: stuks-artikel 900000025 (300×400 cm) voor doos 900000015 nog aanmaken.';
END $$;
