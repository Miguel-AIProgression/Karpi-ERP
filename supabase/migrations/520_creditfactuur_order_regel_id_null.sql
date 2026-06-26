-- Migratie 520: creditregels krijgen altijd order_regel_id = NULL
--
-- idx_factuur_regels_order_regel is een UNIQUE index op order_regel_id.
-- De originele factuurregel bezet die sleutel al; een creditregel met
-- dezelfde order_regel_id veroorzaakte "duplicate key violates unique constraint".
-- Modus B (deelcredit) had dit al goed (NULL); Modus A en volledig kopieerden
-- ten onrechte fr.order_regel_id. order_id (FK naar orders) blijft wel staan.

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
    -- order_regel_id = NULL: geen order-regelkoppeling (los bedrag, niet aan een specifieke
    -- orderregel gebonden). order_id ook NULL: geen order-koppeling.
    INSERT INTO factuur_regels (
      factuur_id, order_regel_id, order_id, regelnummer,
      omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_nieuwe_id, NULL, NULL, 1,
      COALESCE(p_los_reden, 'Creditering (los bedrag)'),
      1, -v_bedrag_excl, 0, -v_bedrag_excl, v_orig.btw_percentage
    );

  ELSIF p_deelcredit_regels IS NOT NULL THEN
    -- order_regel_id = NULL: de UNIQUE-index staat één rij per order_regel_id toe;
    -- de originele factuurregel bezet die sleutel al. order_id wél kopiëren.
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
      dc.aantal, fr.prijs, fr.korting_pct,
      -ROUND(fr.prijs * dc.aantal::NUMERIC * (1 - COALESCE(fr.korting_pct, 0) / 100), 2),
      fr.btw_percentage
    FROM jsonb_to_recordset(p_deelcredit_regels) AS dc(id BIGINT, aantal INT)
    JOIN factuur_regels fr ON fr.id = dc.id AND fr.factuur_id = p_factuur_id;

  ELSIF v_is_volledig THEN
    -- order_regel_id = NULL: zelfde reden als deelcredit. order_id kopiëren.
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
      fr.aantal, fr.prijs, fr.korting_pct, -ABS(fr.bedrag),
      fr.btw_percentage
    FROM factuur_regels fr
    WHERE fr.factuur_id = p_factuur_id;

  ELSE
    -- Modus A: geselecteerde regels. order_regel_id = NULL (UNIQUE-constraint).
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
      fr.aantal, fr.prijs, fr.korting_pct, -ABS(fr.bedrag),
      fr.btw_percentage
    FROM factuur_regels fr
    WHERE fr.id = ANY(p_factuur_regel_ids) AND fr.factuur_id = p_factuur_id;
  END IF;

  IF p_voorraad_bijwerken THEN
    -- Hoog voorraad op én herbereken vrije_voorraad via de centrale functie.
    UPDATE producten p
    SET voorraad = voorraad + sub.aantal
    FROM (
      SELECT fr.artikelnr, SUM(ABS(fr.aantal)) AS aantal
      FROM factuur_regels fr
      WHERE fr.factuur_id = v_nieuwe_id
        AND fr.artikelnr IS NOT NULL
        AND NOT COALESCE((SELECT is_pseudo FROM producten WHERE artikelnr = fr.artikelnr), FALSE)
      GROUP BY fr.artikelnr
    ) sub
    WHERE p.artikelnr = sub.artikelnr;

    PERFORM herbereken_product_reservering(fr.artikelnr)
    FROM factuur_regels fr
    WHERE fr.factuur_id = v_nieuwe_id
      AND fr.artikelnr IS NOT NULL
      AND NOT COALESCE((SELECT is_pseudo FROM producten WHERE artikelnr = fr.artikelnr), FALSE);
  END IF;

  RETURN v_nieuwe_id;
END;
$function$;
