-- Migratie 504: creditfactuur uitbreiding.
--
-- Bouwt voort op de minimale mig 467 (maak_creditfactuur + credit_voor_factuur_id)
-- en voegt de volledige bedrijfsworkflow toe die in mig 467 bewust buiten scope viel.
--
-- Nieuw in maak_creditfactuur:
--
-- A. Harde max-credit-grens (financiële beveiliging):
--    Het totale gecrediteerde bedrag op een debetfactuur mag NOOIT hoger zijn
--    dan het debetbedrag. Elke aanroep wordt hier serverside gecheckt.
--
-- B. Deelcredit met aangepast aantal (p_deelcredit_regels JSONB):
--    Beheerder kiest factuurregels en geeft per regel een nieuw aantal op.
--    Bedrag wordt herberekend als prijs × nieuw_aantal × (1 - korting_pct/100).
--    Formaat: [{"id": <factuur_regel_id>, "aantal": <int>}]
--
-- C. Los bedrag crediteren (p_los_bedrag + p_los_bedrag_incl_btw):
--    Vrij creditbedrag zonder koppeling aan een specifieke orderregel.
--    BTW-tarief spiegelt altijd de originele debetfactuur.
--    p_los_bedrag_incl_btw=TRUE  → bedrag is incl. BTW (systeem berekent excl.)
--    p_los_bedrag_incl_btw=FALSE → bedrag is excl. BTW (systeem telt BTW erbij op)
--
-- D. Voorraad bijwerken (p_voorraad_bijwerken BOOLEAN):
--    Bij TRUE: producten.voorraad += gecrediteerd_aantal voor elk gecrediteerd artikel.
--    Alleen voor orderregel-credits (niet voor los bedrag — geen artikel-koppeling).
--    Bewust op de BASE-kolom producten.voorraad (niet vrije_voorraad).
--
-- Bestaand gedrag (mig 467) blijft exact behouden:
-- - Volledige credit (geen extra parameters) → spiegelt alle regels, origineel → 'Gecrediteerd'
-- - p_factuur_regel_ids → selectieve regelcredit

-- Drop de oude 3-argument overload (mig 467) zodat CREATE OR REPLACE niet
-- klaagt over ambiguïteit. De nieuwe functie heeft 8 parameters.
DROP FUNCTION IF EXISTS maak_creditfactuur(bigint, text, bigint[]);

