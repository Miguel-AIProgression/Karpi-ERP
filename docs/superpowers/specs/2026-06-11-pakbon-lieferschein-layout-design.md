# Pakbon-layout naar oud Lieferschein-ontwerp

**Datum:** 2026-06-11
**Status:** goedgekeurd door Miguel (visual companion mockup, 11 juni)
**Scope:** alleen [`pakbon-document.tsx`](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx) + print-query-uitbreiding in [`zendingen.ts`](../../../frontend/src/modules/logistiek/queries/zendingen.ts)

## Aanleiding

De pakbon die vanuit Pick & Ship geprint wordt moet qua layout lijken op het
oude Karpi Lieferschein-document (foto-voorbeeld KIBEK TAUFKIRCHEN,
Auftragnr 26549480, 5 juni 2026). Het oude document is de vertrouwde vorm voor
zowel magazijn als ontvangers.

## Goedgekeurde layout (van boven naar beneden)

1. **Header:** KARPI GROUP-logo gecentreerd (KARPI / horizontale lijn / GROUP),
   bedrijfsgegevens (uit `app_config.bedrijfsgegevens`) rechtsboven — als nu.
2. **Documenttitel:** groot "Pakbon" links-van-midden, rechts ervan
   `Pakbonnr: <zending_nr>` en `Datum: <verzenddatum ?? created_at>`.
3. **Afleveradres als hoofd-adresblok** (rechts van het midden, uppercase):
   `afl_naam` (+ `orders.afl_naam_2`), `afl_adres`, `afl_postcode afl_plaats`,
   land (voluit indien ≠ NL), daaronder het **telefoonnummer**
   (`zendingen.afl_telefoon`, mig 339).
4. **Referentieblok** links: `Uw referentie`, `Vertegenw.`,
   `Order/Debiteur: <order_nr>/<debiteur_nr>`. Rechts:
   `Routecode: <debiteuren.route>` (regel weglaten als NULL).
5. **Tabel** tussen dashed dividers met kolommen
   `Rgl. | Artikel | Omschrijving | Besteld | Geleverd`.
   Eenheid ("St") staat inline vóór de omschrijving, zoals het oude document.
6. **Factuuradres in de body** onder de tabelheader (label `Factuuradres:`),
   zoals "Rechnungsadresse" in het oude document. Het factuuradres staat dus
   niet meer bovenaan.
7. **Artikelregels:** regelnummer 2-cijferig (01, 02, …), artikelnr,
   Karpi-omschrijving als hoofdregel (incl. maatwerk-afmeting), sub-regel
   `Uw naam: <klanteigen omschrijving>` alléén als die afwijkt.
   Besteld = `order_regels.orderaantal`, Geleverd = `zending_regels.aantal`.
8. **Bundel-zendingen (mig 222):** sub-kop `Order <order_nr>` per bron-order
   boven zijn regels blijft, binnen de nieuwe tabelkolommen. Het
   referentieblok toont bij bundels "N orders gebundeld" + per-order
   referentielijst (huidig gedrag behouden).
9. **Totalen:** `Kolli: <aantal_colli>` en `Gewicht: <totaal kg>` — vervangt
   het huidige "Totaal m2" (expliciete keuze, optie D aangeklikt).
10. **Disclaimer** boven de footer, vast Nederlands:
    "EEN KLEINE MAATAFWIJKING (+/- 3%) EN KLEURAFWIJKINGEN KUNNEN OPTREDEN".
11. **Footer:** k.v.k./btw/bank-regel uit bedrijfsgegevens — ongewijzigd.

## Afwijkingen t.o.v. het oude document (bewust)

- **"Leveringskond.: Frei Haus" vervalt** — er is geen betrouwbaar veld in het
  schema (eerder besloten, zie changelog-notitie over "Franco").
- **Routecode** komt uit `debiteuren.route` (legacy-import); regel verdwijnt
  stilletjes als het veld leeg is.
- Taal is vast Nederlands (het voorbeeld was Duits; gebruiker: "qua layout").

## Datawijzigingen

`fetchZendingPrintSet` selecteert extra: `zendingen.afl_telefoon` en
`debiteuren.route`. Typen `ZendingPrintSet` uitgebreid. Geen migratie nodig.

## Testen

`npm run typecheck` + bestaande tests; visuele controle via printset-pagina.
