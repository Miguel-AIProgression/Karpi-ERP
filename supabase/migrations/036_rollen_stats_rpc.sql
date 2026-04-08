-- Migration 036: Server-side rollen stats
-- Fix: Supabase default limit (1000 rijen) gaf onjuiste stats

CREATE OR REPLACE FUNCTION rollen_stats()
RETURNS JSON AS $$
  SELECT json_build_object(
    'totaal',        COUNT(*) FILTER (WHERE status NOT IN ('verkocht', 'gesneden')),
    'totaal_m2',     COALESCE(SUM(oppervlak_m2) FILTER (WHERE status NOT IN ('verkocht', 'gesneden')), 0),
    'volle_rollen',  COUNT(*) FILTER (WHERE status IN ('beschikbaar', 'gereserveerd')),
    'volle_m2',      COALESCE(SUM(oppervlak_m2) FILTER (WHERE status IN ('beschikbaar', 'gereserveerd')), 0),
    'aangebroken',   COUNT(*) FILTER (WHERE status = 'in_snijplan'),
    'aangebroken_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE status = 'in_snijplan'), 0),
    'reststukken',   COUNT(*) FILTER (WHERE status = 'reststuk'),
    'reststukken_m2', COALESCE(SUM(oppervlak_m2) FILTER (WHERE status = 'reststuk'), 0),
    'leeg_op',       COUNT(*) FILTER (WHERE status IN ('verkocht', 'gesneden'))
  )
  FROM rollen;
$$ LANGUAGE sql STABLE;
