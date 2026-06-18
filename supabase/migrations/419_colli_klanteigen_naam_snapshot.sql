-- Migratie 419: klant-eigennaam voor de kwaliteit op het verzendlabel.
--
-- Sommige klanten hanteren een eigen naam voor een kwaliteit (bv. debiteur
-- noemt BEAC intern "BREDA"). Het oude systeem toonde die als regel
-- "Uw referentie: <naam>" op de verzendsticker, direct onder de kwaliteitscode.
-- Deze migratie bevriest die naam per colli zodat het label hem puur kan lezen
-- (zelfde snapshot-patroon als omschrijving_snapshot/lengte_cm).
--
-- Bron: tabel klanteigen_namen (mig 199/200) via resolve_klanteigen_naam(
--   debiteur_nr, kwaliteit_code, kleur_code) — exact dezelfde resolutie als de
-- maatwerk-sticker (mig 295, view snijplan_sticker_data). NULL = geen
-- afwijkende naam → het label toont geen "Uw referentie"-regel.
--
-- SUPERSET-DRIFT: §2 doet CREATE OR REPLACE genereer_zending_colli en is de
-- SUPERSET van mig 400 (= superset van 399 → 390 → 387). De complete mig
-- 400-body is hieronder overgenomen; toegevoegd zijn UITSLUITEND:
--   * LEFT JOIN orders o (voor o.debiteur_nr),
--   * kleur_code via COALESCE(ore.maatwerk_kleur_code, p.kleur_code),
--   * de nieuwe kolom klanteigen_naam_snapshot in de INSERT.
-- Verifieer bij apply met pg_get_functiondef dat de live-body exact deze
-- superset is.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Kolom
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS klanteigen_naam_snapshot TEXT;

-- ============================================================================
-- §2. genereer_zending_colli — mig 400-superset + klant-eigennaam-snapshot
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
      k.omschrijving      AS kwaliteit_naam,
      -- Mig 419: klant-eigennaam voor de kwaliteit, bevroren op shipmoment.
      -- NULL als de klant geen afwijkende naam heeft. Kwaliteit/kleur volgen
      -- dezelfde maatwerk→product-fallback als kwaliteit_code hierboven (en als
      -- snijplan_sticker_data, mig 295).
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
    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot,
        lengte_cm, breedte_cm, klanteigen_naam_snapshot, aantal
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
        -- Mig 419: bevroren klant-eigennaam voor de kwaliteit (of NULL).
        r.klanteigen_naam,
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
  'Mig 419 (superset van mig 400 → 399 → 390 → 387): gewicht-ladder + '
  'klant_omschrijving_snapshot + lengte_cm/breedte_cm + klanteigen_naam_snapshot '
  '(klant-eigennaam voor de kwaliteit via resolve_klanteigen_naam). 1 colli per '
  'stuk, idempotent, SSCC + alle snapshots per colli — single source voor label, '
  'pakbon en carrier-XML.';

-- ============================================================================
-- §3. Backfill — klant-eigennaam voor niet-verzonden zendingen
-- ============================================================================
-- Alleen de nieuwe kolom; lengte/omschrijving zijn al correct uit mig 400.
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden
-- (die hadden de regel nooit als snapshot).
UPDATE zending_colli zc
SET klanteigen_naam_snapshot = resolve_klanteigen_naam(
      o.debiteur_nr,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
      COALESCE(ore.maatwerk_kleur_code, p.kleur_code)
    )
FROM zending_regels zr
JOIN order_regels ore  ON ore.id = zr.order_regel_id
JOIN orders o          ON o.id = ore.order_id
LEFT JOIN producten p  ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
JOIN zendingen z       ON z.id = zr.zending_id
WHERE zr.zending_id = zc.zending_id
  AND zr.order_regel_id = zc.order_regel_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd');

-- ============================================================================
-- §4. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_met_naam INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_met_naam
  FROM zending_colli
  WHERE klanteigen_naam_snapshot IS NOT NULL;
  RAISE NOTICE 'Mig 419: colli met een klant-eigennaam-snapshot: % (0 is OK als geen niet-verzonden zending een klanteigen_namen-match heeft)', v_met_naam;
END $$;

NOTIFY pgrst, 'reload schema';
