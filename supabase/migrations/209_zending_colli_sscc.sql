-- Migratie 209: zending_colli + SSCC-generator
--
-- Achtergrond
-- -----------
-- Tot nu toe registreerde `zendingen.aantal_colli` alleen een telling. Voor
-- verzendstickers heeft elk colli een eigen identiteit nodig:
--   • SSCC-barcode (GS1, 18 digits, uniek per colli wereldwijd)
--   • Welk tapijt (= welke orderregel/rol) zit erin → bron voor sticker-tekst
--   • Volgorde-nummer "x VAN y" voor de sticker
--
-- V1-regel: strikt 1 tapijt = 1 colli (afspraak met Karpi 2026-05-07).
-- Multi-tapijt-per-colli komt later — `aantal` is alvast in het schema.
--
-- SSCC-formaat (GS1)
-- ------------------
--   18 cijfers totaal:
--     positie 1     : extension digit (we kiezen '0')
--     positie 2-8   : GS1 company prefix Karpi (8715954)
--     positie 9-17  : serial reference (9 cijfers, ophogend)
--     positie 18    : Mod-10 GS1 check digit
--
-- De full barcode op de label heeft AI(00) ervóór: '00' || sscc → 20 chars.
--
-- Idempotent.

-- ============================================================================
-- 1. SSCC check-digit functie (GS1 Mod-10)
-- ============================================================================
CREATE OR REPLACE FUNCTION sscc_check_digit(p_data TEXT) RETURNS INTEGER AS $$
DECLARE
  v_sum    INTEGER := 0;
  v_pos    INTEGER;
  v_digit  INTEGER;
  v_factor INTEGER;
  v_len    INTEGER := length(p_data);
BEGIN
  IF p_data !~ '^\d+$' THEN
    RAISE EXCEPTION 'sscc_check_digit verwacht numerieke string, kreeg %', p_data;
  END IF;
  -- Itereer van links naar rechts; bepaal factor o.b.v. positie van rechts
  FOR v_pos IN 1..v_len LOOP
    v_digit := substring(p_data FROM v_pos FOR 1)::INTEGER;
    -- Positie vanaf rechts (1-based): v_len - v_pos + 1
    -- Oneven (1,3,5...) → factor 3; even (2,4,6...) → factor 1
    IF ((v_len - v_pos + 1) % 2) = 1 THEN
      v_factor := 3;
    ELSE
      v_factor := 1;
    END IF;
    v_sum := v_sum + v_digit * v_factor;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sscc_check_digit(TEXT) IS
  'GS1 Mod-10 check digit. Input = 17 numerieke cijfers (zonder check digit). '
  'Output = 1 cijfer (0-9). Factor 3 op oneven posities vanaf rechts, factor 1 op even.';

-- ============================================================================
-- 2. Sequence + generator
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS sscc_serial_seq START 1 MAXVALUE 999999999 CYCLE;

CREATE OR REPLACE FUNCTION genereer_sscc() RETURNS TEXT AS $$
DECLARE
  v_extension      TEXT := '0';
  v_company_prefix TEXT := '8715954';   -- Karpi GS1-prefix (eerste 7 van GLN 8715954999998)
  v_serial         TEXT;
  v_data           TEXT;
  v_check          INTEGER;
BEGIN
  -- Serial-lengte = 17 - 1 (extension) - length(prefix). Voor prefix=7: serial=9.
  v_serial := lpad(nextval('sscc_serial_seq')::TEXT, 17 - 1 - length(v_company_prefix), '0');
  v_data   := v_extension || v_company_prefix || v_serial;
  v_check  := sscc_check_digit(v_data);
  RETURN v_data || v_check::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION genereer_sscc() IS
  'Genereer een GS1-conforme 18-digit SSCC. Karpi GS1-prefix is hardcoded op 8715954; '
  'pas de constante aan als GS1 een andere prefix toekent. De volledige barcode op de '
  'label krijgt AI(00) ervoor: ''00'' || sscc.';

-- ============================================================================
-- 3. Tabel zending_colli
-- ============================================================================
CREATE TABLE IF NOT EXISTS zending_colli (
  id                    BIGSERIAL PRIMARY KEY,
  zending_id            BIGINT  NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  colli_nr              INTEGER NOT NULL,
  order_regel_id        BIGINT  REFERENCES order_regels(id) ON DELETE SET NULL,
  rol_id                BIGINT  REFERENCES rollen(id) ON DELETE SET NULL,
  sscc                  TEXT    UNIQUE,
  gewicht_kg            NUMERIC,
  omschrijving_snapshot TEXT,
  aantal                INTEGER NOT NULL DEFAULT 1 CHECK (aantal >= 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zending_id, colli_nr)
);

CREATE INDEX IF NOT EXISTS idx_zending_colli_zending ON zending_colli (zending_id);
CREATE INDEX IF NOT EXISTS idx_zending_colli_orderregel ON zending_colli (order_regel_id);

COMMENT ON TABLE zending_colli IS
  'Eén rij per fysieke colli binnen een zending. V1: strikt 1 tapijt = 1 colli '
  '(aantal=1). Multi-tapijt-per-colli komt later via aantal>1 + losse colli-content-tabel.';

COMMENT ON COLUMN zending_colli.sscc IS
  '18-digit GS1 SSCC, gegenereerd via genereer_sscc(). Op label getoond met AI(00) prefix.';
