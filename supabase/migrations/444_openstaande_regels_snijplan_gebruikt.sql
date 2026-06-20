-- Migratie 444: openstaande_inkooporder_regels toont snijplan-claim (mig 438)
--
-- De Inkooporders-pagina (Regeloverzicht-tab) leest deze view rechtstreeks
-- voor de "Te leveren"-tabel. Voegt `snijplan_gebruikte_lengte_cm` toe zodat
-- de operator ziet hoeveel van een nog-niet-ontvangen rol al "Wacht op
-- inkoop"-stukken draagt. CREATE OR REPLACE met de volledige mig 320-body +
-- één kolom aan het einde (Postgres staat alleen toevoegen toe, geen
-- herordening — bestaande `.select('kolom1,kolom2,...')`-callers blijven
-- ongewijzigd werken).

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
  r.eta_bijgewerkt_door,
  r.eta_bijgewerkt_op,
  r.leverancier_notitie,
  r.verwacht_datum AS regel_verwacht_datum,
  o.verwacht_datum AS order_verwacht_datum,
  r.eenheid,
  r.snijplan_gebruikte_lengte_cm
FROM inkooporder_regels r
JOIN inkooporders o ON o.id = r.inkooporder_id
LEFT JOIN leveranciers l ON l.id = o.leverancier_id
LEFT JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.te_leveren_m > 0
  AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');
