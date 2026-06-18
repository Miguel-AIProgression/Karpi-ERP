-- Migratie 421: colli-bundeling al tijdens de pickronde toestaan.
--
-- Mig 420 liet bundelen alleen toe bij status 'Klaar voor verzending' (= ná
-- 'Voltooi pickronde'). De operator wil echter al tijdens het verzamelen
-- (status 'Picken', op de Verzendset-pagina) colli samenpakken onder één nieuwe
-- SSCC-sticker. Deze migratie verruimt de status-poort in maak_colli_bundel +
-- verwijder_colli_bundel naar { 'Picken', 'Klaar voor verzending' }.
--
-- Waarom dit veilig is voor de pick-flow:
--   * voltooi_pickronde (mig 258) blokkeert alleen op pick_uitkomst='niet_gevonden'
--     en zet 'open'->'gepickt'. Een bundel-rij is default 'open' -> wordt gewoon
--     mee-gepickt, telt niet als probleem.
--   * De synthetische bundel-rij (is_bundel=TRUE) wordt frontend-side uit de
--     pick-vinkjes gefilterd (fetchColliVoorZending: is_bundel=false), zodat de
--     bundel geen los pick-item wordt. De gebundelde kinderen blijven afvinkbaar.
--   * De hold-guard in enqueue_zending_naar_vervoerder (mig 420) is ongewijzigd:
--     aanmelden gebeurt nog steeds ná voltooien (status 'Klaar voor verzending').
--
-- Idempotent: CREATE OR REPLACE. Body = exact mig 420 met alléén de status-IF
-- + COMMENT aangepast (drift-check: vergelijk met mig 420 §3/§4).

