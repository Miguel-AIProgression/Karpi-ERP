-- Migration 320: voeg eenheid toe aan openstaande_inkooporder_regels view
-- Achteraan toegevoegd zodat CREATE OR REPLACE VIEW slaagt.

CREATE OR REPLACE VIEW openstaande_inkooporder_regels AS
SELECT
  r.id AS regel_id,
  r.inkooporder_id,
  o.inkooporder_nr,
  o.oud_inkooporder_nr,
  o.status AS order_status,
  o.besteldatum,
  o.leverweek,
  COALESCE(r.verwacht_datum, o.verwacht_datum) AS verwacht_datum,
  l.id AS leverancier_id,
  l.leverancier_nr,
  l.naam AS leverancier_naam,
  l.woonplaats AS leverancier_woonplaats,
  r.regelnummer,
  r.artikelnr,
  r.artikel_omschrijving,
  r.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving AS product_omschrijving,
  r.inkoopprijs_eur,
  r.besteld_m,
  r.geleverd_m,
  r.te_leveren_m,
  r.status_excel,
  -- Mig 318
  r.eta_bijgewerkt_door,
  r.eta_bijgewerkt_op,
  r.leverancier_notitie,
  r.verwacht_datum       AS regel_verwacht_datum,
  o.verwacht_datum       AS order_verwacht_datum,
  -- Mig 320
  r.eenheid
FROM inkooporder_regels r
JOIN inkooporders o ON o.id = r.inkooporder_id
LEFT JOIN leveranciers l ON l.id = o.leverancier_id
LEFT JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.te_leveren_m > 0
  AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');

NOTIFY pgrst, 'reload schema';
