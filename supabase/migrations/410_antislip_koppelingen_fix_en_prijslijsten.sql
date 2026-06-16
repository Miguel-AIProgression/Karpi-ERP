-- Migratie 410: Antislip koppelingen fix + prijslijsten 210-217
--
-- Correctie op mig 408/409:
--   Drie aparte antislip-productgroepen:
--     1. ALGEMEEN (geen suffix): doos 900000000-015 ↔ stuks 900000010-016
--     2. KNUTZEN (K):           doos 900000017-029K ↔ stuks 900000018-024
--     3. WEHKAMP (W):           doos 900000003/004/008 — alleen per doos, geen stuks
--
--   Mig 408 koppelde de ALGEMENE dozen ten onrechte aan K-KNUTZEN stuks.
--   Dit is onjuist: het zijn fysiek verschillende producten (ander merk/label).
--
-- Acties:
--   1. Fix: algemene doos → algemene stuks (900000010-014, 900000016)
--   2. Koppel: Knutzen doos → K-stuks (nieuw)
--   3. Backfill: doos vrije_voorraad herladen na koppelings-correctie
--   4. Prijzen: reguliere stuks (900000010-014) verkoopprijs instellen
--   5. K-stuks verkoopprijs: corrigeren naar Knutzen-tarieven (prijslijst 0249)
--   6. Prijslijsten 0210/0211/0212/0213/0215/0217: algemene doos-antislip toevoegen
--      (0214 en 0216 bestaan niet in deze database)

-- ============================================================================
-- STAP 1: Fix algemene doos-stuks koppelingen
-- ============================================================================
-- Correcte koppeling: algemeen doos → algemeen stuks (zonder K-suffix)

UPDATE producten SET stuks_artikelnr = '900000010', stuks_per_doos = 20 WHERE artikelnr = '900000005';
UPDATE producten SET stuks_artikelnr = '900000011', stuks_per_doos = 15 WHERE artikelnr = '900000006';
UPDATE producten SET stuks_artikelnr = '900000012', stuks_per_doos = 12 WHERE artikelnr = '900000000';
UPDATE producten SET stuks_artikelnr = '900000013', stuks_per_doos =  8 WHERE artikelnr = '900000001';
UPDATE producten SET stuks_artikelnr = '900000014', stuks_per_doos =  5 WHERE artikelnr = '900000009';
-- 900000015 → 900000016: al correct vanuit mig 409

-- ============================================================================
-- STAP 2: Koppel Knutzen doos-artikelen aan K-stuks
-- ============================================================================
-- Knutzen doos-artikelen (K-suffix) → K-stuks artikelen

UPDATE producten SET stuks_artikelnr = '900000018', stuks_per_doos = 30 WHERE artikelnr = '900000017';
UPDATE producten SET stuks_artikelnr = '900000020', stuks_per_doos = 20 WHERE artikelnr = '900000019';
UPDATE producten SET stuks_artikelnr = '900000021', stuks_per_doos = 15 WHERE artikelnr = '900000025';
UPDATE producten SET stuks_artikelnr = '900000022', stuks_per_doos = 12 WHERE artikelnr = '900000026';
UPDATE producten SET stuks_artikelnr = '900000023', stuks_per_doos =  8 WHERE artikelnr = '900000027';
UPDATE producten SET stuks_artikelnr = '900000024', stuks_per_doos =  5 WHERE artikelnr = '900000029';
-- Wehkamp W-artikelen (900000003/004/008): geen stuks-koppeling, blijven per doos

-- ============================================================================
-- STAP 3: Backfill doos vrije_voorraad na koppelings-correctie
-- ============================================================================
-- De sync-trigger vuurt niet bij FK-wijziging, alleen bij voorraad-wijziging.
-- Volledige herberekening voor alle gekoppelde dozen.

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
-- STAP 4: Reguliere stuks artikelen — verkoopprijs instellen
-- ============================================================================
-- Prijs = doos_prijs / stuks_per_doos × 1.25 (25% toeslag losse stuks)
-- (900000016 is al correct vanuit mig 409)

UPDATE producten SET verkoopprijs = 7.50,  inkoopprijs = 6.00  WHERE artikelnr = '900000010';  -- 80×150:  120/20×1.25
UPDATE producten SET verkoopprijs = 10.00, inkoopprijs = 8.00  WHERE artikelnr = '900000011';  -- 130×190: 120/15×1.25
UPDATE producten SET verkoopprijs = 13.75, inkoopprijs = 11.00 WHERE artikelnr = '900000012';  -- 160×230: 132/12×1.25
UPDATE producten SET verkoopprijs = 20.00, inkoopprijs = 16.00 WHERE artikelnr = '900000013';  -- 190×290: 128/8×1.25
UPDATE producten SET verkoopprijs = 28.75, inkoopprijs = 23.00 WHERE artikelnr = '900000014';  -- 240×340: 115/5×1.25

