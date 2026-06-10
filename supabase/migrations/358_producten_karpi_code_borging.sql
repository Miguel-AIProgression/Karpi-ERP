-- Migratie 358: karpi_code-borging op producten (trigger-guard)
--
-- Invariant (eigenaar-besluit, sluitstuk van de maatwerk-zonder-artikelnr-saga,
-- mig 356/357): nieuwe of bewerkte producten van de bewaakte klassen dragen
-- altijd een karpi_code.
--
-- Bewaakte klassen:
--   - product_type IN ('rol', 'vast')
--   - generieke MAATWERK-artikelen (omschrijving ~ '^[A-Z]+[0-9]+MAATWERK$')
-- Expliciet vrijgesteld (eigenaar-besluit):
--   - is_pseudo = TRUE (admin-pseudo, ADR-0018 — geen fysieke leverbaarheid)
--   - product_type 'overig'/'staaltje' buiten het MAATWERK-patroon
--     (banden/calibra/staaltjes hebben geen karpi_code nodig)
--
-- Gedrag bij ontbrekende karpi_code:
--   - MAATWERK-patroon: afleiden als `kwaliteit_code || kleur_code ||
--     'MAATWERK'` (catalogus-conventie, mig 356a) wanneer beide codes gevuld;
--     anders EXCEPTION.
--   - rol/vast: EXCEPTION met duidelijke NL-melding — bewust GEEN stille
--     afleiding (breedte/maat-info is niet betrouwbaar beschikbaar).
--
-- KRITIEK voor de dagelijkse voorraad-imports (update_voorraad*.py — die
-- UPDATEn alleen voorraad/vrije_voorraad/backorder/gereserveerd op legacy
-- rijen): de guard mag een ongerelateerde UPDATE op een legacy rij met NULL
-- karpi_code NOOIT laten falen. Dubbele bescherming:
--   (1) trigger als `UPDATE OF karpi_code, product_type, omschrijving` —
--       vuurt niet eens bij een kale voorraad-UPDATE;
--   (2) in de functie: bij UPDATE alleen handhaven als één van de bewaakte
--       kolommen daadwerkelijk van waarde verandert (IS DISTINCT FROM) —
--       dekt frontends/RPC's die alle kolommen in de SET-lijst meesturen
--       met ongewijzigde waarden.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; herdraaien = no-op.

BEGIN;

CREATE OR REPLACE FUNCTION producten_karpi_code_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_maatwerk_patroon BOOLEAN;
BEGIN
  -- (1) Alleen handhaven op INSERT, of op UPDATEs die een bewaakte kolom
  --     daadwerkelijk wijzigen. Een legacy rij (karpi_code NULL) waarvan
  --     alleen voorraad/locatie/etc. muteert, passeert hier altijd.
  IF TG_OP = 'UPDATE'
     AND NEW.karpi_code   IS NOT DISTINCT FROM OLD.karpi_code
     AND NEW.product_type IS NOT DISTINCT FROM OLD.product_type
     AND NEW.omschrijving IS NOT DISTINCT FROM OLD.omschrijving THEN
    RETURN NEW;
  END IF;

  -- (2) Vrijstellingen: admin-pseudo nooit bewaakt.
  IF COALESCE(NEW.is_pseudo, FALSE) THEN
    RETURN NEW;
  END IF;

  v_is_maatwerk_patroon := NEW.omschrijving ~ '^[A-Z]+[0-9]+MAATWERK$';

  -- (3) Buiten scope: overig/staaltje (of type NULL) zonder MAATWERK-patroon.
  IF NOT v_is_maatwerk_patroon
     AND (NEW.product_type IS NULL OR NEW.product_type NOT IN ('rol', 'vast')) THEN
    RETURN NEW;
  END IF;

  -- (4) karpi_code aanwezig → klaar.
  IF NEW.karpi_code IS NOT NULL AND btrim(NEW.karpi_code) <> '' THEN
    RETURN NEW;
  END IF;

  -- (5) MAATWERK-patroon: afleiden volgens catalogus-conventie (mig 356a).
  IF v_is_maatwerk_patroon THEN
    IF NEW.kwaliteit_code IS NOT NULL AND btrim(NEW.kwaliteit_code) <> ''
       AND NEW.kleur_code IS NOT NULL AND btrim(NEW.kleur_code) <> '' THEN
      NEW.karpi_code := NEW.kwaliteit_code || NEW.kleur_code || 'MAATWERK';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Karpi-code is verplicht voor MAATWERK-artikel % en kan niet afgeleid worden: vul kwaliteit- en kleurcode (of de Karpi-code zelf) in.',
      NEW.artikelnr
      USING ERRCODE = 'KA358';
  END IF;

  -- (6) rol/vast zonder karpi_code: hard weigeren, geen stille afleiding.
  RAISE EXCEPTION 'Karpi-code is verplicht voor producten van type ''%'' (artikelnr %): vul de Karpi-code in.',
    NEW.product_type, NEW.artikelnr
    USING ERRCODE = 'KA358';
