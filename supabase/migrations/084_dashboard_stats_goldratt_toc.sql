-- =============================================================
-- Migratie 084: dashboard_stats — Goldratt TOC-framing
-- =============================================================
-- Herziening van 083, aangepast op Theory of Constraints (Goldratt):
--
--   Inventory (I) = voorraadwaarde_inkoop
--     Geld vastgebonden in fysieke voorraad, aan INKOOPPRIJS.
--     SUM(rollen.waarde) WHERE status != 'verkocht'. Verkochte rollen
--     zijn geleverd en horen niet meer bij I.
--
--   Open verkooporders = voorraadwaarde_verkoop
--     Waarde van ORDERS IN FLIGHT (nog niet geleverd, niet geannuleerd),
--     aan verkoopprijs, exclusief verzendkosten. Dit is de pipeline —
--     commitments die throughput gaan worden. 'Verzonden' = reeds
--     gerealiseerd en 'Geannuleerd' = niet van toepassing.
--
-- Kolomnamen blijven (frontend-contract). Labels op UI-kaarten
-- reflecteren de nieuwe betekenis.
-- =============================================================

CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
    -- Voorraad (aantallen ongewijzigd)
    (SELECT COUNT(*) FROM producten WHERE actief = true)                         AS aantal_producten,
    (SELECT COUNT(*) FROM rollen WHERE status = 'beschikbaar')                   AS beschikbare_rollen,

    -- Inventory (I): vastliggend kapitaal in voorraad, excl. verkocht
    (SELECT COALESCE(SUM(waarde), 0) FROM rollen WHERE status != 'verkocht')     AS voorraadwaarde_inkoop,

    -- Open verkooporders: waarde van orders in flight, excl. verzendkosten
    (
        SELECT COALESCE(SUM(o.totaal_bedrag), 0)
                - COALESCE((
                    SELECT SUM(orl.bedrag)
                    FROM order_regels orl
                    JOIN orders o2 ON o2.id = orl.order_id
                    WHERE orl.artikelnr = 'VERZEND'
                      AND o2.status NOT IN ('Verzonden', 'Geannuleerd')
                  ), 0)
        FROM orders o
        WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
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
  'Dashboard KPI-view (Goldratt TOC-framing). '
  'voorraadwaarde_inkoop = Inventory (I): SUM(rollen.waarde) excl. status=verkocht. '
  'voorraadwaarde_verkoop = Open verkooporders: SUM(orders.totaal_bedrag) minus VERZEND, '
  'alleen status NOT IN (Verzonden, Geannuleerd).';
