-- Migratie 513: producten.leverancier_id erven van uitwisselbare equivalenten
--
-- Als een uitwisselgroep (kwaliteit_kleur_uitwisselbaar.basis_code) precies
-- één bekende leverancier heeft, krijgen alle andere producten in dezelfde
-- groep diezelfde leverancier_id.
--
-- Voorbeeld: DREAM·25 → HENAN → LENA·25 en PLUS·25 erven HENAN automatisch.
--
-- Scope:
--   - Alleen groepen met precies 1 leverancier (geen leverancier-conflicten)
--   - Alleen producten waarbij leverancier_id nog NULL is
--
-- Bereik: ~1.555 producten, 103 uitwisselgroepen, 0 conflicten (2026-06-25).

WITH product_met_leverancier AS (
  SELECT DISTINCT kwaliteit_code, kleur_code, leverancier_id
  FROM producten
  WHERE leverancier_id IS NOT NULL
    AND kwaliteit_code IS NOT NULL
    AND kleur_code IS NOT NULL
),
groep_stats AS (
  SELECT u.basis_code, pm.leverancier_id
  FROM kwaliteit_kleur_uitwisselbaar u
  JOIN product_met_leverancier pm
       ON pm.kwaliteit_code = u.input_kwaliteit_code
      AND pm.kleur_code     = u.input_kleur_code
  GROUP BY u.basis_code, pm.leverancier_id
),
-- Alleen groepen met precies 1 leverancier
enkelvoudig AS (
  SELECT basis_code, MAX(leverancier_id) AS leverancier_id
  FROM groep_stats
  GROUP BY basis_code
  HAVING COUNT(*) = 1
),
te_koppelen AS (
  SELECT DISTINCT p.artikelnr, e.leverancier_id
  FROM producten p
  JOIN kwaliteit_kleur_uitwisselbaar u
       ON u.input_kwaliteit_code = p.kwaliteit_code
      AND u.input_kleur_code     = p.kleur_code
  JOIN enkelvoudig e ON e.basis_code = u.basis_code
  WHERE p.leverancier_id IS NULL
)
UPDATE producten p
SET leverancier_id = tk.leverancier_id
FROM te_koppelen tk
WHERE p.artikelnr = tk.artikelnr;

DO $$
DECLARE v_count integer;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'leverancier_id via uitwisselgroep gekoppeld: % producten', v_count;
END $$;
