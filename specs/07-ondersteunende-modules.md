# Spec: Ondersteunende Modules (Debiteuren, Producten, Dashboard)

## Wat dit oplost

De orders-module verwijst naar klanten en producten. Die moeten minstens als leesbare overzichten bestaan. Daarnaast is het dashboard de landingspagina en moet minimaal statistieken tonen.

## Module 1: Debiteuren/Klanten

### Klanten Overzicht (`/klanten`)

**Functionaliteit:**
- Grid/kaart-weergave van klanten (inspiratie: klanten.html mockup)
- Per klant: logo, naam, tier badge (Gold/Silver/Bronze), status, omzet YTD
- Zoeken op naam, debiteur_nr, plaats
- Filteren op: status (Actief/Inactief), tier, vertegenwoordiger
- Sorteren op: naam, omzet, tier

**Data source:** `klant_omzet_ytd` view (bevat alles wat nodig is)

### Klant Detail (`/klanten/:id`)

**Functionaliteit:**
- Header: logo, naam, debiteur_nr, status badge, tier badge
- Tabs:
  - **Info**: contactgegevens, factuuradres, commerciële data (vertegenw, prijslijst, korting, conditie)
  - **Afleveradressen**: lijst van alle afleveradressen
  - **Orders**: orders van deze klant (hergebruik orders-tabel component)
  - **Klanteigen namen**: welke kwaliteiten noemt deze klant hoe
  - **Artikelnummers**: klant-specifieke artikelnummers

**Data source:** `debiteuren` + `afleveradressen` + `orders` + `klanteigen_namen` + `klant_artikelnummers`

### Logo's

- Logo's staan in Supabase Storage bucket `logos`
- URL: `{supabase_url}/storage/v1/object/public/logos/{debiteur_nr}.jpg`
- Fallback bij geen logo: initialen-avatar (eerste letters van de naam)

## Module 2: Producten

### Producten Overzicht (`/producten`)

**Functionaliteit:**
- Tabel met producten (inspiratie: producten.html mockup)
- Kolommen: artikelnr, karpi_code, omschrijving, kwaliteit, voorraad, vrije voorraad, prijs
- Zoeken op: artikelnr, karpi_code, omschrijving, EAN, zoeksleutel
- Filteren op: kwaliteit_code, collectie
- Voorraad-indicatoren: groen (>10), oranje (1-10), rood (0)

**Data source:** `producten` JOIN `kwaliteiten` LEFT JOIN `collecties`

### Product Detail (`/producten/:id`)

**Functionaliteit:**
- Header: artikelnr, omschrijving, kwaliteit, collectie
- Voorraadblok: voorraad, backorder, gereserveerd, besteld, vrije voorraad
- Rollen tabel: alle individuele rollen van dit product (rolnummer, afmetingen, waarde, status)
- Prijzen: in welke prijslijsten zit dit product (met prijs per lijst)

**Data source:** `producten` + `rollen` + `prijslijst_regels` JOIN `prijslijst_headers`

## Module 3: Dashboard

### Dashboard (`/` = landingspagina)

**Functionaliteit (inspiratie: dashboard.html mockup):**
- Statistiek-kaarten:
  - Open orders (aantal + bedrag)
  - Actie vereist (urgent)
  - Voorraadwaarde (inkoop + verkoop)
  - Beschikbare rollen
  - Actieve klanten
  - Gemiddelde marge %
- Recente orders tabel (laatste 10-15)
- Quick actions: "Bekijk orders", "Zoek klant", etc.

**Data source:** `dashboard_stats` view + `recente_orders` view

## Acceptatiecriteria

### Debiteuren
1. Klanten overzicht laadt en toont klanten met logo's/initialen
2. Tier badges (Gold/Silver/Bronze) zijn visueel onderscheidbaar
3. Zoeken en filteren werken correct
4. Detail pagina toont alle tabs met correcte data
5. Klikken vanuit een order naar een klant werkt

### Producten
1. Producten overzicht laadt en toont producten met voorraad-indicatoren
2. Zoeken op zoeksleutel werkt (bijv. "CISC_21" vindt alle Cisco kleur 21)
3. Detail pagina toont rollen en prijzen
4. Klikken vanuit een orderregel naar een product werkt

### Dashboard
1. Dashboard laadt en toont actuele statistieken uit de database
2. Statistiek-kaarten zijn klikbaar en navigeren naar de relevante pagina
3. Recente orders tabel toont de laatste orders

## Edge cases

- Klant zonder logo → initialen-avatar
- Klant zonder orders → "Nog geen orders" in de orders-tab
- Product zonder rollen → "Geen rollen beschikbaar"
- Dashboard bij lege database → alle waarden op 0, geen errors

## Dependencies

- Spec 05 (frontend core) — layout, routing
- Spec 06 (orders) — orders-tabel component wordt hergebruikt in klant detail
- Spec 03 (database) — views moeten bestaan
- Spec 04 (import) — data moet geïmporteerd zijn voor zinvolle weergave
