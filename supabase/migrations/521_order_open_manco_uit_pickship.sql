-- Migratie 521: een order met een OPEN manco-regel hoort niet in Pick & Ship
-- tot de binnendienst de manco op de Manco-werklijst heeft afgehandeld.
--
-- Achtergrond
-- -----------
-- Mig 518 zet bij een niet-gevonden colli `order_regels.pick_backorder_sinds` en
-- sluit die regel uit `orderregel_pickbaarheid` (open manco → niet pickbaar). De
-- rest van de order wordt als deelzending verzonden → order 'Deels verzonden'.
-- Maar een al-verzonden regel blijft in `orderregel_pickbaarheid` staan met
-- is_pickbaar=true (de view weet niet dat de regel al in een eindstatus-zending
-- zit — dat is `start_pickronden`'s is_locked-guard, niet de pickbaarheid). Voor
-- zo'n order is dan "alle (resterende, niet-manco) regels pickbaar" TRUE en komt
-- hij via `pick_ship_zichtbaar` tak (1)/(2) tóch terug in Pick & Ship — terwijl
-- er fysiek niets te picken valt (alles verzonden of manco).
--
-- Gebruikerseis (2026-06-26): zo'n order mag pas terugkomen NADAT de binnendienst
-- de manco heeft afgehandeld via de Manco-werklijst:
--   * "Opnieuw leveren" (manco_terug_naar_pickship) → gate weg → weer pickbaar;
--   * "Niet leverbaar / annuleren" (manco_niet_leverbaar) → NL backorder (komt
--     terug zodra voorraad) of DE afgesloten (order naar Verzonden).
--
-- Wijziging
-- ---------
-- `order_pickbaarheid.pick_ship_zichtbaar` krijgt een extra guard: zolang de
-- order ≥1 OPEN manco-regel heeft (pick_backorder_sinds NOT NULL AND
-- pick_backorder_geannuleerd_op NULL — exact het Manco-werklijst-predikaat, vgl.
-- idx_order_regels_pick_backorder uit mig 518), is hij NIET zichtbaar via de
-- voorraad-/deellevering-takken. De actieve-zending-tak (mig 476) blijft een
-- override: een lopende pickronde (Gepland/Picken) moet vindbaar blijven om af te
-- ronden, en een open manco ontstaat pas NA het voltooien van een pickronde, dus
-- deze override wint enkel bij een aparte nog-lopende deelzending.
--
-- `start_pickronden`'s pickbaarheid-guard (mig 466/479) leest deze view, dus die
-- weigert automatisch een open-manco-order (geen aparte wijziging nodig).
-- Body verder BYTE-IDENTIEK aan mig 479 (incl. heeft_gepland_zending).

CREATE OR REPLACE VIEW order_pickbaarheid AS
SELECT
  op.order_id,
  count(*)::integer AS totaal_regels,
  count(*) FILTER (WHERE op.is_pickbaar)::integer AS pickbare_regels,
  count(*) FILTER (WHERE op.is_pickbaar) = count(*) AS alle_regels_pickbaar,
  count(*) FILTER (WHERE op.is_pickbaar) > 0 AS heeft_pickbare_regel,
  COALESCE(d.deelleveringen_toegestaan, false) AS deelleveringen_toegestaan,
  (
    (
      (count(*) FILTER (WHERE op.is_pickbaar) = count(*))
      OR (COALESCE(d.deelleveringen_toegestaan, false) AND count(*) FILTER (WHERE op.is_pickbaar) > 0)
    )
    -- Mig 521: open manco → order uit Pick & Ship tot binnendienst-afhandeling.
    AND NOT EXISTS (
      SELECT 1
        FROM order_regels orm
       WHERE orm.order_id = op.order_id
         AND orm.pick_backorder_sinds IS NOT NULL
         AND orm.pick_backorder_geannuleerd_op IS NULL
    )
  )
  OR EXISTS (
       SELECT 1
         FROM zending_orders zo
         JOIN zendingen z ON z.id = zo.zending_id
        WHERE zo.order_id = op.order_id
          AND z.status IN ('Gepland', 'Picken')
     )
    AS pick_ship_zichtbaar,
  EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = op.order_id
       AND z.status = 'Gepland'
  ) AS heeft_gepland_zending
FROM orderregel_pickbaarheid op
JOIN orders o ON o.id = op.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
GROUP BY op.order_id, d.deelleveringen_toegestaan;

COMMENT ON VIEW order_pickbaarheid IS
  'Order-niveau pickbaarheid (mig 386/476/479). Mig 521: pick_ship_zichtbaar '
  'verbergt een order met >=1 OPEN manco-regel (pick_backorder_sinds gezet, niet '
  'geannuleerd) uit Pick & Ship tot de Manco-werklijst-afhandeling; een actieve '
  'Gepland/Picken-zending blijft een override.';

NOTIFY pgrst, 'reload schema';
