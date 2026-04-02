# Spec: Orders Module (Eerste Frontend Feature)

## Wat dit oplost

De orders-module is de eerste volledige feature in de frontend. Orders zijn het hart van het ERP — alles draait erom. Door hier te beginnen valideren we de hele stack: Supabase queries, React componenten, routing, en data-display.

## Pagina's

### 1. Orders Overzicht (`/orders`)

**Functionaliteit:**
- Tabel met alle orders, gesorteerd op orderdatum (nieuwste eerst)
- Status-tabs bovenaan: Alle | Nieuw | Actie vereist | Wacht op picken | ... (aantallen per tab)
- Zoeken op: order_nr, oud_order_nr, klantnaam, klant_referentie
- Kolommen: order_nr, datum, klant, referentie, # regels, totaal bedrag, status
- Status badges met kleur per status
- Klikken op een order → detail pagina

**Data source:** `orders` JOIN `debiteuren` (voor klantnaam). Status-telling via `orders_status_telling` view.

### 2. Order Detail (`/orders/:id`)

**Functionaliteit:**
- Header: order_nr, orderdatum, status badge, klantnaam (klikbaar → klantpagina)
- Adresblokken: factuuradres en afleveradres (uit de order snapshots)
- Commercieel: vertegenwoordiger, betaler, inkooporganisatie
- Orderregels tabel:
  - Kolommen: regel#, artikelnr, omschrijving, aantal, prijs, korting, bedrag
  - Klikken op artikelnr → productpagina
- Totalen: subtotaal, totaal gewicht
- Gerelateerd: zendingen, facturen, snijplannen (als ze bestaan — links naar die modules)

**Data source:** `orders` + `order_regels` + `debiteuren` + `vertegenwoordigers`

### 3. Nieuwe Order Aanmaken (`/orders/nieuw`)

**Flow:**
1. **Klant selecteren** — zoekbare dropdown/combobox op debiteuren (naam, debiteur_nr)
   - Bij selectie: factuuradres en standaard-afleveradres worden automatisch ingevuld (uit debiteuren + afleveradressen)
   - Vertegenwoordiger, betaler, prijslijst worden overgenomen uit de klantgegevens
2. **Afleveradres kiezen** — dropdown met alle afleveradressen van de geselecteerde klant
   - Of: handmatig afwijkend adres invullen
   - Adressen worden als snapshot opgeslagen in de order (niet als FK)
3. **Ordergegevens invullen:**
   - Klant referentie (vrij tekstveld)
   - Afleverdatum (datepicker)
   - Week (optioneel)
4. **Orderregels toevoegen:**
   - Artikel zoeken: combobox op artikelnr, karpi_code, omschrijving, zoeksleutel
   - Bij selectie: omschrijving, prijs (uit prijslijst van de klant) en gewicht worden ingevuld
   - Velden per regel: aantal, prijs (aanpasbaar), korting %, omschrijving_2 (optioneel)
   - Bedrag wordt automatisch berekend: (aantal × prijs) × (1 - korting%)
   - Regels kunnen verwijderd en herordend worden
   - Voorraadinfo wordt getoond: vrije voorraad, verwacht aantal
5. **Order opslaan:**
   - Order_nr wordt automatisch gegenereerd via `volgend_nummer('ORD')`
   - Status wordt "Nieuw"
   - Totalen (bedrag, gewicht, aantal_regels) worden berekend door de database-trigger
   - Na opslaan: redirect naar de detail pagina

**Prijs-logica:**
- Bij klantselectie wordt de `prijslijst_nr` van de klant geladen
- Bij artikelselectie: prijs opzoeken in `prijslijst_regels` WHERE prijslijst_nr = klant.prijslijst_nr AND artikelnr = gekozen artikel
- Als geen prijs gevonden: `producten.verkoopprijs` als fallback
- Als ook geen verkoopprijs: prijs veld leeg, handmatig invullen
- Klantkorting (`debiteuren.korting_pct`) wordt als standaard korting% op elke regel gezet (aanpasbaar)

### 4. Order Bewerken (`/orders/:id/bewerken`)

**Functionaliteit:**
- Zelfde formulier als aanmaken, maar voorgevuld met bestaande data
- Klant is **niet** wijzigbaar (om referentiële integriteit te bewaken)
- Afleveradres, referentie, afleverdatum zijn wijzigbaar
- Orderregels:
  - Bestaande regels bewerken (aantal, prijs, korting)
  - Nieuwe regels toevoegen
  - Regels verwijderen (met bevestiging)
- Status is wijzigbaar (dropdown met alle order_status enum waarden)
  - Statuswijziging wordt gelogd in `activiteiten_log`

**Beperkingen:**
- Orders met status "Verzonden" of "Geannuleerd" zijn niet bewerkbaar (toon melding)
- Als er al zendingen/facturen aan gekoppeld zijn: waarschuwing tonen bij wijziging van regels

