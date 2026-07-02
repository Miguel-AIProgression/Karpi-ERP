-- Migratie 575: vrije_voorraad blijft altijd in sync + Basta-veilige handmatige correcties
--
-- Bug: vrije_voorraad (mig 149) werd alleen herberekend door
-- herbereken_product_reservering() (reageert op claim-wijzigingen). Een
-- handmatige voorraad-aanpassing op het product-bewerk-formulier doet een
-- kale UPDATE producten SET voorraad=... via PostgREST -> vrije_voorraad
-- bleef staan op de oude waarde (voorraad 10->9, vrije_voorraad bleef 10).
--
-- Fix 1: trigger dwingt vrije_voorraad = voorraad - gereserveerd - backorder
-- af bij ELKE wijziging van die drie kolommen, ongeacht de bron (UI, RPC,
-- import-script). Eén bron van waarheid, geen los onderhoudspad meer nodig.
--
-- Fix 2: een handmatige correctie in RugFlow (bv. fysieke afwijking) mag niet
-- stilletjes verdwijnen zodra de periodieke Basta-voorraadlijst opnieuw wordt
-- ingeladen (die zet producten.voorraad hard op Basta's eigen kolom-H-telling,
-- een onafhankelijke fysieke telling die niets van RugFlow's correctie weet).
-- Ledger-tabel + RPC leggen elke handmatige wijziging vast; het import-script
-- (import/update_voorraad.py) telt bij het herladen alleen de correcties mee
-- die NA de datum van de ingeladen lijst zijn gemaakt (Basta's eigen telling
-- was toen al gedaan, kende de correctie dus nog niet) en sluit de rest af
-- (Basta's nieuwe telling heeft 'm al verwerkt) -> geen dubbeltelling.

CREATE OR REPLACE FUNCTION sync_vrije_voorraad()
RETURNS TRIGGER AS $$
BEGIN
  NEW.vrije_voorraad := COALESCE(NEW.voorraad, 0) - COALESCE(NEW.gereserveerd, 0) - COALESCE(NEW.backorder, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producten_sync_vrije_voorraad ON producten;
CREATE TRIGGER trg_producten_sync_vrije_voorraad
  BEFORE UPDATE OF voorraad, gereserveerd, backorder ON producten
  FOR EACH ROW
  EXECUTE FUNCTION sync_vrije_voorraad();

COMMENT ON FUNCTION sync_vrije_voorraad IS
  'Migratie 575: bewaakt vrije_voorraad = voorraad - gereserveerd - backorder bij elke wijziging, ongeacht de bron.';

-- Eenmalige backfill: bestaande scheve rijen (zoals de aanleiding van deze
-- migratie) rechttrekken. NB: een no-op UPDATE (x=x) vuurt de trigger niet
-- (WHEN OLD IS DISTINCT FROM NEW-semantiek van UPDATE OF), dus expliciet los.
UPDATE producten
SET vrije_voorraad = COALESCE(voorraad, 0) - COALESCE(gereserveerd, 0) - COALESCE(backorder, 0)
WHERE vrije_voorraad IS DISTINCT FROM (COALESCE(voorraad, 0) - COALESCE(gereserveerd, 0) - COALESCE(backorder, 0));

-- ============================================================================
-- Ledger voor handmatige voorraad-correcties (Basta-veilig)
-- ============================================================================
CREATE TABLE IF NOT EXISTS producten_voorraad_correcties (
  id BIGSERIAL PRIMARY KEY,
  artikelnr TEXT NOT NULL REFERENCES producten(artikelnr) ON DELETE CASCADE,
  van INTEGER NOT NULL,
  naar INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reden TEXT,
  aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
  aangemaakt_door TEXT,
  -- NULL = nog niet definitief verwerkt door een Basta-import (open, telt nog mee);
  -- gevuld = een Basta-lijst met snapshot-datum >= aangemaakt_op heeft 'm meegenomen.
  verwerkt_in_import_op TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voorraad_correcties_open
  ON producten_voorraad_correcties (artikelnr)
  WHERE verwerkt_in_import_op IS NULL;

COMMENT ON TABLE producten_voorraad_correcties IS
  'Migratie 575: audit-ledger van handmatige producten.voorraad-wijzigingen (via corrigeer_voorraad_handmatig), zodat import/update_voorraad.py (Basta-lijst) ze niet stilletjes overschrijft of dubbeltelt.';

CREATE OR REPLACE FUNCTION corrigeer_voorraad_handmatig(
  p_artikelnr TEXT,
  p_nieuwe_voorraad INTEGER,
  p_reden TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_oud INTEGER;
BEGIN
  SELECT voorraad INTO v_oud FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % niet gevonden', p_artikelnr;
  END IF;

  IF p_nieuwe_voorraad = v_oud THEN
    RETURN;
  END IF;

  UPDATE producten SET voorraad = p_nieuwe_voorraad WHERE artikelnr = p_artikelnr;

  INSERT INTO producten_voorraad_correcties (artikelnr, van, naar, delta, reden, aangemaakt_door)
  VALUES (p_artikelnr, v_oud, p_nieuwe_voorraad, p_nieuwe_voorraad - v_oud, p_reden, huidige_actor_email());
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION corrigeer_voorraad_handmatig IS
  'Migratie 575: enige weg om producten.voorraad handmatig te wijzigen -- logt het delta in producten_voorraad_correcties zodat de eerstvolgende Basta-import het kan meewegen i.p.v. overschrijven.';
