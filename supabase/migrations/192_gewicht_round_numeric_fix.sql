-- Migratie 192: ROUND(double precision, integer) fix in gewicht-resolvers
--
-- Bug: in mig 188 introduceerden we vorm-aware gewicht-berekening met
-- `PI() * POWER(...) * density`. `PI()` retourneert `double precision`,
-- waardoor de hele expressie naar double-precision promoot. Postgres heeft
-- echter geen `ROUND(double precision, integer)`-overload — alleen
-- `ROUND(numeric, integer)`. Resultaat: elke UPDATE op `kwaliteiten.
-- gewicht_per_m2_kg` faalt voor groepen met ronde producten met
-- `function round(double precision, integer) does not exist`.
--
-- Fix: cast `PI()` expliciet naar NUMERIC zodat de hele expressie NUMERIC
-- blijft. Twee plekken: `bereken_product_gewicht_kg` (resolver, gebruikt
-- bij ad-hoc berekeningen) + `trg_kwaliteit_gewicht_recalc` (cascade-trigger
-- bij density-update).

------------------------------------------------------------------------
-- 1. Resolver: vorm-aware gewicht-berekening met PI()::NUMERIC
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bereken_product_gewicht_kg(p_artikelnr TEXT)
RETURNS TABLE(gewicht_kg NUMERIC, uit_kwaliteit BOOLEAN) AS $$
DECLARE
  v_lengte INTEGER;
  v_breedte INTEGER;
  v_vorm TEXT;
  v_density NUMERIC;
  v_legacy_gewicht NUMERIC;
BEGIN
  SELECT p.lengte_cm, p.breedte_cm, p.vorm, q.gewicht_per_m2_kg, p.gewicht_kg
    INTO v_lengte, v_breedte, v_vorm, v_density, v_legacy_gewicht
  FROM producten p
  LEFT JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  IF v_lengte IS NOT NULL AND v_breedte IS NOT NULL AND v_density IS NOT NULL THEN
    IF v_vorm = 'rond' THEN
      RETURN QUERY SELECT
        ROUND(PI()::NUMERIC * POWER(v_lengte::NUMERIC / 200.0, 2) * v_density, 2),
        true;
    ELSE
      RETURN QUERY SELECT
        ROUND((v_lengte::NUMERIC * v_breedte::NUMERIC / 10000.0) * v_density, 2),
        true;
    END IF;
  ELSE
    RETURN QUERY SELECT v_legacy_gewicht, false;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_product_gewicht_kg IS
  'Gewicht-resolver — vorm-aware (rond/rechthoek). Mig 192: PI()::NUMERIC '
  'cast om ROUND(double precision, int) error te voorkomen. Mig 185, 188, 192.';

------------------------------------------------------------------------
-- 2. Cascade-trigger: zelfde fix
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_kwaliteit_gewicht_recalc()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE producten p
  SET
    gewicht_kg = CASE
      WHEN p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL THEN
        CASE p.vorm
          WHEN 'rond' THEN ROUND(PI()::NUMERIC * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * NEW.gewicht_per_m2_kg, 2)
          ELSE          ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * NEW.gewicht_per_m2_kg, 2)
        END
      ELSE p.gewicht_kg
    END,
    gewicht_uit_kwaliteit = (
      p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL
    )
  WHERE p.kwaliteit_code = NEW.code
    AND p.product_type IN ('vast', 'staaltje');

  UPDATE order_regels ore
  SET gewicht_kg = CASE
    WHEN NEW.gewicht_per_m2_kg IS NOT NULL AND ore.maatwerk_oppervlak_m2 IS NOT NULL
      THEN ROUND(ore.maatwerk_oppervlak_m2 * NEW.gewicht_per_m2_kg, 2)
    ELSE NULL
  END
  FROM orders o
  WHERE ore.order_id = o.id
    AND ore.maatwerk_kwaliteit_code = NEW.code
    AND ore.is_maatwerk = true
    AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_kwaliteit_gewicht_recalc IS
  'Cascade: bij wijziging gewicht_per_m2_kg op kwaliteit, herrekent producten '
  '(vorm-aware) + open maatwerk-orderregels. Mig 192: PI()::NUMERIC cast.';
