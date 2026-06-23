-- Migratie 471: IO-fallback-tak voor de maatwerk-auto-verzendweek (vervolg op mig 469)
--
-- Achtergrond
-- -----------
-- Mig 469 zet `order_regels.verzendweek` automatisch op "vandaag + N weken"
-- zodra een maatwerk-regel volledig op een ÉCHTE rol staat (materiaal op
-- voorraad). De andere dekkingsvorm — een snijplan-stuk zonder rol maar wél
-- gekoppeld aan een openstaande inkooporder-regel via
-- `snijplannen.verwacht_inkooporder_regel_id` (mig 437-445, snijplan-status
-- 'Wacht op inkoop') — deed tot nu niets: zo'n regel hield `verzendweek=NULL`
-- voor altijd, ook al is er wel degelijk een concrete dekking met een eigen
-- verwachte datum.
--
-- Deze migratie breidt dezelfde trigger uit: een snijplan-stuk is nu ook
-- "gedekt" als het een `verwacht_inkooporder_regel_id` heeft (naast de
-- bestaande "heeft een rol_id"-dekking — de XOR-constraint
-- `snijplannen_rol_of_verwacht_xor` garandeert dat een stuk nooit beide
-- tegelijk heeft). Zodra ALLE stukken van de regel op een van de twee manieren
-- gedekt zijn, wordt de verzendweek:
--   GREATEST(vandaag + N1 weken, MAX(inkoop-ETA over IO-gedekte stukken) + N2 weken)
-- N1 = app_config.productie_planning.maatwerk_voorraad_levertijd_weken (7, ongewijzigd)
-- N2 = app_config.order_config.inkoop_buffer_weken_maatwerk (bestaande key, 2)
-- Bij uitsluitend rol-gedekte stukken (geen enkele IO-link) is dit exact
-- mig 469's oude gedrag: gewoon vandaag + N1.
--
-- Bewust NIET gebouwd (mogelijke vervolgstap, niet gevraagd): als een al-
-- gekoppelde IO-regel's `verwacht_datum` later wijzigt (leverancier-ETA-
-- update), wordt een al-gezette `verzendweek` niet automatisch herzien —
-- exact zoals de rol-tak nu ook werkt (snapshot, geen live herberekening).

CREATE OR REPLACE FUNCTION public.trg_snijplan_rol_toegewezen_auto_verzendweek()
RETURNS TRIGGER AS $$
DECLARE
  v_weken_voorraad INTEGER;
  v_weken_io       INTEGER;
  v_max_io_datum   DATE;
  v_kandidaat      DATE;
BEGIN
  -- Niets relevant gezet (noch rol, noch IO-koppeling) -> niets te doen.
  IF NEW.rol_id IS NULL AND NEW.verwacht_inkooporder_regel_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bij UPDATE alleen reageren als een van de twee dekkingsvelden echt wijzigde.
  IF TG_OP = 'UPDATE'
     AND OLD.rol_id IS NOT DISTINCT FROM NEW.rol_id
     AND OLD.verwacht_inkooporder_regel_id IS NOT DISTINCT FROM NEW.verwacht_inkooporder_regel_id
  THEN
    RETURN NEW;
  END IF;

  -- "Volledig gedekt": geen niet-geannuleerd sibling-stuk zonder rol ÉN zonder IO-koppeling.
  IF EXISTS (
    SELECT 1 FROM snijplannen sp2
    WHERE sp2.order_regel_id = NEW.order_regel_id
      AND sp2.status <> 'Geannuleerd'
      AND sp2.rol_id IS NULL
      AND sp2.verwacht_inkooporder_regel_id IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((waarde->>'maatwerk_voorraad_levertijd_weken')::INTEGER, 7)
    INTO v_weken_voorraad
  FROM app_config WHERE sleutel = 'productie_planning';

  SELECT COALESCE((waarde->>'inkoop_buffer_weken_maatwerk')::INTEGER, 2)
    INTO v_weken_io
  FROM app_config WHERE sleutel = 'order_config';

  -- Kritiekste (laatste) IO-ETA onder de siblings die via inkoop gedekt zijn.
  SELECT MAX(ior.verwacht_datum)
    INTO v_max_io_datum
  FROM snijplannen sp3
  JOIN inkooporder_regels ior ON ior.id = sp3.verwacht_inkooporder_regel_id
  WHERE sp3.order_regel_id = NEW.order_regel_id
    AND sp3.status <> 'Geannuleerd';

  v_kandidaat := (CURRENT_DATE + (v_weken_voorraad || ' weeks')::INTERVAL)::DATE;
  IF v_max_io_datum IS NOT NULL THEN
    v_kandidaat := GREATEST(v_kandidaat, (v_max_io_datum + (v_weken_io || ' weeks')::INTERVAL)::DATE);
  END IF;

  UPDATE order_regels
  SET verzendweek = verzendweek_voor_datum(v_kandidaat),
      verzendweek_bron = 'automatisch_voorraad'
  WHERE id = NEW.order_regel_id
    AND is_maatwerk = TRUE
    AND verzendweek IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.trg_snijplan_rol_toegewezen_auto_verzendweek() IS
  'Mig 469+471: zet order_regels.verzendweek op een snapshot-datum zodra een '
  'maatwerk-regel volledig gedekt is (elk stuk heeft een rol_id ÓF een '
  'verwacht_inkooporder_regel_id) — mits nog NULL. Datum = GREATEST(vandaag + '
  'maatwerk_voorraad_levertijd_weken, MAX(IO-eta) + inkoop_buffer_weken_maatwerk) '
  'over de IO-gedekte stukken; zuiver rol-gedekte regels krijgen gewoon '
  'vandaag + N weken (mig 469-gedrag ongewijzigd).';

DROP TRIGGER IF EXISTS trg_snijplan_rol_toegewezen_auto_verzendweek ON snijplannen;
CREATE TRIGGER trg_snijplan_rol_toegewezen_auto_verzendweek
AFTER INSERT OR UPDATE OF rol_id, verwacht_inkooporder_regel_id ON snijplannen
FOR EACH ROW
EXECUTE FUNCTION trg_snijplan_rol_toegewezen_auto_verzendweek();

NOTIFY pgrst, 'reload schema';
