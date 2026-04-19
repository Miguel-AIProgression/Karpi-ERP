-- Fix: gewicht_kg in order_regels was 1000× te klein opgeslagen.
-- Oorzaak: normalizeGewicht() deelde door 1_000_000 i.p.v. 1_000
--          (Lightspeed stuurt gewicht in gram, niet in microgram).
-- Scope:   alleen webshop-orders van Floorpassion NL/DE.
-- Effect:  trigger update_order_totalen() herberekent orders.totaal_gewicht automatisch.

UPDATE order_regels
SET gewicht_kg = ROUND(gewicht_kg * 1000, 2)
WHERE order_id IN (
  SELECT id FROM orders
  WHERE bron_shop IN ('floorpassion_nl', 'floorpassion_de')
)
AND gewicht_kg IS NOT NULL
AND gewicht_kg > 0;
