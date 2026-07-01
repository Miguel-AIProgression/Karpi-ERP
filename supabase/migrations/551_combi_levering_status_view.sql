-- Migratie 551: Combi-levering-wachtgroep (hernummerd van 486, collisie op origin/main) — live view (ADR-0039)
--
-- Puur lezend, geen state — herevalueert bij elke query, net als
-- voorgestelde_zending_bundels (mig 229). Sleutel is (debiteur_nr, adres-norm),
-- bewust zónder vervoerder/verzendweek: het punt is juist over meerdere weken
-- heen te wachten, en de vervoerder is sowieso een afgeleide van adres/gewicht
-- (land-gedreven selectieregels, ADR-0030) die pas bij pickronde-start
-- opnieuw bepaald wordt voor de dan-bekende gecombineerde zending.

CREATE OR REPLACE FUNCTION combi_levering_orderregel_subtotaal(p_order_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  -- Zelfde uitsluiting als voorgestelde_zending_bundels.bundel_subtotaal_excl
  -- (mig 229, regel ~90): VERZEND-pseudo-regel telt niet mee in de klantwaarde.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    FROM order_regels
   WHERE order_id = p_order_id
     AND COALESCE(artikelnr, '') <> 'VERZEND'
     AND COALESCE(orderaantal, 0) > 0;
$$;

COMMENT ON FUNCTION combi_levering_orderregel_subtotaal(BIGINT) IS
  'Mig 551: order-subtotaal excl. VERZEND, voor de Combi-levering-drempeltoets. '
  'Zelfde exclusie als voorgestelde_zending_bundels (mig 229) — geen tweede '
  'canonieke berekening.';

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  -- Alle orders die ÜBERHAUPT in een Combi-levering-wachtgroep kunnen zitten:
  -- klant heeft de instelling aan, dit exemplaar is niet overruled, en het is
  -- geen dropshipment (die betaalt al voor eigen verzending, ADR-0018-patroon).
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
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
  'Mig 551 (ADR-0039): per order, alleen voor klanten met combi_levering=TRUE '
  'en niet-overruled/niet-dropshipment orders: wacht_op_combi_levering=TRUE '
  'zolang de (debiteur × adres-norm)-groep de vrachtvrije-drempel niet haalt, '
  'OF de drempel wel haalt maar niet al zijn leden individueel pickbaar zijn '
  '(ADR-0012-les: een groep die de drempel haalt wordt als 1 order behandeld, '
  'nooit deels los verzonden). Orders die niet in deze view voorkomen (want '
  'geen match op de WHERE in leden) zijn nooit geblokkeerd door Combi-levering '
  '— consumenten moeten LEFT JOIN + COALESCE(..., FALSE) gebruiken.';

NOTIFY pgrst, 'reload schema';
