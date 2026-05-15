-- Migratie 289: confectie-buffer default → 0 minuten
--
-- Aanleiding: de 15-minuten confectie-buffer (mig 103) liet een vers-gesneden
-- stuk 15 min "verdwijnen" uit de Confectielijst zonder enige indicatie —
-- verwarrend op de werkvloer ("waar is mijn gesneden stuk?"). Bedrijfskeuze:
-- gesneden stukken moeten direct beschikbaar zijn voor confectie.
--
-- Wijziging (gedrag, geen bugfix):
--   1. Live config app_config.productie_planning.confectie_buffer_minuten → 0.
--   2. Fallback in confectie_buffer_minuten() van 15 → 0, zodat de "default"
--      ook 0 is als de config-sleutel ooit ontbreekt.
--
-- Effect: de WHERE-buffer in confectie_planning_forward
--   NOT (status='Gesneden' AND snijden_voltooid_op + buffer > NOW())
-- wordt met buffer=0 effectief inert (snijden_voltooid_op ligt in het
-- verleden) → Gesneden stukken verschijnen direct in de Confectielijst.
-- De view zelf blijft ongemoeid (leest confectie_buffer_minuten() dynamisch).
-- Omkeerbaar: zet de config-waarde terug op een positief getal.

-- 1) Live config-waarde naar 0 (non-destructief: overige velden behouden)
UPDATE app_config
   SET waarde = waarde || jsonb_build_object('confectie_buffer_minuten', 0)
 WHERE sleutel = 'productie_planning';

-- 2) Helper-functie: fallback 15 → 0
CREATE OR REPLACE FUNCTION confectie_buffer_minuten()
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (waarde ->> 'confectie_buffer_minuten')::integer
       FROM app_config
      WHERE sleutel = 'productie_planning'),
    0
  );
$$;

COMMENT ON FUNCTION confectie_buffer_minuten() IS
  'Leest buffer-minuten uit app_config.productie_planning.confectie_buffer_minuten. Default 0 (mig 289, was 15 sinds mig 103).';

NOTIFY pgrst, 'reload schema';
