-- =====================================================================
-- MIGRATIE 021: Eenmalige sync van bestaande reserveringen
-- =====================================================================
-- Herbereken gereserveerd + vrije_voorraad voor ALLE producten
-- op basis van bestaande actieve orders.
-- =====================================================================

-- Stap 1: Reset alle producten naar 0 gereserveerd
UPDATE producten
SET gereserveerd = 0,
    vrije_voorraad = voorraad - backorder + besteld_inkoop;

-- Stap 2: Bereken gereserveerd vanuit actieve orders
UPDATE producten p
SET gereserveerd = sub.totaal_gereserveerd,
    vrije_voorraad = p.voorraad - sub.totaal_gereserveerd - p.backorder + p.besteld_inkoop
FROM (
    SELECT
        or2.artikelnr,
        COALESCE(SUM(or2.te_leveren), 0) AS totaal_gereserveerd
    FROM order_regels or2
    JOIN orders o ON o.id = or2.order_id
    WHERE or2.artikelnr IS NOT NULL
      AND o.status NOT IN ('Verzonden', 'Geannuleerd')
    GROUP BY or2.artikelnr
) sub
WHERE p.artikelnr = sub.artikelnr;

-- Stap 3: Verificatie — toon resultaat
-- (dit is alleen informatief, geen wijziging)
DO $$
DECLARE
    v_totaal_producten INTEGER;
    v_met_reservering INTEGER;
    v_totaal_gereserveerd BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_totaal_producten FROM producten;
    SELECT COUNT(*) INTO v_met_reservering FROM producten WHERE gereserveerd > 0;
    SELECT COALESCE(SUM(gereserveerd), 0) INTO v_totaal_gereserveerd FROM producten;

    RAISE NOTICE '=== SYNC RESULTAAT ===';
    RAISE NOTICE 'Totaal producten: %', v_totaal_producten;
    RAISE NOTICE 'Producten met reservering: %', v_met_reservering;
    RAISE NOTICE 'Totaal gereserveerd: %', v_totaal_gereserveerd;
END $$;
