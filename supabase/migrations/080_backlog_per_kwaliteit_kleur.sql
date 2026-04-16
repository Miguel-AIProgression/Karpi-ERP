-- Migration 080: backlog_per_kwaliteit_kleur RPC voor real-time levertijd-check.
--
-- Geeft één rij terug met totale m² + aantal stukken in de backlog (status
-- 'Wacht', nog geen rol toegewezen) voor een (kwaliteit, kleur) combinatie.
-- Gebruikt door de check-levertijd edge function om in één roundtrip te
-- bepalen of er voldoende backlog is om een nieuwe rol efficient te benutten.

CREATE OR REPLACE FUNCTION backlog_per_kwaliteit_kleur(
  p_kwaliteit TEXT,
  p_kleur TEXT
)
RETURNS TABLE (
  totaal_m2 NUMERIC,
  aantal_stukken INTEGER,
  vroegste_afleverdatum DATE
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(snij_lengte_cm::numeric * snij_breedte_cm / 10000), 0)::NUMERIC AS totaal_m2,
    COUNT(*)::INTEGER AS aantal_stukken,
    MIN(afleverdatum)::DATE AS vroegste_afleverdatum
  FROM snijplanning_overzicht
  WHERE kwaliteit_code = p_kwaliteit
    AND kleur_code IN (
      p_kleur,
      p_kleur || '.0',
      regexp_replace(p_kleur, '\.0$', '')
    )
    AND status = 'Wacht'
    AND rol_id IS NULL;
$$;

COMMENT ON FUNCTION backlog_per_kwaliteit_kleur(TEXT, TEXT) IS
  'Aggregeert wachtende snijplan-stukken voor real-time levertijd-check. Match op kleur-varianten (X, X.0).';
