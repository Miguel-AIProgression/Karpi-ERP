-- Migratie 476: order_pickbaarheid.pick_ship_zichtbaar moet ook TRUE zijn
-- zodra de order al een actieve (Gepland/Picken) zending heeft.
--
-- Achtergrond
-- -----------
-- `pick_ship_zichtbaar` (mig 386) = `alle_regels_pickbaar OR (deelleveringen_
-- toegestaan AND heeft_pickbare_regel)`. Dat is een STATISCHE snapshot van de
-- huidige pickbaarheid — geen geheugen van "is er al een pickronde gestart".
--
-- Gevonden tijdens het testen van de deelzending-override (mig 473): een
-- override-deelzending (`start_deelzending` met `p_override_reden`) voor een
-- klant met `deelleveringen_toegestaan=false` zet de order keurig op
-- 'In pickronde' met een actieve zending, maar die order verdwijnt volledig
-- uit Pick & Ship (`fetchPickShipOrders` filtert hard op `pick_ship_zichtbaar`,
-- frontend/src/modules/magazijn/queries/pickbaarheid.ts:102) — de picker kan
-- de net-gestarte pickronde dus nergens vinden om af te ronden.
--
-- Dit is GEEN nieuw probleem dat alleen de override raakt: order ORD-2026-0126
-- (id 3674, zending ZEND-2026-0066, 'Picken' sinds 2026-06-19 — vier dagen)
-- zit in exact dezelfde val: 6 van 7 regels nog pickbaar, deelleveringen niet
-- toegestaan, dus onvindbaar in Pick & Ship sinds het moment dat een regel na
-- het starten van de pickronde niet meer pickbaar bleek. "Een order in
-- pickronde blijft zichtbaar in de lijst" was al het bedoelde gedrag
-- (CLAUDE.md, mig 386-sectie) maar was voor dit geval niet afgedekt.
--
-- Fix
-- ---
-- Eén extra OR-tak: een order met een actieve zending (status IN ('Gepland',
-- 'Picken')) is altijd `pick_ship_zichtbaar`, los van de statische
-- pickbaarheid-snapshot. Voor élke order ZONDER actieve zending is dit een
-- no-op (EXISTS faalt, ongewijzigd gedrag) — geverifieerd op alle 1497 rijen
-- in de live `order_pickbaarheid`: precies 2 orders veranderen (de twee
-- hierboven genoemde), 0 regressies.

CREATE OR REPLACE VIEW order_pickbaarheid AS
SELECT
  op.order_id,
  count(*)::integer AS totaal_regels,
  count(*) FILTER (WHERE op.is_pickbaar)::integer AS pickbare_regels,
  count(*) FILTER (WHERE op.is_pickbaar) = count(*) AS alle_regels_pickbaar,
  count(*) FILTER (WHERE op.is_pickbaar) > 0 AS heeft_pickbare_regel,
  COALESCE(d.deelleveringen_toegestaan, false) AS deelleveringen_toegestaan,
  (count(*) FILTER (WHERE op.is_pickbaar) = count(*))
    OR (COALESCE(d.deelleveringen_toegestaan, false) AND count(*) FILTER (WHERE op.is_pickbaar) > 0)
    OR EXISTS (
         SELECT 1
           FROM zending_orders zo
           JOIN zendingen z ON z.id = zo.zending_id
          WHERE zo.order_id = op.order_id
            AND z.status IN ('Gepland', 'Picken')
       )
    AS pick_ship_zichtbaar
FROM orderregel_pickbaarheid op
JOIN orders o ON o.id = op.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
GROUP BY op.order_id, d.deelleveringen_toegestaan;

NOTIFY pgrst, 'reload schema';
