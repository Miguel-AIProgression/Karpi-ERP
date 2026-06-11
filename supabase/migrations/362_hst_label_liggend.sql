-- Migratie 362: HST-verzendlabel liggend (152,4×76,2) i.p.v. staand
--
-- Achtergrond
-- -----------
-- Mig 361 zette HST op 76,2×152,4 (staand ontwerp langs de rol-richting).
-- Miguel wil echter expliciet het vertrouwde LIGGENDE ontwerp (zoals de oude
-- 3"×2"-labels eruit kwamen: tekst dwars op de uitvoer-richting), maar dan
-- het volledige 3"×6"-etiket vullend. De pagina wordt dus 152,4 breed ×
-- 76,2 hoog; de ZDesigner-driver staat op "liggend" (rol fysiek 76,2 breed)
-- en roteert het beeld op het etiket — exact de oude Windows Connect-flow.
--
-- De frontend schaalt het compacte 3-rijen-ontwerp mee met de label-hoogte
-- (factor 76,2/50,8 = 1,5) zodat het hele etiket gevuld is.

UPDATE vervoerders
SET label_breedte_mm = 152.4,
    label_hoogte_mm  = 76.2
WHERE code = 'hst_api';

NOTIFY pgrst, 'reload schema';
