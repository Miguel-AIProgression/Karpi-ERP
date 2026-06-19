-- Migratie 433: zendingen-overzicht toont het AANGEMELDE aantal colli (na bundeling)
--
-- Aanleiding (gebruiker 2026-06-19): in het Zendingen-overzicht stond bij COLLI
-- altijd het fysieke aantal colli, ook nadat de operator binnen een (Rhenus-)
-- zending meerdere colli onder één bundel-SSCC had samengepakt (mig 420). Wat
-- de vervoerder krijgt aangemeld is echter het AANTAL na bundeling: bundelen
-- 3 colli naar 1 → er moet 1 staan, niet 3.
--
-- Single-source-fix: `zendingen.aantal_colli` wordt voortaan afgeleid van de
-- "aangemelde" colli — exact de rijen die label/pakbon/carrier-bericht óók al
-- als 1 collo tellen: `bundel_colli_id IS NULL` (= de bundel-rij + alle niet-
-- gebundelde colli; de onderliggende kind-colli tellen niet mee). Dat is hetzelfde
-- predicaat dat mig 420 in `enqueue_zending_naar_vervoerder`, `fetch-zending-colli`
-- en `bouwVerzenddocument` hanteert. Het Zendingen-overzicht leest `aantal_colli`
-- rechtstreeks, dus na deze fix klopt het getal zonder frontend-wijziging.
--
-- Meegenomen latente bug (zelfde categorie): `sync_zending_totaal_gewicht`
-- (mig 391) somde `gewicht_kg` over ÁLLE colli. De bundel-rij krijgt
-- `gewicht_kg = SUM(kinderen)` (maak_colli_bundel §3), dus na bundeling werd het
-- gewicht DUBBEL geteld (kinderen + bundel-rij). Hetzelfde `bundel_colli_id IS NULL`-
-- filter telt het aangemelde gewicht 1×. We vervangen die trigger door één
-- gecombineerde aggregaten-trigger die zowel `aantal_colli` als `totaal_gewicht_kg`
-- correct afleidt — één UPDATE, één bron van waarheid voor de zending-colli-aggregaten.
--
-- Trigger vuurt nu óók op `UPDATE OF bundel_colli_id`: bij maak_colli_bundel wordt
-- éérst de bundel-rij geïnsert (kinderen nog niet gemarkeerd → tijdelijk te hoog)
-- en daarna `bundel_colli_id` op de kinderen gezet — die laatste UPDATE moet de
-- aggregaten herberekenen naar de juiste eindstaat.
--
-- Bundel-lock (mig 230): die lockt orders.afleverdatum/afl_*/debiteur_nr, niet de
-- zendingen-aggregaten → deze sync mag op actieve bundels draaien (zoals mig 391).

CREATE OR REPLACE FUNCTION sync_zending_colli_aggregaten()
RETURNS TRIGGER AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  v_zending_id := COALESCE(NEW.zending_id, OLD.zending_id);
  UPDATE zendingen z
  SET aantal_colli = (
        SELECT COUNT(*)
        FROM zending_colli c
        WHERE c.zending_id = v_zending_id
          AND c.bundel_colli_id IS NULL
      ),
      totaal_gewicht_kg = (
        SELECT COALESCE(SUM(c.gewicht_kg), 0)
        FROM zending_colli c
        WHERE c.zending_id = v_zending_id
          AND c.bundel_colli_id IS NULL
      )
  WHERE z.id = v_zending_id;
  RETURN NULL; -- AFTER-trigger: returnwaarde wordt genegeerd
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_zending_colli_aggregaten IS
  'Mig 433: houdt zendingen.aantal_colli + .totaal_gewicht_kg gelijk aan de '
  'AANGEMELDE colli (zending_colli WHERE bundel_colli_id IS NULL) — de bundel-rij '
  'telt als 1 collo, de gebundelde kind-colli niet. Vervangt sync_zending_totaal_'
  'gewicht (mig 391, dat over alle colli somde en na bundeling dubbel telde). '
  'Vuurt bij INSERT/DELETE/UPDATE OF gewicht_kg,bundel_colli_id op zending_colli.';

-- Oude gewicht-only trigger (mig 391) vervangen door de gecombineerde versie.
DROP TRIGGER IF EXISTS trg_sync_zending_totaal_gewicht ON zending_colli;
DROP TRIGGER IF EXISTS trg_sync_zending_colli_aggregaten ON zending_colli;
CREATE TRIGGER trg_sync_zending_colli_aggregaten
  AFTER INSERT OR DELETE OR UPDATE OF gewicht_kg, bundel_colli_id ON zending_colli
  FOR EACH ROW
  EXECUTE FUNCTION sync_zending_colli_aggregaten();

-- De oude functie is nu ongebruikt (geen trigger meer). Laten staan zou dode code
-- zijn; droppen is veilig — geen andere caller (alleen mig 391's trigger).
DROP FUNCTION IF EXISTS sync_zending_totaal_gewicht();

-- Eenmalige backfill voor niet-verzonden zendingen met colli-rijen. Verzonden/
-- afgeleverde zendingen bewust ongemoeid (historie zoals die de deur uit ging).
UPDATE zendingen z
SET aantal_colli      = sub.aantal,
    totaal_gewicht_kg = sub.som
FROM (
  SELECT zending_id,
         COUNT(*)                   AS aantal,
         COALESCE(SUM(gewicht_kg), 0) AS som
  FROM zending_colli
  WHERE bundel_colli_id IS NULL
  GROUP BY zending_id
) sub
WHERE z.id = sub.zending_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND (z.aantal_colli IS DISTINCT FROM sub.aantal
       OR z.totaal_gewicht_kg IS DISTINCT FROM sub.som);

-- Verifier-rapport
DO $$
DECLARE
  v_mismatch INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_mismatch
  FROM zendingen z
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND EXISTS (SELECT 1 FROM zending_colli c WHERE c.zending_id = z.id)
    AND (
      z.aantal_colli IS DISTINCT FROM (
        SELECT COUNT(*) FROM zending_colli c
        WHERE c.zending_id = z.id AND c.bundel_colli_id IS NULL
      )
      OR z.totaal_gewicht_kg IS DISTINCT FROM (
        SELECT COALESCE(SUM(c.gewicht_kg), 0) FROM zending_colli c
        WHERE c.zending_id = z.id AND c.bundel_colli_id IS NULL
      )
    );
  RAISE NOTICE 'Mig 433 verifier: niet-verzonden zendingen met aggregaat <> aangemelde colli: % (verwacht 0)', v_mismatch;
END $$;

NOTIFY pgrst, 'reload schema';
