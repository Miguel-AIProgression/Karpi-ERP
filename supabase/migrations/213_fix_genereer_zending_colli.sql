-- Migratie 213: fix genereer_zending_colli — kolom + type-cast rechtgetrokken
--
-- Symptoom op staging: bij klik "Verzendset" op pick & ship gaven achtereen-
-- volgens vier fouten op `genereer_zending_colli`:
--
--   1. "column ore.kwaliteit_code does not exist (42703)"
--      → moet `ore.maatwerk_kwaliteit_code` zijn (order_regels heeft alleen
--        die maatwerk-variant; vaste-product kwaliteit zit op producten).
--
--   2. "column p.naam does not exist (42703)"
--      → producten heeft geen `naam`-kolom, wel `omschrijving`.
--
--   3. "column k.naam does not exist (42703)"
--      → kwaliteiten heeft `omschrijving`, geen `naam`.
--
--   4. "function compose_colli_omschrijving(... numeric, numeric ...) does
--       not exist (42883)"
--      → live signatuur verwacht INTEGER voor alle 4 dimensies, maar
--        order_regels.maatwerk_lengte_cm/_breedte_cm zijn NUMERIC. Postgres
--        cast NUMERIC niet impliciet naar INTEGER. Fix: expliciete cast in
--        de SELECT, zodat het record-type integer is.
--
-- Alle vier fouten zaten in de repo-versie van mig 209. Die migratie is dus
-- zelf nooit op staging getest. Deze migratie zet alleen
-- `genereer_zending_colli` recht. Geen schema-mutaties.
--
-- Idempotent (CREATE OR REPLACE).

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
      -- Cast naar INTEGER: live compose_colli_omschrijving verwacht INTEGER,
      -- maar order_regels.maatwerk_lengte_cm/_breedte_cm zijn NUMERIC.
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
  'Mig 213: kolom- + type-fix tov mig 209: ore.kwaliteit_code → '
  'ore.maatwerk_kwaliteit_code, p.naam → p.omschrijving, k.naam → '
  'k.omschrijving, expliciete INTEGER-cast op maatwerk_lengte/breedte_cm '
  '(NUMERIC in order_regels, INTEGER verwacht door compose_colli_omschrijving). '
  'Functie-gedrag verder identiek: maakt zending_colli-rijen aan voor een '
  'zending (1 colli per stuk), idempotent.';

NOTIFY pgrst, 'reload schema';
