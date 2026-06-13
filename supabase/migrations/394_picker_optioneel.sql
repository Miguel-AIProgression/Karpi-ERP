-- 394_picker_optioneel.sql
-- Picker is "voor nu" NIET meer verplicht bij pickronde-start/voltooi/niet-gevonden.
--
-- Aanleiding (13-06-2026, meekijken met logistiek): de operator wil een pickronde
-- kunnen starten/voltooien zonder eerst een picker te kiezen. Tot mig 217 wierp
-- `_valideer_picker` een exception bij NULL, waardoor élke caller (start_pickronden,
-- start_pickronden_voor_order, start_pickronde, voltooi_pickronde,
-- markeer_colli_niet_gevonden, start_pickronden_bundel) hard faalde op een lege picker.
--
-- Door alleen DEZE helper te versoepelen blijft het audit-gedrag intact: als er
-- WÉL een picker wordt meegegeven moet die nog steeds een actieve picker-medewerker
-- zijn. NULL betekent simpelweg "niet vastgelegd". De `picker_id`-kolom op
-- `zendingen` is al nullable (mig 217), dus geen verdere schema-wijziging nodig.
--
-- Terugdraaien = de NULL-RAISE terugzetten (zie mig 217 §3).

CREATE OR REPLACE FUNCTION _valideer_picker(p_picker_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  -- Picker optioneel: NULL is toegestaan (= niet vastgelegd). Geen exception meer.
  IF p_picker_id IS NULL THEN
    RETURN;
  END IF;

  -- Als er wél een picker is opgegeven, moet die een actieve picker-medewerker zijn.
  IF NOT EXISTS (
    SELECT 1 FROM medewerkers
     WHERE id = p_picker_id
       AND 'picker' = ANY(rollen)
       AND actief
  ) THEN
    RAISE EXCEPTION 'Medewerker % is geen actieve picker', p_picker_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

COMMENT ON FUNCTION _valideer_picker(BIGINT) IS
  'Mig 394: picker optioneel. NULL = niet vastgelegd (geen exception). '
  'Een niet-NULL waarde moet nog steeds een actieve picker-medewerker zijn.';
