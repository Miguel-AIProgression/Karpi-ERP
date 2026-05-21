-- Migratie 302: View `verkoopoverzicht_export`
--
-- Doel: vervangt de "VERK_OVERZICHT_VAN_..._TOT_....XLS" tab-separated
-- export uit het oude ERP. Levert per factuur 1 rij met debiteur-snapshot
-- (uit debiteuren — fact_naam is geen 1-op-1 met "Naam1"-veld uit oud
-- systeem), gekoppelde ordernummers + klant-referenties (samengevoegd uit
-- `factuur_regels` als 1 factuur meerdere orders bundelt — AFAS-import
-- veld), en factuur-totalen.
--
-- Selectie van facturen gebeurt frontend-side via een datum-filter (BETWEEN
-- van/tot op `factuurdatum`) — de view bevat álle factuur-rijen ongeacht
-- status, zodat hetzelfde view ook bruikbaar is voor andere overzichten.
-- Het frontend-filter beperkt tot status in (Verstuurd, Betaald,
-- Herinnering, Aanmaning) — Concept en Gecrediteerd worden uitgesloten.
--
-- Land: snapshot uit `facturen.fact_land`. De oude export liet NL leeg en
-- BE als "België" zien. Voor backwards-compat doen we die mapping in de
-- frontend-builder (niet hier — laat fact_land letterlijk staan).
--
-- Naam2: oud-systeem-veld voor markers als "@" (hoofd-debiteur) of
-- "(ZR-NR.115560)(VME)" (inkoopgroep-ref). We hebben geen analogon op
-- `debiteuren` — afgeleid uit `debiteuren.inkoopgroep_code` (toont
-- "(INKC-... <naam>)") als basis. Pure tekst-veld, niet kritisch voor
-- AFAS-import.

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
  -- Naam2: inkoopgroep-ref ("INKC-XX <naam>") als debiteur in een
  -- inkoopgroep zit. Voor hoofd-debiteuren of solo-debiteuren leeg.
  CASE
    WHEN d.inkoopgroep_code IS NOT NULL THEN
      '(' || d.inkoopgroep_code || COALESCE(' ' || ig.naam, '') || ')'
    ELSE ''
  END                        AS naam2,
  d.adres,
  d.postcode,
  d.plaats,
  d.land,
  -- Concat van distinct ordernummers/klant-referenties uit alle
  -- factuur-regels (bundel-facturen kunnen meerdere orders dekken).
  -- ; -gescheiden zodat AFAS-import het in een tekstveld kan plaatsen.
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
  )                          AS klant_refs
FROM facturen f
JOIN debiteuren d ON d.debiteur_nr = f.debiteur_nr
LEFT JOIN inkoopgroepen ig ON ig.code = d.inkoopgroep_code;

COMMENT ON VIEW verkoopoverzicht_export IS
  'AFAS-compatibele verkoopoverzicht-export per factuur. Bron voor de '
  '"Verkoopoverzicht exporteren"-knop op /facturatie. Mig 302.';
