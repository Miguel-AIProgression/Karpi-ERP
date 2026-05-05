-- Migratie 0183: RPC set_locatie_voor_orderregel
--
-- Atomaire vervanger voor de twee opeenvolgende RPC-calls in
-- useUpdateMaatwerkLocatie:
--   1. createOrGetMagazijnLocatie(code) → magazijn_locaties.id
--   2. UPDATE snijplannen SET locatie = code WHERE order_regel_id = ? AND status = 'Ingepakt'
--
-- Bug die hiermee opgelost wordt: als de tweede call faalt (bv. invalid
-- order_regel_id, RLS-error, network-issue) dan blijft een dangling rij in
-- magazijn_locaties achter — er is dan een nieuwe magazijn-locatie aangemaakt
-- die nog door geen enkele snijplan-rij wordt gebruikt.
--
-- Door beide stappen in één plpgsql-functie te bundelen, vallen ze samen in
-- één transactie. Mislukt de UPDATE, dan rolt de hele functie terug en is er
-- geen dangling magazijn_locaties-rij.
--
-- Zie ADR-0002 (sectie "Locatie-mutaties — pragma, geen seam-leak-fix").

CREATE OR REPLACE FUNCTION set_locatie_voor_orderregel(
  p_order_regel_id INTEGER,
  p_code TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_id BIGINT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Magazijnlocatie-code mag niet leeg zijn';
  END IF;

  -- Stap 1: vind of maak magazijn-locatie. Hergebruikt dezelfde idempotente
  -- logica als create_or_get_magazijn_locatie (mig 169).
  SELECT id INTO v_id FROM magazijn_locaties WHERE code = v_code;
  IF v_id IS NULL THEN
    INSERT INTO magazijn_locaties (code, omschrijving, type, actief)
    VALUES (v_code, NULL, 'rek', true)
    RETURNING id INTO v_id;
  END IF;

  -- Stap 2: koppel locatie-code aan de ingepakte snijplan-regel(s) van deze
  -- orderregel. Snijplannen.locatie is een TEXT-kolom (geen FK) — dat blijft
  -- in V1 zo (zie ADR-0002 "Niet in scope: schema-migratie naar FK").
  UPDATE snijplannen
  SET locatie = v_code
  WHERE order_regel_id = p_order_regel_id
    AND status = 'Ingepakt';

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION set_locatie_voor_orderregel IS
  'Atomair: vindt-of-maakt magazijn_locaties-rij voor `code` en zet snijplannen.locatie '
  'op die code voor alle Ingepakt-rijen van de orderregel. Vervangt twee opeenvolgende '
  'RPC-calls in useUpdateMaatwerkLocatie. Migratie 0183 (ADR-0002).';
