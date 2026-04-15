-- Migration 077: Normaliseer kleur_code — strip trailing ".0" in alle tabellen
--
-- Reden: legacy data bevat zowel "10" als "10.0" voor dezelfde kleur. Dit
-- veroorzaakt dubbele groepen in de rollen-voorraad UI (VELV 10 én VELV 10.0)
-- en verwarrende mismatches bij snijplanning/matching. Na deze migration zijn
-- alle kleur_code-waarden genormaliseerd en voorkomt een CHECK-constraint
-- regressie.

BEGIN;

-- 1. Helper (idempotent): normaliseer_kleur_code
CREATE OR REPLACE FUNCTION normaliseer_kleur_code(code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(code, ''), '\.0+$', '')
$$;

-- 2. maatwerk_m2_prijzen: merge duplicates (UK kwaliteit_code+kleur_code)
--    Behoud de rij ZONDER .0 wanneer beide bestaan; anders hernoem de .0-rij.
DELETE FROM maatwerk_m2_prijzen p
WHERE kleur_code ~ '\.0+$'
  AND EXISTS (
    SELECT 1 FROM maatwerk_m2_prijzen q
    WHERE q.kwaliteit_code = p.kwaliteit_code
      AND q.kleur_code = normaliseer_kleur_code(p.kleur_code)
  );

UPDATE maatwerk_m2_prijzen
SET kleur_code = normaliseer_kleur_code(kleur_code)
WHERE kleur_code ~ '\.0+$';

-- 3. snijplan_groep_locks: composite PK (kwaliteit_code, kleur_code)
DELETE FROM snijplan_groep_locks p
WHERE kleur_code ~ '\.0+$'
  AND EXISTS (
    SELECT 1 FROM snijplan_groep_locks q
    WHERE q.kwaliteit_code = p.kwaliteit_code
      AND q.kleur_code = normaliseer_kleur_code(p.kleur_code)
  );

UPDATE snijplan_groep_locks
SET kleur_code = normaliseer_kleur_code(kleur_code)
WHERE kleur_code ~ '\.0+$';

-- 4. producten: normaliseer kleur_code en herbereken zoeksleutel
UPDATE producten
SET kleur_code = normaliseer_kleur_code(kleur_code),
    zoeksleutel = kwaliteit_code || '_' || normaliseer_kleur_code(kleur_code)
WHERE kleur_code ~ '\.0+$';

-- 5. rollen: normaliseer kleur_code en herbereken zoeksleutel
UPDATE rollen
SET kleur_code = normaliseer_kleur_code(kleur_code),
    zoeksleutel = kwaliteit_code || '_' || normaliseer_kleur_code(kleur_code)
WHERE kleur_code ~ '\.0+$';

-- 6. order_regels: maatwerk_kleur_code
UPDATE order_regels
SET maatwerk_kleur_code = normaliseer_kleur_code(maatwerk_kleur_code)
WHERE maatwerk_kleur_code ~ '\.0+$';

-- 7. snijvoorstellen
UPDATE snijvoorstellen
SET kleur_code = normaliseer_kleur_code(kleur_code)
WHERE kleur_code ~ '\.0+$';

-- 8. CHECK-constraints om regressie te voorkomen
ALTER TABLE rollen
  DROP CONSTRAINT IF EXISTS rollen_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT rollen_kleur_code_geen_trailing_nul
    CHECK (kleur_code IS NULL OR kleur_code !~ '\.0+$');

ALTER TABLE producten
  DROP CONSTRAINT IF EXISTS producten_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT producten_kleur_code_geen_trailing_nul
    CHECK (kleur_code IS NULL OR kleur_code !~ '\.0+$');

ALTER TABLE order_regels
  DROP CONSTRAINT IF EXISTS order_regels_maatwerk_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT order_regels_maatwerk_kleur_code_geen_trailing_nul
    CHECK (maatwerk_kleur_code IS NULL OR maatwerk_kleur_code !~ '\.0+$');

ALTER TABLE snijvoorstellen
  DROP CONSTRAINT IF EXISTS snijvoorstellen_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT snijvoorstellen_kleur_code_geen_trailing_nul
    CHECK (kleur_code IS NULL OR kleur_code !~ '\.0+$');

ALTER TABLE maatwerk_m2_prijzen
  DROP CONSTRAINT IF EXISTS maatwerk_m2_prijzen_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT maatwerk_m2_prijzen_kleur_code_geen_trailing_nul
    CHECK (kleur_code IS NULL OR kleur_code !~ '\.0+$');

ALTER TABLE snijplan_groep_locks
  DROP CONSTRAINT IF EXISTS snijplan_groep_locks_kleur_code_geen_trailing_nul,
  ADD  CONSTRAINT snijplan_groep_locks_kleur_code_geen_trailing_nul
    CHECK (kleur_code IS NULL OR kleur_code !~ '\.0+$');

COMMIT;
