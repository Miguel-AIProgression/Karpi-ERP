-- Migratie 200: klanteigen_namen op inkoopgroep-niveau + resolutie-RPC's
--
-- Achtergrond
-- -----------
-- `klanteigen_namen` bestaat al met (debiteur_nr, kwaliteit_code) UK en is in
-- mig 199 uitgebreid met optionele `kleur_code`. Inkoopgroepen zijn pas in
-- mig 189 toegevoegd. In TKA013-export uit het oude systeem staan ook
-- inkoopgroep-brede aliassen (rijen waar kolom `Klant/Inkoopcomb.` een
-- INKC-code is i.p.v. debiteur-nr). Die zijn nooit ingeladen.
--
-- Deze migratie:
--   1. Maakt `debiteur_nr` nullable.
--   2. Voegt `inkoopgroep_code` FK + `bron` + `updated_at` (audit) toe.
--   3. Forceert XOR via CHECK constraint — precies één van debiteur_nr en
--      inkoopgroep_code is gevuld.
--   4. Voegt een UK voor inkoopgroep-niveau toe (op kwaliteit + kleur — kleur
--      NULL telt mee via COALESCE-trick zoals in mig 199).
--   5. Levert RPC `resolve_klanteigen_naam(debiteur, kwaliteit, kleur)` —
--      klant-met-kleur > klant-zonder-kleur > inkoopgroep-met-kleur >
--      inkoopgroep-zonder-kleur > NULL.
--   6. Levert batch-RPC `resolve_klanteigen_namen_voor_debiteur(debiteur)` —
--      alle aliassen die voor een debiteur gelden, met dezelfde prioriteit.
--
-- Idempotent.

------------------------------------------------------------------------
-- 1. Kolommen toevoegen
------------------------------------------------------------------------

ALTER TABLE klanteigen_namen
  ADD COLUMN IF NOT EXISTS inkoopgroep_code TEXT
    REFERENCES inkoopgroepen(code) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS bron TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_klanteigen_namen_inkoopgroep_code
  ON klanteigen_namen(inkoopgroep_code);

------------------------------------------------------------------------
-- 2. debiteur_nr nullable
------------------------------------------------------------------------

ALTER TABLE klanteigen_namen
  ALTER COLUMN debiteur_nr DROP NOT NULL;

------------------------------------------------------------------------
-- 3. Inkoopgroep-UK (partial, met dezelfde COALESCE-trick als mig 199)
------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS klanteigen_namen_groep_kwal_kleur_uk
  ON klanteigen_namen (inkoopgroep_code, kwaliteit_code, COALESCE(kleur_code, ''))
  WHERE inkoopgroep_code IS NOT NULL;

------------------------------------------------------------------------
-- 4. CHECK XOR
------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'klanteigen_namen_debiteur_xor_inkoopgroep'
      AND conrelid = 'klanteigen_namen'::regclass
  ) THEN
    ALTER TABLE klanteigen_namen
      ADD CONSTRAINT klanteigen_namen_debiteur_xor_inkoopgroep CHECK (
        (debiteur_nr IS NOT NULL AND inkoopgroep_code IS NULL) OR
        (debiteur_nr IS NULL AND inkoopgroep_code IS NOT NULL)
      );
  END IF;
END $$;

------------------------------------------------------------------------
-- 5. updated_at trigger
------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_klanteigen_namen_updated_at ON klanteigen_namen;
CREATE TRIGGER trg_klanteigen_namen_updated_at
  BEFORE UPDATE ON klanteigen_namen
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

------------------------------------------------------------------------
-- 6. Resolutie-RPC met kleur-fallback
------------------------------------------------------------------------
-- Volgorde:
--   1) klant-specifiek + zelfde kleur
--   2) klant-specifiek + kleur=NULL
--   3) inkoopgroep + zelfde kleur (via debiteuren.inkoopgroep_code)
--   4) inkoopgroep + kleur=NULL
--   5) NULL