-- ============================================================================
-- maak_colli_bundel — status-poort verruimd naar 'Picken' OR 'Klaar voor verzending'
-- ============================================================================
CREATE OR REPLACE FUNCTION maak_colli_bundel(
  p_zending_id BIGINT,
  p_colli_ids  BIGINT[],
  p_gewicht_kg NUMERIC DEFAULT NULL,
  p_lengte_cm  INTEGER DEFAULT NULL,
  p_breedte_cm INTEGER DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_status          TEXT;
  v_vervoerder      TEXT;
  v_handmatig       BOOLEAN;
  v_aantal_kinderen INTEGER;
  v_valid_count     INTEGER;
  v_gewicht         NUMERIC;
  v_lengte          INTEGER;
  v_breedte         INTEGER;
  v_volgnr          INTEGER;
  v_bundel_id       BIGINT;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  -- Mig 421: bundelen mag tijdens de pickronde ('Picken') én erna ('Klaar voor verzending').
  IF v_status NOT IN ('Picken', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Bundelen kan alleen tijdens of net na de pickronde (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  SELECT handmatig_aanmelden INTO v_handmatig FROM vervoerders WHERE code = v_vervoerder;
  IF NOT COALESCE(v_handmatig, FALSE) THEN
    RAISE EXCEPTION 'Colli-bundeling is alleen toegestaan voor handmatig-aanmelden-vervoerders (zending % -> %)',
      p_zending_id, COALESCE(v_vervoerder, '(geen)');
  END IF;

  v_aantal_kinderen := COALESCE(array_length(p_colli_ids, 1), 0);
  IF v_aantal_kinderen < 2 THEN
    RAISE EXCEPTION 'Een bundel vereist minstens 2 colli (gekregen: %)', v_aantal_kinderen;
  END IF;

  -- Alle opgegeven colli moeten bij deze zending horen, zelf geen bundel zijn en
  -- nog niet gebundeld zijn.
  SELECT COUNT(*) INTO v_valid_count
    FROM zending_colli
   WHERE id = ANY(p_colli_ids)
     AND zending_id = p_zending_id
     AND is_bundel = FALSE
     AND bundel_colli_id IS NULL;
  IF v_valid_count <> v_aantal_kinderen THEN
    RAISE EXCEPTION 'Niet alle colli zijn geldig (zending %, geen bundel, nog niet gebundeld): % van % geldig',
      p_zending_id, v_valid_count, v_aantal_kinderen;
  END IF;

  -- Gewicht = som, maat = max van de kinderen; expliciete parameters winnen.
  SELECT COALESCE(p_gewicht_kg, SUM(gewicht_kg)),
         COALESCE(p_lengte_cm,  MAX(lengte_cm)),
         COALESCE(p_breedte_cm, MAX(breedte_cm))
    INTO v_gewicht, v_lengte, v_breedte
    FROM zending_colli
   WHERE id = ANY(p_colli_ids);

  IF COALESCE(v_gewicht, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-gewicht moet > 0 zijn (Rhenus-preflight); kreeg %', v_gewicht;
  END IF;
  IF COALESCE(v_lengte, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-lengte moet > 0 zijn (Rhenus-preflight); kreeg %', v_lengte;
  END IF;

  SELECT COALESCE(MAX(colli_nr), 0) + 1 INTO v_volgnr
    FROM zending_colli WHERE zending_id = p_zending_id;

  INSERT INTO zending_colli (
    zending_id, colli_nr, order_regel_id, rol_id, sscc, gewicht_kg,
    omschrijving_snapshot, klant_omschrijving_snapshot, lengte_cm, breedte_cm, aantal, is_bundel
  ) VALUES (
    p_zending_id, v_volgnr, NULL, NULL, genereer_sscc(), v_gewicht,
    NULL, 'BUNDEL — ' || v_aantal_kinderen || ' colli', v_lengte, v_breedte, 1, TRUE
  ) RETURNING id INTO v_bundel_id;

  UPDATE zending_colli SET bundel_colli_id = v_bundel_id WHERE id = ANY(p_colli_ids);

  RETURN v_bundel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION maak_colli_bundel IS
  'Colli-bundeling (spec 2026-06-17): maakt 1 bundel-rij in zending_colli (eigen '
  'SSCC, is_bundel=TRUE) en zet bundel_colli_id op de gekozen kind-colli. Gewicht=som, '
  'maat=max (overschrijfbaar). Mig 421: status ''Picken'' OF ''Klaar voor verzending'' '
  '+ handmatig-aanmelden-vervoerder + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- verwijder_colli_bundel — status-poort verruimd (ontbundelen ook tijdens pickronde)
-- ============================================================================
CREATE OR REPLACE FUNCTION verwijder_colli_bundel(p_bundel_colli_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
  v_is_bundel  BOOLEAN;
  v_status     TEXT;
BEGIN
  SELECT zending_id, is_bundel INTO v_zending_id, v_is_bundel
    FROM zending_colli WHERE id = p_bundel_colli_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colli % bestaat niet', p_bundel_colli_id; END IF;
  IF NOT COALESCE(v_is_bundel, FALSE) THEN
    RAISE EXCEPTION 'Colli % is geen bundel — ontbundelen kan niet', p_bundel_colli_id;
  END IF;

  SELECT status INTO v_status FROM zendingen WHERE id = v_zending_id;
  -- Mig 421: ontbundelen mag tijdens de pickronde ('Picken') én erna ('Klaar voor verzending').
  IF v_status NOT IN ('Picken', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Ontbundelen kan alleen tijdens of net na de pickronde (zending % staat op %)',
      v_zending_id, v_status;
  END IF;

  DELETE FROM zending_colli WHERE id = p_bundel_colli_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verwijder_colli_bundel(BIGINT) TO authenticated;

COMMENT ON FUNCTION verwijder_colli_bundel IS
  'Ontbundelt: verwijdert de bundel-rij; de kinderen worden via ON DELETE SET NULL '
  'automatisch ontkoppeld. Mig 421: status ''Picken'' OF ''Klaar voor verzending''.';

-- ============================================================================
-- Verifier-rapport + PostgREST schema-reload
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Mig 421: maak_colli_bundel/verwijder_colli_bundel staan nu ook bundelen tijdens ''Picken'' toe.';
END $$;

NOTIFY pgrst, 'reload schema';
