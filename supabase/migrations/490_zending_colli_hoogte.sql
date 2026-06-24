-- Migratie 490: hoogte op zending_colli + maak_colli_bundel(p_hoogte_cm).
--
-- Vervolg op mig 489 (Rhenus pallet-bundeling). Een pallet heeft naast de
-- footprint (lengte×breedte) ook een LAADHOOGTE die de operator invult — Rhenus
-- wil L/B/H voor transportplanning. lengte/breedte komen uit de pallet-footprint
-- (PLTS 80×120, HPLT 80×60); hoogte is operator-invoer (stapelhoogte van de lading).
--
-- zending_colli had geen hoogte-kolom; deze voegt 'm toe (nullable — alleen
-- pallet-bundels vullen 'm; rollen/losse colli/HST blijven NULL). De Rhenus
-- xml-builder stuurt <height> in <dimension> alleen als hoogte_cm gevuld is.
-- LET OP: <height> staat NIET in het legacy-Rhenus-bestand (daar alleen
-- depth+width) — het is wel een standaard (optioneel) GS1-element. Te bevestigen
-- bij Rhenus' format-check, samen met de HPLT-footprint (mig 489).
--
-- maak_colli_bundel: signatuur van 6-arg → 7-arg (p_hoogte_cm DEFAULT NULL).
-- DROP de 6-arg zodat er geen overload-ambiguïteit is; een 6-named-arg-aanroep
-- (oude frontend, vóór redeploy) resolvet backward-compatible naar de 7-arg met
-- de default — geen deploy-volgorde-risico. Body = exact mig 489 + hoogte.
-- Drift-check: diff tegen mig 489 §maak_colli_bundel.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP+CREATE. Nummer 490 = hoogste (489)
-- + 1; HERVERIFIEER vlak vóór merge t.o.v. origin/main. VOORWAARDE: mig 489.

-- ============================================================================
-- §1. Schema: hoogte_cm op zending_colli
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS hoogte_cm INTEGER;

COMMENT ON COLUMN zending_colli.hoogte_cm IS
  'Mig 490: laadhoogte (cm) van een pallet-bundel — operator-invoer, voedt de '
  'Rhenus <dimension><height>. NULL voor rollen/losse colli/niet-pallet-bundels '
  'en HST (dat negeert dims). lengte_cm/breedte_cm = de pallet-footprint.';

-- ============================================================================
-- §2. maak_colli_bundel + p_hoogte_cm (7-arg). DROP 6-arg → CREATE 7-arg.
--     Body = mig 489 + hoogte-opslag.
-- ============================================================================
DROP FUNCTION IF EXISTS maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION maak_colli_bundel(
  p_zending_id  BIGINT,
  p_colli_ids   BIGINT[],
  p_gewicht_kg  NUMERIC DEFAULT NULL,
  p_lengte_cm   INTEGER DEFAULT NULL,
  p_breedte_cm  INTEGER DEFAULT NULL,
  p_pallet_type TEXT    DEFAULT NULL,
  p_hoogte_cm   INTEGER DEFAULT NULL
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
    RAISE EXCEPTION 'Colli-bundeling is alleen toegestaan voor bundel-vervoerders (zending % -> %)',
      p_zending_id, COALESCE(v_vervoerder, '(geen)');
  END IF;

  -- Mig 485/489: pallet-type alleen EP/SP (HST) of PLTS/HPLT (Rhenus). De CHECK op
  -- de kolom borgt dit ook; deze RAISE geeft een leesbare melding vóór de INSERT.
  IF p_pallet_type IS NOT NULL AND p_pallet_type NOT IN ('EP', 'SP', 'PLTS', 'HPLT') THEN
    RAISE EXCEPTION 'Onbekend pallet-type % (verwacht EP/SP voor HST of PLTS/HPLT voor Rhenus)', p_pallet_type;
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

  -- Mig 489: Rhenus-pallet draagt een VASTE footprint (depth=lengte, width=breedte),
  -- niet de max-van-de-rollen. Vult alleen als de caller geen expliciete maat gaf
  -- (expliciete param wint nog — de frontend stuurt sinds mig 490 de footprint mee).
  -- EP/SP (HST) blijven op max — HST prijst op PackageUnitID, niet op dims.
  IF p_pallet_type = 'PLTS' THEN
    v_lengte  := COALESCE(p_lengte_cm, 80);
    v_breedte := COALESCE(p_breedte_cm, 120);
  ELSIF p_pallet_type = 'HPLT' THEN
    v_lengte  := COALESCE(p_lengte_cm, 80);
    v_breedte := COALESCE(p_breedte_cm, 60);
  END IF;

  IF COALESCE(v_gewicht, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-gewicht moet > 0 zijn (carrier-preflight); kreeg %', v_gewicht;
  END IF;
  IF COALESCE(v_lengte, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-lengte moet > 0 zijn (carrier-preflight); kreeg %', v_lengte;
  END IF;

  SELECT COALESCE(MAX(colli_nr), 0) + 1 INTO v_volgnr
    FROM zending_colli WHERE zending_id = p_zending_id;

  INSERT INTO zending_colli (
    zending_id, colli_nr, order_regel_id, rol_id, sscc, gewicht_kg,
    omschrijving_snapshot, klant_omschrijving_snapshot, lengte_cm, breedte_cm, hoogte_cm, aantal,
    is_bundel, pallet_type
  ) VALUES (
    p_zending_id, v_volgnr, NULL, NULL, genereer_sscc(), v_gewicht,
    NULL, 'BUNDEL — ' || v_aantal_kinderen || ' colli', v_lengte, v_breedte, p_hoogte_cm, 1,
    TRUE, p_pallet_type
  ) RETURNING id INTO v_bundel_id;

  UPDATE zending_colli SET bundel_colli_id = v_bundel_id WHERE id = ANY(p_colli_ids);

  RETURN v_bundel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION maak_colli_bundel IS
  'Colli-bundeling (spec 2026-06-17, mig 485/489/490): maakt 1 bundel-rij in zending_colli '
  '(eigen SSCC, is_bundel=TRUE). Gewicht=som; maat=max behalve Rhenus-pallet (PLTS 80×120 / '
  'HPLT 80×60 vaste footprint). p_pallet_type EP/SP (HST PackageUnitID) of PLTS/HPLT (Rhenus '
  'packageTypeCode+width), NULL = geen pallet (RLEN/zak). p_hoogte_cm = pallet-laadhoogte '
  '(Rhenus <height>, NULL voor los/HST). Status ''Picken'' OF ''Klaar voor verzending'' + '
  'bundel-vervoerder + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- §3. Verifier
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'zending_colli' AND column_name = 'hoogte_cm') THEN
    RAISE EXCEPTION 'Mig 490: kolom zending_colli.hoogte_cm ontbreekt';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'maak_colli_bundel' AND pronargs = 7
  ) THEN
    RAISE EXCEPTION 'Mig 490: 7-arg maak_colli_bundel ontbreekt';
  END IF;
  RAISE NOTICE 'Mig 490 verifier: hoogte_cm-kolom + 7-arg maak_colli_bundel OK.';
END $$;

NOTIFY pgrst, 'reload schema';
