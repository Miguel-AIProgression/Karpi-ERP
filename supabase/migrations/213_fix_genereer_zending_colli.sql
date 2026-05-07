-- Migratie 213: fix genereer_zending_colli — kolomnaam ore.kwaliteit_code → ore.maatwerk_kwaliteit_code
--
-- Symptoom op staging: bij klik "Verzendset" op pick & ship gaf de RPC
-- `create_zending_voor_order` (alias voor `start_pickronde` sinds mig 211)
-- een fout terug:
--
--   "column ore.kwaliteit_code does not exist
--    Perhaps you meant to reference the column "p.kwaliteit_code". (42703)"
--
-- Oorzaak: een oudere live-versie van `genereer_zending_colli` (van vóór de
-- gewicht-per-kwaliteit-feature) referenceerde `ore.kwaliteit_code`. Op
-- `order_regels` heet die kolom echter `maatwerk_kwaliteit_code` — alleen
-- `producten` heeft een platte `kwaliteit_code`. Mig 209 heeft de body al
-- correct (`COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)`), maar
-- die migratie is niet (volledig) op staging toegepast — vermoedelijk omdat
-- mig 211 los ervan is gerund.
--
-- Deze migratie zet alleen de functie-body recht. Geen schema-mutaties.
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
  'Mig 213: kolom-fix (ore.kwaliteit_code → ore.maatwerk_kwaliteit_code). '
  'Functie-gedrag identiek aan mig 209: maakt zending_colli-rijen aan voor een '
  'zending (1 colli per stuk), idempotent — als er al colli''s zijn returnt 0.';

NOTIFY pgrst, 'reload schema';
