-- Functie: groepen_met_nieuwe_ongeplande_stukken
--
-- Geeft (kwaliteit_code, kleur_code)-groepen terug waar recent een 'Gepland'-
-- snijplan is aangemaakt dat nog geen rol en geen IO-claim heeft.
--
-- Aanleiding: na bevestig_concept_order worden maatwerk-snijplannen aangemaakt
-- als 'Gepland'/rol_id=NULL. De pg_net-trigger (mig 100) is inert totdat
-- edge_url/auth_header in app_config gevuld zijn; de herplan-sweep is de
-- enige terugval maar selecteert willekeurig 50/~220 groepen en kan een
-- specifieke groep meerdere uren overslaan. Deze functie voedt een
-- prioriteitspass in herplan-sweep zodat een nieuwe groep maximaal
-- één sweep-interval (30 min) hoeft te wachten.
--
-- p_window_minuten: hoeveel minuten terug te kijken (default 360 = 6 uur,
-- ruimschoots genoeg voor de statistische worst case van de willekeurige
-- sweep).
CREATE OR REPLACE FUNCTION groepen_met_nieuwe_ongeplande_stukken(
  p_window_minuten INTEGER DEFAULT 360
)
RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT
    orr.maatwerk_kwaliteit_code::TEXT,
    orr.maatwerk_kleur_code::TEXT
  FROM snijplannen sn
  JOIN order_regels orr ON sn.order_regel_id = orr.id
  WHERE sn.status = 'Gepland'
    AND sn.rol_id IS NULL
    AND sn.verwacht_inkooporder_regel_id IS NULL
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
    AND sn.snijden_uit_standaardmaat = false
    AND sn.created_at > NOW() - (p_window_minuten || ' minutes')::INTERVAL
  ORDER BY 1, 2
$$;

GRANT EXECUTE ON FUNCTION groepen_met_nieuwe_ongeplande_stukken(INTEGER) TO service_role;
