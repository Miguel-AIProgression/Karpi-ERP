-- Migratie 345: productie-only orders (Basta) uit orders_zonder_vervoerder
--
-- De "X order(s) zonder vervoerder"-banner op Pick & Ship telde 1066
-- alleen_productie-orders mee (bron_systeem='oud_systeem', ADR-0029/mig 327).
-- Voor die orders doet RugFlow alleen snijden + confectie — verzending,
-- facturatie en labels blijven in Basta. Een vervoerder kiezen is daar dus
-- per definitie niet aan de orde; de guard uit mig 327 ontbrak in deze view.
--
-- Idempotent.

CREATE OR REPLACE VIEW orders_zonder_vervoerder AS
SELECT DISTINCT o.id AS order_id, o.order_nr, o.debiteur_nr, o.afl_land, o.afl_plaats
  FROM orders o
 WHERE COALESCE(o.afhalen, FALSE) = FALSE
   AND NOT o.alleen_productie
   AND o.status NOT IN ('Geannuleerd', 'Verzonden', 'Concept')
   AND EXISTS (
     SELECT 1
       FROM effectieve_vervoerder_per_orderregel(o.id) e
      WHERE e.bron = 'geen'
   );

COMMENT ON VIEW orders_zonder_vervoerder IS
  'Mig 338+345: niet-afhaal-orders met >=1 regel zonder vervoerder (buiten '
  'HST-bereik). Voedt de "handmatig vervoerder kiezen"-teller/banner. '
  'Productie-only orders (alleen_productie, ADR-0029) uitgesloten: verzending '
  'blijft in Basta.';

NOTIFY pgrst, 'reload schema';