COMMENT ON COLUMN zending_colli.omschrijving_snapshot IS
  'Productregel zoals op label getoond, bv. "MAATW. SISAL-GOLD 21 160x090 cm, KI21 Band:KI21". '
  'Snapshot-veld zodat re-print altijd consistent is, ook na product-rename.';
COMMENT ON COLUMN zending_colli.aantal IS
  'Aantal tapijten in deze colli. V1 = altijd 1. Reserveert ruimte voor toekomstige '
  'multi-pack-flow zonder ALTER TABLE.';

-- ============================================================================
-- 4. RLS
-- ============================================================================
ALTER TABLE zending_colli ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zending_colli_all ON zending_colli;
CREATE POLICY zending_colli_all ON zending_colli FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- 5. RPC: genereer_zending_colli(zending_id)
-- ============================================================================
-- Splitst zending_regels in colli-rijen (V1: 1 colli per stuk). Idempotent
-- voor "geen colli aanwezig" — als er al colli's zijn voor de zending blijven
-- die staan en wordt niets toegevoegd. Gebruik delete+regenerate in de UI als
-- volledig herstellen nodig is.

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

  -- Loop door zending_regels; voor elk regel met aantal>1 maak die N colli's aan
  FOR r IN
    SELECT
      zr.id              AS zending_regel_id,
      zr.order_regel_id,
      zr.artikelnr,
      zr.rol_id,
      zr.aantal,
      ore.is_maatwerk,
      ore.maatwerk_lengte_cm,
      ore.maatwerk_breedte_cm,
      ore.maatwerk_afwerking,
      p.naam              AS product_naam,
      p.lengte_cm         AS prod_lengte_cm,
      p.breedte_cm        AS prod_breedte_cm,
      p.gewicht_kg        AS prod_gewicht_kg,
      ore.gewicht_kg      AS regel_gewicht_kg,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
      k.naam              AS kwaliteit_naam
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
        COALESCE(r.regel_gewicht_kg, r.prod_gewicht_kg),
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

  -- Sync de oude integer-kolom voor backwards-compat
  UPDATE zendingen SET aantal_colli = v_aantal_aangemaakt WHERE id = p_zending_id;

  RETURN v_aantal_aangemaakt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION genereer_zending_colli(BIGINT) TO authenticated;

COMMENT ON FUNCTION genereer_zending_colli(BIGINT) IS
  'Maakt zending_colli-rijen aan voor een zending (1 colli per stuk). Idempotent: '
  'als er al colli''s zijn returnt 0 zonder mutatie. Genereert SSCC per colli en '
  'snapshot van de omschrijving voor de sticker.';

-- ============================================================================
-- 6. Helper: compose_colli_omschrijving
-- ============================================================================
-- Bouwt de productregel-tekst zoals die op de sticker komt:
--   maatwerk: "MAATW. {kwaliteit_naam} {breedte}x{lengte} cm, {kwaliteit_code} Band:{afwerking}"
--   vast    : "{product_naam} {breedte}x{lengte} cm"
-- Geen exacte match met DPD-stijl gegarandeerd; tweaken kan zonder schema-wijziging.

CREATE OR REPLACE FUNCTION compose_colli_omschrijving(
  p_maatwerk           BOOLEAN,
  p_kwaliteit_code     TEXT,
  p_kwaliteit_naam     TEXT,
  p_mw_lengte_cm       INTEGER,
  p_mw_breedte_cm      INTEGER,
  p_afwerking_code     TEXT,
  p_product_naam       TEXT,
  p_prod_lengte_cm     INTEGER,
  p_prod_breedte_cm    INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_dim TEXT;
BEGIN
  IF COALESCE(p_maatwerk, FALSE) THEN
    -- Maatwerk-formaat
    v_dim := COALESCE(lpad(p_mw_breedte_cm::TEXT, 3, '0') || 'x' || lpad(p_mw_lengte_cm::TEXT, 3, '0'), '');
    RETURN trim(BOTH ' ' FROM
      'MAATW. ' ||
      COALESCE(upper(p_kwaliteit_naam), '') || ' ' ||
      v_dim ||
      CASE WHEN v_dim <> '' THEN ' cm' ELSE '' END ||
      CASE WHEN p_kwaliteit_code IS NOT NULL THEN ', ' || p_kwaliteit_code ELSE '' END ||
      CASE WHEN p_afwerking_code IS NOT NULL THEN ' Band:' || p_afwerking_code ELSE '' END
    );
  ELSE
    -- Vaste maat
    v_dim := CASE
      WHEN p_prod_lengte_cm IS NOT NULL AND p_prod_breedte_cm IS NOT NULL
        THEN lpad(p_prod_breedte_cm::TEXT, 3, '0') || 'x' || lpad(p_prod_lengte_cm::TEXT, 3, '0') || ' cm'
      ELSE ''
    END;
    RETURN trim(BOTH ' ' FROM
      COALESCE(p_product_naam, '') ||
      CASE WHEN v_dim <> '' THEN ' ' || v_dim ELSE '' END
    );
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION compose_colli_omschrijving IS
  'Bouwt de label-omschrijving uit orderregel- en productdata. Gebruikt door '
  'genereer_zending_colli; mag los aangeroepen worden om sticker-preview te tonen.';

NOTIFY pgrst, 'reload schema';
