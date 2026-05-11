-- Migratie 238: snijplanning_kpis_gefilterd RPC
--
-- Vervangt de drie parallelle count-queries in
-- frontend/src/lib/supabase/queries/snijplanning.ts (fetchSnijplanningKpis):
-- 3 round-trips → 1 round-trip, en de ISO-week-grenzen leven nu op één plek
-- (Postgres `date_trunc('week', …)`) ipv verspreid over JS `weekRange()` en
-- inline filterklauzules. Spiegelt het patroon van `snijplanning_status_counts_gefilterd`.

CREATE OR REPLACE FUNCTION snijplanning_kpis_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  binnen_horizon          BIGINT,
  deze_week_te_snijden    BIGINT,
  deze_week_gesneden      BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH grenzen AS (
    SELECT
      date_trunc('week', CURRENT_DATE)::DATE                 AS deze_week_ma,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE  AS deze_week_zo,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::DATE  AS volgende_week_ma,
      (date_trunc('week', CURRENT_DATE) + INTERVAL '13 days')::DATE AS volgende_week_zo
  )
  SELECT
    COUNT(*) FILTER (
      WHERE so.status IN ('Gepland', 'Snijden')
        AND (p_tot_datum IS NULL OR so.afleverdatum IS NULL OR so.afleverdatum <= p_tot_datum)
    ) AS binnen_horizon,
    COUNT(*) FILTER (
      WHERE so.status IN ('Gepland', 'Snijden')
        AND so.afleverdatum BETWEEN g.volgende_week_ma AND g.volgende_week_zo
    ) AS deze_week_te_snijden,
    COUNT(*) FILTER (
      WHERE so.status = 'Gesneden'
        AND so.gesneden_op::DATE BETWEEN g.deze_week_ma AND g.deze_week_zo
    ) AS deze_week_gesneden
  FROM snijplanning_overzicht so
  CROSS JOIN grenzen g;
$$;

COMMENT ON FUNCTION snijplanning_kpis_gefilterd(DATE) IS
  'Drie KPI-cijfers voor de snijplanning-overview header in één query. '
  '`binnen_horizon` (Gepland+Snijden binnen p_tot_datum), `deze_week_te_snijden` '
  '(Gepland+Snijden met afleverdatum in volgende ISO-week), `deze_week_gesneden` '
  '(status Gesneden met gesneden_op in deze ISO-week). Mig 238.';
