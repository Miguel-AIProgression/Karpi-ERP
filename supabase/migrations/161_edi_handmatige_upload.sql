-- Migratie 161: EDI handmatige upload/download — formaat-keuze + response-sequencing + test-tracking
--
-- Plan: docs/superpowers/plans/2026-04-30-edi-handmatige-upload-download.md
--
-- Wat deze migratie doet:
--   1. `edi_handelspartner_config.orderbev_format` — per debiteur of orderbevestiging
--      uitgaat als TransusXML of Karpi-fixed-width. Default 'transus_xml' op basis van
--      het BDSK-voorbeeld; partners die anders verwachten kunnen handmatig overrulen.
--   2. `edi_berichten.order_response_seq` — sequentie binnen een order voor de
--      `OrderResponseNumber`-veld in TransusXML (bv. eerste bevestiging "...01",
--      hercorrectie "...02").
--   3. `edi_berichten.transus_test_*` — velden waarin Miguel handmatig kan
--      annoteren of een uitgaand bericht door Transus' "Bekijken en testen"-tab
--      is geaccepteerd of afgekeurd.
--   4. `ruim_edi_demo_data()` uitbreiden zodat ook UPLOAD-prefix opgeruimd wordt.
--
-- Idempotent. Geen breaking changes.

-- ============================================================================
-- 1. orderbev_format op edi_handelspartner_config
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE edi_orderbev_format AS ENUM ('transus_xml', 'fixed_width');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE edi_handelspartner_config
  ADD COLUMN IF NOT EXISTS orderbev_format edi_orderbev_format NOT NULL DEFAULT 'transus_xml';

COMMENT ON COLUMN edi_handelspartner_config.orderbev_format IS
  'Default uitgaand formaat voor orderbevestiging. transus_xml = <ORDERRESPONSES>-XML '
  '(bewezen voor BDSK 2026-04-30). fixed_width = Karpi 463+281 fixed-width. '
  'UI laat altijd beide opties toe — deze waarde is alleen de default.';

-- ============================================================================
-- 2. order_response_seq op edi_berichten
-- ============================================================================

ALTER TABLE edi_berichten
  ADD COLUMN IF NOT EXISTS order_response_seq INTEGER;

COMMENT ON COLUMN edi_berichten.order_response_seq IS
  'Sequentie van orderbevestigingen binnen één order. Wordt gebruikt om '
  '<OrderResponseNumber> in TransusXML te bouwen: Karpi-ordernr + zero-padded seq. '
  'Eerste bevestiging = 1, herzending na correctie = 2, etc.';

-- ============================================================================
-- 3. transus_test_* velden op edi_berichten
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE edi_transus_test_status AS ENUM (
    'niet_getest',
    'goedgekeurd',
    'afgekeurd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE edi_berichten
  ADD COLUMN IF NOT EXISTS transus_test_status edi_transus_test_status NOT NULL DEFAULT 'niet_getest',
  ADD COLUMN IF NOT EXISTS transus_test_resultaat TEXT,
  ADD COLUMN IF NOT EXISTS transus_test_at TIMESTAMPTZ;

COMMENT ON COLUMN edi_berichten.transus_test_status IS
  'Handmatige tracking-status na upload in Transus Online "Bekijken en testen"-tab. '
  'Onderdeel van de pre-cutover round-trip-validatie.';

COMMENT ON COLUMN edi_berichten.transus_test_resultaat IS
  'Vrije tekst — copy-paste van Transus'' foutmeldingen of validatie-output.';

-- ============================================================================
-- 4. ruim_edi_demo_data uitbreiden naar UPLOAD-prefix
--
-- Behoudt de bestaande output-signatuur uit migratie 160:
--   (verwijderde_orders INTEGER, verwijderde_berichten INTEGER)
-- in deze volgorde — anders weigert Postgres de CREATE OR REPLACE met
-- "cannot change return type of existing function".
-- ============================================================================

CREATE OR REPLACE FUNCTION ruim_edi_demo_data() RETURNS TABLE(
  verwijderde_orders     INTEGER,
  verwijderde_berichten  INTEGER
) AS $$
DECLARE
  v_orders    INTEGER := 0;
  v_berichten INTEGER := 0;
BEGIN
  -- 1. Verwijder demo- en upload-orders. CASCADE op order_regels en
  --    order_reserveringen via bestaande FK-rules.
  WITH del AS (
    DELETE FROM orders
     WHERE bron_systeem = 'edi'
       AND (bron_order_id LIKE 'DEMO-%' OR bron_order_id LIKE 'UPLOAD-%')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_orders FROM del;

  -- 2. Verwijder alle test-EDI-berichten (zowel inkomend als uitgaand,
  --    inclusief uitgaande orderbevs zonder transactie_id en upload-uploads).
  WITH del AS (
    DELETE FROM edi_berichten
     WHERE is_test = TRUE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_berichten FROM del;

  RETURN QUERY SELECT v_orders, v_berichten;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ruim_edi_demo_data() TO authenticated;

COMMENT ON FUNCTION ruim_edi_demo_data() IS
  'Verwijdert alle test-data van de EDI-flow (demo-berichten + handmatige uploads). '
  'Returnt het aantal verwijderde rijen per tabel. Veilig om ongelimiteerd uit '
  'te voeren — raakt geen productie-EDI-berichten omdat is_test=true alleen wordt '
  'gezet door demo-helper en upload-helper, en orders worden gefilterd op '
  'bron_systeem=edi met DEMO-/UPLOAD-prefix.';
