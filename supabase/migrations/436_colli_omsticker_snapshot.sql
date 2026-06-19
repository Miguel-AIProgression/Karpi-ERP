-- Migratie 436: omsticker-artikel op het verzendlabel (OMB-regel).
--
-- Aanleiding (melding 19-06, ORD-2026-0672 / ZEND-2026-0108): bij een order waar
-- de allocator een EQUIVALENT product pakt (omstickeren) toont het verzendlabel
-- alleen de code van het BESTELDE product. De magazijnier/picker ziet dan niet
-- welk fysiek artikel hij omsticker. Voorbeeld: besteld RACC23XX200290 (RACCOON),
-- fysiek gepakt 522230003 = TIFF23XX200290 → label moet onder de productregel
-- "OMB: TIFF23XX200290" tonen.
--
-- BELANGRIJK: de omsticker gebeurt hier AUTOMATISCH — order_reserveringen-rij met
-- is_handmatig=FALSE en bron='voorraad'. Detectie is dus puur
-- fysiek_artikelnr <> order_regels.artikelnr (NIET filteren op is_handmatig); dat
-- spiegelt de order-detail-claim-uitsplitsing (fetchClaimsVoorOrder).
--
-- Net als mig 390 (omschrijving) / 399-400 (afmetingen) / 419 (klant-eigennaam)
-- bevriezen we de waarde als snapshot op zending_colli, zodat het label puur leest
-- (single source) en een herprint exact toont wat er bij pickronde-start gold. De
-- carrier-payloads (HST/Rhenus/Verhoek) blijven het originele/omschrijving-snapshot
-- gebruiken — OMB is uitsluitend label-presentatie.
--
-- PER-STUK MAPPING: genereer_zending_colli maakt 1 colli per stuk. Een orderregel
-- kan multi-source gedekt zijn (eigen voorraad + 1..n equivalenten). We bouwen per
-- orderregel een per-stuk-array van omsticker-codes (claims geëxpandeerd op aantal,
-- claim_volgorde-volgorde; eigen voorraad / IO → NULL) en wijzen stuk i de i-de
-- code toe. Voor de dominante 1-colli-per-regel-case is dit triviaal; mixed sourcing
-- binnen één regel klopt in aggregaat (juist aantal colli met OMB).
--
-- SUPERSET-DRIFT: §2 doet CREATE OR REPLACE genereer_zending_colli en is de SUPERSET
-- van mig 419 (= superset van 400 → 399 → 390 → 387). De complete mig 419-body is
-- hieronder overgenomen; toegevoegd zijn UITSLUITEND:
--   * ore.artikelnr AS regel_artikelnr in de hoofd-SELECT,
--   * variabele v_omsticker_codes + de per-orderregel array-opbouw,
--   * de nieuwe kolom omsticker_snapshot in de INSERT (v_omsticker_codes[i]).
-- Verifieer bij apply met pg_get_functiondef dat de live-body exact deze superset is.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Kolom
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS omsticker_snapshot TEXT;

COMMENT ON COLUMN zending_colli.omsticker_snapshot IS
  'Mig 436: bevroren karpi_code van het FYSIEK gepakte (omgesticker) artikel als '
  'dat afwijkt van het bestelde order_regels.artikelnr (equivalent/uitwisselbaar). '
  'NULL = geen omsticker (eigen artikel gepakt). Single source voor de "OMB:"-regel '
  'op het verzendlabel; carrier-payloads gebruiken dit NIET.';

