-- Migratie 149: vrije_voorraad-formule + producten_overzicht
--
-- Wijziging: vrije_voorraad = voorraad − gereserveerd − backorder
-- (geen + besteld_inkoop meer; toekomstige inkoop is ZICHTBAAR via besteld_inkoop
-- en via order_reserveringen, maar telt niet meer mee in de "vandaag-leverbaar"-formule.)
--
-- gereserveerd-bron wordt nu: SUM(order_reserveringen.aantal) waar bron='voorraad'.
-- Dat is consistent met migratie 146 trigger C (die elk claim-rij wisselt).

CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
  v_gereserveerd INTEGER;
BEGIN
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_gereserveerd
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  JOIN orders o ON o.id = oreg.order_id
  WHERE oreg.artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND o.status NOT IN ('Verzonden', 'Geannuleerd');

  UPDATE producten
  SET gereserveerd = v_gereserveerd,
      vrije_voorraad = COALESCE(voorraad, 0) - v_gereserveerd - COALESCE(backorder, 0)
  WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herbereken_product_reservering IS
  'Migratie 149: gereserveerd = SUM order_reserveringen waar bron=voorraad. '
  'vrije_voorraad = voorraad − gereserveerd − backorder (geen + besteld_inkoop).';

-- ============================================================================
-- Backfill: alle producten éénmaal recompute
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT artikelnr FROM producten LOOP
    PERFORM herbereken_product_reservering(r.artikelnr);
  END LOOP;
END $$;
