-- Migratie 448: view `cbs_intrastat_export`
--
-- Doel: vervangt de maandelijkse CBS/Intrastat-aangifte-export uit Basta
-- (bijlage "fbacbs" bij mail Nando 17-06-2026) voor de VERZENDINGEN-kant
-- (buitenlandse verkoopfacturen) — niet de inkoop-arrivals (die hebben een
-- andere bron: inkooporders van buitenlandse leveranciers, niet gevraagd).
--
-- Scope: alleen facturen met `btw_verlegd = true` (intracommunautaire
-- leveringen — exact de facturen die ook de Stat.nr.-regel op de PDF tonen,
-- zie intracom-statregel.ts). Per factuurregel 1 rij, admin-pseudo-regels
-- (VERZEND/DROPSHIP-*/kortingen — ADR-0018 `is_admin_pseudo`) uitgesloten:
-- geen fysieke goederenbeweging.
--
-- Kolomvolgorde + -namen matchen de Basta-export 1-op-1 zodat de bestaande
-- workflow (CBS-aangiftesoftware) ongewijzigd kan blijven. Numerieke/
-- fixed-width-formattering (10-cijferige zero-padding, CRLF) gebeurt in de
-- frontend-builder (cbs-export-tsv.ts), niet hier — deze view levert schone
-- getypeerde waarden.
--
-- Bekende vereenvoudigingen (zie mail-thread + CLAUDE.md-toelichting):
--   - Land van oorsprong: constant 'NL' (Karpi's eigen voorraad/productie).
--   - Transactie: constant '11' (normale verkoop) — retouren/loonwerk
--     (21/31 in de Basta-historie) zijn hier niet apart gemodelleerd.
--   - Vervoerswijze: constant '3' (wegvervoer).
--   - Bijzondere maatstaf: constant 0 — in de Basta-historie was dit veld
--     in 94,6% van de regels 0; de overige 5,4% liet steeds "1" zien
--     (vermoedelijk een exportartefact, niet stuks/m² conform CBS-eis).
--     Bij twijfel: navragen bij Alex/CBS welke goederencodes een
--     bijzondere maatstaf vereisen vóór dit veld alsnog gevuld wordt.
--   - Goederencode kan NULL zijn als de kwaliteit nog geen code heeft
--     (mig 446) — de rij wordt NIET uitgesloten (anders verdwijnt een
--     regel stilletjes uit de aangifte); de frontend toont een waarschuwing
--     zodat de gebruiker dit kan signaleren vóór het indienen.

CREATE OR REPLACE VIEW cbs_intrastat_export AS
SELECT
  fr.id                                          AS factuur_regel_id,
  f.id                                            AS factuur_id,
  f.factuur_nr,
  f.factuurdatum,
  TRIM(f.btw_nummer)                              AS partner_id,
  normaliseer_land(f.fact_land)                   AS land_bestemming,
  'NL'                                             AS land_oorsprong,
  '11'                                             AS transactie,
  '3'                                              AS vervoerswijze,
  ''                                               AS leveringsvoorwaarden,
  kw.goederencode,
  ROUND(COALESCE(orr.gewicht_kg, 0))::INTEGER      AS netto_gewicht_kg,
  0                                                AS bijzondere_maatstaf,
  ROUND(fr.bedrag)::INTEGER                        AS factuurwaarde,
  'EUR'                                            AS factuurvaluta,
  f.factuur_nr                                     AS eigen_administratienummer
FROM factuur_regels fr
JOIN facturen f ON f.id = fr.factuur_id
LEFT JOIN order_regels orr ON orr.id = fr.order_regel_id
LEFT JOIN producten p ON p.artikelnr = fr.artikelnr
LEFT JOIN kwaliteiten kw ON kw.code = COALESCE(orr.maatwerk_kwaliteit_code, p.kwaliteit_code)
WHERE f.btw_verlegd = TRUE
  AND NOT is_admin_pseudo(fr.artikelnr);

COMMENT ON VIEW cbs_intrastat_export IS
  'Maandelijkse CBS/Intrastat-verzendingen-export (buitenlandse verkoop), '
  'per factuurregel. Bron voor de "CBS-export"-knop op /facturatie. Mig 448.';
