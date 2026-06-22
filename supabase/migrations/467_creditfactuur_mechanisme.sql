-- Migratie 467: minimaal creditfactuur-mechanisme.
--
-- Aanleiding (incident 2026-06-22): de voorraad-importfout (kolom D i.p.v. H,
-- 08-06 t/m 15-06) leidde tot 19 orders die ten onrechte volledig leverbaar
-- leken en zijn verzonden + gefactureerd. De orders zijn geannuleerd en
-- opnieuw aangemaakt (mig 466-werk), maar 15 van de bijbehorende facturen
-- waren al 'Verstuurd' naar de klant — die kunnen niet verwijderd worden
-- (staan al in de boekhouding van de klant), die moeten gecrediteerd worden.
--
-- `facturen.status` heeft al een 'Gecrediteerd'-waarde (mig 117) maar die was
-- tot nu toe puur een handmatig zetbare vlag zonder enige koppeling naar een
-- daadwerkelijk credit-document. Dit voegt het minimale stuk toe om dat
-- gat te dichten: een koppelkolom + een RPC die de creditfactuur + gespiegelde
-- (negatieve) regels aanmaakt en het origineel naar 'Gecrediteerd' zet.
--
-- Bewust NIET in scope hier (apart vervolgtraject, plan-mode):
--   - order-detail UI die debet+credit naast elkaar toont (Lightspeed-stijl)
--   - automatisch verzenden van de creditfactuur (status blijft 'Concept' —
--     een mens moet 'm beoordelen vóór verzending, zeker omdat er nog geen
--     EDI-creditbericht-ondersteuning is, zie de discussie in deze sessie)
--   - EDI-credit-bericht (Transus' "Custom ERP"-format heeft een
--     creditNoteFlag-veld maar dat staat in de code hardcoded op 'N';
--     vereist eerst afstemming met Transus over hun exacte credit-spec)

ALTER TABLE facturen
  ADD COLUMN credit_voor_factuur_id BIGINT REFERENCES facturen(id);

COMMENT ON COLUMN facturen.credit_voor_factuur_id IS
  'Verwijst naar de oorspronkelijke (debet-)factuur als deze rij een creditfactuur is. NULL voor normale facturen.';

-- p_factuur_regel_ids: NULL = crediteer de volledige factuur (alle regels,
-- origineel -> 'Gecrediteerd'). Gevuld = deelcredit van alleen die regels
-- (bv. een gebundelde zending-/weekfactuur waarvan maar 1 regel het probleem
-- is) — het origineel blijft dan op zijn huidige status staan, want de
-- overige regels zijn nog steeds een geldige factuur.
CREATE OR REPLACE FUNCTION maak_creditfactuur(
  p_factuur_id BIGINT,
  p_reden TEXT DEFAULT NULL,
  p_factuur_regel_ids BIGINT[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orig        facturen%ROWTYPE;
  v_nieuwe_id   BIGINT;
  v_nieuwe_nr   TEXT;
  v_subtotaal   NUMERIC;
  v_btw_bedrag  NUMERIC;
  v_is_volledig BOOLEAN := p_factuur_regel_ids IS NULL;
BEGIN
  SELECT * INTO v_orig FROM facturen WHERE id = p_factuur_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_orig.credit_voor_factuur_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factuur % is zelf al een creditfactuur, kan niet opnieuw gecrediteerd worden', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_is_volledig AND EXISTS (SELECT 1 FROM facturen WHERE credit_voor_factuur_id = p_factuur_id) THEN
    RAISE EXCEPTION 'Factuur % is al (deels) gecrediteerd', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_is_volledig THEN
    v_subtotaal  := v_orig.subtotaal;
    v_btw_bedrag := v_orig.btw_bedrag;
  ELSE
    SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
      FROM factuur_regels WHERE id = ANY(p_factuur_regel_ids) AND factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * COALESCE(v_orig.btw_percentage, 0) / 100, 2);
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
    COALESCE(p_reden, 'Creditfactuur voor ' || v_orig.factuur_nr), v_orig.btw_nummer, v_orig.btw_verlegd, v_orig.btw_regeling,
    p_factuur_id
  ) RETURNING id INTO v_nieuwe_id;

  -- order_regel_id bewust NULL: idx_factuur_regels_order_regel staat een
  -- orderregel maar één keer toe over alle factuur_regels heen, en het
  -- origineel houdt die koppeling al. De beschrijvende snapshot-velden
  -- (omschrijving/artikelnr/order_nr/klant_referentie) blijven wel staan.
  INSERT INTO factuur_regels (
    factuur_id, order_regel_id, omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage,
    order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
  )
  SELECT
    v_nieuwe_id, NULL, omschrijving, aantal, prijs, korting_pct, -bedrag, btw_percentage,
    order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
  FROM factuur_regels
  WHERE factuur_id = p_factuur_id
    AND (v_is_volledig OR id = ANY(p_factuur_regel_ids));

  IF v_is_volledig THEN
    UPDATE facturen
       SET status = 'Gecrediteerd', updated_at = now()
     WHERE id = p_factuur_id;
  END IF;

  RETURN v_nieuwe_id;
END;
$function$;
