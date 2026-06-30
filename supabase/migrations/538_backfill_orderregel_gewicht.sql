-- Migratie 538: backfill order_regels.gewicht_kg voor NULL-rijen
--
-- Root-cause: order_regels.gewicht_kg wordt bij order-aanmaak gevuld vanuit
-- producten.gewicht_kg via de trigger trg_product_gewicht_recalc (mig 185).
-- Die trigger cascadeert alleen naar open orders (NOT IN Verzonden/Geannuleerd/
-- Klaar voor verzending). Orders die al Verzonden waren toen producten.gewicht_kg
-- gecorrigeerd werd (mig 184/185/188/192 density-fix, en latere data-imports)
-- hebben daardoor nog steeds NULL in order_regels.gewicht_kg.
--
-- Gevolg: factuur-PDF (via bouwIntracomStatRegel) toont "Gewicht: 0 kg" voor
-- elke orderregel waarvan het gewicht NULL is (fallback 0 in de TS-code).
--
-- Fix: backfill alle NULL-rijen via bereken_orderregel_gewicht_kg — de
-- bestaande live resolver die per-order_regel het juiste gewicht berekent
-- (maatwerk: oppervlak × density; vast: bereken_product_gewicht_kg).
-- Bewust GEEN beperking op orderstatus — ook Verzonden-orders worden gecorrigeerd,
-- want die staan op facturen die de klant al heeft ontvangen.
-- Bewust GEEN beperking op is_maatwerk — de resolver dekt beide takken.
-- Alleen uitgesloten: regels zonder artikelnr (TOESLAG, VORM-companion) — de
-- resolver geeft voor die ook NULL terug, maar de UPDATE is dan een no-op.

UPDATE order_regels
SET gewicht_kg = bereken_orderregel_gewicht_kg(id)
WHERE gewicht_kg IS NULL
  AND artikelnr IS NOT NULL;
