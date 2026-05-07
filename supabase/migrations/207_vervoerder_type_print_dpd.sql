-- Migratie 207: type='print' + DPD als vervoerder
--
-- Achtergrond
-- -----------
-- Tot nu toe kende `vervoerders.type` alleen 'api' (HST) en 'edi' (Rhenus, Verhoek).
-- DPD heeft géén directe API-koppeling vanuit Karpi: stickers worden lokaal op
-- een Zebra ZT230 thermische printer gedrukt (80×150mm). Die flow heeft een eigen
-- type omdat de switch-RPC `enqueue_zending_naar_vervoerder` (mig 205/209) anders
-- moet beslissen — geen transportorder, alleen sticker-PDF.
--
-- Wat doet deze migratie
-- ----------------------
-- 1. Verbreed CHECK op `vervoerders.type` van ('api','edi') naar ('api','edi','print').
-- 2. Nieuwe kolommen voor de print-flow: printer-IP/naam + label-formaat.
-- 3. INSERT vervoerder 'dpd' (display 'DPD', type 'print', initieel inactief).
--
-- Idempotent. Geen breaking change voor bestaande HST/EDI-records.

-- ============================================================================
-- 1. CHECK-constraint verbreden
-- ============================================================================
ALTER TABLE vervoerders DROP CONSTRAINT IF EXISTS vervoerders_type_check;
ALTER TABLE vervoerders
  ADD CONSTRAINT vervoerders_type_check
  CHECK (type IN ('api', 'edi', 'print'));

COMMENT ON COLUMN vervoerders.type IS
  'Communicatiemethode: ''api'' (HST-style REST), ''edi'' (Transus/EDIFACT), '
  '''print'' (lokale label-printer, geen externe koppeling — bv. DPD via Zebra).';

-- ============================================================================
-- 2. Print-specifieke kolommen
-- ============================================================================
ALTER TABLE vervoerders
  ADD COLUMN IF NOT EXISTS printer_naam      TEXT,
  ADD COLUMN IF NOT EXISTS printer_ip        TEXT,
  ADD COLUMN IF NOT EXISTS label_breedte_mm  INTEGER,
  ADD COLUMN IF NOT EXISTS label_hoogte_mm   INTEGER,
  ADD COLUMN IF NOT EXISTS service_codes     TEXT[];

COMMENT ON COLUMN vervoerders.printer_naam IS
  'Windows-printernaam waar de browser/applicatie de label-PDF naartoe stuurt. '
  'Alleen relevant voor type=''print''.';
COMMENT ON COLUMN vervoerders.printer_ip IS
  'Optioneel IP-adres voor directe ZPL-push (TCP poort 9100). Voor V1 niet gebruikt — '
  'we vertrouwen op browser→Windows-printer flow. Vult zich later voor native ZPL-pad.';
COMMENT ON COLUMN vervoerders.label_breedte_mm IS
  'Label-breedte in mm voor PDF-render (bv. 80). NULL → fallback A6 of vervoerder-default.';
COMMENT ON COLUMN vervoerders.label_hoogte_mm IS
  'Label-hoogte in mm voor PDF-render (bv. 150).';
COMMENT ON COLUMN vervoerders.service_codes IS
  'Lijst van service-varianten die deze vervoerder ondersteunt, bv. '
  '{''srv'',''classic'',''predict''} voor DPD. Selectieregels kiezen er één.';

-- ============================================================================
-- 3. DPD-vervoerder toevoegen
-- ============================================================================
INSERT INTO vervoerders (
  code, display_naam, type, actief, notities,
  label_breedte_mm, label_hoogte_mm, service_codes
) VALUES (
  'dpd', 'DPD', 'print', FALSE,
  'Pakketdienst voor pakketten t/m ~30kg. Stickers via Zebra ZT230 thermisch (80×150mm). '
  'Geen API-koppeling vanuit Karpi — labels worden in RugFlow gerenderd en lokaal geprint.',
  80, 150, ARRAY['srv', 'classic', 'predict', 'internationaal']::TEXT[]
)
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
