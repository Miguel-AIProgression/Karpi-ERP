-- Migratie 383: colli-gewicht-fix — resolver-verdieping + self-healing cache + backfill
-- (in de live DB draait dit als 382 — zelfde repo/DB-offset als mig 379-382,
--  zie de hernummer-notitie in die headers)
--
-- Aanleiding (Rhenus/Verhoek-cutover, handoff 12-06): de SFTP-preflights
-- verplichten gewicht_kg > 0 per colli, maar zending_colli.gewicht_kg stond
-- vrijwel overal op 0. Diagnose wees dieper: ~26% van de vaste producten met
-- complete maat+density heeft de DENSITY (kg/m²) in producten.gewicht_kg
-- staan i.p.v. het stukgewicht (bv. 548120001, 200×290: cache 2.5, echt 14.5).
-- Oorzaak: de oorspronkelijke import schreef de Excel-kolom "Gewicht" (kg/m²)
-- naar gewicht_kg; mig 185 §4 backfillde alleen wat tóén compleet was; de
-- mig 188 §6 "self-update" (SET gewicht_per_m2_kg = gewicht_per_m2_kg) was
-- een stille NO-OP (trigger-WHEN: OLD IS DISTINCT FROM NEW — self-assignment
-- is niet distinct); en er bestond géén herreken-trigger aan de productKANT
-- (maat/kwaliteit later gevuld → cache nooit herrekend).
--
-- Drie lagen:
--   §1  bereken_orderregel_gewicht_kg rekent vast-producten voortaan LIVE
--       via bereken_product_gewicht_kg (vorm-aware) i.p.v. cache-copy.
--   §2  Self-healing BEFORE-trigger op producten: voor vast/staaltje met
--       complete data is gewicht_kg ALTIJD de gederiveerde waarde — sluit
--       alle vervuilingsroutes (imports, UI, scripts) categorisch af.
--       Handmatige gewichtscorrectie hoort op kwaliteiten.gewicht_per_m2_kg.
--   §3  genereer_zending_colli: gewicht-ladder met NULLIF(0) — regel-cache
--       (kan handmatig gecorrigeerd zijn) → live resolver → product-cache.
--   §4  evalueer_orderregel_attributes: NULLIF(0)-defensie (zelfde rotte
--       bronnen voedden de vervoerder-selectie, o.a. Rhenus "DE ≤30 kg").
--   §5  Backfill: producten (vorm-aware) → AFTER-trigger cascadeert naar
--       open vaste orderregels; expliciete backfill voor maatwerk-regels en
--       KvV-orders; zending_colli van niet-verzonden zendingen.
--
-- Idempotent: CREATE OR REPLACE + herhaalbare set-based UPDATEs.

-- ============================================================================
-- §1. bereken_orderregel_gewicht_kg — vast-pad via live resolver
-- ============================================================================
CREATE OR REPLACE FUNCTION bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
  v_is_maatwerk        BOOLEAN;
  v_maatwerk_opp       NUMERIC;
  v_maatwerk_kwaliteit TEXT;
  v_artikelnr          TEXT;
  v_density            NUMERIC;
  v_gewicht            NUMERIC;
BEGIN
  SELECT ore.is_maatwerk, ore.maatwerk_oppervlak_m2,
         ore.maatwerk_kwaliteit_code, ore.artikelnr
    INTO v_is_maatwerk, v_maatwerk_opp, v_maatwerk_kwaliteit, v_artikelnr
  FROM order_regels ore
  WHERE ore.id = p_order_regel_id;

  IF v_is_maatwerk = true AND v_maatwerk_opp IS NOT NULL
     AND v_maatwerk_kwaliteit IS NOT NULL THEN
    SELECT gewicht_per_m2_kg INTO v_density
      FROM kwaliteiten WHERE code = v_maatwerk_kwaliteit;
    IF v_density IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN ROUND(v_maatwerk_opp * v_density, 2);
  END IF;

  IF v_artikelnr IS NOT NULL THEN
    -- Mig 383: LIVE berekening (vorm-aware, mig 188) i.p.v. copy van de
    -- producten.gewicht_kg-cache — de cache bleek vervuilbaar (density-bug).
    -- bereken_product_gewicht_kg valt zelf al terug op legacy-gewicht als
    -- maat/density ontbreken. NULLIF: 0 is geen gewicht.
    SELECT bg.gewicht_kg INTO v_gewicht
      FROM bereken_product_gewicht_kg(v_artikelnr) bg;
    RETURN NULLIF(v_gewicht, 0);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_orderregel_gewicht_kg IS
  'Gewicht-resolver — gewicht (kg/stuk) voor een orderregel. Maatwerk: '
  'oppervlak × kwaliteit-density. Vast: sinds mig 383 LIVE via '
  'bereken_product_gewicht_kg (vorm-aware) i.p.v. cache-copy. '
  'Service-items zonder artikelnr → NULL. Mig 185/383.';

