-- Migratie 560: order_pickbaarheid — Combi-levering-wachtende order uit Pick & Ship (ADR-0040)
--
-- order_pickbaarheid.pick_ship_zichtbaar was tot nu toe PUUR regel-gebaseerd
-- (orderregel_pickbaarheid) plus een paar losse status-onafhankelijke guards
-- (bv. mig 521's open-manco-guard) — geen enkele `orders.status`-filter. Een
-- order in 'Wacht op combi-levering' heeft per definitie alle eigen regels
-- pickbaar (dat is precies waarom hij die status kreeg, mig 558/559) en zou
-- dus zonder deze guard gewoon zichtbaar blijven in Pick & Ship. Zelfde stijl
-- als mig 521's manco-guard: alleen op de reguliere pick_ship_zichtbaar-tak,
-- NIET op de actieve-zending-OR-tak (die is hier nooit van toepassing — een
-- combi-levering-wachtende order is per definitie nooit gestart, dus kan geen
-- Gepland/Picken-zending hebben).
--
-- Body verder BYTE-IDENTIEK aan mig 521.

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
      -- Mig 560 (ADR-0040): Combi-levering-wachtende order nooit in Pick & Ship —
      -- de order_status-gate (mig 558/559) is hier de bron-van-waarheid.
      AND bool_and(o.status <> 'Wacht op combi-levering'::order_status)
    )
    OR EXISTS (
         SELECT 1
           FROM zending_orders zo
           JOIN zendingen z ON z.id = zo.zending_id
          WHERE zo.order_id = op.order_id
            AND z.status IN ('Gepland', 'Picken')
       )
  ) AS pick_ship_zichtbaar,
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
  'Order-niveau pickbaarheid (mig 386/476/479/521/560). Mig 560 (ADR-0040): '
  'pick_ship_zichtbaar sluit een order met status ''Wacht op combi-levering'' uit '
  '(Combi-levering-drempel nog niet gehaald door de hele adres-groep); een '
  'actieve Gepland/Picken-zending blijft een override — nooit van toepassing '
  'voor een combi-levering-wachtende order, want die is per definitie nooit '
  'gestart.';

NOTIFY pgrst, 'reload schema';
