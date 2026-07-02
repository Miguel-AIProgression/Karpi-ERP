-- Migratie 558: Combi-levering — VERZEND-orderregel-herwaardering (ADR-0039, hernummerd van 487)
--
-- Zolang een order in een Combi-levering-wachtgroep zit, staat er GEEN
-- VERZEND-orderregel op — de drempel-beslissing wordt uitgesteld tot vrijgave.
-- Twee transitiemomenten kunnen dat veranderen:
--   1. orders.combi_levering_override wijzigt (klant wil dít exemplaar toch
--      los, of een eerder geforceerde order gaat weer wachten).
--   2. debiteuren.combi_levering wijzigt (klant zet de instelling aan/uit —
--      raakt ALLE openstaande orders van die klant, niet alleen de order
--      waarop de wijziging is getriggerd).
-- Buiten deze twee momenten verandert er niets: de normale, groepsgewijze
-- drempel-toets bij vrijgave/facturatie (bestaande verzendkosten_voor_bundel,
-- mig 234) blijft ongewijzigd en ongeraakt.

CREATE OR REPLACE FUNCTION herwaardeer_combi_levering_verzendregel(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT is_dropship_order(p_order_id);

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  IF v_moet_wachten OR v_order.afhalen THEN
    -- Wachten (drempel-beslissing uitgesteld) of afhalen (nooit VERZEND):
    -- een eventuele bestaande VERZEND-regel moet weg.
    IF v_bestaande_regel_id IS NOT NULL THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  -- Normaal pad (override=TRUE, of combi_levering=FALSE): zelfde regel als
  -- frontend applyShippingLogic — voeg toe/verwijder op basis van het eigen
  -- ordersubtotaal t.o.v. de klant-drempel.
  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 0);

  IF v_moet_verzendregel AND v_bestaande_regel_id IS NULL THEN
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_regelnummer
      FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, prijs, korting_pct, bedrag
    ) VALUES (
      p_order_id, v_regelnummer, 'VERZEND', 'Verzendkosten',
      1, 1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0)
    );
  ELSIF NOT v_moet_verzendregel AND v_bestaande_regel_id IS NOT NULL THEN
    DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION herwaardeer_combi_levering_verzendregel(BIGINT) IS
  'Mig 558 (ADR-0039): voegt/verwijdert de VERZEND-orderregel op een order, '
  'rekening houdend met of de klant/order in een Combi-levering-wachtgroep '
  'zit. Idempotent — aanroepbaar vanuit triggers en handmatig.';

CREATE OR REPLACE FUNCTION trg_orders_combi_levering_override_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.combi_levering_override IS DISTINCT FROM OLD.combi_levering_override THEN
    PERFORM herwaardeer_combi_levering_verzendregel(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_combi_levering_override ON orders;
CREATE TRIGGER trg_orders_combi_levering_override
  AFTER UPDATE OF combi_levering_override ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trg_orders_combi_levering_override_fn();

CREATE OR REPLACE FUNCTION trg_debiteuren_combi_levering_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF NEW.combi_levering IS DISTINCT FROM OLD.combi_levering THEN
    FOR v_order_id IN
      SELECT id FROM orders
       WHERE debiteur_nr = NEW.debiteur_nr
         AND status NOT IN ('Verzonden', 'Geannuleerd')
    LOOP
      PERFORM herwaardeer_combi_levering_verzendregel(v_order_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debiteuren_combi_levering ON debiteuren;
CREATE TRIGGER trg_debiteuren_combi_levering
  AFTER UPDATE OF combi_levering ON debiteuren
  FOR EACH ROW
  EXECUTE FUNCTION trg_debiteuren_combi_levering_fn();

NOTIFY pgrst, 'reload schema';
