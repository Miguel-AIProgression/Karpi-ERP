-- Migratie 399: colli-afmetingen single-source — lengte_cm/breedte_cm op
-- zending_colli (repo-nr 399; check vlak vóór merge opnieuw t.o.v. origin/main,
--  parallelle sessies claimen nummers).
--
-- Aanleiding (architectuur-review 2026-06-14, candidate #2 van de SSCC-analogen-
-- audit): zending_colli.gewicht_kg (mig 387), omschrijving_snapshot (mig 209) en
-- klant_omschrijving_snapshot (mig 390) zijn BEVROREN snapshots die álle carriers
-- uit dezelfde rij lezen — single source. Maar lengte_cm/breedte_cm stonden NIET
-- op zending_colli: rhenus-send én verhoek-send haalden ze LIVE op via een
-- hand-gekopieerde ladder `order_regels.maatwerk_*_cm ?? producten.*_cm`. Twee
-- adapters met dezelfde ladder = een seam die nog niet bestond:
--   * de ladder wijzigen raakt 3 plekken (deze functie + 2 orchestrators) →
--     "één vergeten" = stille divergentie tussen label/pakbon en vrachtbrief;
--   * na een live productmaat-wijziging kan een carrier een ANDERE afmeting
--     versturen dan de bevroren colli (label/pakbon lezen al snapshots).
-- Dit trekt het snapshot-patroon (gewicht/omschrijving) door naar afmetingen:
-- één canonieke bevroren bron op zending_colli die de carriers lézen.
--
-- COÖRDINATIE / SUPERSET-DRIFT: §3 doet CREATE OR REPLACE genereer_zending_colli
-- en is bewust de SUPERSET van mig 390 (= zelf al superset van mig 387):
-- gewicht-ladder + klant_omschrijving + NU lengte_cm/breedte_cm. Mis je iets uit
-- de mig-390-body, dan verlies je gewicht-ladder of klant-omschrijving. Omdat
-- 399 > 390 landt deze als laatste → alle wijzigingen overleven. Verifieer bij
-- apply met pg_get_functiondef dat de live-body exact deze superset is (drift).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Nieuwe kolommen
-- ============================================================================
-- INTEGER: de ladder rondt al af (::INTEGER in de record; Rhenus deed Math.round
-- op depth). Hele cm is wat Verhoek (Lengte/Breedte in hele cm) en Rhenus
-- (dimension/depth) versturen.
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS lengte_cm  INTEGER;
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS breedte_cm INTEGER;

COMMENT ON COLUMN zending_colli.lengte_cm IS
  'Mig 399: bevroren colli-lengte (cm) op moment van colli-aanmaak — '
  'COALESCE(order_regels.maatwerk_lengte_cm, producten.lengte_cm). Single source '
  'voor de afmeting die Rhenus (dimension/depth) en Verhoek (Lengte) versturen; '
  'de carriers leiden niets meer live af. NULL = onbekend (carrier-preflight '
  'beslist of dat blokkeert — Rhenus eist lengte, Verhoek lengte+breedte).';
COMMENT ON COLUMN zending_colli.breedte_cm IS
  'Mig 399: bevroren colli-breedte (cm) — COALESCE(order_regels.maatwerk_breedte_cm, '
  'producten.breedte_cm). Zie lengte_cm. Verhoek eist dit per colli; Rhenus stuurt '
  'alleen depth (=lengte) en raakt dit niet.';

