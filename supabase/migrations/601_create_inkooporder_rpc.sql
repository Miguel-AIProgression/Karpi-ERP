-- Migratie 601: create_inkooporder(p_header, p_regels) — transactioneel aanmaken
--
-- Vervangt de 3-losse-inserts-flow in de frontend (volgend_nummer + header +
-- regels zonder rollback: een falende regel-insert liet een lege order achter)
-- én is het ene schrijfpad waar import/import_inkoopoverzicht.py's TODO al om
-- vroeg (ADR-0017: de Module is haar eigen enige writer).
-- Status altijd 'Besteld' — de Concept-fase is bewust ongebruikt (besluit
-- 2026-07-02, YAGNI). Bestaande triggers doen de rest: trg_sync_besteld_inkoop,
-- trg_io_regel_insert_swap_evaluate (swap-doelwit, mig 297/470).

CREATE OR REPLACE FUNCTION create_inkooporder(
  p_header JSONB,
  p_regels JSONB
) RETURNS TABLE(inkooporder_id BIGINT, inkooporder_nr TEXT) AS $$
DECLARE
  v_leverancier_id BIGINT := (p_header->>'leverancier_id')::BIGINT;
  v_nr TEXT;
  v_id BIGINT;
  v_regel JSONB;
  v_regelnummer INTEGER := 0;
  v_besteld NUMERIC;
  v_eenheid TEXT;
  v_artikelnr TEXT;
BEGIN
  IF v_leverancier_id IS NULL THEN
    RAISE EXCEPTION 'leverancier_id is verplicht';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM leveranciers l WHERE l.id = v_leverancier_id) THEN
    RAISE EXCEPTION 'Leverancier % bestaat niet', v_leverancier_id;
  END IF;
  IF p_regels IS NULL OR jsonb_typeof(p_regels) <> 'array' OR jsonb_array_length(p_regels) = 0 THEN
    RAISE EXCEPTION 'Minimaal één regel is verplicht';
  END IF;

  v_nr := volgend_nummer('INK');

  INSERT INTO inkooporders (
    inkooporder_nr, leverancier_id, besteldatum, leverweek, verwacht_datum,
    status, bron, opmerkingen
  ) VALUES (
    v_nr,
    v_leverancier_id,
    COALESCE(NULLIF(p_header->>'besteldatum', '')::DATE, CURRENT_DATE),
    NULLIF(p_header->>'leverweek', ''),
    NULLIF(p_header->>'verwacht_datum', '')::DATE,
    'Besteld',
    COALESCE(NULLIF(p_header->>'bron', ''), 'handmatig'),
    NULLIF(p_header->>'opmerkingen', '')
  ) RETURNING id INTO v_id;

  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels) LOOP
    v_regelnummer := v_regelnummer + 1;
    v_besteld  := (v_regel->>'besteld_m')::NUMERIC;
    v_eenheid  := COALESCE(NULLIF(v_regel->>'eenheid', ''), 'm');
    v_artikelnr := NULLIF(v_regel->>'artikelnr', '');

    IF v_besteld IS NULL OR v_besteld <= 0 THEN
      RAISE EXCEPTION 'Regel %: besteld_m moet > 0 zijn', v_regelnummer;
    END IF;
    IF v_eenheid NOT IN ('m', 'stuks') THEN
      RAISE EXCEPTION 'Regel %: eenheid moet ''m'' of ''stuks'' zijn (kreeg %)', v_regelnummer, v_eenheid;
    END IF;
    IF v_artikelnr IS NULL AND NULLIF(v_regel->>'karpi_code', '') IS NULL THEN
      RAISE EXCEPTION 'Regel %: artikelnr of karpi_code is verplicht', v_regelnummer;
    END IF;
    IF v_artikelnr IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM producten p WHERE p.artikelnr = v_artikelnr) THEN
      RAISE EXCEPTION 'Regel %: artikel % bestaat niet', v_regelnummer, v_artikelnr;
    END IF;

    INSERT INTO inkooporder_regels (
      inkooporder_id, regelnummer, artikelnr, karpi_code, artikel_omschrijving,
      inkoopprijs_eur, besteld_m, geleverd_m, te_leveren_m, eenheid
    ) VALUES (
      v_id, v_regelnummer, v_artikelnr,
      NULLIF(v_regel->>'karpi_code', ''),
      NULLIF(v_regel->>'artikel_omschrijving', ''),
      NULLIF(v_regel->>'inkoopprijs_eur', '')::NUMERIC,
      v_besteld, 0, v_besteld, v_eenheid
    );
  END LOOP;

  inkooporder_id := v_id;
  inkooporder_nr := v_nr;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_inkooporder(JSONB, JSONB) IS
  'Inkoop-Module (mig 601): transactioneel aanmaken van inkooporder + regels. '
  'Eén schrijfpad voor UI en (later) import-script. Status altijd Besteld. '
  'JSONB-valkuil: onbekende sleutels worden stil gedropt — kolomlijst hier '
  'compleet houden bij velduitbreiding.';

GRANT EXECUTE ON FUNCTION create_inkooporder(JSONB, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 601 toegepast: create_inkooporder RPC.';
END $$;