END;
$$;

DROP TRIGGER IF EXISTS trg_producten_karpi_code_guard ON producten;
CREATE TRIGGER trg_producten_karpi_code_guard
  BEFORE INSERT OR UPDATE OF karpi_code, product_type, omschrijving
  ON producten
  FOR EACH ROW
  EXECUTE FUNCTION producten_karpi_code_guard();

-- ============================================================================
-- Zelf-test
-- ============================================================================
DO $$
DECLARE
  v_guard_ok    BOOLEAN := FALSE;
  v_legacy_null INT;
BEGIN
  -- (1) Trigger bestaat.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'producten'
      AND t.tgname = 'trg_producten_karpi_code_guard'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAAL mig 358: trigger trg_producten_karpi_code_guard niet gevonden op producten';
  END IF;
  RAISE NOTICE 'Mig 358: zelf-test (1) OK — trigger bestaat';

  -- (2) Subtransactie: dummy `vast`-product zonder karpi_code moet falen
  --     met onze eigen SQLSTATE 'KA358'. Elke andere fout = migratie-fout.
  BEGIN
    INSERT INTO producten (artikelnr, omschrijving, product_type, actief)
    VALUES ('_MIG358_GUARDTEST', 'MIG358 GUARD TESTPRODUCT', 'vast', FALSE);
    -- Hier komen = guard heeft NIET gevuurd: opruimen en falen.
    DELETE FROM producten WHERE artikelnr = '_MIG358_GUARDTEST';
  EXCEPTION
    WHEN SQLSTATE 'KA358' THEN
      v_guard_ok := TRUE;  -- verwachte weigering; subtransactie is teruggerold
    WHEN OTHERS THEN
      RAISE EXCEPTION 'FAAL mig 358: testinsert faalde met onverwachte fout (%, SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  IF NOT v_guard_ok THEN
    RAISE EXCEPTION 'FAAL mig 358: guard weigerde het vast-testproduct zonder karpi_code NIET';
  END IF;
  RAISE NOTICE 'Mig 358: zelf-test (2) OK — vast-product zonder karpi_code geweigerd (KA358)';

  -- (3) Informatief: resterende legacy rol/vast-rijen zonder karpi_code
  --     (na mig 356 + handmatige fixes verwacht ~0-4). Geen EXCEPTION —
  --     legacy rijen worden bewust gegrandfatherd zolang hun bewaakte
  --     kolommen niet muteren.
  SELECT COUNT(*) INTO v_legacy_null
  FROM producten
  WHERE product_type IN ('rol', 'vast')
    AND COALESCE(is_pseudo, FALSE) = FALSE
    AND (karpi_code IS NULL OR btrim(karpi_code) = '');
  RAISE NOTICE 'Mig 358: zelf-test (3) — % legacy rol/vast-rij(en) zonder karpi_code (informatief)', v_legacy_null;
END $$;

COMMIT;
