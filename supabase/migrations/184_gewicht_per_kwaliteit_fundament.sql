-- Migratie 184 — Fundament voor gewicht-per-kwaliteit feature.
-- Voegt kolommen toe op `kwaliteiten` en `producten`, parset lengte/breedte uit
-- karpi_code voor vaste/staaltje-producten, en maakt index voor snelle herrekening
-- in vervolg-migratie 185.
--
-- GEEN gedragsverandering in deze migratie — geen functies, geen triggers, geen
-- RPC-wijzigingen. Bron-van-waarheid `kwaliteiten.gewicht_per_m2_kg` blijft NULL
-- tot Excel-import (issue #42).
--
-- Issues: #38 (DB-fundament), gevolgd door #39 (resolver+triggers).
-- Plan: docs/superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md

BEGIN;

------------------------------------------------------------------------
-- 1. Kwaliteiten — nieuwe kolom voor gewicht-density (bron-van-waarheid)
------------------------------------------------------------------------

ALTER TABLE kwaliteiten
  ADD COLUMN IF NOT EXISTS gewicht_per_m2_kg NUMERIC(8,3);

COMMENT ON COLUMN kwaliteiten.gewicht_per_m2_kg IS
  'Gewicht-density in kg per vierkante meter. Bron-van-waarheid voor alle '
  'gewicht-berekeningen op orderregel/zending-niveau. NULL = nog niet ingevuld; '
  'producten in deze kwaliteit vallen terug op legacy producten.gewicht_kg met '
  'flag gewicht_uit_kwaliteit=false.';

------------------------------------------------------------------------
-- 2. Producten — maat-kolommen + flag voor cache-bron
------------------------------------------------------------------------

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS lengte_cm INTEGER,
  ADD COLUMN IF NOT EXISTS breedte_cm INTEGER,
  ADD COLUMN IF NOT EXISTS gewicht_uit_kwaliteit BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN producten.lengte_cm IS
  'Lengte in cm voor vaste/staaltje-producten. Geparset uit karpi_code-suffix '
  '(laatste 6 cijfers = lengte 3 + breedte 3). NULL voor product_type rol/overig.';
COMMENT ON COLUMN producten.breedte_cm IS
  'Breedte in cm voor vaste/staaltje-producten. Zie lengte_cm-comment.';
COMMENT ON COLUMN producten.gewicht_uit_kwaliteit IS
  'TRUE = gewicht_kg gederiveerd uit kwaliteiten.gewicht_per_m2_kg via trigger '
  '(migratie 185). FALSE = legacy waarde uit oude systeem. Migratie-voortgang '
  'flag: data-completing-rapport filtert hierop.';

------------------------------------------------------------------------
-- 3. Eenmalige parsing van karpi_code → lengte_cm/breedte_cm
------------------------------------------------------------------------
-- Karpi-code patroon: KKKK + LL + XX + LLL + BBB
--   bv. ABST11XX200290 = ABST + 11 + XX + 200 + 290 → 200x290 cm
--       ACHT54XX040060 = ACHT + 54 + XX + 040 + 060 → 40x60 cm (staaltje)
-- Regex `^.{8}(\d{3})(\d{3})$` pakt de laatste 6 cijfers; eerste 8 chars is de
-- 4-letter kwaliteit + 2-cijfer kleur + 2 filler-chars (vaak XX).
-- Sommige codes wijken af (oude prefixen zonder XX-filler) — die blijven NULL
-- en zijn zichtbaar via het verifier-rapport hieronder.

UPDATE producten
SET
  lengte_cm  = (regexp_match(karpi_code, '^.{8}(\d{3})(\d{3})$'))[1]::INTEGER,
  breedte_cm = (regexp_match(karpi_code, '^.{8}(\d{3})(\d{3})$'))[2]::INTEGER
WHERE
  product_type IN ('vast', 'staaltje')
  AND karpi_code IS NOT NULL
  AND karpi_code ~ '^.{8}\d{3}\d{3}$';

------------------------------------------------------------------------
-- 4. Index voor snelle herrekening per kwaliteit (vervolg-trigger #39)
------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS producten_kwaliteit_code_idx
  ON producten (kwaliteit_code)
  WHERE kwaliteit_code IS NOT NULL;

------------------------------------------------------------------------
-- 5. Verifier-rapport — onmatchbare vaste/staaltje-producten
------------------------------------------------------------------------
-- Output bij apply: aantal producten waar parsing faalde, voor latere fix.
-- Niet-fataal — vervolg-trigger valt voor deze rijen terug op legacy gewicht_kg.

DO $$
DECLARE
  v_total_vast_staaltje INTEGER;
  v_geparsed INTEGER;
  v_onmatchbaar INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_vast_staaltje
    FROM producten WHERE product_type IN ('vast', 'staaltje');
  SELECT COUNT(*) INTO v_geparsed
    FROM producten
    WHERE product_type IN ('vast', 'staaltje')
      AND lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL;
  v_onmatchbaar := v_total_vast_staaltje - v_geparsed;

  RAISE NOTICE 'Parse-rapport migratie 184:';
  RAISE NOTICE '  Totaal vaste/staaltje-producten: %', v_total_vast_staaltje;
  RAISE NOTICE '  Geparsed met lengte+breedte:    %', v_geparsed;
  RAISE NOTICE '  Onmatchbaar (afwijkend patroon): %', v_onmatchbaar;
END $$;

COMMIT;
