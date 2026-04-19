-- =============================================================
-- Migratie 083: dashboard_stats — nieuwe voorraadwaarden
-- =============================================================
-- voorraadwaarde_inkoop  = SUM(rollen.waarde) over ALLE rollen (alle statussen)
-- voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) - SUM(order_regels.bedrag
--                          WHERE artikelnr = 'VERZEND'), excl. Geannuleerd.
-- gemiddelde_marge_pct   blijft ongewijzigd (gebaseerd op beschikbare rollen).
-- =============================================================

CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
    -- Voorraad (aantallen ongewijzigd)
    (SELECT COUNT(*) FROM producten WHERE actief = true)                         AS aantal_producten,
    (SELECT COUNT(*) FROM rollen WHERE status = 'beschikbaar')                   AS beschikbare_rollen,

    -- NIEUW: som van waarde over ALLE rollen (ongeacht status)
    (SELECT COALESCE(SUM(waarde), 0) FROM rollen)                                AS voorraadwaarde_inkoop,

    -- NIEUW: totaal orderomzet minus verzendkosten, excl. geannuleerde orders
    (
        SELECT COALESCE(SUM(o.totaal_bedrag), 0)
                - COALESCE((
                    SELECT SUM(orl.bedrag)
                    FROM order_regels orl
                    JOIN orders o2 ON o2.id = orl.order_id
                    WHERE orl.artikelnr = 'VERZEND'
                      AND o2.status != 'Geannuleerd'
                  ), 0)
        FROM orders o
        WHERE o.status != 'Geannuleerd'
    )                                                                            AS voorraadwaarde_verkoop,

    -- Berekende marge (ONGEWIJZIGD; baseert op beschikbare rollen)
    CASE
        WHEN (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar') > 0
        THEN ROUND(
            (1 - (SELECT SUM(waarde) FROM rollen WHERE status = 'beschikbaar')
                / (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar')
            ) * 100, 1
        )
        ELSE 0
    END                                                                          AS gemiddelde_marge_pct,

    -- Orders
    (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Verzonden', 'Geannuleerd')) AS open_orders,
    (SELECT COUNT(*) FROM orders WHERE status = 'Actie vereist')                   AS actie_vereist_orders,

    -- Klanten
    (SELECT COUNT(*) FROM debiteuren WHERE status = 'Actief')                      AS actieve_klanten,

    -- Productie
    (SELECT COUNT(*) FROM snijplannen WHERE status IN ('Gepland', 'In productie')) AS in_productie,

    -- Collecties
    (SELECT COUNT(*) FROM collecties WHERE actief = true)                          AS actieve_collecties;

COMMENT ON VIEW public.dashboard_stats IS
  'Dashboard KPI-view. voorraadwaarde_inkoop = SUM(rollen.waarde) over ALLE rollen. '
  'voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) minus VERZEND-regels, excl. Geannuleerd.';
