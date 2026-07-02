-- Migratie 560 (hernummerd van 489): order-detail-knop "zet in de wacht voor Combi-levering" (ADR-0039)
--
-- Zet debiteuren.combi_levering=TRUE (raakt daardoor ALLE openstaande orders
-- van deze klant naar dit soort adressen, niet alleen p_order_id — bewuste
-- keuze, bevestigd tijdens de grilling-sessie: de klant schakelt hiermee
-- feitelijk helemaal over naar combi-levering-gedrag). De bestaande trigger
-- trg_debiteuren_combi_levering (mig 558) herwaardeert vanzelf de
-- VERZEND-regels van al die orders.

CREATE OR REPLACE FUNCTION zet_order_in_combi_levering_wacht(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_debiteur_nr INTEGER;
BEGIN
  SELECT debiteur_nr INTO v_debiteur_nr FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE debiteuren SET combi_levering = TRUE WHERE debiteur_nr = v_debiteur_nr;

  -- Deze ene order kan zelf al een override hebben staan (bv. eerder bewust
  -- los verzonden) — dat moet uit, anders doet de nieuwe klant-instelling
  -- voor DEZE order niets.
  UPDATE orders SET combi_levering_override = FALSE WHERE id = p_order_id;
END;
$$;

COMMENT ON FUNCTION zet_order_in_combi_levering_wacht(BIGINT) IS
  'Mig 560 (ADR-0039): order-detail-knop-RPC. Zet debiteuren.combi_levering=TRUE '
  '(klant-breed) en orders.combi_levering_override=FALSE voor deze order. '
  'Trigger mig 558 herwaardeert de VERZEND-regels van alle geraakte orders.';

NOTIFY pgrst, 'reload schema';
