-- Migratie 372: orders_zonder_vervoerder — status + genormaliseerd land
--
-- Aanleiding (11-06-2026): de Pick & Ship-banner toonde een kaal aantal
-- ("196 order(s) zonder vervoerder — kies handmatig") terwijl het scherm zelf
-- maar 91 orders liet zien. Het aantal leek daardoor fout, maar de telling
-- klopt: de view telt bewust álle open orders (ook Wacht op voorraad/inkoop/
-- maatwerk, die Pick & Ship verbergt), en het zijn vrijwel allemaal DE/BE-
-- orders. Voor die landen bestaan wel selectie-regels (Rhenus/DPD), maar die
-- vervoerders staan tot hun cutover op actief=false — alleen hst_api (NL) is
-- live (ADR-0030). Handmatig kiezen per order is voor die volumes geen
-- werkbare actie; de banner moet dat kunnen duiden in plaats van alleen tellen.
--
-- Deze migratie voegt twee kolommen toe zodat de banner kan uitsplitsen:
--   - status         (TEXT)  — voor "waarvan X klaar voor picken"
--   - afl_land_norm  (TEXT)  — via normaliseer_land (mig 214), zodat
--                              'DEUTSCHLAND' en 'DE' als één land tellen
--
-- De scope van de view blijft bewust ongewijzigd (alle open niet-productie-
-- orders): de teller is óók monitor-signaal, niet alleen picker-info.
--
-- Idempotent.

CREATE OR REPLACE VIEW orders_zonder_vervoerder AS
SELECT DISTINCT
       o.id AS order_id, o.order_nr, o.debiteur_nr, o.afl_land, o.afl_plaats,
       o.status::TEXT              AS status,
       normaliseer_land(o.afl_land) AS afl_land_norm
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
  'Mig 338+345+372: niet-afhaal-orders met >=1 regel zonder vervoerder (geen '
  'matchende actieve selectie-regel). Telt ALLE open orders, ook orders die '
  'Pick & Ship (nog) niet toont. Voedt de banner/teller "zonder vervoerder"; '
  'status + afl_land_norm (normaliseer_land, mig 214) maken de uitsplitsing '
  'per land en "waarvan klaar voor picken" mogelijk. Productie-only orders '
  '(alleen_productie, ADR-0029) uitgesloten: verzending blijft in Basta.';

GRANT SELECT ON orders_zonder_vervoerder TO authenticated;

NOTIFY pgrst, 'reload schema';
