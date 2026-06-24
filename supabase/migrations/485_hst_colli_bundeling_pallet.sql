-- Migratie 485: colli-bundeling ook voor HST, op pallet (EP/SP).
--
-- Rhenus kon al colli samenpakken onder één nieuwe SSCC (mig 420/421). HST krijgt
-- dezelfde mogelijkheid, maar de bundel = een PALLET. Het pallet-type bepaalt de
-- HST PackageUnitID die de payload-builder meestuurt:
--   EP = Europallet, SP = wegwerp pallet (afkortingen = HST's PackageUnitID's,
--   mail Niek Zandvoort 19-06-2026).
--
-- TWEE wijzigingen:
--   1) vervoerders.handmatig_aanmelden = TRUE voor hst_api. Sinds mig 484 is de
--      hold-guard van mig 420 weg — deze vlag gate't nu nog UITSLUITEND
--      maak_colli_bundel/verwijder_colli_bundel ("mag deze vervoerder bundelen?").
--      HST houdt dus NIET vast: bundelen gebeurt tijdens de pickronde ('Picken'),
--      daarna meldt HST gewoon direct aan (batch_cutoff_tijd blijft NULL).
--   2) zending_colli.pallet_type (NULL | 'EP' | 'SP') + maak_colli_bundel krijgt
--      p_pallet_type. NULL voor losse colli en Rhenus-bundels; 'EP'/'SP' voor een
--      HST-pallet-bundel. De payload-builder leest dit via de colli-seam
--      (fetch-zending-colli) en zet PackageUnitID = pallet_type ?? 'col'.
--
-- Géén nieuw bundel-concept: hergebruikt de generieke zending_colli-bundel-rij
-- (is_bundel + bundel_colli_id, mig 420) en het filter bundel_colli_id IS NULL in
-- de carrier-seam, dat de bundel-rij al als 1 collo laat meegaan.
--
-- Idempotent: ADD COLUMN/CONSTRAINT IF NOT EXISTS, DROP+CREATE de RPC (nieuwe
-- signatuur), UPDATE-guard. Nummer 485 = hoogste (484) + 1 op moment van
-- schrijven — HERVERIFIEER vlak vóór merge t.o.v. origin/main en hernummer indien
-- nodig (parallelle sessies schrijven live migraties).
-- VOORWAARDE: mig 420/421 (colli-bundeling) + mig 484 (hold-guard weg) toegepast.

-- ============================================================================
-- §1. Schema: pallet_type op zending_colli
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS pallet_type TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zending_colli_pallet_type_chk'
  ) THEN
    -- pallet_type alleen EP/SP, én alleen op een bundel-rij: een losse colli mag
    -- nooit een pallet-type dragen (zou anders als pallet naar HST gaan i.p.v. 'col').
    ALTER TABLE zending_colli ADD CONSTRAINT zending_colli_pallet_type_chk
      CHECK (pallet_type IS NULL OR (pallet_type IN ('EP', 'SP') AND is_bundel));
  END IF;
END $$;

COMMENT ON COLUMN zending_colli.pallet_type IS
  'Mig 485: HST-pallet-type van een bundel-rij — EP (Europallet) of SP (wegwerp '
  'pallet). NULL = losse colli of niet-HST-bundel. Wordt door de HST payload-'
  'builder gemapt op PackageUnitID (pallet_type ?? ''col''). CHECK borgt EP/SP.';

-- ============================================================================
-- §2. hst_api mag bundelen (gate voor maak_colli_bundel; geen hold meer sinds 484)
-- ============================================================================
UPDATE vervoerders SET handmatig_aanmelden = TRUE WHERE code = 'hst_api';

-- ============================================================================
-- §3. maak_colli_bundel + p_pallet_type. DROP de 5-arg versie (mig 421) zodat de
--     nieuwe 6-arg met DEFAULT NULL geen overload-ambiguïteit geeft; oude 5-arg-
--     aanroepen (zonder pallet) resolven backward-compatible naar de default.
--     Body = exact mig 421 + pallet-validatie + pallet_type op de INSERT; de
--     gewicht/lengte-guards zijn carrier-agnostisch hertekstueel ("preflight").
--     Drift-check: diff tegen mig 421 §maak_colli_bundel.
-- ============================================================================
DROP FUNCTION IF EXISTS maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER);

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

  -- Mig 485: pallet-type alleen EP/SP toegestaan (HST PackageUnitID). De CHECK op
  -- de kolom borgt dit ook; deze RAISE geeft een leesbare melding vóór de INSERT.
  IF p_pallet_type IS NOT NULL AND p_pallet_type NOT IN ('EP', 'SP') THEN
    RAISE EXCEPTION 'Onbekend pallet-type % (verwacht EP of SP)', p_pallet_type;
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
  'Colli-bundeling (spec 2026-06-17, mig 485): maakt 1 bundel-rij in zending_colli '
  '(eigen SSCC, is_bundel=TRUE) en zet bundel_colli_id op de gekozen kind-colli. '
  'Gewicht=som, maat=max (overschrijfbaar). p_pallet_type EP/SP zet de HST-'
  'PackageUnitID (NULL voor Rhenus/los). Status ''Picken'' OF ''Klaar voor '
  'verzending'' + bundel-vervoerder (handmatig_aanmelden) + >=2 nog-niet-gebundelde colli.';

-- ============================================================================
-- §4. Verifier — schema + vlag (geen live-mutatie; functioneel getest via de
--     payload-builder Deno-test + een aparte rolled-back SQL-check vóór deploy).
-- ============================================================================
DO $$
DECLARE
  v_flag BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'zending_colli' AND column_name = 'pallet_type') THEN
    RAISE EXCEPTION 'Mig 485: kolom zending_colli.pallet_type ontbreekt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zending_colli_pallet_type_chk') THEN
    RAISE EXCEPTION 'Mig 485: CHECK zending_colli_pallet_type_chk ontbreekt';
  END IF;
  SELECT handmatig_aanmelden INTO v_flag FROM vervoerders WHERE code = 'hst_api';
  ASSERT COALESCE(v_flag, FALSE), 'Mig 485: hst_api.handmatig_aanmelden niet TRUE';
  RAISE NOTICE 'Mig 485 verifier: pallet_type-kolom + CHECK + hst_api-bundelvlag OK.';
END $$;

NOTIFY pgrst, 'reload schema';