-- ============================================================================
-- STAP 5: K-stuks verkoopprijs corrigeren naar Knutzen 0249-tarieven
-- ============================================================================
-- Mig 408 vulde de K-stuks met de algemene 25%-toeslag-prijs.
-- K-stuks zijn Knutzen-specifieke producten; verkoopprijs = Knutzen-tarief.
-- (Per-klant prijzen staan ook al correct in prijslijst_regels 0249/0250)

UPDATE producten SET verkoopprijs = 3.72  WHERE artikelnr = '900000018';  -- 60×110 K (was al goed)
UPDATE producten SET verkoopprijs = 6.61  WHERE artikelnr = '900000020';  -- 80×150 K (was 7.50)
UPDATE producten SET verkoopprijs = 9.02  WHERE artikelnr = '900000021';  -- 130×190 K (was 10.00)
UPDATE producten SET verkoopprijs = 12.62 WHERE artikelnr = '900000022';  -- 160×230 K (was 13.75)
UPDATE producten SET verkoopprijs = 17.72 WHERE artikelnr = '900000023';  -- 190×290 K (was 20.00)
UPDATE producten SET verkoopprijs = 26.43 WHERE artikelnr = '900000024';  -- 240×340 K (was 28.75)

-- ============================================================================
-- STAP 6: Prijslijsten 0210/0211/0212/0213/0215/0217 — algemene doos toevoegen
-- ============================================================================
-- Prijslijsten 0214 en 0216 bestaan niet in deze database.
-- Per INSERT: als regel al bestaat overslaan (WHERE NOT EXISTS).
-- Omschrijving uit producten, prijs = door gebruiker opgegeven tarieven.

DO $$
DECLARE
  v_pl TEXT;
  v_artikel RECORD;
  v_prijzen JSONB := '{
    "900000005": 120.00,
    "900000006": 120.00,
    "900000000": 132.00,
    "900000001": 128.00,
    "900000009": 115.00,
    "900000015": 160.00
  }';
  v_prijs NUMERIC;
BEGIN
  FOR v_pl IN SELECT unnest(ARRAY['0210','0211','0212','0213','0215','0217'])
  LOOP
    FOR v_artikel IN
      SELECT artikelnr, omschrijving
        FROM producten
       WHERE artikelnr IN ('900000005','900000006','900000000','900000001','900000009','900000015')
    LOOP
      v_prijs := (v_prijzen ->> v_artikel.artikelnr)::NUMERIC;

      IF NOT EXISTS (
        SELECT 1 FROM prijslijst_regels
         WHERE prijslijst_nr = v_pl AND artikelnr = v_artikel.artikelnr
      ) THEN
        INSERT INTO prijslijst_regels (prijslijst_nr, artikelnr, omschrijving, prijs)
        VALUES (v_pl, v_artikel.artikelnr, v_artikel.omschrijving, v_prijs);
      ELSE
        -- Prijs bijwerken als die afwijkt
        UPDATE prijslijst_regels
           SET prijs = v_prijs, omschrijving = v_artikel.omschrijving
         WHERE prijslijst_nr = v_pl AND artikelnr = v_artikel.artikelnr
           AND prijs IS DISTINCT FROM v_prijs;
      END IF;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verificatie (na deployment)
-- ============================================================================
-- 1. Correcte koppelingen:
--    SELECT d.artikelnr, d.omschrijving, d.stuks_per_doos, s.artikelnr AS stuks, s.omschrijving AS stuks_naam
--      FROM producten d JOIN producten s ON s.artikelnr = d.stuks_artikelnr
--     WHERE d.stuks_artikelnr IS NOT NULL ORDER BY d.artikelnr;
--
-- 2. Prijslijsten OK:
--    SELECT pr.prijslijst_nr, pr.artikelnr, pr.prijs
--      FROM prijslijst_regels pr
--     WHERE pr.prijslijst_nr IN ('0210','0211','0212','0213','0215','0217')
--       AND pr.artikelnr IN ('900000000','900000001','900000005','900000006','900000009','900000015')
--     ORDER BY pr.prijslijst_nr, pr.artikelnr;
--    Verwacht: 6 prijslijsten × 6 artikelen = 36 regels.

DO $$
BEGIN
  RAISE NOTICE 'Mig 410: antislip koppelingen gecorrigeerd + prijslijsten bijgewerkt.';
  RAISE NOTICE '  + Algemeen doos → reguliere stuks (900000005→010, 006→011, 000→012, 001→013, 009→014)';
  RAISE NOTICE '  + Knutzen doos → K-stuks (017→018, 019→020, 025→021, 026→022, 027→023, 029→024)';
  RAISE NOTICE '  + Reguliere stuks prijzen ingesteld (900000010-014)';
  RAISE NOTICE '  + K-stuks verkoopprijs gecorrigeerd naar Knutzen 0249-tarieven';
  RAISE NOTICE '  + Antislip doos toegevoegd aan prijslijsten 0210/0211/0212/0213/0215/0217';
END $$;
