-- Migratie 491: HST pallet-types MP (mini pallet) + PLH (halve pallet).
--
-- Niek Zandvoort (HST Groep, mail 2026-06-24) bevestigde twee extra HST
-- PackageUnitID's naast EP/SP (mig 485): MP = Mini Pallet, PLH = halve pallet.
-- Zelfde deep module — `zending_colli.pallet_type` → HST payload-builder mapt
-- PackageUnitID = pallet_type ?? 'col' — dus de payload-builder en de colli-seam
-- hoeven NIET aangeraakt; MP/PLH stromen automatisch door. HST prijst op
-- PackageUnitID (geen footprint), dus net als EP/SP géén footprint-prefill in
-- maak_colli_bundel (de PLTS/HPLT-tak blijft Rhenus-only).
--
-- TWEE plekken met de hardgecodeerde toegestane-waarden-lijst worden verbreed:
--   1) CHECK zending_colli_pallet_type_chk: + MP, PLH.
--   2) maak_colli_bundel-validatie (RAISE vóór de INSERT): + MP, PLH.
-- Body van maak_colli_bundel = exact mig 490 (7-arg) + verbrede IN-lijst.
-- Drift-check: diff tegen mig 490 §maak_colli_bundel.
--
-- Idempotent: DROP+ADD CONSTRAINT (vaste naam), CREATE OR REPLACE (signatuur
-- ongewijzigd t.o.v. mig 490). Nummer 491 = hoogste (490) + 1 op origin/main —
-- HERVERIFIEER vlak vóór merge t.o.v. origin/main en hernummer indien nodig
-- (parallelle sessies schrijven live migraties). VOORWAARDE: mig 485 + 489 + 490.

-- ============================================================================
-- §1. CHECK verbreden: EP/SP/PLTS/HPLT + MP/PLH
-- ============================================================================
ALTER TABLE zending_colli DROP CONSTRAINT IF EXISTS zending_colli_pallet_type_chk;
ALTER TABLE zending_colli ADD CONSTRAINT zending_colli_pallet_type_chk
  CHECK (pallet_type IS NULL OR (pallet_type IN ('EP', 'SP', 'MP', 'PLH', 'PLTS', 'HPLT') AND is_bundel));

COMMENT ON COLUMN zending_colli.pallet_type IS
  'Mig 485/489/491: pallet-type van een bundel-rij. HST PackageUnitID: EP '
  '(Europallet) / SP (wegwerp pallet) / MP (mini pallet) / PLH (halve pallet). '
  'Rhenus packageTypeCode: PLTS (volle pallet) / HPLT (halve pallet). NULL = '
  'losse colli of Rhenus-zak. HST payload-builder: PackageUnitID = pallet_type ?? ''col''.';

-- ============================================================================
-- §2. maak_colli_bundel-validatie verbreden. Body = exact mig 490 (7-arg) +
--     MP/PLH in de pallet-type-RAISE. Signatuur ongewijzigd → CREATE OR REPLACE.
-- ============================================================================
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

  -- Mig 485/489/491: pallet-type alleen EP/SP/MP/PLH (HST) of PLTS/HPLT (Rhenus).
  -- De CHECK op de kolom borgt dit ook; deze RAISE geeft een leesbare melding vóór de INSERT.
  IF p_pallet_type IS NOT NULL AND p_pallet_type NOT IN ('EP', 'SP', 'MP', 'PLH', 'PLTS', 'HPLT') THEN
    RAISE EXCEPTION 'Onbekend pallet-type % (verwacht EP/SP/MP/PLH voor HST of PLTS/HPLT voor Rhenus)', p_pallet_type;
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
  -- EP/SP/MP/PLH (HST) blijven op max — HST prijst op PackageUnitID, niet op dims.
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

COMMENT ON FUNCTION maak_colli_bundel IS
  'Colli-bundeling (spec 2026-06-17, mig 485/489/490/491): maakt 1 bundel-rij in zending_colli '
  '(eigen SSCC, is_bundel=TRUE). Gewicht=som; maat=max behalve Rhenus-pallet (PLTS 80×120 / '
  'HPLT 80×60 vaste footprint). p_pallet_type EP/SP/MP/PLH (HST PackageUnitID) of PLTS/HPLT (Rhenus '
  'packageTypeCode+width), NULL = geen pallet (RLEN/zak). p_hoogte_cm = pallet-laadhoogte '
  '(Rhenus <height>, NULL voor los/HST). Status ''Picken'' OF ''Klaar voor verzending'' + '
  'bundel-vervoerder + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- §3. Verifier — CHECK bevat MP/PLH.
-- ============================================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'zending_colli_pallet_type_chk';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Mig 491: CHECK zending_colli_pallet_type_chk ontbreekt';
  END IF;
  ASSERT v_def LIKE '%''MP''%' AND v_def LIKE '%''PLH''%',
    'Mig 491: CHECK bevat MP/PLH niet (def: ' || v_def || ')';
  RAISE NOTICE 'Mig 491 verifier: pallet_type CHECK bevat MP + PLH OK.';
END $$;

NOTIFY pgrst, 'reload schema';
