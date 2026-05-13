-- Migratie 272: producten.is_pseudo BOOLEAN + is_admin_pseudo(text)-helper
--
-- Bron-van-waarheid voor admin-pseudo-orderregels (ADR-0018). Vervangt de
-- hardcoded `artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')`-
-- lijsten die nu in 10+ SQL-callsites en 5 FE-callsites leven.
--
-- Beslissing: data-gedreven (geen ENUM-categorie, geen lookup-tabel).
-- Toekomstige 4e/5e admin-pseudo = pure UPDATE producten SET is_pseudo=TRUE.
-- De boolean reist mee in FE-queries via `producten ( is_pseudo )` — geen
-- TS-spiegel met hardcoded lijst, dus drift onmogelijk.
--
-- Mig 273 herschrijft de bestaande hardcoded callsites (263/266/269) naar
-- is_admin_pseudo(). Deze migratie is puur additief; bestaande callsites
-- blijven werken tot mig 273 deploy.
--
-- Out-of-scope: ENUM-categorie ('verzendkosten' | 'korting') voor semantische
-- groepering — pas waardevol bij 6+ pseudo's; nu YAGNI.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- VOORWAARDE: mig 265 (pseudo-producten in producten-tabel).

-- ============================================================================
-- 1. Kolom + backfill + index
-- ============================================================================

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS is_pseudo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE producten
   SET is_pseudo = TRUE
 WHERE artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
   AND is_pseudo IS DISTINCT FROM TRUE;

CREATE INDEX IF NOT EXISTS producten_is_pseudo_idx
  ON producten(artikelnr)
  WHERE is_pseudo;

COMMENT ON COLUMN producten.is_pseudo IS
  'TRUE = administratieve correctie-regel zonder fysieke leverbaarheid '
  '(VERZEND, BUNDELKORTING, DREMPELKORTING per mig 265). Bron-van-waarheid '
  'voor allocator/status/levertijd/pickbaarheid-skip. Zie ADR-0018.';

-- ============================================================================
-- 2. is_admin_pseudo(text)-helper
-- ============================================================================
--
-- Voor SQL-callsites die geen JOIN op producten doen (triggers, simpele
-- filters in views). STABLE — niet IMMUTABLE — omdat de set kan groeien
-- tussen statements via INSERT/UPDATE op producten.is_pseudo.
-- PARALLEL SAFE zodat view-planners 'm kunnen vectoriseren.

CREATE OR REPLACE FUNCTION is_admin_pseudo(p_artikelnr TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT COALESCE(
    (SELECT is_pseudo FROM producten WHERE artikelnr = p_artikelnr),
    FALSE
  )
$$;

GRANT EXECUTE ON FUNCTION is_admin_pseudo(TEXT) TO authenticated, anon;

COMMENT ON FUNCTION is_admin_pseudo IS
  'Centraal predikaat voor admin-pseudo-orderregels (ADR-0018). '
  'STABLE (niet IMMUTABLE) omdat de set kan groeien via INSERT/UPDATE '
  'producten.is_pseudo. Vervangt de hardcoded artikelnr-IN-lijsten in '
  'mig 263/266/269 (callsites rewriten in mig 273). NULL of onbekend '
  'artikelnr returnt FALSE (defensieve default).';

-- ============================================================================
-- 3. ASSERT-blok: backfill correct + helper-gedrag klopt
-- ============================================================================

DO $$
DECLARE
  v_pseudo_count INTEGER;
  v_test_verzend BOOLEAN;
  v_test_korting BOOLEAN;
  v_test_drempel BOOLEAN;
  v_test_echt    BOOLEAN;
  v_test_null    BOOLEAN;
  v_test_unknown BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_pseudo_count FROM producten WHERE is_pseudo;
  ASSERT v_pseudo_count = 3,
    format('Backfill mismatch: %s producten met is_pseudo=TRUE, verwacht 3 (VERZEND/BUNDELKORTING/DREMPELKORTING)', v_pseudo_count);

  v_test_verzend := is_admin_pseudo('VERZEND');
  v_test_korting := is_admin_pseudo('BUNDELKORTING');
  v_test_drempel := is_admin_pseudo('DREMPELKORTING');
  v_test_echt    := is_admin_pseudo('CISC12400');
  v_test_null    := is_admin_pseudo(NULL);
  v_test_unknown := is_admin_pseudo('GEEN_PRODUCT_HIERMEE');

  ASSERT v_test_verzend = TRUE,  'is_admin_pseudo(''VERZEND'') = FALSE — backfill miste';
  ASSERT v_test_korting = TRUE,  'is_admin_pseudo(''BUNDELKORTING'') = FALSE';
  ASSERT v_test_drempel = TRUE,  'is_admin_pseudo(''DREMPELKORTING'') = FALSE';
  ASSERT v_test_echt    = FALSE, 'is_admin_pseudo(''CISC12400'') = TRUE — false positive op echt product';
  ASSERT v_test_null    = FALSE, 'is_admin_pseudo(NULL) = TRUE — defensieve default gebroken';
  ASSERT v_test_unknown = FALSE, 'is_admin_pseudo(onbekend) = TRUE — defensieve default gebroken';

  RAISE NOTICE 'Mig 272 OK: producten.is_pseudo backfilled (3 rijen), is_admin_pseudo() actief.';
  RAISE NOTICE 'Volgende: deploy mig 273 om callsites 263/266/269 om te zetten naar is_admin_pseudo().';
END $$;

NOTIFY pgrst, 'reload schema';
