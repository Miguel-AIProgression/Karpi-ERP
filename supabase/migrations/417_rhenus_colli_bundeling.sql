-- Migratie 417: colli-bundeling bij Rhenus (ADR-volgt; spec 2026-06-17).
-- Binnen één zending meerdere colli samenpakken onder één nieuwe SSCC; alleen
-- die bundel-SSCC + de niet-gebundelde colli worden bij Rhenus aangemeld.
--
-- NIET te verwarren met zending-bundeling (orders -> 1 zending, mig 222) of de
-- bundel-sleutel (mig 228-230). Dit is COLLI-bundeling, alleen voor Rhenus.
--
-- Nummer 417: her-verifieer vlak vóór merge t.o.v. origin/main (collisie-historie).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.

-- ============================================================================
-- §1. Schema: bundel-kolommen op zending_colli + hold-vlag op vervoerders
-- ============================================================================
-- bundel_colli_id: kind-colli wijzen naar hun bundel-rij. ON DELETE SET NULL zodat
-- een bundel-rij verwijderen de kinderen automatisch ontbundelt (geen cascade-delete!).
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS bundel_colli_id BIGINT
  REFERENCES zending_colli(id) ON DELETE SET NULL;
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS is_bundel BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_zending_colli_bundel ON zending_colli (bundel_colli_id);

COMMENT ON COLUMN zending_colli.bundel_colli_id IS
  'Zelf-FK: kind-colli die in een bundel zitten wijzen naar de bundel-rij. '
  'NULL = niet gebundeld (normale colli of zelf een bundel-rij). Carrier-XML en '
  'label-expansie negeren rijen waar dit NOT NULL is.';
COMMENT ON COLUMN zending_colli.is_bundel IS
  'TRUE = synthetische bundel-rij (eigen SSCC, gewicht=som, maat=max van de kinderen). '
  'Alleen voor handmatig-aanmelden-vervoerders (Rhenus).';

