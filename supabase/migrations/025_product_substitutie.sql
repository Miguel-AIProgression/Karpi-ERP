-- 025_product_substitutie.sql
-- Voeg substitutie-kolommen toe aan order_regels
-- en maak een functie om equivalente producten te vinden

-- 1. Nieuwe kolommen op order_regels
ALTER TABLE public.order_regels
  ADD COLUMN fysiek_artikelnr TEXT REFERENCES public.producten(artikelnr),
  ADD COLUMN omstickeren BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_regels.fysiek_artikelnr
  IS 'Artikelnr van het fysiek te leveren product (bij substitutie). NULL = zelfde als artikelnr.';
COMMENT ON COLUMN public.order_regels.omstickeren
  IS 'True als het fysieke product omgestickerd moet worden naar de bestelde productnaam.';

-- 2. Functie: zoek equivalente producten met voorraad
CREATE OR REPLACE FUNCTION zoek_equivalente_producten(
  p_artikelnr TEXT,
  p_min_voorraad INTEGER DEFAULT 1
)
RETURNS TABLE(
  artikelnr       TEXT,
  karpi_code      TEXT,
  omschrijving    TEXT,
  kwaliteit_code  TEXT,
  kleur_code      TEXT,
  vrije_voorraad  INTEGER,
  besteld_inkoop  INTEGER,
  verkoopprijs    NUMERIC(10,2)
) AS $$
DECLARE
  v_collectie_id  BIGINT;
  v_kleur_code    TEXT;
  v_afmeting      TEXT;
BEGIN
  -- Haal collectie + kleur + afmeting op van het bronproduct
  -- Afmeting = karpi_code zonder kwaliteit_code prefix (bv. "12XX120170")
  SELECT k.collectie_id,
         p.kleur_code,
         SUBSTRING(p.karpi_code FROM LENGTH(p.kwaliteit_code) + 1)
    INTO v_collectie_id, v_kleur_code, v_afmeting
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = p_artikelnr;

  -- Geen collectie of geen karpi_code = geen equivalenten
  IF v_collectie_id IS NULL OR v_afmeting IS NULL THEN
    RETURN;
  END IF;

  -- Zoek producten met zelfde collectie + zelfde kleur + zelfde afmeting
  RETURN QUERY
  SELECT p.artikelnr,
         p.karpi_code,
         p.omschrijving,
         p.kwaliteit_code,
         p.kleur_code,
         p.vrije_voorraad,
         p.besteld_inkoop,
         p.verkoopprijs
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND SUBSTRING(p.karpi_code FROM LENGTH(p.kwaliteit_code) + 1) = v_afmeting
     AND p.artikelnr <> p_artikelnr
     AND p.actief = true
   ORDER BY p.vrije_voorraad DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Update reservering-functie: gebruik fysiek_artikelnr als die gezet is
CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
    v_gereserveerd INTEGER;
BEGIN
  -- Lock producten-rij om race conditions te voorkomen
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(or2.te_leveren), 0)
    INTO v_gereserveerd
    FROM order_regels or2
    JOIN orders o ON o.id = or2.order_id
   WHERE COALESCE(or2.fysiek_artikelnr, or2.artikelnr) = p_artikelnr
     AND o.status NOT IN ('Verzonden', 'Geannuleerd');

  UPDATE producten
     SET gereserveerd = v_gereserveerd,
         vrije_voorraad = voorraad - v_gereserveerd - backorder + besteld_inkoop
   WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

-- 4. Update de orderregel-trigger om ook fysiek_artikelnr te herberekenen
CREATE OR REPLACE FUNCTION update_reservering_bij_orderregel()
RETURNS TRIGGER AS $$
BEGIN
  -- Bij DELETE of UPDATE: herbereken voor het OUDE (fysieke) artikelnr
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.artikelnr IS NOT NULL THEN
    PERFORM herbereken_product_reservering(COALESCE(OLD.fysiek_artikelnr, OLD.artikelnr));
    -- Als fysiek verschilt van besteld, herbereken ook het bestelde product
    IF OLD.fysiek_artikelnr IS NOT NULL AND OLD.fysiek_artikelnr IS DISTINCT FROM OLD.artikelnr THEN
      PERFORM herbereken_product_reservering(OLD.artikelnr);
    END IF;
  END IF;

  -- Bij INSERT of UPDATE: herbereken voor het NIEUWE (fysieke) artikelnr
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.artikelnr IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR OLD.artikelnr IS DISTINCT FROM NEW.artikelnr
       OR OLD.fysiek_artikelnr IS DISTINCT FROM NEW.fysiek_artikelnr
       OR OLD.te_leveren IS DISTINCT FROM NEW.te_leveren THEN
      PERFORM herbereken_product_reservering(COALESCE(NEW.fysiek_artikelnr, NEW.artikelnr));
      IF NEW.fysiek_artikelnr IS NOT NULL AND NEW.fysiek_artikelnr IS DISTINCT FROM NEW.artikelnr THEN
        PERFORM herbereken_product_reservering(NEW.artikelnr);
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Update de order-status-trigger om fysiek_artikelnr te herberekenen
CREATE OR REPLACE FUNCTION update_reservering_bij_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_artikelnr TEXT;
    v_fysiek    TEXT;
BEGIN
  FOR v_artikelnr, v_fysiek IN
    SELECT DISTINCT artikelnr, fysiek_artikelnr
    FROM order_regels
    WHERE order_id = NEW.id
      AND artikelnr IS NOT NULL
  LOOP
    PERFORM herbereken_product_reservering(COALESCE(v_fysiek, v_artikelnr));
    IF v_fysiek IS NOT NULL AND v_fysiek IS DISTINCT FROM v_artikelnr THEN
      PERFORM herbereken_product_reservering(v_artikelnr);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Zorg dat triggers bestaan
DROP TRIGGER IF EXISTS trg_reservering_orderregel ON order_regels;
CREATE TRIGGER trg_reservering_orderregel
    AFTER INSERT OR UPDATE OR DELETE ON order_regels
    FOR EACH ROW
    EXECUTE FUNCTION update_reservering_bij_orderregel();

DROP TRIGGER IF EXISTS trg_reservering_order_status ON orders;
CREATE TRIGGER trg_reservering_order_status
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION update_reservering_bij_order_status();
