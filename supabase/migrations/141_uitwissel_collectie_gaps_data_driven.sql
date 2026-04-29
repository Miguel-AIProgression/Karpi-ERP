-- Migration 141: Map1 → collectie-gaps data-driven dichten
--
-- De handmatige migratie 139 dekte slechts 3 clusters (ANNA/BREE, BERM/EDGB,
-- SOPI+SOPV→CISC). De diff-check toonde 154 onbedekt paren met breakdown:
--   * 138× input-kwaliteit zonder collectie_id
--   * 12×  target-kwaliteit zonder collectie_id
--   * 4×   kwaliteiten in andere collecties (genuine conflict — niet auto-fixbaar)
--
-- Deze migratie loopt over ALLE Map1-groepen `(basis_code, variant_nr)` en
-- past de eenvoudige cases aan:
--
--   Case A: geen enkel groepslid heeft een collectie_id
--     → nieuwe collectie aan (naam=basis_code), alle leden eraan koppelen
--   Case B: precies één groepslid (of meer met dezelfde collectie_id) heeft
--     een collectie, andere leden zonder
--     → andere leden aan dezelfde collectie koppelen
--   Case C: groepsleden zitten in verschillende collecties
--     → SKIP met RAISE NOTICE (manuele beslissing nodig: collecties mergen of
--       Map1-paar als foutief markeren). Zichtbaar via
--       `SELECT * FROM uitwisselbaarheid_map1_diff
--        WHERE reden = 'kwaliteiten in andere collecties'`.
--
-- Idempotent: alle UPDATEs guarden op `collectie_id IS NULL`; INSERTs via
-- `ON CONFLICT (groep_code) DO NOTHING`.

DO $$
DECLARE
  rec               RECORD;
  v_collectie_id    BIGINT;
  v_distinct_count  INT;
  v_groep_code      TEXT;
  v_aantal_case_a   INT := 0;
  v_aantal_case_b   INT := 0;
  v_aantal_case_c   INT := 0;
  v_aantal_updates  INT := 0;
BEGIN
  FOR rec IN
    SELECT
      g.basis_code,
      g.variant_nr,
      ARRAY_AGG(DISTINCT g.kwaliteit_code ORDER BY g.kwaliteit_code) AS kwaliteiten
    FROM kwaliteit_kleur_uitwisselgroepen g
    GROUP BY g.basis_code, g.variant_nr
  LOOP
    -- Hoeveel verschillende collectie_ids hebben de leden van deze groep?
    SELECT COUNT(DISTINCT k.collectie_id)
    INTO v_distinct_count
    FROM kwaliteiten k
    WHERE k.code = ANY(rec.kwaliteiten)
      AND k.collectie_id IS NOT NULL;

    IF v_distinct_count = 0 THEN
      -- Case A: nieuwe collectie aanmaken
      v_groep_code := 'm1_' || lower(rec.basis_code) || '_v' || rec.variant_nr;

      INSERT INTO collecties (groep_code, naam, omschrijving, actief)
      VALUES (
        v_groep_code,
        rec.basis_code,
        'Auto-gegenereerd uit Map1 (migratie 141). Basis ' || rec.basis_code
        || ' variant ' || rec.variant_nr || '. Hernoem indien gewenst.',
        true
      )
      ON CONFLICT (groep_code) DO NOTHING;

      SELECT id INTO v_collectie_id
      FROM collecties
      WHERE groep_code = v_groep_code;

      UPDATE kwaliteiten
      SET collectie_id = v_collectie_id
      WHERE code = ANY(rec.kwaliteiten)
        AND collectie_id IS NULL;

      GET DIAGNOSTICS v_aantal_updates = ROW_COUNT;
      IF v_aantal_updates > 0 THEN
        v_aantal_case_a := v_aantal_case_a + 1;
      END IF;

    ELSIF v_distinct_count = 1 THEN
      -- Case B: bestaande collectie — koppel ontbrekende leden eraan
      SELECT k.collectie_id INTO v_collectie_id
      FROM kwaliteiten k
      WHERE k.code = ANY(rec.kwaliteiten)
        AND k.collectie_id IS NOT NULL
      LIMIT 1;

      UPDATE kwaliteiten
      SET collectie_id = v_collectie_id
      WHERE code = ANY(rec.kwaliteiten)
        AND collectie_id IS NULL;

      GET DIAGNOSTICS v_aantal_updates = ROW_COUNT;
      IF v_aantal_updates > 0 THEN
        v_aantal_case_b := v_aantal_case_b + 1;
      END IF;

    ELSE
      -- Case C: conflict — meerdere verschillende collecties binnen één groep
      v_aantal_case_c := v_aantal_case_c + 1;
      RAISE NOTICE 'Conflict: Map1-groep % v% — leden % zitten in % verschillende collecties. Overgeslagen.',
        rec.basis_code, rec.variant_nr, rec.kwaliteiten, v_distinct_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migratie 141 samenvatting: case A (nieuwe collectie) = %, case B (uitbreiding) = %, case C (conflict, geskipt) = %',
    v_aantal_case_a, v_aantal_case_b, v_aantal_case_c;
END $$;
