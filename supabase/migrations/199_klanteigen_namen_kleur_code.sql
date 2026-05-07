-- =============================================================
-- Migration 199: klanteigen_namen — optionele kleur_code
-- =============================================================
-- Voegt een derde dimensie toe: een rij kan optioneel een specifieke
-- `kleur_code` hebben. NULL = van toepassing op alle kleuren van de
-- kwaliteit (fallback).
--
-- Resolutie-prioriteit (volledig):
--   1. klant + kwaliteit + specifieke kleur
--   2. klant + kwaliteit + NULL kleur
--   3. inkoopgroep + kwaliteit + specifieke kleur   (alleen als mig 198 toegepast)
--   4. inkoopgroep + kwaliteit + NULL kleur          (alleen als mig 198 toegepast)
--   5. NULL
--
-- Defensief: deze migratie werkt zowel met als zonder mig 198 (die de
-- kolom `inkoopgroep_code` toevoegt). Detectie gebeurt via
-- information_schema, en het inkoopgroep-deel wordt overgeslagen als
-- de kolom ontbreekt.
-- =============================================================

ALTER TABLE public.klanteigen_namen
  ADD COLUMN IF NOT EXISTS kleur_code TEXT;

-- Oude UK (mig 198 of pre-198) wegruimen — onafhankelijk van naam.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'public.klanteigen_namen'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) ILIKE '%debiteur_nr%kwaliteit_code%'
     AND pg_get_constraintdef(oid) NOT ILIKE '%kleur_code%'
   LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.klanteigen_namen DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

DROP INDEX IF EXISTS uniq_klanteigen_debiteur_kwaliteit;
DROP INDEX IF EXISTS uniq_klanteigen_inkoopgroep_kwaliteit;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_klanteigen_debiteur_kwaliteit_kleur
  ON public.klanteigen_namen (debiteur_nr, kwaliteit_code, COALESCE(kleur_code, ''))
  WHERE debiteur_nr IS NOT NULL;

-- Inkoopgroep-niveau index alleen aanmaken als de kolom bestaat (mig 198).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'klanteigen_namen'
      AND column_name = 'inkoopgroep_code'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uniq_klanteigen_inkoopgroep_kwaliteit_kleur '
         || 'ON public.klanteigen_namen (inkoopgroep_code, kwaliteit_code, COALESCE(kleur_code, '''')) '
         || 'WHERE inkoopgroep_code IS NOT NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_klanteigen_namen_kleur
  ON public.klanteigen_namen (kleur_code)
  WHERE kleur_code IS NOT NULL;

COMMENT ON COLUMN public.klanteigen_namen.kleur_code IS
  'Optioneel: als gezet, geldt de eigen naam alleen voor deze (kwaliteit, kleur)-combinatie. NULL = van toepassing op alle kleuren van de kwaliteit (fallback). Mig 199.';

-- =============================================================
-- Resolutie-RPC herzien: kleur-bewust
-- =============================================================
-- Eén versie die werkt met of zonder mig 198. Als `inkoopgroep_code`
-- niet bestaat krijg je de oude pre-198-functie terug (alleen klant);
-- als hij wel bestaat krijg je de volledige hiërarchie.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'klanteigen_namen'
      AND column_name = 'inkoopgroep_code'
  ) THEN
    -- Volledige versie met inkoopgroep-fallback
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION resolve_klanteigen_naam(
        p_debiteur_nr    INTEGER,
        p_kwaliteit_code TEXT,
        p_kleur_code     TEXT DEFAULT NULL
      ) RETURNS TEXT
      LANGUAGE sql
      STABLE
      AS $body$
        WITH klant_specifiek AS (
          SELECT benaming
          FROM klanteigen_namen
          WHERE debiteur_nr = p_debiteur_nr
            AND kwaliteit_code = p_kwaliteit_code
            AND kleur_code = p_kleur_code
            AND p_kleur_code IS NOT NULL
          LIMIT 1
        ),
        klant_fallback AS (
          SELECT benaming
          FROM klanteigen_namen
          WHERE debiteur_nr = p_debiteur_nr
            AND kwaliteit_code = p_kwaliteit_code
            AND kleur_code IS NULL
          LIMIT 1
        ),
        groep_specifiek AS (
          SELECT k.benaming
          FROM klanteigen_namen k
          JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
          WHERE d.debiteur_nr = p_debiteur_nr
            AND k.kwaliteit_code = p_kwaliteit_code
            AND k.kleur_code = p_kleur_code
            AND p_kleur_code IS NOT NULL
          LIMIT 1
        ),
        groep_fallback AS (
          SELECT k.benaming
          FROM klanteigen_namen k
          JOIN debiteuren d ON d.inkoopgroep_code = k.inkoopgroep_code
          WHERE d.debiteur_nr = p_debiteur_nr
            AND k.kwaliteit_code = p_kwaliteit_code
            AND k.kleur_code IS NULL
          LIMIT 1
        )
        SELECT benaming FROM klant_specifiek
        UNION ALL
        SELECT benaming FROM klant_fallback
        UNION ALL
        SELECT benaming FROM groep_specifiek
        UNION ALL
        SELECT benaming FROM groep_fallback
        LIMIT 1;
      $body$;
    $f$;
  ELSE
    -- Pre-198 variant: alleen klant-niveau, geen inkoopgroep
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION resolve_klanteigen_naam(
        p_debiteur_nr    INTEGER,
        p_kwaliteit_code TEXT,
        p_kleur_code     TEXT DEFAULT NULL
      ) RETURNS TEXT
      LANGUAGE sql
      STABLE
      AS $body$
        WITH klant_specifiek AS (
          SELECT benaming
          FROM klanteigen_namen
          WHERE debiteur_nr = p_debiteur_nr
            AND kwaliteit_code = p_kwaliteit_code
            AND kleur_code = p_kleur_code
            AND p_kleur_code IS NOT NULL
          LIMIT 1
        ),
        klant_fallback AS (
          SELECT benaming
          FROM klanteigen_namen
          WHERE debiteur_nr = p_debiteur_nr
            AND kwaliteit_code = p_kwaliteit_code
            AND kleur_code IS NULL
          LIMIT 1
        )
        SELECT benaming FROM klant_specifiek
        UNION ALL
        SELECT benaming FROM klant_fallback
        LIMIT 1;
      $body$;
    $f$;
  END IF;
END $$;

COMMENT ON FUNCTION resolve_klanteigen_naam(INTEGER, TEXT, TEXT) IS
  'Klant-eigen kwaliteit-naam met fallback. Volgorde: 1) klant + specifieke '
  'kleur, 2) klant + NULL kleur, 3) inkoopgroep + specifieke kleur, '
  '4) inkoopgroep + NULL kleur, 5) NULL. Mig 199 (2026-05-06).';