### 5. Order Acties (op detail pagina)

- **Status wijzigen** — snelknop om status te veranderen (bijv. "Markeer als Klaar voor verzending")
- **Order annuleren** — met bevestigingsdialoog, zet status naar "Geannuleerd"
- **Order dupliceren** — maakt een nieuwe order aan met dezelfde klant, adressen en regels (nieuw order_nr, status "Nieuw")
- **Bewerken** — opent bewerkformulier

## Queries

### Orders lijst met status-tabs
```
SELECT o.*, d.naam AS klant_naam
FROM orders o
JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
WHERE o.status = :selected_status (optioneel)
ORDER BY o.orderdatum DESC
LIMIT 50 OFFSET :page * 50
```

### Order detail met regels
```
SELECT o.*, d.naam AS klant_naam, v.naam AS vertegenw_naam
FROM orders o
JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN vertegenwoordigers v ON v.code = o.vertegenw_code
WHERE o.id = :id

SELECT * FROM order_regels WHERE order_id = :id ORDER BY regelnummer
```

### Prijs opzoeken bij artikelselectie
```
SELECT pr.prijs
FROM prijslijst_regels pr
WHERE pr.prijslijst_nr = :klant_prijslijst_nr
  AND pr.artikelnr = :artikelnr
```

### Order aanmaken (insert)
```
INSERT INTO orders (order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
  fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
  afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
  betaler, vertegenw_code, inkooporganisatie, status)
VALUES (volgend_nummer('ORD'), :debiteur_nr, CURRENT_DATE, ...)
RETURNING id, order_nr

-- Dan per regel:
INSERT INTO order_regels (order_id, regelnummer, artikelnr, karpi_code,
  omschrijving, orderaantal, te_leveren, prijs, korting_pct, bedrag, gewicht_kg)
VALUES (:order_id, :regel_nr, ...)
```

## Acceptatiecriteria

### Lezen
1. Orders overzicht laadt en toont orders uit Supabase
2. Status-tabs filteren correct en tonen het juiste aantal
3. Zoeken werkt op order_nr, klantnaam, klant_referentie
4. Paginering werkt (50 orders per pagina)
5. Klikken op een order opent de detail pagina
6. Detail pagina toont alle order-informatie + regels
7. Bedragen zijn geformateerd als € met 2 decimalen
8. Datums zijn geformateerd als DD-MM-YYYY (Nederlandse conventie)
9. Status badges hebben correcte kleuren per status
10. Lege states: "Geen orders gevonden" bij lege resultaten

### Aanmaken
11. "Nieuwe order" knop op overzichtspagina opent het aanmaakformulier
12. Klant-zoeker vindt debiteuren op naam en nummer
13. Bij klantselectie worden adressen en commerciële data automatisch ingevuld
14. Artikelzoeker vindt producten op artikelnr, karpi_code, omschrijving, zoeksleutel
15. Bij artikelselectie wordt de correcte prijs uit de klant-prijslijst ingevuld
16. Orderregels kunnen toegevoegd, verwijderd en bewerkt worden
17. Totalen worden live herberekend bij elke regelwijziging
18. Order opslaan genereert een uniek order_nr en redirect naar detail
19. Validatie: minstens 1 orderregel, klant is verplicht

### Bewerken
20. Bewerken knop op detail pagina opent het bewerkformulier
21. Bestaande data is correct ingevuld
22. Regels kunnen toegevoegd, gewijzigd en verwijderd worden
23. Verzonden/geannuleerde orders zijn niet bewerkbaar
24. Statuswijzigingen worden gelogd

### Acties
25. Status kan gewijzigd worden via dropdown of snelknoppen
26. Order annuleren toont bevestigingsdialoog
27. Order dupliceren maakt een correcte kopie met nieuw nummer

## Edge cases

- Orders zonder regels (mogelijk bij geannuleerde orders) → tabel tonen met "Geen orderregels"
- Orders zonder afleveradres → adresblok weglaten, bij aanmaken verplicht
- Oud_order_nr is optioneel (nieuwe orders hebben het niet)
- Zeer lange klant_referentie → truncaten met tooltip
- Artikel zonder prijs in klant-prijslijst → fallback naar verkoopprijs, dan leeg
- Klant zonder prijslijst → alle prijzen handmatig
- Klant zonder afleveradressen → alleen handmatig adres invullen
- Gelijktijdig bewerken door meerdere gebruikers → optimistic locking via `updated_at` check
- Order met gekoppelde zendingen/facturen bewerken → waarschuwing tonen

## Dependencies

- Spec 05 (frontend core) — layout, routing, Supabase client
- Spec 03 (database) — orders en order_regels tabellen met data
- Spec 07 (debiteuren) — klantnamen en klantpagina links
