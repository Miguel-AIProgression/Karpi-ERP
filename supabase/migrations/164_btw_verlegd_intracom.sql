-- Migratie 164: BTW-verlegging-flag voor intracommunautaire EU-debiteuren
--
-- Probleem (gevonden 2026-04-30 bij eerste BDSK orderbev round-trip-test in Transus):
--   `download-orderbev-xml.ts` zet `<VATPercentage>` standaard op `debiteuren.btw_percentage`
--   (default 21.00). Voor BDSK Handels (DE, intracommunautair B2B) levert dat een
--   EDIFACT-segment `TAX+7+VAT+++:::21+S` op, terwijl het origineel-bestand toont dat
--   BDSK `TAX+7+VAT+++:::0+S` verwacht (BTW-verlegd binnen EU).
--
-- Aanpak:
--   1. Nieuwe boolean `debiteuren.btw_verlegd_intracom` (default FALSE).
--   2. Backfill: alle debiteuren met een `land`-waarde die wijst op een
--      andere EU-lidstaat dan Nederland krijgen TRUE. Conservatief — alleen
--      bij expliciet herkenbare landcodes/-namen, anders blijft het FALSE
--      en kan een gebruiker het handmatig per debiteur aanzetten.
--   3. Index op (btw_verlegd_intracom) WHERE TRUE — facturatie- en EDI-queries
--      kunnen daarmee snel intracommunautaire debiteuren oppakken.
--
-- Idempotent. Geen breaking changes — bestaande facturatie blijft `btw_percentage`
-- gebruiken; deze flag is een aparte aanwijzing voor de EDI-laag (en straks INVOIC).

-- ============================================================================
-- 1. Nieuwe kolom
-- ============================================================================

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS btw_verlegd_intracom BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.btw_verlegd_intracom IS
  'TRUE = intracommunautaire B2B-debiteur in een andere EU-lidstaat dan NL — '
  'BTW wordt verlegd naar de afnemer en op uitgaande EDI/facturen wordt 0% toegepast '
  'i.p.v. de waarde uit btw_percentage. Manueel aan te vinken in debiteuren-detail; '
  'eenmalige backfill in migratie 164 op basis van debiteuren.land.';

-- ============================================================================
-- 2. Conservatieve backfill — alleen bij expliciet herkenbare EU-landen
--
-- Lijst gekozen op basis van:
--   - Top-5 EDI-partners (BDSK, SB-Möbel BOSS, Hornbach, Hammer, Krieger zijn DE)
--   - Andere EU-lidstaten waar Karpi mogelijk handelt met B2B-klanten
--   - Variant-spellingen (NL is soms "Nederland", "Niederlande", etc.)
-- ============================================================================

UPDATE debiteuren
   SET btw_verlegd_intracom = TRUE
 WHERE btw_verlegd_intracom = FALSE
   AND land IS NOT NULL
   AND TRIM(land) <> ''
   AND UPPER(TRIM(land)) IN (
     -- Duitsland (top-prio: alle BDSK/SB-Möbel/Hornbach/Hammer/Krieger zitten hier)
     'DE', 'DEU', 'DEUTSCHLAND', 'DUITSLAND', 'GERMANY',
     -- België
     'BE', 'BEL', 'BELGIE', 'BELGIË', 'BELGIUM', 'BELGIQUE',
     -- Frankrijk
     'FR', 'FRA', 'FRANCE', 'FRANKRIJK',
     -- Oostenrijk
     'AT', 'AUT', 'AUSTRIA', 'OOSTENRIJK', 'ÖSTERREICH', 'OSTERREICH',
     -- Italië
     'IT', 'ITA', 'ITALY', 'ITALIE', 'ITALIË', 'ITALIA',
     -- Spanje
     'ES', 'ESP', 'SPAIN', 'SPANJE', 'ESPANA', 'ESPAÑA',
     -- Luxemburg
     'LU', 'LUX', 'LUXEMBOURG', 'LUXEMBURG',
     -- Denemarken
     'DK', 'DNK', 'DENMARK', 'DENEMARKEN', 'DANMARK',
     -- Zweden
     'SE', 'SWE', 'SWEDEN', 'ZWEDEN', 'SVERIGE',
     -- Finland
     'FI', 'FIN', 'FINLAND', 'SUOMI',
     -- Ierland
     'IE', 'IRL', 'IRELAND', 'IERLAND', 'EIRE',
     -- Portugal
     'PT', 'PRT', 'PORTUGAL',
     -- Polen
     'PL', 'POL', 'POLAND', 'POLEN', 'POLSKA',
     -- Tsjechië
     'CZ', 'CZE', 'CZECHIA', 'TSJECHIE', 'TSJECHIË', 'CESKO',
     -- Slowakije
     'SK', 'SVK', 'SLOVAKIA', 'SLOWAKIJE',
     -- Hongarije
     'HU', 'HUN', 'HUNGARY', 'HONGARIJE', 'MAGYARORSZAG',
     -- Griekenland
     'GR', 'GRC', 'GREECE', 'GRIEKENLAND', 'ELLAS',
     -- Slovenië, Estland, Letland, Litouwen, Bulgarije, Roemenië, Kroatië, Cyprus, Malta
     'SI', 'SVN', 'SLOVENIA', 'SLOVENIE', 'SLOVENIË',
     'EE', 'EST', 'ESTONIA', 'ESTLAND',
     'LV', 'LVA', 'LATVIA', 'LETLAND',
     'LT', 'LTU', 'LITHUANIA', 'LITOUWEN',
     'BG', 'BGR', 'BULGARIA', 'BULGARIJE',
     'RO', 'ROU', 'ROMANIA', 'ROEMENIE', 'ROEMENIË',
     'HR', 'HRV', 'CROATIA', 'KROATIE', 'KROATIË',
     'CY', 'CYP', 'CYPRUS',
     'MT', 'MLT', 'MALTA'
   );

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM debiteuren WHERE btw_verlegd_intracom = TRUE;
  RAISE NOTICE 'Migratie 164: % debiteuren gemarkeerd als intracommunautair (BTW-verlegd).', v_count;
END $$;

-- ============================================================================
-- 3. Partial index voor snelle filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_debiteuren_btw_verlegd_intracom
  ON debiteuren (debiteur_nr)
  WHERE btw_verlegd_intracom = TRUE;
