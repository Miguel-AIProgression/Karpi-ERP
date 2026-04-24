-- Migration 127: Inkooporders, inkooporder_regels, leveranciers + ontvangst-flow
-- Zie plan: C:\Users\migue\.claude\plans\ik-heb-zojuist-een-mighty-moore.md
--
-- Idempotent: veilig om meerdere keren te runnen. Robuust tegen bestaande
-- (mogelijk lege) stub-tabellen: elke kolom wordt via ALTER TABLE ADD COLUMN
-- IF NOT EXISTS toegevoegd, nooit via CREATE TABLE-only.
--
-- Bron: eenmalige import van Inkoopoverzicht.xlsx (~535 openstaande orders,
-- 4.273 regels, 22 actieve leveranciers) + handmatige invoer via frontend.

-- ============================================================================
-- ENUM inkooporder_status
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE inkooporder_status AS ENUM (
    'Concept', 'Besteld', 'Deels ontvangen', 'Ontvangen', 'Geannuleerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- TABEL leveranciers — CREATE + fill-in missing columns
-- ============================================================================
CREATE TABLE IF NOT EXISTS leveranciers (
  id BIGSERIAL PRIMARY KEY,
  naam TEXT NOT NULL
);

ALTER TABLE leveranciers
  ADD COLUMN IF NOT EXISTS leverancier_nr INTEGER,
  ADD COLUMN IF NOT EXISTS woonplaats     TEXT,
  ADD COLUMN IF NOT EXISTS adres          TEXT,
  ADD COLUMN IF NOT EXISTS postcode       TEXT,
  ADD COLUMN IF NOT EXISTS land           TEXT,
  ADD COLUMN IF NOT EXISTS contactpersoon TEXT,
  ADD COLUMN IF NOT EXISTS telefoon       TEXT,
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS betaalconditie TEXT,
  ADD COLUMN IF NOT EXISTS actief         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- UNIQUE via index (partial, staat meerdere NULLs toe voor handmatige invoer)
CREATE UNIQUE INDEX IF NOT EXISTS leveranciers_leverancier_nr_key
  ON leveranciers(leverancier_nr) WHERE leverancier_nr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leveranciers_actief ON leveranciers(actief);
CREATE INDEX IF NOT EXISTS idx_leveranciers_naam   ON leveranciers(naam);

COMMENT ON COLUMN leveranciers.leverancier_nr IS
  'Extern leveranciernummer uit oud systeem (Inkoopoverzicht.xlsx kolom "Leverancier nr."). '
  'NULL voor handmatig aangemaakte leveranciers zonder oud nummer.';

-- ============================================================================
-- TABEL inkooporders — CREATE + fill-in missing columns
-- ============================================================================
CREATE TABLE IF NOT EXISTS inkooporders (
  id BIGSERIAL PRIMARY KEY
);

-- inkooporder_nr bestaat mogelijk al — voeg veilig toe en maak unique via index
ALTER TABLE inkooporders
  ADD COLUMN IF NOT EXISTS inkooporder_nr     TEXT,
  ADD COLUMN IF NOT EXISTS oud_inkooporder_nr BIGINT,
  ADD COLUMN IF NOT EXISTS leverancier_id     BIGINT,
  ADD COLUMN IF NOT EXISTS besteldatum        DATE,
  ADD COLUMN IF NOT EXISTS leverweek          TEXT,
  ADD COLUMN IF NOT EXISTS verwacht_datum     DATE,
  ADD COLUMN IF NOT EXISTS status             inkooporder_status NOT NULL DEFAULT 'Concept',
  ADD COLUMN IF NOT EXISTS bron               TEXT NOT NULL DEFAULT 'handmatig',
  ADD COLUMN IF NOT EXISTS opmerkingen        TEXT,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- FK naar leveranciers (idempotent via DO-block)
DO $$ BEGIN
  ALTER TABLE inkooporders
    ADD CONSTRAINT inkooporders_leverancier_fk
    FOREIGN KEY (leverancier_id) REFERENCES leveranciers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unieke nummers via partial indexes (werken ook als er al NULLs inzitten)
CREATE UNIQUE INDEX IF NOT EXISTS inkooporders_inkooporder_nr_key
  ON inkooporders(inkooporder_nr) WHERE inkooporder_nr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inkooporders_oud_nr_key
  ON inkooporders(oud_inkooporder_nr) WHERE oud_inkooporder_nr IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inkooporders_leverancier ON inkooporders(leverancier_id);
CREATE INDEX IF NOT EXISTS idx_inkooporders_status ON inkooporders(status)
  WHERE status IN ('Besteld', 'Deels ontvangen');
CREATE INDEX IF NOT EXISTS idx_inkooporders_verwacht ON inkooporders(verwacht_datum);

COMMENT ON COLUMN inkooporders.oud_inkooporder_nr IS
  'Ordernummer uit oud systeem (Inkoopoverzicht.xlsx kolom "Ordernummer", BIGINT). '
  'NULL voor nieuwe orders aangemaakt via de frontend.';

COMMENT ON COLUMN inkooporders.leverweek IS
  'Originele leverweek uit Excel in format "NN/YYYY" (bijv. "18/2026"). '
  'Wordt door de import geparsed naar verwacht_datum (maandag van die week).';

COMMENT ON COLUMN inkooporders.bron IS
  '''import'' = geimporteerd uit Inkoopoverzicht.xlsx, ''handmatig'' = aangemaakt via frontend.';

-- ============================================================================
-- TABEL inkooporder_regels — CREATE + fill-in missing columns
-- ============================================================================
CREATE TABLE IF NOT EXISTS inkooporder_regels (
  id BIGSERIAL PRIMARY KEY
);

ALTER TABLE inkooporder_regels
  ADD COLUMN IF NOT EXISTS inkooporder_id       BIGINT,
  ADD COLUMN IF NOT EXISTS regelnummer          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS artikelnr            TEXT,
  ADD COLUMN IF NOT EXISTS artikel_omschrijving TEXT,
  ADD COLUMN IF NOT EXISTS karpi_code           TEXT,
  ADD COLUMN IF NOT EXISTS inkoopprijs_eur      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS besteld_m            NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS geleverd_m           NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS te_leveren_m         NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eenheid              TEXT NOT NULL DEFAULT 'm',
  ADD COLUMN IF NOT EXISTS status_excel         INTEGER,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE inkooporder_regels
    ADD CONSTRAINT inkooporder_regels_eenheid_check CHECK (eenheid IN ('m', 'stuks'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN inkooporder_regels.eenheid IS
  '''m'' voor rolproducten (strekkende meters), ''stuks'' voor vaste afmetingen / staaltjes. '
  'Afgeleid uit producten.product_type bij import (''rol'' -> ''m'', anders ''stuks''); '
  'bij handmatige invoer via het product-type of door gebruiker gekozen.';

DO $$ BEGIN
  ALTER TABLE inkooporder_regels
    ADD CONSTRAINT inkooporder_regels_order_fk
    FOREIGN KEY (inkooporder_id) REFERENCES inkooporders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE inkooporder_regels
    ADD CONSTRAINT inkooporder_regels_artikelnr_fk
    FOREIGN KEY (artikelnr) REFERENCES producten(artikelnr) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Zet inkooporder_id NOT NULL als er geen NULL-rijen in staan (anders stil laten)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM inkooporder_regels WHERE inkooporder_id IS NULL) THEN
    ALTER TABLE inkooporder_regels ALTER COLUMN inkooporder_id SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inkooporder_regels_order_regel_key
  ON inkooporder_regels(inkooporder_id, regelnummer);

