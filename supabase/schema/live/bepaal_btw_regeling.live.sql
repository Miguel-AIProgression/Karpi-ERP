CREATE OR REPLACE FUNCTION public.bepaal_btw_regeling(p_afl_land text, p_debiteur_land text, p_afhalen boolean, p_verlegd_vlag boolean, p_btw_nummer text, p_btw_percentage numeric)
 RETURNS TABLE(regeling text, effectief_pct numeric, controle_nodig boolean, controle_reden text, land_iso2 text)
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_land_bron TEXT;
  v_iso2      TEXT;
BEGIN
  -- Afhalen: Karpi heeft geen vervoersbewijs naar het land waar de klant zelf
  -- naartoe rijdt — behandel als binnenlands (conservatieve aanname).
  IF COALESCE(p_afhalen, FALSE) THEN
    v_land_bron := p_debiteur_land;
  ELSE
    v_land_bron := COALESCE(NULLIF(TRIM(p_afl_land), ''), p_debiteur_land);
  END IF;

  v_iso2 := normaliseer_land(v_land_bron);

  -- Geval 1: geen land af te leiden (order én debiteur leeg) — veilig
  -- terugvallen op binnenlands gedrag. GEEN blokkade: 62% van de actieve
  -- debiteuren heeft een leeg land-veld (legacy NL-klanten).
  IF v_iso2 IS NULL THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Geval 2: NL (binnenland) — gewoon het debiteur-tarief, geen controle.
  IF v_iso2 = 'NL' THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 3: andere EU-lidstaat — altijd ICL, 0% BTW (mig 550).
  -- eu_b2b_binnenland_afwijking-tak vervalt: Karpi levert uitsluitend B2B,
  -- dus elk ander EU-lid = ICL (art. 9(2)(b) Wet OB 1968). De debiteur-vlag
  -- btw_verlegd_intracom was handmatig en kon foutief staan (DECOR-UNION).
  -- Ontbrekend btw-nummer → advisory (ICP-verplichting, mig 164-besluit, niet
  -- blokkerend — blijft ongewijzigd).
  IF is_eu_land(v_iso2) THEN
    RETURN QUERY SELECT
      'eu_b2b_icl'::TEXT,
      0.00::NUMERIC(5,2),
      (p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''),
      CASE WHEN p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''
        THEN 'EU-intracommunautaire levering zonder btw-nummer bij de afnemer — controleer voor de ICP-opgave.'
        ELSE NULL END,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 4: buiten de EU — export, 0% met exportbewijs. Altijd controle_nodig:
  -- geen exportbewijs-tracking (bewust buiten scope) en 0% mag niet stilzwijgend
  -- ontstaan zonder menselijke bevestiging.
  RETURN QUERY SELECT
    'export_buiten_eu'::TEXT,
    0.00::NUMERIC(5,2),
    TRUE,
    format('Afleverland (%s) ligt buiten de EU — exportlevering, in principe 0%% BTW mits exportbewijs. Controleer en bevestig.', v_iso2),
    v_iso2;
END;
$function$

