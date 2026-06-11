-- Migratie 361: label-formaat naar NUMERIC + HST-verzendlabel op 3"×6" (76,2×152,4 mm)
--
-- Achtergrond
-- -----------
-- Het verzendlabel op de Pick & Ship-verzendset stond hard op 76,2×50,8 mm
-- (3"×2", de oude ZD420-aanname). De fysieke rol in de Zebra ZT231 is echter
-- 76,2×152,4 mm (3"×6") — het label vulde maar een derde van het etiket
-- (foto-incident 11 juni 2026). De render-pipeline leest het formaat al per
-- vervoerder uit `vervoerders.label_breedte_mm/label_hoogte_mm` (mig 207),
-- maar die kolommen waren INTEGER en alleen gevuld voor DPD.
--
-- Wat doet deze migratie
-- ----------------------
-- 1. Kolommen naar NUMERIC(5,1): inch-gebaseerde labelrollen zijn fractioneel
--    in mm (76.2, 50.8, 152.4) — afronden naar hele mm geeft een sluipende
--    mismatch met het driver-papierformaat.
-- 2. HST (`hst_api`) krijgt het werkelijke rolformaat 76,2×152,4. De frontend
--    (labelFormaatVoor in printset.ts) pakt dit automatisch op en rendert het
--    staande 3×6-ontwerp; vervoerders zonder formaat vallen terug op de
--    oude default 76,2×50,8.
--
-- Idempotent. DPD (80×150, al INTEGER-compatibel) blijft ongewijzigd.

ALTER TABLE vervoerders
  ALTER COLUMN label_breedte_mm TYPE NUMERIC(5,1),
  ALTER COLUMN label_hoogte_mm  TYPE NUMERIC(5,1);

COMMENT ON COLUMN vervoerders.label_breedte_mm IS
  'Label-breedte in mm voor de label-render (bv. 76.2). NUMERIC(5,1) omdat '
  'inch-gebaseerde rollen fractioneel zijn. NULL → frontend-default 76,2×50,8.';
COMMENT ON COLUMN vervoerders.label_hoogte_mm IS
  'Label-hoogte in mm voor de label-render (bv. 152.4).';

UPDATE vervoerders
SET label_breedte_mm = 76.2,
    label_hoogte_mm  = 152.4
WHERE code = 'hst_api';

NOTIFY pgrst, 'reload schema';
