-- Migratie 516: voeg `is_creditnota` toe aan `verkoopoverzicht_export`
--
-- Aanleiding: de export sloeg creditnotas over omdat die status='Concept'
-- hebben (nooit per e-mail verstuurd naar klant, maar wél echte boekhoud-
-- documenten). AFAS heeft de creditnota nodig als tegenboeking.
--
-- Aanpak: additieve kolom `is_creditnota` (BOOLEAN) — frontend-filter
-- wijzigt van `.in('status', [...])` naar
-- `.or('status.in.(...),is_creditnota.is.true')` zodat verstuurde/betaalde
-- debetfacturen én álle creditnotas (ongeacht status) meegenomen worden.
-- Concept-debetfacturen en Gecrediteerd-debetfacturen blijven uitgesloten.

CREATE OR REPLACE VIEW verkoopoverzicht_export AS
SELECT
  f.id                       AS factuur_id,
  f.factuur_nr,
  f.factuurdatum,
  f.vervaldatum,
  f.status,
  f.subtotaal                AS bedrag_ex,
  f.btw_bedrag,
  f.totaal,
  d.debiteur_nr,
  d.naam                     AS naam1,
  CASE
    WHEN d.inkoopgroep_code IS NOT NULL THEN
      '(' || d.inkoopgroep_code || COALESCE(' ' || ig.naam, '') || ')'
    ELSE ''
  END                        AS naam2,
  d.adres,
  d.postcode,
  d.plaats,
  d.land,
  (
    SELECT STRING_AGG(DISTINCT fr.order_nr, '; ' ORDER BY fr.order_nr)
      FROM factuur_regels fr
     WHERE fr.factuur_id = f.id
       AND fr.order_nr IS NOT NULL
       AND COALESCE(fr.artikelnr, '') NOT IN
           ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
  )                          AS ordernummers,
  (
    SELECT STRING_AGG(DISTINCT fr.uw_referentie, '; ' ORDER BY fr.uw_referentie)
      FROM factuur_regels fr
     WHERE fr.factuur_id = f.id
       AND fr.uw_referentie IS NOT NULL
       AND fr.uw_referentie <> ''
       AND COALESCE(fr.artikelnr, '') NOT IN
           ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
  )                          AS klant_refs,
  (f.credit_voor_factuur_id IS NOT NULL) AS is_creditnota
FROM facturen f
JOIN debiteuren d ON d.debiteur_nr = f.debiteur_nr
LEFT JOIN inkoopgroepen ig ON ig.code = d.inkoopgroep_code;

COMMENT ON VIEW verkoopoverzicht_export IS
  'AFAS-compatibele verkoopoverzicht-export per factuur. Bron voor de '
  '"Verkoopoverzicht exporteren"-knop op /facturatie. Mig 302/516. '
  'is_creditnota=TRUE → altijd in de export (ook als status=Concept). '
  'Concept-debetfacturen en Gecrediteerd-debetfacturen worden uitgesloten '
  'via het frontend-filter in verkoopoverzicht.ts.';
