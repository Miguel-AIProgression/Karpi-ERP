-- Read-only feitenlijst: verzonden/betaalde facturen met >1 VERZEND-regel.
--
-- Grill-besluit E1: we doen NIETS met deze facturen (juridisch netjes),
-- maar willen wel weten HOEVEEL en WELKE. Resultaat informeert eventueel
-- reactief handelen op klantvraag.
--
-- Veilig: alleen SELECT, geen DML.
--
-- Run dit in Supabase SQL Editor na deploy van mig 256 + run van het
-- merge-script. Output: 0 rijen = schoon; N rijen = bewaren als naslag.

SELECT
  f.factuur_nr,
  f.debiteur_nr,
  d.naam                                            AS klant_naam,
  f.status,
  f.factuurdatum,
  f.verstuurd_op,
  f.totaal,
  COUNT(*) FILTER (WHERE fr.artikelnr = 'VERZEND')  AS aantal_verzend_regels,
  SUM(fr.bedrag) FILTER (WHERE fr.artikelnr = 'VERZEND') AS verzend_totaal
FROM facturen f
JOIN factuur_regels fr ON fr.factuur_id = f.id
JOIN debiteuren d      ON d.debiteur_nr = f.debiteur_nr
WHERE f.status IN ('Verstuurd', 'Betaald', 'Herinnering', 'Aanmaning')
GROUP BY f.id, f.factuur_nr, f.debiteur_nr, d.naam, f.status,
         f.factuurdatum, f.verstuurd_op, f.totaal
HAVING COUNT(*) FILTER (WHERE fr.artikelnr = 'VERZEND') > 1
ORDER BY f.factuurdatum DESC;
