-- Migratie 350: snapshot-assert op de order_status-enum (bevinding B5)
-- (NB: op 2026-06-10 toegepast als "mig 349", vóór hernummering wegens
--  collisie met 346_derive_wacht_status_single_source op main.)
--
-- Zelfde vangnet als mig 344 voor snijplan_status/confectie_status, nu voor
-- order_status: faalt zodra iemand een waarde toevoegt/verwijdert zonder de
-- spiegels mee te nemen. Spiegels die bij een enum-wijziging MOETEN worden
-- bijgewerkt:
--   - deze snapshot (hieronder)
--   - frontend/src/lib/utils/constants.ts → ORDER_STATUS_COLORS
--   - docs/order-lifecycle.md §2 (status-tabel)
--   - herbereken_wacht_status no-touch-lijst (mig 275 / opvolger)
--
-- BEWUST set-vergelijking (gesorteerd), géén volgorde-assert zoals mig 344:
-- de basis-CREATE TYPE van order_status zit niet in deze repo (pre-migratie-
-- tijdperk), dus de fysieke enum-volgorde is niet uit de historie af te
-- leiden. Volgorde is voor order_status ook niet betekenis-dragend (geen
-- code sorteert op enum-volgorde).
--
-- PRE-FLIGHT bij toepassen: draai eerst
--   SELECT enum_range(NULL::order_status);
-- en vergelijk met de snapshot. Faalt de assert, dan print de exception
-- beide arrays — sync de snapshot én de spiegels hierboven in één commit.
--
-- Idempotent: alleen leesbewerkingen.

DO $$
DECLARE
  v_verwacht TEXT[] := ARRAY[
    -- Canoniek (ADR-0016 + mig 308/327)
    'Concept', 'Klaar voor picken', 'Wacht op voorraad', 'Wacht op inkoop',
    'Wacht op maatwerk', 'In pickronde', 'Deels verzonden', 'Verzonden',
    'Geannuleerd', 'Maatwerk afgerond',
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
    RAISE EXCEPTION E'order_status enum <> snapshot (set-vergelijking).\nDB      = %\nsnapshot = %\nSync de snapshot + ORDER_STATUS_COLORS + docs/order-lifecycle.md §2.',
      v_db, v_verwacht;
  END IF;
  RAISE NOTICE 'Mig 350: order_status matcht de snapshot (% waarden)', array_length(v_db, 1);
END $$;
