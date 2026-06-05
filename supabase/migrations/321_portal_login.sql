-- mig 321: portal login (email + wachtwoord) voor leveranciers
-- Leveranciers kunnen inloggen via /portal/login met email+wachtwoord.
-- Admin maakt account aan via stel_portal_credentials_in().
-- Login valideert bcrypt-hash en geeft portal_token terug.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE leveranciers
  ADD COLUMN IF NOT EXISTS portal_email       TEXT,
  ADD COLUMN IF NOT EXISTS portal_wachtwoord_hash TEXT;

-- Case-insensitive unique index op email
CREATE UNIQUE INDEX IF NOT EXISTS leveranciers_portal_email_unique
  ON leveranciers (lower(portal_email))
  WHERE portal_email IS NOT NULL;

-- ── Login RPC ──────────────────────────────────────────────────────────────────
-- Valideert email+wachtwoord; geeft portal_token + naam terug (of nul rijen bij fout).
-- Wordt aangeroepen vanuit de supplier-portal edge function (service role).
CREATE OR REPLACE FUNCTION portal_login(p_email TEXT, p_wachtwoord TEXT)
RETURNS TABLE(portal_token UUID, leverancier_naam TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT l.portal_token, l.naam
  FROM   leveranciers l
  WHERE  lower(l.portal_email) = lower(trim(p_email))
    AND  l.portal_wachtwoord_hash IS NOT NULL
    AND  l.portal_wachtwoord_hash = crypt(p_wachtwoord, l.portal_wachtwoord_hash)
    AND  l.actief       = TRUE
    AND  l.portal_token IS NOT NULL;
END;
$$;

-- ── Admin: stel credentials in ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION stel_portal_credentials_in(
  p_leverancier_id INTEGER,
  p_email          TEXT,
  p_wachtwoord     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF length(trim(p_wachtwoord)) < 6 THEN
    RAISE EXCEPTION 'Wachtwoord moet minimaal 6 tekens zijn';
  END IF;
  UPDATE leveranciers SET
    portal_email          = lower(trim(p_email)),
    portal_wachtwoord_hash = crypt(p_wachtwoord, gen_salt('bf', 10))
  WHERE id = p_leverancier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leverancier % niet gevonden', p_leverancier_id;
  END IF;
END;
$$;

-- ── Admin: verwijder portal toegang ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION verwijder_portal_toegang(p_leverancier_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE leveranciers
  SET portal_email = NULL, portal_wachtwoord_hash = NULL
  WHERE id = p_leverancier_id;
END;
$$;

GRANT EXECUTE ON FUNCTION stel_portal_credentials_in(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verwijder_portal_toegang(INTEGER)                TO authenticated;