-- ============================================================================
-- §2. genereer_zending_colli — mig 419-superset + omsticker_snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION genereer_zending_colli(p_zending_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_aantal_aangemaakt INTEGER := 0;
  v_volgnr            INTEGER := 0;
  r                   RECORD;
  i                   INTEGER;
  v_omsticker_codes   TEXT[];
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
      ore.artikelnr       AS regel_artikelnr,
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
      k.omschrijving      AS kwaliteit_naam,
      -- Mig 419: klant-eigennaam voor de kwaliteit, bevroren op shipmoment.
      resolve_klanteigen_naam(
        o.debiteur_nr,
        COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
        COALESCE(ore.maatwerk_kleur_code, p.kleur_code)
      ) AS klanteigen_naam
    FROM zending_regels zr
    LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
    -- Mig 419: orders erbij voor debiteur_nr (klant-eigennaam-resolve).
    LEFT JOIN orders o         ON o.id = ore.order_id
    -- Mig 400: join via het order_regel-artikel (zr.artikelnr is altijd NULL).
    LEFT JOIN producten p     ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    -- Mig 436: per-stuk omsticker-code-array voor deze orderregel. Actieve claims
    -- geëxpandeerd op `aantal` (claim_volgorde-volgorde); een claim waarvan het
    -- fysieke artikel afwijkt van het bestelde levert de karpi_code (val terug op
    -- het artikelnr), eigen voorraad / IO leveren NULL. Stuk i pakt element i.
    SELECT array_agg(sub.code ORDER BY sub.k, sub.gs)
    INTO v_omsticker_codes
    FROM (
      SELECT
        CASE
          WHEN res.fysiek_artikelnr IS NOT NULL
           AND res.fysiek_artikelnr <> COALESCE(r.regel_artikelnr, '')
          THEN COALESCE(fp.karpi_code, res.fysiek_artikelnr)
          ELSE NULL
        END                 AS code,
        res.claim_volgorde  AS k,
        gs.gs               AS gs
      FROM order_reserveringen res
      LEFT JOIN producten fp ON fp.artikelnr = res.fysiek_artikelnr
      CROSS JOIN LATERAL generate_series(1, GREATEST(res.aantal, 1)) AS gs(gs)
      WHERE res.order_regel_id = r.order_regel_id
        AND res.status = 'actief'
    ) sub;

    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot,
        lengte_cm, breedte_cm, klanteigen_naam_snapshot, omsticker_snapshot, aantal
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
        -- Mig 399/400: bevroren afmetingen (single source voor Rhenus/Verhoek).
        COALESCE(r.maatwerk_lengte_cm,  r.prod_lengte_cm),
        COALESCE(r.maatwerk_breedte_cm, r.prod_breedte_cm),
        -- Mig 419: bevroren klant-eigennaam voor de kwaliteit (of NULL).
        r.klanteigen_naam,
        -- Mig 436: omsticker-code voor dit stuk (of NULL = eigen artikel gepakt).
        v_omsticker_codes[i],
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
  'Mig 436 (superset van mig 419 → 400 → 399 → 390 → 387): gewicht-ladder + '
  'klant_omschrijving_snapshot + lengte_cm/breedte_cm + klanteigen_naam_snapshot '
  '+ omsticker_snapshot (karpi_code van het fysiek gepakte equivalent per stuk, of '
  'NULL). 1 colli per stuk, idempotent, SSCC + alle snapshots per colli — single '
  'source voor label, pakbon en carrier-XML.';

-- ============================================================================
-- §3. Backfill — omsticker_snapshot voor niet-verzonden zendingen
-- ============================================================================
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden.
-- Zelfde per-stuk-mapping als genereer_zending_colli: per orderregel de colli op
-- colli_nr matchen tegen de op-aantal-geëxpandeerde claims (claim_volgorde-volgorde).
-- Partition per (zending, orderregel) — correct voor de dominante single-zending-
-- case; een over deelzendingen gesplitste regel telt per zending opnieuw, wat in
-- aggregaat het juiste aantal OMB-colli geeft.
WITH colli_rn AS (
  SELECT zc.id, zc.zending_id, zc.order_regel_id,
         row_number() OVER (
           PARTITION BY zc.zending_id, zc.order_regel_id ORDER BY zc.colli_nr
         ) AS rn
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND zc.order_regel_id IS NOT NULL
),
claim_exp AS (
  SELECT res.order_regel_id,
         CASE
           WHEN res.fysiek_artikelnr IS NOT NULL
            AND res.fysiek_artikelnr <> COALESCE(ore.artikelnr, '')
           THEN COALESCE(fp.karpi_code, res.fysiek_artikelnr)
           ELSE NULL
         END AS code,
         row_number() OVER (
           PARTITION BY res.order_regel_id
           ORDER BY res.claim_volgorde, res.id, gs.gs
         ) AS rn
  FROM order_reserveringen res
  JOIN order_regels ore  ON ore.id = res.order_regel_id
  LEFT JOIN producten fp ON fp.artikelnr = res.fysiek_artikelnr
  CROSS JOIN LATERAL generate_series(1, GREATEST(res.aantal, 1)) AS gs(gs)
  WHERE res.status = 'actief'
)
UPDATE zending_colli zc
SET omsticker_snapshot = ce.code
FROM colli_rn cr
LEFT JOIN claim_exp ce
  ON ce.order_regel_id = cr.order_regel_id AND ce.rn = cr.rn
WHERE zc.id = cr.id;

-- ============================================================================
-- §4. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_met_omb INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_met_omb
  FROM zending_colli
  WHERE omsticker_snapshot IS NOT NULL;
  RAISE NOTICE 'Mig 436: colli met een omsticker-snapshot: % (>0 verwacht zodra een niet-verzonden zending een equivalent-claim heeft, bv. ZEND-2026-0108)', v_met_omb;
END $$;

NOTIFY pgrst, 'reload schema';