-- ============================================================================
-- §2. Self-healing cache: BEFORE-trigger op producten
-- ============================================================================
-- Voor vast/staaltje met maat + kwaliteit-density is gewicht_kg een
-- AFGEDWONGEN gederiveerde cache: elke INSERT/UPDATE die de bron-kolommen
-- (of gewicht_kg zelf) raakt, herleidt de waarde. Een import of UI-edit kan
-- de cache dus niet meer vervuilen. Bij incomplete data blijft de bestaande
-- waarde staan (legacy-fallback, gewicht_uit_kwaliteit=false).
CREATE OR REPLACE FUNCTION producten_gewicht_derive()
RETURNS TRIGGER AS $$
DECLARE
  v_density NUMERIC;
BEGIN
  IF NEW.product_type NOT IN ('vast', 'staaltje') THEN
    RETURN NEW;
  END IF;
  IF NEW.lengte_cm IS NULL OR NEW.breedte_cm IS NULL
     OR NEW.kwaliteit_code IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT gewicht_per_m2_kg INTO v_density
    FROM kwaliteiten WHERE code = NEW.kwaliteit_code;
  IF v_density IS NULL OR v_density <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.vorm = 'rond' THEN
    NEW.gewicht_kg := ROUND(PI() * POWER(NEW.lengte_cm::NUMERIC / 200.0, 2) * v_density, 2);
  ELSE
    NEW.gewicht_kg := ROUND((NEW.lengte_cm::NUMERIC * NEW.breedte_cm::NUMERIC / 10000.0) * v_density, 2);
  END IF;
  NEW.gewicht_uit_kwaliteit := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producten_gewicht_derive ON producten;
CREATE TRIGGER trg_producten_gewicht_derive
  BEFORE INSERT OR UPDATE OF gewicht_kg, lengte_cm, breedte_cm, kwaliteit_code, vorm, product_type
  ON producten
  FOR EACH ROW
  EXECUTE FUNCTION producten_gewicht_derive();

COMMENT ON TRIGGER trg_producten_gewicht_derive ON producten IS
  'Mig 383: self-healing gederiveerde cache. Voor vast/staaltje met complete '
  'data (maat + kwaliteit-density) wordt gewicht_kg ALTIJD herleid — een '
  'handmatige/import-waarde wordt bewust overschreven. Gewicht corrigeren = '
  'kwaliteiten.gewicht_per_m2_kg aanpassen (cascadeert via mig 185/188-trigger). '
  'Let op: UPDATE OF vuurt op kolom-in-SET-lijst, niet op waarde-verandering — '
  'precies waardoor de mig 188 §6 self-update-backfill destijds een no-op was '
  '(die zat achter een WHEN OLD IS DISTINCT FROM NEW).';

