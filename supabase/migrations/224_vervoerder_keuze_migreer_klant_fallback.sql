-- Migratie 224: vervoerder-keuze — migreer klant-fallback naar verzendregels
--
-- ADR-0008: klant-fallback vervalt; regel-engine wordt leidend.
--
-- Voor elke debiteur met een niet-NULL `edi_handelspartner_config.vervoerder_code`
-- maken we één rij in `vervoerder_selectie_regels` met conditie
-- `{debiteur_nrs: [debiteur_nr]}` en prio 9000 (laag — specifiekere regels op
-- land/gewicht/inkoopgroep gaan voor; klant-default is laatste keuze voor regel
-- "matcht").
--
-- Idempotent: gebruikt unieke notitie-marker om dubbele inserts te voorkomen
-- bij hertesten of als migratie meerdere keren draait.
--
-- Geen schema-wijziging in deze migratie — kolom `vervoerder_code` blijft nog
-- bestaan tot migratie 226.

DO $$
DECLARE
  v_aantal INTEGER;
BEGIN
  -- Voorwaarde: tabellen + kolommen bestaan (idempotent guard).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'edi_handelspartner_config'
       AND column_name = 'vervoerder_code'
  ) THEN
    RAISE NOTICE 'Mig 224: kolom edi_handelspartner_config.vervoerder_code bestaat niet meer — migratie wordt overgeslagen';
    RETURN;
  END IF;

  -- Auto-genereer regels uit niet-NULL klant-fallbacks die nog niet zijn gemigreerd.
  INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, actief, notitie, service_code)
  SELECT
    ehc.vervoerder_code,
    9000,
    jsonb_build_object('debiteur_nrs', jsonb_build_array(ehc.debiteur_nr)),
    TRUE,
    'Auto-gemigreerd uit klant-fallback (ADR-0008, mig 224) — debiteur ' || ehc.debiteur_nr,
    NULL
  FROM edi_handelspartner_config ehc
  JOIN vervoerders v ON v.code = ehc.vervoerder_code
  WHERE ehc.vervoerder_code IS NOT NULL
    -- Idempotentie: zoek bestaande regel met exact deze conditie + notitie-marker.
    AND NOT EXISTS (
      SELECT 1 FROM vervoerder_selectie_regels vsr
       WHERE vsr.vervoerder_code = ehc.vervoerder_code
         AND vsr.conditie = jsonb_build_object('debiteur_nrs', jsonb_build_array(ehc.debiteur_nr))
         AND vsr.notitie LIKE 'Auto-gemigreerd uit klant-fallback%'
    );

  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RAISE NOTICE 'Mig 224: % verzendregels aangemaakt uit klant-fallbacks', v_aantal;
END
$$;

NOTIFY pgrst, 'reload schema';

-- Idempotentie-assertie: aantal auto-gemigreerde regels mag MAX 1× per debiteur zijn.
DO $$
DECLARE
  v_dups INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dups FROM (
    SELECT conditie->'debiteur_nrs', vervoerder_code, COUNT(*) AS n
      FROM vervoerder_selectie_regels
     WHERE notitie LIKE 'Auto-gemigreerd uit klant-fallback%'
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
  ) sub;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Mig 224: idempotentie-fout — % duplicaat-rijen in vervoerder_selectie_regels', v_dups;
  END IF;
END
$$;
