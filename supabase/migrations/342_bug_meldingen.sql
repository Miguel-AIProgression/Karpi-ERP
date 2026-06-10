-- Migratie 342: bug_meldingen — in-app feedback/bug-meldtool
--
-- Doel: gebruikers kunnen overal in RugFlow via een zwevende knop rechtsonder
-- een bug/feedback melden. De huidige pagina-URL wordt automatisch vastgelegd,
-- de melder (auth.users) wordt opgeslagen, en optioneel kan een screenshot mee.
--
-- Workflow-statussen (bug_melding_status):
--   'Open'         -> nieuw gemeld, wacht op behandeling
--   'Verwerkt'     -> beheerder (Miguel) heeft het opgelost; wacht op acceptatie
--   'Geaccepteerd' -> melder bevestigt dat het goed is afgerond (eindstatus)
-- Transitie-rechten (afgedwongen in set_bug_status):
--   - alleen de beheerder mag 'Open' <-> 'Verwerkt' zetten (verwerken + terugzetten)
--   - alleen de melder (of beheerder) mag 'Verwerkt' -> 'Geaccepteerd' zetten
--
-- Beheerder = 1 hardcoded e-mail (Miguel). Single source of truth: is_bug_beheerder().
-- Frontend spiegelt deze waarde in frontend/src/lib/bug/beheerder.ts.
--
-- RLS: melder ziet eigen meldingen, beheerder ziet alles (volgt het mig 127-patroon,
-- maar dan rij-gescoped i.p.v. open). Statuswijzigingen lopen via SECURITY DEFINER-RPC,
-- daarom is er geen UPDATE-policy nodig.
--
-- Idempotent: enums in DO-blocks, tabel/bucket met IF NOT EXISTS / ON CONFLICT,
-- policies in DO-blocks met duplicate_object-guard, RPC's via CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE bug_melding_status AS ENUM ('Open', 'Verwerkt', 'Geaccepteerd');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE bug_urgentie AS ENUM ('Laag', 'Middel', 'Hoog');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tabel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bug_meldingen (
  id                BIGSERIAL PRIMARY KEY,
  titel             TEXT NOT NULL,
  omschrijving      TEXT,
  urgentie          bug_urgentie NOT NULL DEFAULT 'Middel',
  pagina_url        TEXT,
  status            bug_melding_status NOT NULL DEFAULT 'Open',
  bijlage_path      TEXT,                                       -- storage-path in bucket 'bug-bijlagen'
  gemeld_door       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  gemeld_door_email TEXT,                                       -- snapshot t.b.v. weergave (frontend leest auth.users niet)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verwerkt_op       TIMESTAMPTZ,
  geaccepteerd_op   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bug_meldingen_status     ON bug_meldingen (status);
CREATE INDEX IF NOT EXISTS idx_bug_meldingen_gemeld_door ON bug_meldingen (gemeld_door);
CREATE INDEX IF NOT EXISTS idx_bug_meldingen_created_at  ON bug_meldingen (created_at DESC);

-- updated_at automatisch bijwerken
CREATE OR REPLACE FUNCTION bug_meldingen_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bug_meldingen_updated_at ON bug_meldingen;
CREATE TRIGGER trg_bug_meldingen_updated_at
  BEFORE UPDATE ON bug_meldingen
  FOR EACH ROW EXECUTE FUNCTION bug_meldingen_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Beheerder-helper (single source of truth)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_bug_beheerder()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() ->> 'email', '') = 'miguel@aiprogression.nl';
$$;

COMMENT ON FUNCTION is_bug_beheerder() IS
  'Mig 342: TRUE als de ingelogde gebruiker de bug-beheerder is (Miguel). '
  'Gespiegeld in frontend/src/lib/bug/beheerder.ts.';

GRANT EXECUTE ON FUNCTION is_bug_beheerder() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE bug_meldingen ENABLE ROW LEVEL SECURITY;

-- SELECT: eigen meldingen, beheerder ziet alles
DO $$ BEGIN
  CREATE POLICY bug_meldingen_select ON bug_meldingen
    FOR SELECT TO authenticated
    USING (gemeld_door = auth.uid() OR is_bug_beheerder());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT: alleen namens jezelf
DO $$ BEGIN
  CREATE POLICY bug_meldingen_insert ON bug_meldingen
    FOR INSERT TO authenticated
    WITH CHECK (gemeld_door = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Geen UPDATE/DELETE-policy: statuswijzigingen lopen via set_bug_status (SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- 5. Storage-bucket voor screenshots/bijlagen
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bug-bijlagen',
  'bug-bijlagen',
  false,
  10485760,  -- 10 MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Authenticated upload bug-bijlagen"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'bug-bijlagen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated leest bug-bijlagen"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'bug-bijlagen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 6. Status-transitie-RPC (autorisatie + timestamp-stempeling)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_bug_status(p_id BIGINT, p_status bug_melding_status)
RETURNS bug_meldingen
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      bug_meldingen;
  v_is_admin BOOLEAN := is_bug_beheerder();
  v_uid      UUID    := auth.uid();
BEGIN
  SELECT * INTO v_row FROM bug_meldingen WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bug-melding % bestaat niet', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_status = 'Geaccepteerd' THEN
    -- Accepteren mag de melder zelf (of de beheerder), alleen vanuit 'Verwerkt'.
    IF v_row.gemeld_door IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de melder kan een melding accepteren';
    END IF;
    IF v_row.status <> 'Verwerkt' THEN
      RAISE EXCEPTION 'Een melding kan alleen vanuit "Verwerkt" geaccepteerd worden';
    END IF;
  ELSE
    -- 'Open' / 'Verwerkt' (verwerken + terugzetten): alleen de beheerder.
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de beheerder kan deze status zetten';
    END IF;
  END IF;

  UPDATE bug_meldingen
     SET status          = p_status,
         verwerkt_op     = CASE
                             WHEN p_status = 'Verwerkt' THEN now()
                             WHEN p_status = 'Open'     THEN NULL
                             ELSE verwerkt_op
                           END,
         geaccepteerd_op = CASE WHEN p_status = 'Geaccepteerd' THEN now() ELSE NULL END
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END; $$;

COMMENT ON FUNCTION set_bug_status(BIGINT, bug_melding_status) IS
  'Mig 342: zet de status van een bug-melding met autorisatie. '
  'Open/Verwerkt = alleen beheerder; Geaccepteerd = melder (vanuit Verwerkt).';

GRANT EXECUTE ON FUNCTION set_bug_status(BIGINT, bug_melding_status) TO authenticated;

NOTIFY pgrst, 'reload schema';