-- Data-driven hold: een vervoerder met handmatig_aanmelden=TRUE meldt een
-- multi-colli-zending niet automatisch aan; de operator geeft handmatig vrij.
ALTER TABLE vervoerders ADD COLUMN IF NOT EXISTS handmatig_aanmelden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vervoerders.handmatig_aanmelden IS
  'TRUE = zending met >=2 colli wordt na pickronde-voltooiing vastgehouden op '
  '''Klaar voor verzending'' tot de operator handmatig vrijgeeft (colli-bundeling, '
  'spec 2026-06-17). 1-colli zendingen gaan altijd automatisch door.';

-- ============================================================================
-- §2. Zet de vlag voor Rhenus
-- ============================================================================
UPDATE vervoerders SET handmatig_aanmelden = TRUE WHERE code = 'rhenus_sftp';

-- ============================================================================
-- §3. RPC: maak_colli_bundel — voeg N colli samen tot 1 bundel-rij (eigen SSCC)
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

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Bundelen kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
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
  'maat=max (overschrijfbaar). Alleen status ''Klaar voor verzending'' + handmatig-'
  'aanmelden-vervoerder + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- §4. RPC: verwijder_colli_bundel — ontbundel (kinderen weer los)
-- ============================================================================
-- Dankzij ON DELETE SET NULL op bundel_colli_id zet het verwijderen van de
-- bundel-rij automatisch de kinderen terug op bundel_colli_id=NULL.
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
  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Ontbundelen kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      v_zending_id, v_status;
  END IF;

  DELETE FROM zending_colli WHERE id = p_bundel_colli_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verwijder_colli_bundel(BIGINT) TO authenticated;

COMMENT ON FUNCTION verwijder_colli_bundel IS
  'Ontbundelt: verwijdert de bundel-rij; de kinderen worden via ON DELETE SET NULL '
  'automatisch ontkoppeld. Alleen bij status ''Klaar voor verzending''.';

-- ============================================================================
-- §5. Hold-guard in de dispatch. DROP de 1-arg versie zodat de trigger de nieuwe
--     2-arg versie (met default) aanroept. Body = mig 380 + handmatig_aanmelden-
--     lookup + hold-guard. Géén andere wijzigingen aan de dispatch-logica.
-- ============================================================================
DROP FUNCTION IF EXISTS enqueue_zending_naar_vervoerder(BIGINT);

CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT,
  p_handmatig  BOOLEAN DEFAULT FALSE
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_handmatig_verv  BOOLEAN;
  v_aantal_colli    INTEGER;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, handmatig_aanmelden INTO v_actief, v_type, v_handmatig_verv
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- HOLD-GUARD (colli-bundeling): een handmatig-aanmelden-vervoerder houdt een
  -- multi-colli-zending vast tot de operator vrijgeeft (p_handmatig=TRUE). Een
  -- 1-colli-zending kan niet gebundeld worden -> gaat altijd automatisch door.
  IF NOT p_handmatig AND COALESCE(v_handmatig_verv, FALSE) THEN
    SELECT COUNT(*) INTO v_aantal_colli FROM zending_colli WHERE zending_id = p_zending_id;
    IF v_aantal_colli >= 2 THEN
      RETURN 'held_handmatig';
    END IF;
  END IF;

  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'sftp' THEN
      CASE v_vervoerder_code
        WHEN 'verhoek_sftp' THEN
          PERFORM enqueue_verhoek_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_verhoek';
        WHEN 'rhenus_sftp' THEN
          PERFORM enqueue_rhenus_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_rhenus';
        ELSE
          RAISE NOTICE 'SFTP-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT + hold-guard. Sinds mig 417: 2-arg (p_handmatig). Een vervoerder '
  'met handmatig_aanmelden houdt een >=2-colli-zending vast (RETURN ''held_handmatig'') '
  'tot de operator vrijgeeft (p_handmatig=TRUE, via meld_zending_handmatig_aan). '
  'De trigger roept de 1-arg-vorm aan -> resolved naar deze functie met default FALSE.';

-- ============================================================================
-- §6. RPC: meld_zending_handmatig_aan — de "Aanmelden bij Rhenus"-knop
-- ============================================================================
CREATE OR REPLACE FUNCTION meld_zending_handmatig_aan(p_zending_id BIGINT)
RETURNS TEXT AS $$
DECLARE
  v_status     TEXT;
  v_vervoerder TEXT;
  v_handmatig  BOOLEAN;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Aanmelden kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  SELECT handmatig_aanmelden INTO v_handmatig FROM vervoerders WHERE code = v_vervoerder;
  IF NOT COALESCE(v_handmatig, FALSE) THEN
    RAISE EXCEPTION 'Handmatig aanmelden is niet van toepassing op vervoerder % (zending %)',
      COALESCE(v_vervoerder, '(geen)'), p_zending_id;
  END IF;

  RETURN enqueue_zending_naar_vervoerder(p_zending_id, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION meld_zending_handmatig_aan(BIGINT) TO authenticated;

COMMENT ON FUNCTION meld_zending_handmatig_aan IS
  'Vrijgave-knop: meldt een vastgehouden handmatig-aanmelden-zending alsnog aan bij '
  'de vervoerder (enqueue met p_handmatig=TRUE). Alleen bij ''Klaar voor verzending''.';

-- ============================================================================
-- §7. Verifier-rapport + PostgREST schema-reload
-- ============================================================================
DO $$
DECLARE
  v_flag BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'zending_colli' AND column_name = 'bundel_colli_id') THEN
    RAISE EXCEPTION 'Mig 417: kolom zending_colli.bundel_colli_id ontbreekt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'vervoerders' AND column_name = 'handmatig_aanmelden') THEN
    RAISE EXCEPTION 'Mig 417: kolom vervoerders.handmatig_aanmelden ontbreekt';
  END IF;
  SELECT handmatig_aanmelden INTO v_flag FROM vervoerders WHERE code = 'rhenus_sftp';
  RAISE NOTICE 'Mig 417 verifier: rhenus_sftp.handmatig_aanmelden = % (verwacht TRUE)', v_flag;
END $$;

NOTIFY pgrst, 'reload schema';
