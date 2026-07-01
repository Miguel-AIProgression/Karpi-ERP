-- 543 (hernummerd van 534, botsing met main): Signaal — EDI-orders waarvan de aflever-GLN geen vestiging matcht.
--
-- Aanleiding (2026-06-30, melding Guido via ORD-2026-0892): een EDI-order van
-- BDSK/XXXLutz droeg aflever-GLN 9007019015620 (vestiging Gottfrieding), maar die
-- GLN stond niet in `afleveradressen`. `create_edi_order` (mig 357 r96-113) matcht
-- het afleveradres op `gln_afleveradres` en valt bij géén match STIL terug op het
-- debiteur-hoofdadres (Würzburg). De order werd gewoon aangemaakt — de "Te koppelen"
-- vangnet (mig 306) vuurt alleen als de hele order ongematcht blijft (`order_id IS
-- NULL`), niet als alleen de aflever-vestiging ongekoppeld is. Resultaat: een order
-- die naar het verkeerde (HQ-)adres ging, zonder enig signaal. Bleek niet eenmalig:
-- ~9 open orders over 3 debiteuren (o.a. Ostermann #621816) zaten in dezelfde val.
--
-- Deze view is het ontbrekende signaal. Puur lezend (geen kolom/trigger/backfill —
-- de conditie is een join die vanzelf meebeweegt zodra een vestiging-GLN gekoppeld
-- wordt). Spiegelt de match-conditie van create_edi_order exact: scope op debiteur,
-- ".0"-tolerant (mig 312). Eindstatussen + afhaal + productie-only uitgesloten
-- (zelfde stijl als `orders_zonder_vervoerder`, mig 345).

CREATE OR REPLACE VIEW edi_orders_afleveradres_ongekoppeld AS
SELECT o.id AS order_id,
       o.order_nr,
       o.debiteur_nr,
       o.afl_naam,
       o.afl_plaats,
       o.afleveradres_gln,
       o.status,
       o.orderdatum
  FROM orders o
 WHERE o.bron_systeem = 'edi'
   AND o.afleveradres_gln IS NOT NULL
   AND o.afleveradres_gln <> ''
   AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
   AND NOT COALESCE(o.afhalen, FALSE)
   AND NOT COALESCE(o.alleen_productie, FALSE)
   AND NOT EXISTS (
     SELECT 1
       FROM afleveradressen a
      WHERE a.debiteur_nr = o.debiteur_nr
        AND a.gln_afleveradres IN (o.afleveradres_gln, o.afleveradres_gln || '.0')
   );

COMMENT ON VIEW edi_orders_afleveradres_ongekoppeld IS
  'Mig 543: EDI-orders waarvan de aflever-GLN geen vestiging in afleveradressen matcht '
  '(create_edi_order viel stil terug op het debiteur-hoofdadres). Voedt de '
  'EdiAfleveradresOngekoppeldBanner op het orders-overzicht. Koppel de juiste '
  'vestiging-GLN aan het afleveradres zodat de order van de lijst verdwijnt.';
