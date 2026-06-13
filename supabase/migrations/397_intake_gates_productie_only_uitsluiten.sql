-- Migratie 397: intake-gates (mig 395-396) sluiten productie-only orders uit
--
-- Aanleiding (13-06-2026, direct na de mig 395-396-backfill): ALLE ~200+
-- productie-only orders (`alleen_productie=true`, status 'In productie',
-- OUD-*-nummers uit Basta) werden door de backfill geflagd op zowel adres als
-- prijs — ze hebben per definitie geen afleveradres-snapshot en geen prijs in
-- RugFlow (verzending + facturatie blijven in Basta, ADR-0029). Ze bereiken
-- nooit Pick & Ship of facturatie hier, dus de gates zijn voor hen betekenisloos
-- en domineren beide nieuwe tabs als ruis.
--
-- Fix: beide gate-triggers sluiten `alleen_productie=true` uit (gate altijd
-- NULL), consistent met `orders_zonder_vervoerder` (mig 345) en de Pick & Ship-
-- query (`alleen_productie=false`). Discriminator is de vlag, niet de status —
-- vangt productie-only ongeacht 'In productie' / 'Maatwerk afgerond'. Plus een
-- correctie-backfill die de onterecht gezette flags op die orders wist.
--
-- Echte (niet-productie-only) flags blijven staan: ORD-2026-0097/0108/0123
-- (adres) en de ORD-prijs-gevallen. Idempotent.

-- 1. Adres-gate: productie-only nooit flaggen ------------------------------
CREATE OR REPLACE FUNCTION fn_orders_afl_adres_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_incompleet BOOLEAN;
BEGIN
  v_incompleet :=
    COALESCE(NEW.afhalen, FALSE) = FALSE
    AND COALESCE(NEW.alleen_productie, FALSE) = FALSE
    AND NEW.status NOT IN ('Verzonden', 'Geannuleerd')
    AND (
      NULLIF(TRIM(NEW.afl_naam), '')     IS NULL OR
      NULLIF(TRIM(NEW.afl_adres), '')    IS NULL OR
      NULLIF(TRIM(NEW.afl_postcode), '') IS NULL OR
      NULLIF(TRIM(NEW.afl_plaats), '')   IS NULL
    );

  IF v_incompleet THEN
    IF NEW.afl_adres_incompleet_sinds IS NULL THEN
      NEW.afl_adres_incompleet_sinds := now();
    END IF;
  ELSE
    NEW.afl_adres_incompleet_sinds := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Prijs-gate: productie-only nooit flaggen ------------------------------
CREATE OR REPLACE FUNCTION fn_order_regels_prijs_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id BIGINT;
  v_prod     BOOLEAN;
  v_heeft    BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Productie-only orders (Basta-facturatie) zijn nooit prijs-geflagd.
  SELECT COALESCE(o.alleen_productie, FALSE) INTO v_prod
    FROM orders o WHERE o.id = v_order_id;

  IF v_prod THEN
    UPDATE orders
       SET prijs_ontbreekt_sinds = NULL
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NOT NULL;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM order_regels r
     WHERE r.order_id = v_order_id
       AND COALESCE(r.artikelnr, '') <> 'VERZEND'
       AND NOT is_admin_pseudo(r.artikelnr)
       AND COALESCE(r.korting_pct, 0) < 100
       AND COALESCE(r.prijs, 0) = 0
  ) INTO v_heeft;

  IF v_heeft THEN
    UPDATE orders
       SET prijs_ontbreekt_sinds = now()
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NULL;
  ELSE
    UPDATE orders
       SET prijs_ontbreekt_sinds = NULL
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Correctie-backfill: wis de onterechte flags op productie-only orders ---
UPDATE orders
   SET afl_adres_incompleet_sinds = NULL,
       prijs_ontbreekt_sinds      = NULL
 WHERE COALESCE(alleen_productie, FALSE) = TRUE
   AND (afl_adres_incompleet_sinds IS NOT NULL OR prijs_ontbreekt_sinds IS NOT NULL);

NOTIFY pgrst, 'reload schema';
