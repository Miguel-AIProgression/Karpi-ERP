-- Migration 106: backfill kwaliteit_code + kleur_code op MAATWERK-artikelen
--
-- Probleem: 377 producten met omschrijving-patroon `{KWAL}{KLEUR}MAATWERK`
-- (bijv. VELV16MAATWERK, AEST13MAATWERK) hebben `kwaliteit_code=NULL` en
-- `kleur_code=NULL`. Daardoor:
--  • `fetchMaatwerkArtikelNr(kwaliteit, kleur)` strategie 1-3 falen (filteren
--    op kwaliteit_code+kleur_code) en belanden bij strategie 4 (uitwisselgroep)
--    die bij VELV 16 het CISC16MAATWERK (771169999) teruggeeft i.p.v. het
--    bestelde VELV16MAATWERK (771169998). Gevolg: klant krijgt prijs van de
--    uitwisselbare kwaliteit i.p.v. de bestelde.
--  • Klant-prijslijst-lookup via `artikelnr` werkt niet voor het bestelde
--    artikel, omdat we het verkeerde artikelnr vinden.
--
-- Fix: parse `{KWAL}{KLEUR}MAATWERK` uit omschrijving en vul de kolommen.
-- Conservatief: alleen backfillen als:
--  • omschrijving strikt aan patroon voldoet (`^[A-Z]+\d+MAATWERK$`)
--  • kwaliteit_code + kleur_code beide NULL zijn (overschrijven vermeden)
--  • afgeleide kwaliteit_code bestaat in `kwaliteiten` (respecteert FK)

UPDATE producten p
SET
  kwaliteit_code = (regexp_match(p.omschrijving, '^([A-Z]+)\d+MAATWERK$'))[1],
  kleur_code     = (regexp_match(p.omschrijving, '^[A-Z]+(\d+)MAATWERK$'))[1]
WHERE p.kwaliteit_code IS NULL
  AND p.kleur_code IS NULL
  AND p.omschrijving ~ '^[A-Z]+\d+MAATWERK$'
  AND EXISTS (
    SELECT 1 FROM kwaliteiten k
    WHERE k.code = (regexp_match(p.omschrijving, '^([A-Z]+)\d+MAATWERK$'))[1]
  );