-- ============================================================================
-- §3. genereer_zending_colli — gewicht-ladder (body verder = mig 213)
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
        sscc, gewicht_kg, omschrijving_snapshot, aantal
      ) VALUES (
        p_zending_id,
        v_volgnr,
        r.order_regel_id,
        r.rol_id,
        genereer_sscc(),
        -- Mig 383 gewicht-ladder: regel-cache (respecteert eventuele
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
  'Mig 383: gewicht-ladder NULLIF(regel,0) → bereken_orderregel_gewicht_kg '
  '(live, vorm-aware) → NULLIF(product-cache,0). Verder identiek aan mig 213: '
  'maakt zending_colli-rijen (1 colli per stuk), idempotent, SSCC + '
  'omschrijving-snapshot per colli.';

-- ============================================================================
-- §4. evalueer_orderregel_attributes — NULLIF(0)-defensie
-- ============================================================================
CREATE OR REPLACE FUNCTION evalueer_orderregel_attributes(p_orderregel_id BIGINT)
RETURNS TABLE (
  afl_land           TEXT,
  kleinste_zijde_cm  INTEGER,
  totaal_gewicht_kg  NUMERIC,
  debiteur_nr        INTEGER,
  inkoopgroep_code   TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.afl_land,
    LEAST(
      COALESCE(ore.maatwerk_lengte_cm,  p.lengte_cm),
      COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
    )::INTEGER AS kleinste_zijde_cm,
    -- Mig 383: NULLIF(0) — een 0-gewicht-cache mag de ladder niet
    -- kortsluiten (34 orderregels stonden op exact 0).
    (COALESCE(NULLIF(ore.gewicht_kg, 0), NULLIF(p.gewicht_kg, 0), 0)
       * GREATEST(COALESCE(ore.orderaantal, 0), 0))::NUMERIC AS totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM order_regels ore
  JOIN orders o          ON o.id = ore.order_id
  LEFT JOIN producten p  ON p.artikelnr = ore.artikelnr
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE ore.id = p_orderregel_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION evalueer_orderregel_attributes(BIGINT) TO authenticated;

COMMENT ON FUNCTION evalueer_orderregel_attributes(BIGINT) IS
  'Mig 219 + 383: per-orderregel attributen voor regel-evaluator. Sinds 383 '
  'met NULLIF(0) op beide gewicht-bronnen (0-cache mocht de COALESCE niet '
  'kortsluiten).';

-- ============================================================================
-- §5. Backfills
-- ============================================================================
-- 5a. producten: vorm-aware herberekening (zoals mig 185 §4 + mig 188-formule).
--     De AFTER-trigger trg_product_gewicht_recalc (mig 185, WHEN OLD IS
--     DISTINCT FROM NEW) cascadeert gewijzigde waarden automatisch naar open
--     vaste orderregels (orders niet in Verzonden/Geannuleerd/KvV).
--     De BEFORE-trigger uit §2 herleidt dezelfde waarde — consistent.
UPDATE producten p
SET
  gewicht_kg = CASE p.vorm
    WHEN 'rond' THEN ROUND(PI() * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * q.gewicht_per_m2_kg, 2)
    ELSE             ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * q.gewicht_per_m2_kg, 2)
  END,
  gewicht_uit_kwaliteit = true
FROM kwaliteiten q
WHERE q.code = p.kwaliteit_code
  AND p.product_type IN ('vast', 'staaltje')
  AND p.lengte_cm IS NOT NULL
  AND p.breedte_cm IS NOT NULL
  AND q.gewicht_per_m2_kg IS NOT NULL
  AND q.gewicht_per_m2_kg > 0;

-- 5b. Open VASTE orderregels expliciet (defense-in-depth: de 5a-cascade
--     slaat 'Klaar voor verzending' over; die zendingen zijn nog niet weg
--     en hun colli-generatie/heraanmaak moet op het juiste gewicht kunnen
--     leunen).
UPDATE order_regels ore
SET gewicht_kg = p.gewicht_kg
FROM orders o, producten p
WHERE o.id = ore.order_id
  AND p.artikelnr = ore.artikelnr
  AND ore.is_maatwerk = false
  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND p.gewicht_kg IS NOT NULL
  AND p.gewicht_kg > 0
  AND ore.gewicht_kg IS DISTINCT FROM p.gewicht_kg;

-- 5c. Open MAATWERK-orderregels: oppervlak × density.
UPDATE order_regels ore
SET gewicht_kg = ROUND(ore.maatwerk_oppervlak_m2 * q.gewicht_per_m2_kg, 2)
FROM orders o, kwaliteiten q
WHERE o.id = ore.order_id
  AND q.code = ore.maatwerk_kwaliteit_code
  AND ore.is_maatwerk = true
  AND ore.maatwerk_oppervlak_m2 IS NOT NULL
  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND q.gewicht_per_m2_kg IS NOT NULL
  AND q.gewicht_per_m2_kg > 0
  AND ore.gewicht_kg IS DISTINCT FROM ROUND(ore.maatwerk_oppervlak_m2 * q.gewicht_per_m2_kg, 2);

-- 5d. Bestaande colli van niet-verzonden zendingen: via de (verdiepte)
--     resolver. Verzonden/afgeleverde zendingen bewust ongemoeid — dat is
--     historie zoals die de deur uit ging.
UPDATE zending_colli zc
SET gewicht_kg = COALESCE(bereken_orderregel_gewicht_kg(zc.order_regel_id), zc.gewicht_kg)
FROM zendingen z
WHERE z.id = zc.zending_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND (zc.gewicht_kg IS NULL OR zc.gewicht_kg = 0);

-- ============================================================================
-- §6. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_dens_rest INTEGER;
  v_colli_leeg INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dens_rest
  FROM producten p
  JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.product_type IN ('vast', 'staaltje')
    AND p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL
    AND q.gewicht_per_m2_kg > 0
    AND p.gewicht_kg = q.gewicht_per_m2_kg
    AND ABS(p.gewicht_kg - CASE p.vorm
          WHEN 'rond' THEN ROUND(PI() * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * q.gewicht_per_m2_kg, 2)
          ELSE             ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * q.gewicht_per_m2_kg, 2)
        END) >= 0.05;

  SELECT COUNT(*) INTO v_colli_leeg
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND (zc.gewicht_kg IS NULL OR zc.gewicht_kg = 0);

  RAISE NOTICE 'Mig 383 verifier: density-als-gewicht resterend: % (verwacht 0)', v_dens_rest;
  RAISE NOTICE 'Mig 383 verifier: niet-verzonden colli zonder gewicht: % (verwacht 0, of colli van regels zonder berekenbaar gewicht)', v_colli_leeg;
END $$;

NOTIFY pgrst, 'reload schema';
