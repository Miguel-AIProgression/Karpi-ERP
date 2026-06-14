-- Migratie 400: colli product-join fix — genereer_zending_colli joinde producten
-- via de ALTIJD-LEGE zending_regels.artikelnr (repo-nr 400; check vlak vóór merge
--  opnieuw t.o.v. origin/main — parallelle sessies claimen nummers).
--
-- Aanleiding (Rhenus go-live canary 2026-06-14): de canary-zending kreeg een colli
-- met lengte_cm=null ÉN lege omschrijving_snapshot, terwijl het een vast product
-- (526310144, 200x290, 7,25 kg) betrof. Rhenus-preflight eist lengte_cm>0 per colli
-- (capability-registry `colliVelden`) → de transportorder zou op Fout belanden en
-- de hele DE-cutover blokkeren.
--
-- KERNOORZAAK: genereer_zending_colli (t/m mig 399) joint
--     LEFT JOIN producten p ON p.artikelnr = zr.artikelnr
-- maar `zending_regels.artikelnr` wordt NERGENS gevuld — de membership-INSERT in
-- start_pickronden (mig 248/373/395) zet alleen (zending_id, order_regel_id, aantal).
-- De kolom is dus structureel NULL; de bron-van-waarheid is order_regel_id →
-- order_regels.artikelnr. Daardoor kwamen product_naam + prod_lengte_cm + prod_breedte_cm
-- altijd als NULL binnen:
--   * lengte_cm/breedte_cm (mig 399) → COALESCE(maatwerk=NULL, product=NULL) = NULL
--     voor élk VAST product (werkte alleen toevallig voor maatwerk, dat de maat op
--     order_regels.maatwerk_*_cm draagt);
--   * omschrijving_snapshot (mig 209) → compose_colli_omschrijving kreeg product_naam=NULL
--     → lege string voor álle zendingen;
--   * de gewicht-ladder (mig 387) overleefde alleen omdat die regel-cache/resolver
--     vóór de product-fallback gebruikt.
--
-- FIX: join producten/kwaliteiten via COALESCE(ore.artikelnr, zr.artikelnr) — het
-- order_regel is de bron. (fysiek_artikelnr bij omstickeren is bewust buiten scope:
-- uitwisselbare producten hebben ~gelijke maat, en het label toont per ADR het
-- originele artikel; gewicht loopt al via de regel/resolver-ladder.)
--
-- SUPERSET-DRIFT: §2 doet CREATE OR REPLACE genereer_zending_colli en is de SUPERSET
-- van mig 399 (= superset van 390 → 387): gewicht-ladder + klant_omschrijving +
-- lengte_cm/breedte_cm, met UITSLUITEND de twee joins gecorrigeerd. Omdat 400 > 399
-- landt deze als laatste. Verifieer bij apply met pg_get_functiondef dat de live-body
-- exact deze superset is.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Kolommen (vangnet — normaal al door mig 399 toegevoegd)
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS lengte_cm  INTEGER;
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS breedte_cm INTEGER;

-- ============================================================================
-- §2. genereer_zending_colli — mig 399-superset met gecorrigeerde product-join
-- ============================================================================
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
    -- Mig 400: join via het order_regel-artikel (zr.artikelnr is altijd NULL).
    LEFT JOIN producten p     ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
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
        -- Mig 399/400: bevroren afmetingen (single source voor Rhenus/Verhoek) —
        -- carrier-ladder maatwerk → product, nu met werkende product-join.
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
  'Mig 400 (superset van mig 399 → 390 → 387): gewicht-ladder + '
  'klant_omschrijving_snapshot + lengte_cm/breedte_cm; product-join nu via '
  'COALESCE(order_regels.artikelnr, zending_regels.artikelnr) i.p.v. de '
  'altijd-lege zending_regels.artikelnr. 1 colli per stuk, idempotent, SSCC + '
  'alle snapshots per colli — single source voor label, pakbon en carrier-XML.';

-- ============================================================================
-- §3. Backfill — afmetingen + omschrijving voor niet-verzonden zendingen
-- ============================================================================
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden.
-- Herstelt zowel de NULL-afmetingen (mig 399-bug) als de leeg-gebleven
-- omschrijving_snapshot (zelfde kapotte join). Eén UPDATE met de correcte join.
UPDATE zending_colli zc
SET lengte_cm  = COALESCE(ore.maatwerk_lengte_cm::INTEGER,  p.lengte_cm),
    breedte_cm = COALESCE(ore.maatwerk_breedte_cm::INTEGER, p.breedte_cm),
    omschrijving_snapshot = compose_colli_omschrijving(
      ore.is_maatwerk,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
      k.omschrijving,
      ore.maatwerk_lengte_cm::INTEGER, ore.maatwerk_breedte_cm::INTEGER, ore.maatwerk_afwerking,
      p.omschrijving, p.lengte_cm, p.breedte_cm
    )
FROM zending_regels zr
JOIN order_regels ore  ON ore.id = zr.order_regel_id
LEFT JOIN producten p  ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
LEFT JOIN kwaliteiten k ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
JOIN zendingen z       ON z.id = zr.zending_id
WHERE zr.zending_id = zc.zending_id
  AND zr.order_regel_id = zc.order_regel_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd');

-- ============================================================================
-- §4. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_leeg_lengte INTEGER;
  v_leeg_oms    INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_leeg_lengte
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  JOIN zending_regels zr ON zr.zending_id = zc.zending_id AND zr.order_regel_id = zc.order_regel_id
  LEFT JOIN order_regels ore ON ore.id = zc.order_regel_id
  LEFT JOIN producten p ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND zc.lengte_cm IS NULL
    AND COALESCE(ore.maatwerk_lengte_cm::INTEGER, p.lengte_cm) IS NOT NULL;

  SELECT COUNT(*) INTO v_leeg_oms
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND COALESCE(btrim(zc.omschrijving_snapshot), '') = '';

  RAISE NOTICE 'Mig 400 verifier: niet-verzonden colli met lege lengte terwijl er een afmeting is: % (verwacht 0); met lege omschrijving_snapshot: % (verwacht ~0)', v_leeg_lengte, v_leeg_oms;
END $$;

NOTIFY pgrst, 'reload schema';
