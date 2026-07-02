-- Migratie 568: order_status-enum-snapshot uitbreiden met 'Wacht op combi-levering'
-- (opvolger van mig 350, ADR-0040)
--
-- Zelfde vangnet als mig 350, nu met de mig 563-enum-waarde meegenomen. Draait
-- pas hier (niet in mig 563 zelf) omdat een DO-block die de nieuwe waarde
-- cast niet in dezelfde transactie mag staan als de ALTER TYPE die 'm toevoegt.
--
-- Spiegels die bij deze enum-wijziging zijn bijgewerkt (zelfde commit):
--   - deze snapshot (hieronder)
--   - frontend/src/lib/utils/constants.ts → ORDER_STATUS_COLORS
--   - frontend/src/lib/orders/order-status-groepen.ts → FASE_STATUSES
--   - frontend/src/lib/supabase/queries/vertegenwoordigers.ts → ACTIVE_ORDER_STATUSES
--   - supabase/functions/_shared/order-lifecycle/order-status.ts +
--     __tests__/order-status.golden.json + contracttest
--   - supabase/functions/_shared/order-lifecycle/derive-status.ts (mig 564)
--   - derive_wacht_status no-touch-/promotie-lijsten (mig 564)
--   - docs/order-lifecycle.md §2 (status-tabel)
--
-- BEWUST set-vergelijking (gesorteerd), zoals mig 350 — volgorde is voor
-- order_status niet betekenis-dragend.
--
-- Idempotent: alleen leesbewerkingen.

DO $$
DECLARE
  v_verwacht TEXT[] := ARRAY[
    -- Canoniek (ADR-0016 + mig 308/327 + mig 563/ADR-0040)
    'Concept', 'Klaar voor picken', 'Wacht op voorraad', 'Wacht op inkoop',
    'Wacht op maatwerk', 'Wacht op combi-levering', 'In pickronde',
    'Deels verzonden', 'Verzonden', 'Geannuleerd', 'Maatwerk afgerond',
    -- Legacy (niet meer geschreven; 'In productie' hergebruikt door mig 329)
    'Nieuw', 'Actie vereist', 'Wacht op picken', 'In snijplan',
    'In productie', 'Deels gereed', 'Klaar voor verzending'
  ];
  v_db TEXT[];
BEGIN
  SELECT array_agg(e ORDER BY e) INTO v_db
    FROM unnest(enum_range(NULL::order_status)::TEXT[]) AS e;

  SELECT array_agg(e ORDER BY e) INTO v_verwacht
    FROM unnest(v_verwacht) AS e;

  IF v_db <> v_verwacht THEN
    RAISE EXCEPTION E'order_status enum <> snapshot (set-vergelijking).\nDB      = %\nsnapshot = %\nSync de snapshot + ORDER_STATUS_COLORS + FASE_STATUSES + ACTIVE_ORDER_STATUSES + docs/order-lifecycle.md §2.',
      v_db, v_verwacht;
  END IF;
  RAISE NOTICE 'Mig 568: order_status matcht de snapshot (% waarden)', array_length(v_db, 1);
END $$;
