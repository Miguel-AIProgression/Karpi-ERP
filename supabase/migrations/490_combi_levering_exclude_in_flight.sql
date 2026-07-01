-- Migratie 490: Combi-levering — sluit al-gestarte orders uit de wachtgroep (review-fix)
--
-- Gevonden bij code-review ná mig 486/487: de `leden`-CTE in combi_levering_status
-- en de backfill-loop in trg_debiteuren_combi_levering_fn filterden alleen
-- status NOT IN ('Verzonden','Geannuleerd') — een order die al 'In pickronde' of
-- 'Deels verzonden' is (dus al fysiek aan het picken/verzenden, los van de rest
-- van de groep) telde nog altijd mee in het groep-subtotaal. Scenario: order A
-- (combi-levering, wacht) + order B (zelfde klant/adres) samen boven de drempel
-- → operator start B solo via de "achtergebleven"-waarschuwing → B gaat naar
-- 'In pickronde'. A's subtotaal blijft dan ten onrechte A+B tonen — A lijkt
-- "drempel gehaald" terwijl er in werkelijkheid niets meer is om mee te
-- combineren. Fix: sluit 'In pickronde' en 'Deels verzonden' ook uit — een
-- order die al aan het picken/verzenden is, telt niet meer mee in de pool van
-- orders die nog op elkaar wachten.

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
   AND o.combi_levering_override = FALSE
   AND d.combi_levering = TRUE
   AND NOT is_dropship_order(o.id)
),
groep AS (
  SELECT
    debiteur_nr,
    adres_norm,
    SUM(subtotaal)                 AS groep_subtotaal,
    bool_and(alle_regels_pickbaar) AS alle_leden_pickbaar
  FROM leden
  GROUP BY debiteur_nr, adres_norm
)
SELECT
  l.order_id,
  g.groep_subtotaal,
  d.verzend_drempel,
  d.gratis_verzending,
  g.alle_leden_pickbaar,
  (
    NOT d.gratis_verzending
    AND (
      (d.verzend_drempel IS NOT NULL AND g.groep_subtotaal < d.verzend_drempel)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 486/490 (ADR-0039): per order, alleen voor klanten met combi_levering=TRUE '
  'en niet-overruled/niet-dropshipment/nog-niet-gestarte orders: wacht_op_combi_levering=TRUE '
  'zolang de (debiteur × adres-norm)-groep de vrachtvrije-drempel niet haalt, '
  'OF de drempel wel haalt maar niet al zijn leden individueel pickbaar zijn. '
  'Mig 490: een order die al In pickronde/Deels verzonden is telt niet meer mee '
  'in de groep-pool (die is al vertrokken, niets meer om mee te combineren).';

-- Defensieve guard in de kern-functie zelf (dekt zowel de per-order trigger
-- trg_orders_combi_levering_override als de debiteur-wide backfill-loop
-- hieronder, en zet_order_in_combi_levering_wacht die een specifieke order
-- rechtstreeks raakt): een order die al fysiek aan het picken/verzenden is
-- mag zijn VERZEND-regel nooit meer krijgen/verliezen via dit mechanisme.
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

  -- Mig 490: order al fysiek onderweg (in pickronde/deels verzonden) of in
  -- een eindstatus — nooit meer aankomen aan de VERZEND-regel.
  IF v_order.status IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

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
    IF v_bestaande_regel_id IS NOT NULL THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

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
         AND status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
    LOOP
      PERFORM herwaardeer_combi_levering_verzendregel(v_order_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
