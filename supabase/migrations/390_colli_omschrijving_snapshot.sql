-- Migratie 390: colli-omschrijving single-source — klant_omschrijving_snapshot
-- (repo-nr 390; vlak vóór merge hernummerd 388→389→390 — origin/main claimde
--  intussen 388 (maatwerk_vorm_contour) en 389 (normaliseer_land_contract). In
--  de live DB op 13-06 toegepast als werknummer 388; idempotent, inhoudelijk gelijk.)
--
-- Aanleiding (SSCC-analogen-audit 2026-06-13): de productomschrijving op het
-- verzendlabel, de pakbon en het DPD-label werd LIVE uit order_regels/producten
-- afgeleid — met DRIE verschillende ontdubbel-varianten (label: substring-match,
-- pakbon: geen, DPD: eigen logica) — terwijl HST/Verhoek de BEVROREN snapshot
-- zending_colli.omschrijving_snapshot lezen. Na een productnaamwijziging tonen
-- label, pakbon en vrachtbrief dus drie verschillende teksten voor hetzelfde
-- collo. Dit trekt het SSCC-patroon (één canonieke bron) door naar omschrijving.
--
-- De bestaande omschrijving_snapshot (Karpi-product + maat, compose_colli_omschrijving
-- mig 209) blijft wat de vervoerders al lezen. Wat ontbrak is de KLANT-omschrijving
-- (order_regels.omschrijving + _2, ontdubbeld) die label/pakbon apart tonen. We
-- voegen daarvoor één kolom toe en bevriezen de ontdubbelde klant-omschrijving —
-- de ontdubbeling verhuist daarmee van 3 TS-varianten naar één SQL-plek.
--
-- COÖRDINATIE met de gewicht-sessie (mig 387, fix/colli-gewicht): die migratie
-- doet óók CREATE OR REPLACE genereer_zending_colli (gewicht-ladder). De §3 hier
-- is bewust de SUPERSET van die 387-body: gewicht-ladder ÉN klant_omschrijving.
-- Omdat 390 > 387 landt deze versie als laatste → beide wijzigingen overleven.
-- Verifieer bij apply met pg_get_functiondef dat de live-body niet méér bevat
-- dan deze superset (drift-check).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Nieuwe kolom
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS klant_omschrijving_snapshot TEXT;

COMMENT ON COLUMN zending_colli.klant_omschrijving_snapshot IS
  'Mig 390: bevroren klant-omschrijving (order_regels.omschrijving + _2, '
  'ontdubbeld via compose_klant_omschrijving) op moment van colli-aanmaak. '
  'Single source voor de klant-naam op verzendlabel/pakbon/DPD-label — de '
  'print-laag leidt niets meer live af. NULL = geen klant-omschrijving (label '
  'valt terug op artikelnr).';

-- ============================================================================
-- §2. compose_klant_omschrijving — ontdubbeling in SQL (spiegelt productNamen)
-- ============================================================================
-- Repliceert exact de TS-ontdubbeling uit shipping-label-data.ts:16-23:
--   o1 = trim(omschrijving); o2 = trim(omschrijving_2)
--   laat o2 weg als lower(o1) de lower(o2) als substring bevat (bv.
--   "RUBI 15 — RECHTHOEK / 240 X 330 CM" + "RECHTHOEK / 240 X 330 CM").
-- Geen regex nodig (memory reference_postgres_woordgrens_regex: \b = backspace).
CREATE OR REPLACE FUNCTION compose_klant_omschrijving(
  p_omschrijving   TEXT,
  p_omschrijving_2 TEXT
) RETURNS TEXT AS $$
DECLARE
  v_o1     TEXT := btrim(COALESCE(p_omschrijving, ''));
  v_o2     TEXT := btrim(COALESCE(p_omschrijving_2, ''));
  v_dubbel BOOLEAN;
BEGIN
  v_dubbel := v_o2 <> '' AND POSITION(lower(v_o2) IN lower(v_o1)) > 0;
  RETURN NULLIF(btrim(
    v_o1 || CASE WHEN v_o2 <> '' AND NOT v_dubbel THEN ' ' || v_o2 ELSE '' END
  ), '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION compose_klant_omschrijving IS
  'Mig 390: ontdubbelde klant-omschrijving uit order_regels.omschrijving + _2. '
  'Spiegelt de TS-ontdubbeling van productNamen (shipping-label-data.ts) — sinds '
  'deze migratie de enige plek waar die logica leeft. Gebruikt door '
  'genereer_zending_colli; mag los aangeroepen worden voor preview.';

-- ============================================================================
-- §3. genereer_zending_colli — SUPERSET van mig 387 (gewicht-ladder) +
--     klant_omschrijving_snapshot
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
    LEFT JOIN producten p     ON p.artikelnr = zr.artikelnr
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot, aantal
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
  'Mig 390 (superset van mig 387): gewicht-ladder NULLIF(regel,0) → '
  'bereken_orderregel_gewicht_kg (live, vorm-aware) → NULLIF(product-cache,0) '
  'PLUS klant_omschrijving_snapshot (compose_klant_omschrijving). Verder '
  'identiek aan mig 213: 1 colli per stuk, idempotent, SSCC + '
  'omschrijving-snapshots per colli.';

-- ============================================================================
-- §4. Backfill — klant_omschrijving_snapshot voor niet-verzonden zendingen
-- ============================================================================
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden.
UPDATE zending_colli zc
SET klant_omschrijving_snapshot = compose_klant_omschrijving(ore.omschrijving, ore.omschrijving_2)
FROM zending_regels zr
JOIN order_regels ore ON ore.id = zr.order_regel_id
JOIN zendingen z      ON z.id = zr.zending_id
WHERE zr.zending_id = zc.zending_id
  AND zr.order_regel_id = zc.order_regel_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND zc.klant_omschrijving_snapshot IS NULL;

-- ============================================================================
-- §5. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_leeg INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_leeg
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  JOIN zending_regels zr ON zr.zending_id = zc.zending_id AND zr.order_regel_id = zc.order_regel_id
  JOIN order_regels ore ON ore.id = zc.order_regel_id
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND zc.klant_omschrijving_snapshot IS NULL
    AND compose_klant_omschrijving(ore.omschrijving, ore.omschrijving_2) IS NOT NULL;

  RAISE NOTICE 'Mig 390 verifier: niet-verzonden colli met lege klant-snapshot terwijl er wel een omschrijving is: % (verwacht 0)', v_leeg;
END $$;

NOTIFY pgrst, 'reload schema';