CREATE OR REPLACE FUNCTION maak_creditfactuur(
  p_factuur_id         BIGINT,
  p_reden              TEXT    DEFAULT NULL,
  -- Bestaand: crediteer alleen deze specifieke regels (volledig, origineel aantal)
  p_factuur_regel_ids  BIGINT[] DEFAULT NULL,
  -- Nieuw B: deelcredit met aangepast aantal [{id: <regel_id>, aantal: <int>}]
  p_deelcredit_regels  JSONB   DEFAULT NULL,
  -- Nieuw C: vrij creditbedrag
  p_los_bedrag         NUMERIC DEFAULT NULL,
  p_los_bedrag_incl_btw BOOLEAN DEFAULT NULL,
  p_los_reden          TEXT    DEFAULT NULL,
  -- Nieuw D: verhoog producten.voorraad voor gecrediteerde producten
  p_voorraad_bijwerken BOOLEAN DEFAULT FALSE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orig               facturen%ROWTYPE;
  v_nieuwe_id          BIGINT;
  v_nieuwe_nr          TEXT;
  v_subtotaal          NUMERIC;
  v_btw_bedrag         NUMERIC;
  v_btw_pct            NUMERIC;
  v_bedrag_excl        NUMERIC;
  v_is_volledig        BOOLEAN;
  v_reeds_gecrediteerd NUMERIC;
  v_credit_totaal      NUMERIC;
BEGIN
  -- Bepaal modus: GEEN extra parameters = volledig credit (alles)
  v_is_volledig := (
    p_factuur_regel_ids  IS NULL AND
    p_deelcredit_regels  IS NULL AND
    p_los_bedrag         IS NULL
  );

  SELECT * INTO v_orig FROM facturen WHERE id = p_factuur_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_orig.credit_voor_factuur_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factuur % is zelf al een creditfactuur — kan niet opnieuw gecrediteerd worden', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Volledig credit: blokkeer als er al een creditfactuur bestaat (mig 467-gedrag)
  IF v_is_volledig AND EXISTS (
    SELECT 1 FROM facturen WHERE credit_voor_factuur_id = p_factuur_id
  ) THEN
    RAISE EXCEPTION 'Factuur % is al (deels) gecrediteerd; gebruik deelcredit of los bedrag', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Effectief BTW-tarief: verlegd → altijd 0%
  v_btw_pct := CASE
    WHEN v_orig.btw_verlegd = TRUE THEN 0
    ELSE COALESCE(v_orig.btw_percentage, 0)
  END;

  -- Bepaal subtotaal en BTW van de te crediteren regels/bedrag
  IF p_los_bedrag IS NOT NULL THEN
    -- Modus C: vrij bedrag
    IF p_los_bedrag_incl_btw = TRUE THEN
      -- Gegeven bedrag is incl. BTW → bereken excl.
      v_bedrag_excl := ROUND(p_los_bedrag / (1 + v_btw_pct / 100), 2);
    ELSE
      v_bedrag_excl := p_los_bedrag;
    END IF;
    v_subtotaal  := v_bedrag_excl;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    -- Modus B: deelcredit met aangepast aantal
    SELECT COALESCE(SUM(
      ROUND(
        fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100),
        2
      )
    ), 0) INTO v_subtotaal
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);

  ELSIF v_is_volledig THEN
    -- Modus: volledig (mig 467-gedrag)
    v_subtotaal  := ABS(v_orig.subtotaal);
    v_btw_bedrag := ABS(v_orig.btw_bedrag);

  ELSE
    -- Modus: geselecteerde regels (p_factuur_regel_ids, mig 467-gedrag)
    SELECT COALESCE(SUM(ABS(bedrag)), 0) INTO v_subtotaal
      FROM factuur_regels
     WHERE id = ANY(p_factuur_regel_ids) AND factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  END IF;

  -- A. Harde max-credit-grens check
  SELECT COALESCE(SUM(ABS(totaal)), 0) INTO v_reeds_gecrediteerd
    FROM facturen WHERE credit_voor_factuur_id = p_factuur_id;
  v_credit_totaal := v_subtotaal + v_btw_bedrag;

  IF v_reeds_gecrediteerd + v_credit_totaal > ABS(v_orig.totaal) + 0.01 THEN
    RAISE EXCEPTION
      'Creditbedrag (€%.2f) overschrijdt het resterende kredietlimiet (€%.2f — debetbedrag €%.2f, al gecrediteerd €%.2f)',
      v_credit_totaal,
      ABS(v_orig.totaal) - v_reeds_gecrediteerd,
      ABS(v_orig.totaal),
      v_reeds_gecrediteerd
      USING ERRCODE = 'check_violation';
  END IF;

  v_nieuwe_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    opmerkingen, btw_nummer, btw_verlegd, btw_regeling,
    credit_voor_factuur_id
  ) VALUES (
    v_nieuwe_nr, v_orig.debiteur_nr, CURRENT_DATE, v_orig.vervaldatum, 'Concept',
    -v_subtotaal, v_orig.btw_percentage, -v_btw_bedrag, -(v_subtotaal + v_btw_bedrag),
    v_orig.fact_naam, v_orig.fact_adres, v_orig.fact_postcode, v_orig.fact_plaats, v_orig.fact_land,
    COALESCE(p_reden, 'Creditfactuur voor ' || v_orig.factuur_nr),
    v_orig.btw_nummer, v_orig.btw_verlegd, v_orig.btw_regeling,
    p_factuur_id
  ) RETURNING id INTO v_nieuwe_id;

  -- Voeg factuurregels toe per modus
  IF p_los_bedrag IS NOT NULL THEN
    -- Modus C: één losse creditregel zonder artikel-koppeling
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_nieuwe_id, NULL, NULL, 1,
      COALESCE(p_los_reden, 'Creditering (los bedrag)'),
      1, -v_bedrag_excl, 0, -v_bedrag_excl, v_orig.btw_percentage
    );

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    -- Modus B: gespiegelde regels met herberekend bedrag op basis van nieuw aantal
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, klant_referentie,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    )
    SELECT
      v_nieuwe_id,
      NULL,  -- order_regel_id bewust NULL (UNIQUE-constraint, mig 467)
      fr.order_id,
      ROW_NUMBER() OVER (ORDER BY fr.regelnummer),
      fr.artikelnr, fr.omschrijving, fr.omschrijving_2,
      fr.uw_referentie, fr.order_nr, fr.klant_referentie,
      dc.aantal::INT,
      fr.prijs,
      COALESCE(fr.korting_pct, 0),
      -ROUND(fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100), 2),
      fr.btw_percentage
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;

  ELSE
    -- Modus: volledig (mig 467) of geselecteerde regels (p_factuur_regel_ids)
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage,
      order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
    )
    SELECT
      v_nieuwe_id,
      NULL,  -- order_regel_id bewust NULL (UNIQUE-constraint, mig 467)
      omschrijving, aantal, prijs, korting_pct, -bedrag, btw_percentage,
      order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
    FROM factuur_regels
    WHERE factuur_id = p_factuur_id
      AND (v_is_volledig OR id = ANY(p_factuur_regel_ids));
  END IF;

  -- D. Voorraad bijwerken (alleen voor orderregel-credits, niet voor los bedrag)
  IF p_voorraad_bijwerken AND p_los_bedrag IS NULL THEN
    IF p_deelcredit_regels IS NOT NULL THEN
      UPDATE producten p
         SET voorraad = p.voorraad + dc.aantal::INT
        FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
        JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id
       WHERE p.artikelnr = fr.artikelnr
         AND fr.artikelnr IS NOT NULL;
    ELSE
      UPDATE producten p
         SET voorraad = p.voorraad + fr.aantal
        FROM factuur_regels fr
       WHERE fr.factuur_id = p_factuur_id
         AND (v_is_volledig OR fr.id = ANY(p_factuur_regel_ids))
         AND p.artikelnr = fr.artikelnr
         AND fr.artikelnr IS NOT NULL;
    END IF;
  END IF;

  -- Volledig gecrediteerd: zet origineel op 'Gecrediteerd' (mig 467-gedrag)
  IF v_is_volledig THEN
    UPDATE facturen
       SET status = 'Gecrediteerd', updated_at = now()
     WHERE id = p_factuur_id;
  END IF;

  RETURN v_nieuwe_id;
END;
$function$;

COMMENT ON FUNCTION maak_creditfactuur IS
  'Creditnota aanmaken op basis van een bestaande debetfactuur (mig 467, uitgebreid mig 504). '
  'Vier modi: volledig / p_factuur_regel_ids (selectief volledig) / '
  'p_deelcredit_regels (gedeeltelijk aantal) / p_los_bedrag (vrij bedrag). '
  'Beveiligingen: max-credit-grens (totaal credit ≤ debetbedrag) en '
  'blokkeert zelf-credit (creditnota van creditnota). '
  'p_voorraad_bijwerken=TRUE → producten.voorraad += gecrediteerd aantal (excl. los bedrag).';
