-- Migratie 517: creditnota — alle factuurregels te crediteren, voorraad-guard
--
-- Aanleiding: de frontend-dialog toonde alleen productregels (VERZEND/
-- BUNDELKORTING/DREMPELKORTING/VORMTOESLAG uitgesloten). Gebruiker wil
-- ook verzendkosten en overige regels kunnen crediteren.
--
-- DB-wijziging: voeg AND NOT COALESCE(p.is_pseudo, FALSE) toe aan beide
-- UPDATE-producten-statements in de voorraad_bijwerken-tak, zodat
-- admin-pseudo-artikelen (VERZEND, BUNDELKORTING etc.) nooit een
-- voorraad-ophoging krijgen, ook als de frontend ze selecteert.
-- (Feitelijk waren die updates al no-ops — de is_pseudo-kolom maakt het
-- nu expliciet en documenteert de intentie.)
--
-- Frontend-wijziging: creditfactuur-dialog.tsx verwijdert de productRegels-
-- filter en toont voortaan alle factuurregels.

CREATE OR REPLACE FUNCTION maak_creditfactuur(
  p_factuur_id         BIGINT,
  p_reden              TEXT    DEFAULT NULL,
  p_factuur_regel_ids  BIGINT[] DEFAULT NULL,
  p_deelcredit_regels  JSONB   DEFAULT NULL,
  p_los_bedrag         NUMERIC DEFAULT NULL,
  p_los_bedrag_incl_btw BOOLEAN DEFAULT NULL,
  p_los_reden          TEXT    DEFAULT NULL,
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

  IF v_is_volledig AND EXISTS (
    SELECT 1 FROM facturen WHERE credit_voor_factuur_id = p_factuur_id
  ) THEN
    RAISE EXCEPTION 'Factuur % is al (deels) gecrediteerd; gebruik deelcredit of los bedrag', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_btw_pct := CASE
    WHEN v_orig.btw_verlegd = TRUE THEN 0
    ELSE COALESCE(v_orig.btw_percentage, 0)
  END;

  IF p_los_bedrag IS NOT NULL THEN
    IF p_los_bedrag_incl_btw = TRUE THEN
      v_bedrag_excl := ROUND(p_los_bedrag / (1 + v_btw_pct / 100), 2);
    ELSE
      v_bedrag_excl := p_los_bedrag;
    END IF;
    v_subtotaal  := v_bedrag_excl;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);

  ELSIF p_deelcredit_regels IS NOT NULL THEN
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
    v_subtotaal  := ABS(v_orig.subtotaal);
    v_btw_bedrag := ABS(v_orig.btw_bedrag);

  ELSE
    SELECT COALESCE(SUM(ABS(bedrag)), 0) INTO v_subtotaal
      FROM factuur_regels
     WHERE id = ANY(p_factuur_regel_ids) AND factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  END IF;

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

  IF p_los_bedrag IS NOT NULL THEN
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_nieuwe_id, NULL, NULL, 1,
      COALESCE(p_los_reden, 'Creditering (los bedrag)'),
      1, -v_bedrag_excl, 0, -v_bedrag_excl, v_orig.btw_percentage
    );

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, klant_referentie,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    )
    SELECT
      v_nieuwe_id, NULL, fr.order_id,
      ROW_NUMBER() OVER (ORDER BY fr.regelnummer),
      fr.artikelnr, fr.omschrijving, fr.omschrijving_2,
      fr.uw_referentie, fr.order_nr, fr.klant_referentie,
      dc.aantal::INT, fr.prijs, COALESCE(fr.korting_pct, 0),
      -ROUND(fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100), 2),
      fr.btw_percentage
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;

  ELSE
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage,
      order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
    )
    SELECT
      v_nieuwe_id, NULL,
      omschrijving, aantal, prijs, korting_pct, -bedrag, btw_percentage,
      order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
    FROM factuur_regels
    WHERE factuur_id = p_factuur_id
      AND (v_is_volledig OR id = ANY(p_factuur_regel_ids));
  END IF;

  -- D. Voorraad bijwerken — uitsluitend echte producten, geen admin-pseudo-
  --    artikelen (VERZEND/BUNDELKORTING/DREMPELKORTING/VORMTOESLAG/DROPSHIP).
  --    Guard: AND NOT COALESCE(p.is_pseudo, FALSE).
  IF p_voorraad_bijwerken AND p_los_bedrag IS NULL THEN
    IF p_deelcredit_regels IS NOT NULL THEN
      UPDATE producten p
         SET voorraad = p.voorraad + dc.aantal::INT
        FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
        JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id
       WHERE p.artikelnr = fr.artikelnr
         AND fr.artikelnr IS NOT NULL
         AND NOT COALESCE(p.is_pseudo, FALSE);
    ELSE
      UPDATE producten p
         SET voorraad = p.voorraad + fr.aantal
        FROM factuur_regels fr
       WHERE fr.factuur_id = p_factuur_id
         AND (v_is_volledig OR fr.id = ANY(p_factuur_regel_ids))
         AND p.artikelnr = fr.artikelnr
         AND fr.artikelnr IS NOT NULL
         AND NOT COALESCE(p.is_pseudo, FALSE);
    END IF;
  END IF;

  IF v_is_volledig THEN
    UPDATE facturen
       SET status = 'Gecrediteerd', updated_at = now()
     WHERE id = p_factuur_id;
  END IF;

  RETURN v_nieuwe_id;
END;
$function$;

COMMENT ON FUNCTION maak_creditfactuur IS
  'Creditnota aanmaken op basis van een bestaande debetfactuur (mig 467, uitgebreid mig 504, mig 517). '
  'Vier modi: volledig / p_factuur_regel_ids (selectief volledig) / '
  'p_deelcredit_regels (gedeeltelijk aantal) / p_los_bedrag (vrij bedrag). '
  'p_voorraad_bijwerken=TRUE → producten.voorraad += gecrediteerd aantal, '
  'uitsluitend voor niet-pseudo-artikelen (VERZEND/kortingen worden overgeslagen). '
  'Mig 517: alle factuurregels (incl. VERZEND/overige) zijn crediteerbaar via de dialog.';
