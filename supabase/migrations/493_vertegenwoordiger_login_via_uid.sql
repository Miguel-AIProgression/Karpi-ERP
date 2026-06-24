-- Migratie 491: vertegenwoordiger-login via auth.uid()-mapping i.p.v. JWT app_metadata-claim
--
-- Aanleiding (live bevinding 2026-06-24): in deze Supabase-setup komt een custom key in
-- `app_metadata` (gezet via raw_app_meta_data) WEL in het client-user-object (de sidebar/
-- RoleGuard werken correct) maar NIET in het JWT-access-token. `auth.jwt() -> 'app_metadata'
-- ->> 'rol'` is server-side dus leeg → `is_externe_vertegenwoordiger()` (mig 490) gaf FALSE →
-- RLS filterde niet en de rep zag alles.
--
-- Fix: de helpers lezen de koppeling voortaan uit een tabel, gesleuteld op `auth.uid()`
-- (de `sub`-claim — die zit gegarandeerd in elk token; Supabase's eigen auth.uid() leunt erop).
-- Geen afhankelijkheid meer van token-embedding van custom claims. De policies (mig 490) en de
-- frontend (leest app_metadata client-side, werkt prima) blijven ongewijzigd — alleen de
-- helper-bodies wisselen van bron.

-- ---------------------------------------------------------------------------
-- 1. Koppeltabel auth-account → vertegenwoordiger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vertegenwoordiger_login (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vertegenw_code text NOT NULL REFERENCES medewerkers(code) ON UPDATE CASCADE,
  aangemaakt_op  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vertegenwoordiger_login IS
  'Mig 491: koppelt een auth-account (externe vertegenwoordiger) aan medewerkers.code. '
  'Bron voor is_externe_vertegenwoordiger()/huidige_vertegenw_code(); alleen via die '
  'SECURITY DEFINER-helpers gelezen. Provisioning zet deze rij + app_metadata (frontend).';

-- Volledig afgeschermd: RLS aan, geen policy → niemand leest 'm direct via PostgREST.
-- De helpers zijn SECURITY DEFINER en lezen 'm als owner; service_role (edge) bypasst RLS.
ALTER TABLE vertegenwoordiger_login ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Helpers herschrijven: lees uit de tabel op auth.uid()
--    (SECURITY DEFINER zodat de policy-aanroep de afgeschermde tabel mag lezen;
--     auth.uid() blijft de AANROEPER omdat DEFINER alleen de rol wisselt, niet de JWT-GUC.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_externe_vertegenwoordiger()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM vertegenwoordiger_login WHERE user_id = auth.uid());
$$;

COMMENT ON FUNCTION is_externe_vertegenwoordiger() IS
  'Mig 491: TRUE als de ingelogde gebruiker in vertegenwoordiger_login staat (op auth.uid()). '
  'Vervangt de JWT-app_metadata-check van mig 490 (claim kwam niet in het token).';

CREATE OR REPLACE FUNCTION huidige_vertegenw_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vertegenw_code FROM vertegenwoordiger_login WHERE user_id = auth.uid();
$$;

COMMENT ON FUNCTION huidige_vertegenw_code() IS
  'Mig 491: de medewerkers.code van de ingelogde externe vertegenwoordiger (uit '
  'vertegenwoordiger_login op auth.uid()), of NULL.';

GRANT EXECUTE ON FUNCTION is_externe_vertegenwoordiger() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION huidige_vertegenw_code() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Guido koppelen (vertegenwoordiger 9)
-- ---------------------------------------------------------------------------
INSERT INTO vertegenwoordiger_login (user_id, vertegenw_code)
SELECT u.id, '9'
FROM auth.users u
WHERE u.email = 'guido.boecker@t-online.de'
ON CONFLICT (user_id) DO UPDATE SET vertegenw_code = EXCLUDED.vertegenw_code;

NOTIFY pgrst, 'reload schema';
