-- Migration 139: Map1 → collectie-gaps dichten
--
-- Resultaat van `SELECT * FROM uitwisselbaarheid_map1_diff` (na migratie 138)
-- gaf 49 rijen, allemaal categorie "input/target zonder collectie_id". Drie
-- clusters waar Map1 wel uitwisselbaarheid bevatte maar `kwaliteiten.collectie_id`
-- niet ingevuld was:
--
--   * SOPI, SOPV  → horen in dezelfde collectie als CISC/VELV (basis_code CISC*)
--   * ANNA, BREE  → eigen aliassen-paar (geen bestaande collectie)
--   * BERM, EDGB  → eigen aliassen-paar (geen bestaande collectie)
--
-- Deze migratie zet die `collectie_id` zodat `uitwisselbare_paren()` ook deze
-- paren correct teruggeeft. Geen data-verlies — Map1 blijft staan tot de
-- aparte drop-migratie.
--
-- Idempotent: alle UPDATEs guarden op `collectie_id IS NULL`; INSERT van
-- collecties via `ON CONFLICT (groep_code) DO NOTHING`.
--
-- Verificatie achteraf: `SELECT COUNT(*) FROM uitwisselbaarheid_map1_diff`
-- moet 0 zijn.

DO $$
DECLARE
  v_cisc_collectie_id BIGINT;
  v_anna_collectie_id BIGINT;
  v_berm_collectie_id BIGINT;
BEGIN
  -- ---------------------------------------------------------------------
  -- 1. SOPI + SOPV → bestaande CISC/VELV-collectie
  -- ---------------------------------------------------------------------
  SELECT collectie_id INTO v_cisc_collectie_id
  FROM kwaliteiten
  WHERE code = 'CISC';

  IF v_cisc_collectie_id IS NULL THEN
    RAISE EXCEPTION 'CISC heeft geen collectie_id — '
      'kan SOPI/SOPV niet koppelen. Repareer CISC eerst.';
  END IF;

  UPDATE kwaliteiten
  SET collectie_id = v_cisc_collectie_id
  WHERE code IN ('SOPI', 'SOPV')
    AND collectie_id IS NULL;

  -- ---------------------------------------------------------------------
  -- 2. ANNA + BREE → nieuwe collectie
  -- ---------------------------------------------------------------------
  INSERT INTO collecties (groep_code, naam, omschrijving, actief)
  VALUES ('m1anna', 'Anna/Bree', 'Aliassen-paar uit Map1 (migratie 139). '
                                 'Hernoem indien je een betere naam kent.', true)
  ON CONFLICT (groep_code) DO NOTHING;

  SELECT id INTO v_anna_collectie_id
  FROM collecties
  WHERE groep_code = 'm1anna';

  UPDATE kwaliteiten
  SET collectie_id = v_anna_collectie_id
  WHERE code IN ('ANNA', 'BREE')
    AND collectie_id IS NULL;

  -- ---------------------------------------------------------------------
  -- 3. BERM + EDGB → nieuwe collectie
  -- ---------------------------------------------------------------------
  INSERT INTO collecties (groep_code, naam, omschrijving, actief)
  VALUES ('m1berm', 'Berm/Edgb', 'Aliassen-paar uit Map1 (migratie 139). '
                                 'Hernoem indien je een betere naam kent.', true)
  ON CONFLICT (groep_code) DO NOTHING;

  SELECT id INTO v_berm_collectie_id
  FROM collecties
  WHERE groep_code = 'm1berm';

  UPDATE kwaliteiten
  SET collectie_id = v_berm_collectie_id
  WHERE code IN ('BERM', 'EDGB')
    AND collectie_id IS NULL;
END $$;