CREATE INDEX IF NOT EXISTS idx_inkooporder_regels_artikelnr ON inkooporder_regels(artikelnr);
CREATE INDEX IF NOT EXISTS idx_inkooporder_regels_open ON inkooporder_regels(inkooporder_id)
  WHERE te_leveren_m > 0;

COMMENT ON COLUMN inkooporder_regels.artikelnr IS
  'FK naar producten.artikelnr. NULL als het artikel (nog) niet in de masterdata staat — '
  '628 van de 3.113 artikelnummers uit Inkoopoverzicht.xlsx zitten niet in producten.';

COMMENT ON COLUMN inkooporder_regels.artikel_omschrijving IS
  'Snapshot uit Excel kolom "Omschrijving 1" (leesbare tekst). Fallback voor NULL artikelnr.';

COMMENT ON COLUMN inkooporder_regels.karpi_code IS
  'Snapshot uit Excel kolom "Omschrijving" (bijv. TWIS15400VIL).';

-- ============================================================================
-- KOLOM rollen.inkooporder_regel_id — koppeling fysieke rol -> inkooporder
-- ============================================================================
ALTER TABLE rollen
  ADD COLUMN IF NOT EXISTS inkooporder_regel_id BIGINT;

DO $$ BEGIN
  ALTER TABLE rollen
    ADD CONSTRAINT rollen_inkooporder_regel_fk
    FOREIGN KEY (inkooporder_regel_id) REFERENCES inkooporder_regels(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_rollen_inkooporder_regel ON rollen(inkooporder_regel_id)
  WHERE inkooporder_regel_id IS NOT NULL;

COMMENT ON COLUMN rollen.inkooporder_regel_id IS
  'Welke inkooporder-regel heeft deze fysieke rol geleverd. NULL voor rollen uit de '
  'historische voorraad-import die geen inkooporder-koppeling hebben.';

-- ============================================================================
-- TRIGGER updated_at voor alle drie de tabellen
-- ============================================================================
CREATE OR REPLACE FUNCTION set_inkoop_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leveranciers_updated_at ON leveranciers;
CREATE TRIGGER trg_leveranciers_updated_at
  BEFORE UPDATE ON leveranciers
  FOR EACH ROW EXECUTE FUNCTION set_inkoop_updated_at();

DROP TRIGGER IF EXISTS trg_inkooporders_updated_at ON inkooporders;
CREATE TRIGGER trg_inkooporders_updated_at
  BEFORE UPDATE ON inkooporders
  FOR EACH ROW EXECUTE FUNCTION set_inkoop_updated_at();

DROP TRIGGER IF EXISTS trg_inkooporder_regels_updated_at ON inkooporder_regels;
CREATE TRIGGER trg_inkooporder_regels_updated_at
  BEFORE UPDATE ON inkooporder_regels
  FOR EACH ROW EXECUTE FUNCTION set_inkoop_updated_at();

-- ============================================================================
-- TRIGGER sync producten.besteld_inkoop
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_besteld_inkoop_voor_artikel(p_artikelnr TEXT)
RETURNS void AS $$
DECLARE
  v_totaal NUMERIC;
  v_breedte_cm INTEGER;
  v_product_type TEXT;
  v_waarde INTEGER;
BEGIN
  IF p_artikelnr IS NULL THEN RETURN; END IF;

  -- Totaal openstaand, ongeacht eenheid (meters of stuks)
  SELECT COALESCE(SUM(GREATEST(r.te_leveren_m, 0)), 0)
    INTO v_totaal
  FROM inkooporder_regels r
  JOIN inkooporders o ON o.id = r.inkooporder_id
  WHERE r.artikelnr = p_artikelnr
    AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');

  SELECT p.product_type, k.standaard_breedte_cm
    INTO v_product_type, v_breedte_cm
  FROM producten p
  LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  -- Rol-producten: meters omrekenen naar m2 voor consistentie met voorraad-waarden
  -- Overige product_types (vast/staaltje/overig): aantal stuks direct gebruiken
  IF v_product_type = 'rol' AND v_breedte_cm IS NOT NULL AND v_breedte_cm > 0 THEN
    v_waarde := ROUND(v_totaal * v_breedte_cm / 100.0);
  ELSE
    v_waarde := ROUND(v_totaal);
  END IF;

  UPDATE producten
  SET besteld_inkoop = v_waarde
  WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_sync_besteld_inkoop() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_besteld_inkoop_voor_artikel(OLD.artikelnr);
    RETURN OLD;
  END IF;
  PERFORM sync_besteld_inkoop_voor_artikel(NEW.artikelnr);
  IF TG_OP = 'UPDATE' AND OLD.artikelnr IS DISTINCT FROM NEW.artikelnr THEN
    PERFORM sync_besteld_inkoop_voor_artikel(OLD.artikelnr);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inkooporder_regels_besteld_inkoop ON inkooporder_regels;
CREATE TRIGGER trg_inkooporder_regels_besteld_inkoop
  AFTER INSERT OR UPDATE OF te_leveren_m, artikelnr OR DELETE ON inkooporder_regels
  FOR EACH ROW EXECUTE FUNCTION trg_sync_besteld_inkoop();

-- ============================================================================
-- VIEW openstaande_inkooporder_regels
-- ============================================================================
CREATE OR REPLACE VIEW openstaande_inkooporder_regels AS
SELECT
  r.id AS regel_id,
  r.inkooporder_id,
  o.inkooporder_nr,
  o.oud_inkooporder_nr,
  o.status AS order_status,
  o.besteldatum,
  o.leverweek,
  o.verwacht_datum,
  l.id AS leverancier_id,
  l.leverancier_nr,
  l.naam AS leverancier_naam,
  l.woonplaats AS leverancier_woonplaats,
  r.regelnummer,
  r.artikelnr,
  r.artikel_omschrijving,
  r.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving AS product_omschrijving,
  r.inkoopprijs_eur,
  r.besteld_m,
  r.geleverd_m,
  r.te_leveren_m,
  r.status_excel
FROM inkooporder_regels r
JOIN inkooporders o ON o.id = r.inkooporder_id
LEFT JOIN leveranciers l ON l.id = o.leverancier_id
LEFT JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.te_leveren_m > 0
  AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');

-- ============================================================================
-- VIEW leveranciers_overzicht
-- ============================================================================
CREATE OR REPLACE VIEW leveranciers_overzicht AS
SELECT
  l.id,
  l.leverancier_nr,
  l.naam,
  l.woonplaats,
  l.actief,
  COUNT(DISTINCT o.id) FILTER (
    WHERE o.status IN ('Concept', 'Besteld', 'Deels ontvangen')
  ) AS openstaande_orders,
  COALESCE(SUM(r.te_leveren_m), 0) AS openstaande_meters,
  MIN(o.verwacht_datum) FILTER (
    WHERE o.status IN ('Concept', 'Besteld', 'Deels ontvangen')
      AND r.te_leveren_m > 0
  ) AS eerstvolgende_levering
FROM leveranciers l
LEFT JOIN inkooporders o ON o.leverancier_id = l.id
LEFT JOIN inkooporder_regels r ON r.inkooporder_id = o.id
GROUP BY l.id, l.leverancier_nr, l.naam, l.woonplaats, l.actief;

-- ============================================================================
-- VIEW inkooporders_overzicht
-- ============================================================================
CREATE OR REPLACE VIEW inkooporders_overzicht AS
SELECT
  o.id,
  o.inkooporder_nr,
  o.oud_inkooporder_nr,
  o.status,
  o.besteldatum,
  o.leverweek,
  o.verwacht_datum,
  o.bron,
  o.leverancier_id,
  l.naam AS leverancier_naam,
  l.woonplaats AS leverancier_woonplaats,
  COUNT(r.id) AS aantal_regels,
  COALESCE(SUM(r.besteld_m), 0) AS totaal_besteld_m,
  COALESCE(SUM(r.geleverd_m), 0) AS totaal_geleverd_m,
  COALESCE(SUM(r.te_leveren_m), 0) AS totaal_te_leveren_m
FROM inkooporders o
LEFT JOIN leveranciers l ON l.id = o.leverancier_id
LEFT JOIN inkooporder_regels r ON r.inkooporder_id = o.id
GROUP BY o.id, l.naam, l.woonplaats;

-- ============================================================================
-- RPC boek_ontvangst
-- ============================================================================
CREATE OR REPLACE FUNCTION boek_ontvangst(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT) AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_product RECORD;
  v_rol JSONB;
  v_lengte_cm INTEGER;
  v_breedte_cm INTEGER;
  v_oppervlak_m2 NUMERIC;
  v_rolnummer TEXT;
  v_nieuw_id BIGINT;
  v_totaal_geleverd_m NUMERIC := 0;
  v_open_regels INTEGER;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  IF v_regel.eenheid <> 'm' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rol-ontvangst is alleen voor eenheid ''m''. Gebruik de voorraad-ontvangst-flow voor vaste producten.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  IF v_regel.artikelnr IS NOT NULL THEN
    SELECT p.karpi_code, p.kwaliteit_code, p.kleur_code, p.zoeksleutel, p.omschrijving,
           p.verkoopprijs AS vvp_m2
      INTO v_product
    FROM producten p
    WHERE p.artikelnr = v_regel.artikelnr;
  END IF;

  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    v_rolnummer := v_rol->>'rolnummer';

    IF v_lengte_cm IS NULL OR v_lengte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige lengte_cm in rol: %', v_rol;
    END IF;
    IF v_breedte_cm IS NULL OR v_breedte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige breedte_cm in rol: %', v_rol;
    END IF;
    IF v_rolnummer IS NULL OR v_rolnummer = '' THEN
      RAISE EXCEPTION 'Rolnummer verplicht in rol: %', v_rol;
    END IF;

    v_oppervlak_m2 := ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, inkooporder_regel_id, reststuk_datum
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW()
    )
    RETURNING id INTO v_nieuw_id;

    INSERT INTO voorraad_mutaties (rol_id, type, lengte_voor_cm, lengte_na_cm, reden, medewerker)
    VALUES (v_nieuw_id, 'ontvangst', 0, v_lengte_cm,
            'Ontvangst inkooporder ' || v_order.inkooporder_nr || ' regel ' || v_regel.regelnummer,
            p_medewerker);

    v_totaal_geleverd_m := v_totaal_geleverd_m + (v_lengte_cm / 100.0);
    rol_id := v_nieuw_id;
    rolnummer := v_rolnummer;
    RETURN NEXT;
  END LOOP;

  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + v_totaal_geleverd_m,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + v_totaal_geleverd_m), 0)
  WHERE id = p_regel_id;

  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_ontvangst(BIGINT, JSONB, TEXT) IS
  'Boekt ontvangst van een inkooporder-regel met eenheid=m (rollen): maakt rollen aan in voorraad, '
  'werkt geleverd_m/te_leveren_m bij en zet order-status op Deels ontvangen/Ontvangen. '
  'p_rollen = JSONB array [{rolnummer, lengte_cm, breedte_cm}, ...].';

