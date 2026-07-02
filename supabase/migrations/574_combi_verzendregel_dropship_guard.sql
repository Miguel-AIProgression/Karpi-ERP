-- Migratie 574: herwaardeer_combi_levering_verzendregel — dropship-guard ook
-- in het "normale" (niet-wachtende) pad (audit 02-07). De dropship-kostenregel
-- ís de verzendcomponent (mig 353/370); een VERZEND-regel erbovenop is fout.
-- Body = mig 562 + v_is_dropship in beide beslispunten. Superset-keten:
-- élke volgende CREATE OR REPLACE moet deze volledige body als basis nemen.

CREATE OR REPLACE FUNCTION herwaardeer_combi_levering_verzendregel(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_is_dropship        BOOLEAN;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mig 561: order al fysiek onderweg (in pickronde/deels verzonden) of in
  -- een eindstatus — nooit meer aankomen aan de VERZEND-regel.
  IF v_order.status IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_is_dropship := is_dropship_order(p_order_id);

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT v_is_dropship;

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  -- Mig 574: een dropship-order krijgt via dit mechanisme NOOIT een
  -- VERZEND-regel — de dropship-kostenregel is al de verzendcomponent.
  IF v_moet_wachten OR v_order.afhalen OR v_is_dropship THEN
    IF v_bestaande_regel_id IS NOT NULL AND (v_moet_wachten OR v_order.afhalen) THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  -- Mig 562: COALESCE-fallback 500 (was 0) — zelfde SHIPPING_THRESHOLD-default
  -- als applyShippingLogic (frontend/src/lib/constants/shipping.ts).
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 500);

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
  'Mig 558/561/562/574 (ADR-0039/0040): voegt/verwijdert de VERZEND-orderregel, '
  'Combi-levering-bewust. Idempotent. No-op op vertrokken/eindstatus-orders. '
  'NULL verzend_drempel -> 500 (SHIPPING_THRESHOLD). Mig 574: dropship-orders '
  'krijgen nooit een VERZEND-regel via dit pad (kostenregel is al verzending); '
  'een al-bestaande VERZEND-regel op een dropship-order wordt bewust niet '
  'stilzwijgend verwijderd (handmatige beoordeling).';

NOTIFY pgrst, 'reload schema';
