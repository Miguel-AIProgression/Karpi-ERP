-- Migratie 455: bepaal_btw_regeling — combineert afleverland + debiteur-vlag +
-- btw-nummer tot een regeling-code.
--
-- Aanleiding: audit (2026-06-20) tegen de Belastingdienst-beslisboom voor
-- goederenverkoop B2B (bevestigd met gebruiker: vrijwel uitsluitend B2B-
-- groothandel, geen OSS/particulier-scope). Drie gaten gevonden t.o.v. het
-- bestaande mig 164/371-mechanisme (één statische klant-checkbox):
--   1. 6 actieve niet-EU-debiteuren (VS, Australië, Suriname, Ukraine, VK)
--      staan op btw_verlegd_intracom=false + 21% — fout, export buiten de EU
--      hoort 0% te zijn (mits exportbewijs). Eén (debiteur 350000, Suriname)
--      heeft al een order zonder factuur.
--   2. Geen koppeling tussen de statische klant-checkbox en het werkelijke
--      afleverland van een specifieke order (orders.afl_land bestaat, wordt
--      niet gebruikt voor BTW).
--   3. 30 actieve debiteuren staan op btw_verlegd_intracom=true zonder
--      btw_nummer — bewust niet geblokkeerd sinds mig 164, blijft zo
--      (advisory, niet hard-block).
--
-- KRITIEKE ONTWERPKEUZE: 996 van de 1602 actieve debiteuren (62%) hebben een
-- LEEG land-veld (legacy NL-klanten van vóór het land-veld werd ingevuld).
-- "Geen land bekend" valt daarom NIET terug op een blokkerende 'onbepaald'-
-- regeling (dat zou de meerderheid van alle nieuwe facturen blokkeren) maar
-- op 'nl_binnenland' — exact het bestaande gedrag, ongewijzigd. Dit is een
-- bewuste afwijking van het eerste ontwerp-concept; zie plan-toelichting.
--
-- bepaal_btw_regeling() is een PURE, read-only functie — geen side-effects.
-- De aanroepende factuur-RPC (mig 456) beslist over blokkade.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION bepaal_btw_regeling(
  p_afl_land        TEXT,    -- orders.afl_land (kan NULL zijn)
  p_debiteur_land   TEXT,    -- debiteuren.land (fallback)
  p_afhalen         BOOLEAN, -- orders.afhalen
  p_verlegd_vlag    BOOLEAN, -- debiteuren.btw_verlegd_intracom
  p_btw_nummer      TEXT,    -- debiteuren.btw_nummer
  p_btw_percentage  NUMERIC  -- debiteuren.btw_percentage (NL-fallback-tarief)
)
RETURNS TABLE (
  regeling          TEXT,
  effectief_pct     NUMERIC(5,2),
  controle_nodig    BOOLEAN,
  controle_reden    TEXT,
  land_iso2         TEXT
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_land_bron TEXT;
  v_iso2      TEXT;
BEGIN
  -- Afhalen: Karpi heeft geen vervoersbewijs naar het land waar de klant zelf
  -- naartoe rijdt — behandel als binnenlands tot de debiteur-vlag iets anders
  -- zegt (conservatieve aanname: eerder te veel dan te weinig BTW).
  IF COALESCE(p_afhalen, FALSE) THEN
    v_land_bron := p_debiteur_land;
  ELSE
    v_land_bron := COALESCE(NULLIF(TRIM(p_afl_land), ''), p_debiteur_land);
  END IF;

  v_iso2 := normaliseer_land(v_land_bron);

  -- Geval 1: geen land af te leiden (order én debiteur leeg) — veilig
  -- terugvallen op het bestaande gedrag. GEEN blokkade: 62% van de actieve
  -- debiteuren heeft een leeg land-veld (legacy NL-klanten); een blokkade
  -- hier zou de meerderheid van alle nieuwe facturen tegenhouden.
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

  -- Geval 3: andere EU-lidstaat.
  IF is_eu_land(v_iso2) THEN
    IF COALESCE(p_verlegd_vlag, FALSE) THEN
      RETURN QUERY SELECT
        'eu_b2b_icl'::TEXT,
        0.00::NUMERIC(5,2),
        -- Wel 0%, maar zonder btw-nummer blijft het een advisory-risico
        -- (bewust niet blokkerend sinds mig 164 — niet heropend).
        (p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''),
        CASE WHEN p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''
          THEN 'EU-intracommunautaire levering zonder btw-nummer bij de afnemer — controleer voor de ICP-opgave.'
          ELSE NULL END,
        v_iso2;
    ELSE
      -- Debiteur staat NIET op verlegd, maar deze order gaat naar een ander
      -- EU-land dan NL — mismatch tussen klant-default en order-werkelijkheid.
      RETURN QUERY SELECT
        'eu_b2b_binnenland_afwijking'::TEXT,
        COALESCE(p_btw_percentage, 21.00)::NUMERIC(5,2),
        TRUE,
        format('Afleverland (%s) is een andere EU-lidstaat dan NL, maar deze klant staat niet op "BTW verlegd". Controleer of dit een eenmalige afwijking is of dat de klant-instelling aangepast moet worden.', v_iso2),
        v_iso2;
    END IF;
    RETURN;
  END IF;

  -- Geval 4: buiten de EU — export, in principe 0% met exportbewijs. Altijd
  -- controle_nodig: geen exportbewijs-tracking (bewust buiten scope) en 0%
  -- mag niet stilzwijgend ontstaan zonder menselijke bevestiging.
  RETURN QUERY SELECT
    'export_buiten_eu'::TEXT,
    0.00::NUMERIC(5,2),
    TRUE,
    format('Afleverland (%s) ligt buiten de EU — exportlevering, in principe 0%% BTW mits exportbewijs. Controleer en bevestig.', v_iso2),
    v_iso2;
END;
$$;

GRANT EXECUTE ON FUNCTION bepaal_btw_regeling(TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, NUMERIC) TO authenticated;

COMMENT ON FUNCTION bepaal_btw_regeling IS
  'Mig 455: bepaalt de BTW-regeling voor een order op basis van effectief '
  'afleverland (afl_land, fallback debiteuren.land, leeg → nl_binnenland zonder '
  'blokkade), de btw_verlegd_intracom-vlag en het btw-nummer. Regelingen: '
  'nl_binnenland, eu_b2b_icl, eu_b2b_binnenland_afwijking (mismatch, hard-block '
  'in mig 456), export_buiten_eu (hard-block in mig 456). TS-spiegel: '
  '_shared/btw.ts (bepaalBtwRegeling). Pure/IMMUTABLE — geen side-effects; de '
  'aanroepende factuur-RPC beslist over blokkade.';

NOTIFY pgrst, 'reload schema';