-- ============================================================================
-- §2. genereer_zending_colli — SUPERSET van mig 390 (gewicht-ladder +
--     klant_omschrijving) + lengte_cm/breedte_cm
-- ============================================================================
-- De record r rekent maatwerk_*/prod_* al uit (gebruikt door
-- compose_colli_omschrijving). We persisteren ze nu óók als eigen kolom —
-- exact de carrier-ladder, nu in SQL.
CREATE OR REPLACE FUNCTION genereer_zending_colli(p_zending_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_aantal_aangemaakt INTEGER := 0;
  v_volgnr            INTEGER := 0;
  r                   RECORD;
  i                   INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  -- Skip als al colli's bestaan
  IF EXISTS (SELECT 1 FROM zending_colli WHERE zending_id = p_zending_id) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT
      zr.id              AS zending_regel_id,
      zr.order_regel_id,
      zr.artikelnr,
      zr.rol_id,
      zr.aantal,
      ore.is_maatwerk,
      ore.maatwerk_lengte_cm::INTEGER  AS maatwerk_lengte_cm,
      ore.maatwerk_breedte_cm::INTEGER AS maatwerk_breedte_cm,
      ore.maatwerk_afwerking,
      ore.omschrijving    AS regel_omschrijving,
      ore.omschrijving_2  AS regel_omschrijving_2,
      p.omschrijving      AS product_naam,
      p.lengte_cm         AS prod_lengte_cm,
      p.breedte_cm        AS prod_breedte_cm,
      p.gewicht_kg        AS prod_gewicht_kg,
      ore.gewicht_kg      AS regel_gewicht_kg,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
      k.omschrijving      AS kwaliteit_naam
    FROM zending_regels zr
    LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
    LEFT JOIN producten p     ON p.artikelnr = zr.artikelnr
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot,
        lengte_cm, breedte_cm, aantal
      ) VALUES (
        p_zending_id,
        v_volgnr,
        r.order_regel_id,
        r.rol_id,
        genereer_sscc(),
        -- Mig 387 gewicht-ladder: regel-cache (respecteert eventuele
        -- handmatige correctie; 0 = ontbreekt) → live resolver (vorm-aware,
        -- ook maatwerk) → product-cache als laatste vangnet.
        COALESCE(
          NULLIF(r.regel_gewicht_kg, 0),
          bereken_orderregel_gewicht_kg(r.order_regel_id),
          NULLIF(r.prod_gewicht_kg, 0)
        ),
        compose_colli_omschrijving(
          r.is_maatwerk, r.kwaliteit_code, r.kwaliteit_naam,
          r.maatwerk_lengte_cm, r.maatwerk_breedte_cm, r.maatwerk_afwerking,
          r.product_naam, r.prod_lengte_cm, r.prod_breedte_cm
        ),
        -- Mig 390: bevroren klant-omschrijving (single source voor label/pakbon).
        compose_klant_omschrijving(r.regel_omschrijving, r.regel_omschrijving_2),
        -- Mig 399: bevroren afmetingen (single source voor Rhenus/Verhoek) —
        -- exact de carrier-ladder maatwerk → product.
        COALESCE(r.maatwerk_lengte_cm,  r.prod_lengte_cm),
        COALESCE(r.maatwerk_breedte_cm, r.prod_breedte_cm),
        1
      );
      v_aantal_aangemaakt := v_aantal_aangemaakt + 1;
    END LOOP;
  END LOOP;

  UPDATE zendingen SET aantal_colli = v_aantal_aangemaakt WHERE id = p_zending_id;

  RETURN v_aantal_aangemaakt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION genereer_zending_colli(BIGINT) TO authenticated;

COMMENT ON FUNCTION genereer_zending_colli(BIGINT) IS
  'Mig 399 (superset van mig 390 → 387): gewicht-ladder NULLIF(regel,0) → '
  'bereken_orderregel_gewicht_kg (live, vorm-aware) → NULLIF(product-cache,0); '
  'klant_omschrijving_snapshot (compose_klant_omschrijving); PLUS '
  'lengte_cm/breedte_cm = COALESCE(maatwerk_*, product_*). 1 colli per stuk, '
  'idempotent, SSCC + alle snapshots per colli — single source voor label, '
  'pakbon en carrier-XML.';

-- ============================================================================
-- §3. Backfill — afmetingen voor niet-verzonden zendingen
-- ============================================================================
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden.
-- Zelfde guard + ladder als mig 390 §4. Eén UPDATE vult beide kolommen; de
-- WHERE-clausule pakt rijen waar minstens één afmeting nog NULL is.
UPDATE zending_colli zc
SET lengte_cm  = COALESCE(ore.maatwerk_lengte_cm::INTEGER,  p.lengte_cm),
    breedte_cm = COALESCE(ore.maatwerk_breedte_cm::INTEGER, p.breedte_cm)
FROM zending_regels zr
JOIN order_regels ore ON ore.id = zr.order_regel_id
LEFT JOIN producten p ON p.artikelnr = zr.artikelnr
JOIN zendingen z      ON z.id = zr.zending_id
WHERE zr.zending_id = zc.zending_id
  AND zr.order_regel_id = zc.order_regel_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND (zc.lengte_cm IS NULL OR zc.breedte_cm IS NULL);

-- ============================================================================
-- §4. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_leeg INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_leeg
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  JOIN zending_regels zr ON zr.zending_id = zc.zending_id AND zr.order_regel_id = zc.order_regel_id
  LEFT JOIN order_regels ore ON ore.id = zc.order_regel_id
  LEFT JOIN producten p ON p.artikelnr = zr.artikelnr
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND zc.lengte_cm IS NULL
    AND COALESCE(ore.maatwerk_lengte_cm::INTEGER, p.lengte_cm) IS NOT NULL;

  RAISE NOTICE 'Mig 399 verifier: niet-verzonden colli met lege lengte-snapshot terwijl er wel een afmeting is: % (verwacht 0)', v_leeg;
END $$;

NOTIFY pgrst, 'reload schema';
