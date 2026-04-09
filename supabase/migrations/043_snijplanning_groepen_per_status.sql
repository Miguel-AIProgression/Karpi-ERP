-- Migration 043: Voeg per-status counts toe aan snijplanning_groepen view
-- Nodig voor tab-filtering op de snijplanning overview pagina

DROP VIEW IF EXISTS snijplanning_groepen CASCADE;

CREATE VIEW snijplanning_groepen AS
SELECT
  kwaliteit_code,
  kleur_code,
  COUNT(*)::INTEGER AS totaal_stukken,
  COUNT(DISTINCT order_id)::INTEGER AS totaal_orders,
  ROUND(SUM(snij_lengte_cm::NUMERIC * snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
  -- Backward compat: totaal_gesneden telt alles voorbij snijfase (was al zo)
  COUNT(*) FILTER (WHERE status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
  MIN(afleverdatum) FILTER (WHERE status NOT IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed', 'Geannuleerd')) AS vroegste_afleverdatum,
  -- Per-status counts voor tab-filtering
  COUNT(*) FILTER (WHERE status = 'Wacht')::INTEGER AS totaal_wacht,
  COUNT(*) FILTER (WHERE status = 'Gepland')::INTEGER AS totaal_gepland,
  COUNT(*) FILTER (WHERE status = 'In productie')::INTEGER AS totaal_in_productie,
  COUNT(*) FILTER (WHERE status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
  COUNT(*) FILTER (WHERE status = 'In confectie')::INTEGER AS totaal_in_confectie,
  COUNT(*) FILTER (WHERE status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
FROM snijplanning_overzicht
WHERE kwaliteit_code IS NOT NULL
GROUP BY kwaliteit_code, kleur_code
ORDER BY kwaliteit_code, kleur_code;