-- ============================================================================
-- RPC boek_voorraad_ontvangst — ontvangst voor vaste producten (stuks)
-- ============================================================================
CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_open_regels INTEGER;
BEGIN
  IF p_aantal IS NULL OR p_aantal <= 0 THEN
    RAISE EXCEPTION 'Aantal moet > 0 zijn';
  END IF;

  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  IF v_regel.eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Voorraad-ontvangst is alleen voor eenheid ''stuks''. Gebruik boek_ontvangst voor rollen.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  -- Voorraad ophogen op het product (alleen als artikelnr bekend is)
  IF v_regel.artikelnr IS NOT NULL THEN
    UPDATE producten
    SET voorraad = COALESCE(voorraad, 0) + p_aantal
    WHERE artikelnr = v_regel.artikelnr;
  END IF;

  -- Regel bijwerken
  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + p_aantal,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + p_aantal), 0)
  WHERE id = p_regel_id;

  -- Order-status bijwerken
  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'Boekt ontvangst van een inkooporder-regel met eenheid=stuks (vaste producten): '
  'verhoogt producten.voorraad met p_aantal en werkt regel + order-status bij. '
  'Maakt geen rollen aan (die zijn alleen voor eenheid=m).';

-- ============================================================================
-- RLS policies (fase 1: authenticated = volledige toegang)
-- ============================================================================
ALTER TABLE leveranciers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inkooporders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inkooporder_regels  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY leveranciers_auth_all ON leveranciers FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY inkooporders_auth_all ON inkooporders FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY inkooporder_regels_auth_all ON inkooporder_regels FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
