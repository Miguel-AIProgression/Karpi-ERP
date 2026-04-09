-- Migration 045: RPC functie voor snijplanning groepen met optionele datum-filter
-- Hiermee kunnen gebruikers filteren op afleverdatum (bv. komende 1-4 weken)

CREATE OR REPLACE FUNCTION snijplanning_groepen_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code TEXT,
  totaal_stukken INTEGER,
  totaal_orders INTEGER,
  totaal_m2 FLOAT,
  totaal_gesneden INTEGER,
  vroegste_afleverdatum DATE,
  totaal_wacht INTEGER,
  totaal_gepland INTEGER,
  totaal_in_productie INTEGER,
  totaal_status_gesneden INTEGER,
  totaal_in_confectie INTEGER,
  totaal_gereed INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT
    so.kwaliteit_code,
    so.kleur_code,
    COUNT(*)::INTEGER AS totaal_stukken,
    COUNT(DISTINCT so.order_id)::INTEGER AS totaal_orders,
    ROUND(SUM(so.snij_lengte_cm::NUMERIC * so.snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
    COUNT(*) FILTER (WHERE so.status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
    MIN(so.afleverdatum) FILTER (WHERE so.status NOT IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed', 'Geannuleerd')) AS vroegste_afleverdatum,
    COUNT(*) FILTER (WHERE so.status = 'Wacht')::INTEGER AS totaal_wacht,
    COUNT(*) FILTER (WHERE so.status = 'Gepland')::INTEGER AS totaal_gepland,
    COUNT(*) FILTER (WHERE so.status = 'In productie')::INTEGER AS totaal_in_productie,
    COUNT(*) FILTER (WHERE so.status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
    COUNT(*) FILTER (WHERE so.status = 'In confectie')::INTEGER AS totaal_in_confectie,
    COUNT(*) FILTER (WHERE so.status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
  FROM snijplanning_overzicht so
  WHERE so.kqualiteit_code IS NOT NULL
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.kwaliteit_code, so.kleur_code
  ORDER BY so.kwaliteit_code, so.kleur_code;
$$;

-- Ook een gefilterde status count functie
CREATE OR REPLACE FUNCTION snijplanning_status_counts_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  status TEXT,
  aantal BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT
    so.status::TEXT,
    COUNT(*) AS aantal
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND so.status NOT IN ('Geannuleerd')
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.status
  HAVING COUNT(*) > 0;
$$;