CREATE OR REPLACE FUNCTION resolve_klanteigen_naam(
  p_debiteur_nr    INTEGER,
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH klant_kleur AS (
    SELECT benaming, 1 AS prio
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND p_kleur_code IS NOT NULL
      AND kleur_code = p_kleur_code
    LIMIT 1
  ),
  klant_kwal AS (
    SELECT benaming, 2 AS prio
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NULL
    LIMIT 1
  ),
  groep_kleur AS (
    SELECT k.benaming, 3 AS prio
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND k.kwaliteit_code = p_kwaliteit_code
      AND p_kleur_code IS NOT NULL
      AND k.kleur_code = p_kleur_code
    LIMIT 1
  ),
  groep_kwal AS (
    SELECT k.benaming, 4 AS prio
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND k.kwaliteit_code = p_kwaliteit_code
      AND k.kleur_code IS NULL
    LIMIT 1
  )
  SELECT benaming FROM (
    SELECT * FROM klant_kleur
    UNION ALL SELECT * FROM klant_kwal
    UNION ALL SELECT * FROM groep_kleur
    UNION ALL SELECT * FROM groep_kwal
  ) hits
  ORDER BY prio
  LIMIT 1;
$$;

COMMENT ON FUNCTION resolve_klanteigen_naam(INTEGER, TEXT, TEXT) IS
  'Klant-eigen kwaliteit-naam met fallback. Volgorde: klant+kleur > '
  'klant+kwaliteit > inkoopgroep+kleur > inkoopgroep+kwaliteit > NULL. '
  'Mig 200 (2026-05-06).';

------------------------------------------------------------------------
-- 7. Batch-RPC voor orders-laag
------------------------------------------------------------------------
-- Retourneert per debiteur alle (kwaliteit_code, kleur_code) → benaming met
-- klant-niveau prioriteit boven inkoopgroep-niveau (per kwaliteit+kleur).
-- TS-laag bouwt hieruit een Map op key `${kwaliteit}_${kleur ?? ''}` en
-- gebruikt specifiek > fallback in toRegel().

CREATE OR REPLACE FUNCTION resolve_klanteigen_namen_voor_debiteur(
  p_debiteur_nr INTEGER
) RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code     TEXT,
  benaming       TEXT,
  bron           TEXT  -- 'klant' of 'inkoopgroep'
)
LANGUAGE sql
STABLE
AS $$
  WITH klant AS (
    SELECT k.kwaliteit_code, k.kleur_code, k.benaming, 'klant'::TEXT AS bron
    FROM klanteigen_namen k
    WHERE k.debiteur_nr = p_debiteur_nr
  ),
  groep AS (
    SELECT k.kwaliteit_code, k.kleur_code, k.benaming, 'inkoopgroep'::TEXT AS bron
    FROM klanteigen_namen k
    JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
    WHERE d.debiteur_nr = p_debiteur_nr
      AND NOT EXISTS (
        SELECT 1 FROM klant kl
        WHERE kl.kwaliteit_code = k.kwaliteit_code
          AND kl.kleur_code IS NOT DISTINCT FROM k.kleur_code
      )
  )
  SELECT kwaliteit_code, kleur_code, benaming, bron FROM klant
  UNION ALL
  SELECT kwaliteit_code, kleur_code, benaming, bron FROM groep;
$$;

COMMENT ON FUNCTION resolve_klanteigen_namen_voor_debiteur(INTEGER) IS
  'Alle kwaliteit/kleur-aliassen die voor een debiteur gelden (klant-niveau '
  '+ overerving via inkoopgroep). Klant-niveau heeft voorrang per (kwaliteit, '
  'kleur)-paar. Mig 200.';

------------------------------------------------------------------------
-- 8. Comments op nieuwe kolommen
------------------------------------------------------------------------

COMMENT ON COLUMN klanteigen_namen.inkoopgroep_code IS
  'Inkoopgroep waarvoor deze alias geldt. Erft door naar alle debiteuren met '
  'deze inkoopgroep_code, tenzij debiteur eigen alias heeft. XOR met '
  'debiteur_nr.';

COMMENT ON COLUMN klanteigen_namen.bron IS
  'Herkomst van de regel — bv. ''TKA013-2026-03-19'' voor Excel-import, '
  '''ui'' voor handmatige invoer.';

------------------------------------------------------------------------
-- 9. Upsert-RPC voor de UI
------------------------------------------------------------------------
-- supabase-js .upsert() kan niet richten op een functional unique index
-- (COALESCE(kleur_code, '')). Daarom een server-side wrapper die de juiste
-- match-logica uitvoert: zoek op (debiteur_nr | inkoopgroep_code, kwaliteit,
-- kleur) en UPDATE-of-INSERT.

CREATE OR REPLACE FUNCTION upsert_klanteigen_naam(
  p_debiteur_nr      INTEGER,
  p_inkoopgroep_code TEXT,
  p_kwaliteit_code   TEXT,
  p_kleur_code       TEXT,
  p_benaming         TEXT,
  p_omschrijving     TEXT DEFAULT NULL,
  p_leverancier      TEXT DEFAULT NULL,
  p_bron             TEXT DEFAULT 'ui'
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF (p_debiteur_nr IS NULL) = (p_inkoopgroep_code IS NULL) THEN
    RAISE EXCEPTION 'precies één van debiteur_nr / inkoopgroep_code moet gevuld zijn';
  END IF;

  IF p_debiteur_nr IS NOT NULL THEN
    SELECT id INTO v_id
    FROM klanteigen_namen
    WHERE debiteur_nr = p_debiteur_nr
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NOT DISTINCT FROM p_kleur_code;
  ELSE
    SELECT id INTO v_id
    FROM klanteigen_namen
    WHERE inkoopgroep_code = p_inkoopgroep_code
      AND kwaliteit_code = p_kwaliteit_code
      AND kleur_code IS NOT DISTINCT FROM p_kleur_code;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO klanteigen_namen (
      debiteur_nr, inkoopgroep_code, kwaliteit_code, kleur_code,
      benaming, omschrijving, leverancier, bron
    ) VALUES (
      p_debiteur_nr, p_inkoopgroep_code, p_kwaliteit_code, p_kleur_code,
      p_benaming, p_omschrijving, p_leverancier, p_bron
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE klanteigen_namen
       SET benaming     = p_benaming,
           omschrijving = COALESCE(p_omschrijving, omschrijving),
           leverancier  = COALESCE(p_leverancier, leverancier),
           bron         = COALESCE(p_bron, bron)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION upsert_klanteigen_naam(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Idempotent upsert voor klanteigen_namen — handelt de XOR (debiteur OF '
  'inkoopgroep) en NULL-kleur-matching server-side af. Mig 200.';
