-- Migration 034: Auto-detect maatwerk orders and create snijplannen
-- Problem: snijplanning page is empty because no order_regels are marked as
-- maatwerk and no snijplannen exist. Rol-products are inherently maatwerk
-- (they need cutting from physical rolls).

-- 0. Ensure SNIJ nummering type exists
INSERT INTO nummering (type, jaar, laatste_nummer)
VALUES ('SNIJ', 2026, 0)
ON CONFLICT DO NOTHING;

-- 1. Mark all existing order_regels with rol-products as maatwerk
UPDATE order_regels oreg
SET is_maatwerk = true
FROM producten p
WHERE p.artikelnr = oreg.artikelnr
  AND p.product_type = 'rol'
  AND oreg.is_maatwerk = false;

-- 2. Auto-create snijplannen for all maatwerk order_regels without one
-- Uses the order_regels maatwerk dimensions if set, otherwise defaults
INSERT INTO snijplannen (snijplan_nr, order_regel_id, lengte_cm, breedte_cm, status, opmerkingen)
SELECT
  volgend_nummer('SNIJ'),
  oreg.id,
  COALESCE(oreg.maatwerk_lengte_cm, 100)::INTEGER,
  COALESCE(oreg.maatwerk_breedte_cm, 100)::INTEGER,
  'Wacht'::snijplan_status,
  'Auto-aangemaakt voor rol-product orderregel'
FROM order_regels oreg
JOIN producten p ON p.artikelnr = oreg.artikelnr
LEFT JOIN snijplannen sp ON sp.order_regel_id = oreg.id
WHERE oreg.is_maatwerk = true
  AND sp.id IS NULL
  AND p.product_type = 'rol';

-- 3. Trigger function: auto-mark new order_regels as maatwerk when product is rol
CREATE OR REPLACE FUNCTION auto_markeer_maatwerk()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM producten
    WHERE artikelnr = NEW.artikelnr
      AND product_type = 'rol'
  ) THEN
    NEW.is_maatwerk := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. BEFORE INSERT trigger (modifies NEW row before it's written)
DROP TRIGGER IF EXISTS trg_auto_maatwerk ON order_regels;
CREATE TRIGGER trg_auto_maatwerk
  BEFORE INSERT ON order_regels
  FOR EACH ROW
  EXECUTE FUNCTION auto_markeer_maatwerk();

-- 5. Trigger function: auto-create snijplan for maatwerk order_regels
CREATE OR REPLACE FUNCTION auto_maak_snijplan()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_maatwerk = true THEN
    IF NOT EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
      INSERT INTO snijplannen (snijplan_nr, order_regel_id, lengte_cm, breedte_cm, status, opmerkingen)
      VALUES (
        volgend_nummer('SNIJ'),
        NEW.id,
        COALESCE(NEW.maatwerk_lengte_cm, 100)::INTEGER,
        COALESCE(NEW.maatwerk_breedte_cm, 100)::INTEGER,
        'Wacht'::snijplan_status,
        'Auto-aangemaakt'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. AFTER INSERT trigger (row must exist for FK reference from snijplannen)
DROP TRIGGER IF EXISTS trg_auto_snijplan ON order_regels;
CREATE TRIGGER trg_auto_snijplan
  AFTER INSERT ON order_regels
  FOR EACH ROW
  EXECUTE FUNCTION auto_maak_snijplan();

-- 7. Fix snijplanning_overzicht view: add sp.rol_id (needed for filtering/assignment)
-- Must DROP first because CREATE OR REPLACE cannot add/reorder columns
DROP VIEW IF EXISTS snijplanning_overzicht;
CREATE VIEW snijplanning_overzicht AS
SELECT
  sp.id,
  sp.snijplan_nr,
  sp.scancode,
  sp.status,
  sp.rol_id,
  sp.lengte_cm AS snij_lengte_cm,
  sp.breedte_cm AS snij_breedte_cm,
  sp.prioriteit,
  sp.planning_week,
  sp.planning_jaar,
  sp.afleverdatum,
  sp.positie_x_cm,
  sp.positie_y_cm,
  sp.gesneden_datum,
  sp.gesneden_op,
  sp.gesneden_door,
  -- Rol info
  r.rolnummer,
  r.kwaliteit_code,
  r.kleur_code,
  r.lengte_cm AS rol_lengte_cm,
  r.breedte_cm AS rol_breedte_cm,
  r.oppervlak_m2 AS rol_oppervlak_m2,
  r.status AS rol_status,
  -- Maatwerk specs (from order_regels - single source of truth)
  oreg.maatwerk_vorm,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.maatwerk_afwerking,
  oreg.maatwerk_band_kleur,
  oreg.maatwerk_instructies,
  -- Order info
  oreg.id AS order_regel_id,
  oreg.artikelnr,
  oreg.omschrijving AS product_omschrijving,
  oreg.orderaantal,
  o.id AS order_id,
  o.order_nr,
  o.debiteur_nr,
  d.naam AS klant_naam
FROM snijplannen sp
LEFT JOIN rollen r ON r.id = sp.rol_id
LEFT JOIN order_regels oreg ON oreg.id = sp.order_regel_id
LEFT JOIN orders o ON o.id = oreg.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;
