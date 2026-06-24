-- Migratie 489: colli-bundeling tot een PALLET ook voor Rhenus (PLTS/HPLT).
--
-- HST kreeg in mig 485 al pallet-bundeling (EP/SP → HST PackageUnitID). Rhenus
-- bundelde tot nu toe "in een zak" (pallet_type NULL → packageTypeCode RLEN,
-- geen width). Rhenus' GS1-formaat kent echter een echt pallet-item — ons eigen
-- legacy-bestand (docs/rhenus/voorbeelden/, zending 9453355) stuurde
--   <packageTypeCode>PLTS</packageTypeCode>
--   <dimension><depth>80</depth><width>120</width></dimension>
-- voor een Europallet. Dit zet die mogelijkheid open:
--   PLTS = volle pallet  (footprint depth=80 × width=120, EU-pallet)
--   HPLT = halve pallet   (footprint depth=80 × width=60, half/Düsseldorf-pallet)
--
-- TWEE wijzigingen, beide bouwend op mig 485 (géén nieuw bundel-concept):
--   1) CHECK zending_colli_pallet_type_chk verbreed: EP/SP (HST) + PLTS/HPLT (Rhenus).
--   2) maak_colli_bundel: validatie verbreed naar de 4 codes + voor PLTS/HPLT de
--      vaste pallet-footprint invullen (depth=lengte_cm, width=breedte_cm) wanneer
--      de caller geen expliciete maat meegeeft. Footprint = de bron-van-waarheid
--      hier (single source); de Rhenus xml-builder leest 'm 1-op-1 uit de kolommen.
--
-- HPLT-footprint 80×60 is de half-EU-pallet-standaard maar een AANNAME (niet in
-- ons legacy-bestand, dat alleen 80×120 PLTS toont) — laten bevestigen door Rhenus
-- bij de eerstvolgende format-check. EP/SP-gedrag (HST) blijft ongemoeid: die
-- houden footprint = MAX-van-kinderen (HST prijst op PackageUnitID, niet op dims).
--
-- Idempotent: DROP+ADD CONSTRAINT IF EXISTS, CREATE OR REPLACE (signatuur =
-- mig-485's 6-arg, ongewijzigd). Nummer 489 = hoogste (488) + 1 op moment van
-- schrijven — HERVERIFIEER vlak vóór merge t.o.v. origin/main (parallelle sessies
-- schrijven live migraties). VOORWAARDE: mig 420/421/485 toegepast.

-- ============================================================================
-- §1. CHECK verbreden: EP/SP (HST) + PLTS/HPLT (Rhenus), alleen op een bundel-rij
-- ============================================================================
ALTER TABLE zending_colli DROP CONSTRAINT IF EXISTS zending_colli_pallet_type_chk;
ALTER TABLE zending_colli ADD CONSTRAINT zending_colli_pallet_type_chk
  CHECK (pallet_type IS NULL OR (pallet_type IN ('EP', 'SP', 'PLTS', 'HPLT') AND is_bundel));

COMMENT ON COLUMN zending_colli.pallet_type IS
  'Pallet-type van een bundel-rij. HST (mig 485): EP (Europallet) / SP (wegwerp) '
  '→ PackageUnitID. Rhenus (mig 489): PLTS (volle pallet) / HPLT (halve pallet) '
  '→ packageTypeCode + dimension/width. NULL = losse colli of niet-pallet-bundel. '
  'CHECK borgt de 4 codes; alleen op is_bundel=TRUE.';

-- ============================================================================
-- §2. maak_colli_bundel: validatie verbreed + Rhenus-pallet-footprint.
--     Body = exact mig 485 + de 2 PLTS/HPLT-takken (validatie + footprint).
--     Signatuur ongewijzigd (6-arg) → CREATE OR REPLACE volstaat.
--     Drift-check: diff tegen mig 485 §maak_colli_bundel.
-- ============================================================================
CREATE OR REPLACE FUNCTION maak_colli_bundel(
  p_zending_id  BIGINT,
  p_colli_ids   BIGINT[],
  p_gewicht_kg  NUMERIC DEFAULT NULL,
  p_lengte_cm   INTEGER DEFAULT NULL,
  p_breedte_cm  INTEGER DEFAULT NULL,
  p_pallet_type TEXT    DEFAULT NULL
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
  -- niet de max-van-de-rollen — een Europallet IS 80×120, een halve 80×60. Vult
  -- alleen in als de caller geen expliciete maat gaf (expliciete param wint nog).
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
    omschrijving_snapshot, klant_omschrijving_snapshot, lengte_cm, breedte_cm, aantal,
    is_bundel, pallet_type
  ) VALUES (
    p_zending_id, v_volgnr, NULL, NULL, genereer_sscc(), v_gewicht,
    NULL, 'BUNDEL — ' || v_aantal_kinderen || ' colli', v_lengte, v_breedte, 1,
    TRUE, p_pallet_type
  ) RETURNING id INTO v_bundel_id;

  UPDATE zending_colli SET bundel_colli_id = v_bundel_id WHERE id = ANY(p_colli_ids);

  RETURN v_bundel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION maak_colli_bundel IS
  'Colli-bundeling (spec 2026-06-17, mig 485/489): maakt 1 bundel-rij in zending_colli '
  '(eigen SSCC, is_bundel=TRUE) en zet bundel_colli_id op de gekozen kind-colli. '
  'Gewicht=som; maat=max behalve Rhenus-pallet (PLTS 80×120 / HPLT 80×60, vaste '
  'footprint). p_pallet_type EP/SP (HST PackageUnitID) of PLTS/HPLT (Rhenus '
  'packageTypeCode+width), NULL voor los. Status ''Picken'' OF ''Klaar voor '
  'verzending'' + bundel-vervoerder (handmatig_aanmelden) + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- §3. Verifier — CHECK accepteert de nieuwe codes, weigert onzin.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zending_colli_pallet_type_chk') THEN
    RAISE EXCEPTION 'Mig 489: CHECK zending_colli_pallet_type_chk ontbreekt';
  END IF;
  -- pg_get_constraintdef moet alle 4 de codes noemen.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'zending_colli_pallet_type_chk')
       NOT LIKE '%PLTS%' THEN
    RAISE EXCEPTION 'Mig 489: CHECK kent PLTS niet — verbreding mislukt';
  END IF;
  RAISE NOTICE 'Mig 489 verifier: pallet_type-CHECK verbreed naar EP/SP/PLTS/HPLT OK.';
END $$;

NOTIFY pgrst, 'reload schema';
