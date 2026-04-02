# Spec: Vertegenwoordigers Module

## Wat dit oplost

Karpi heeft vertegenwoordigers (sales reps) die klanten beheren. Er is nu geen inzicht in prestaties per rep: wie genereert de meeste omzet, hoeveel open orders staan er, hoe verdeelt de omzet zich over het jaar. Deze module geeft dat overzicht.

## Module: Vertegenwoordigers

### Vertegenwoordigers Overzicht (`/vertegenwoordigers`)

**Functionaliteit:**
- Tabel met alle vertegenwoordigers, standaard gesorteerd op omzet (hoogste eerst)
- Kolommen: ranking (#), code, naam, omzet, % van totaal, aantal klanten, tier-verdeling (Gold/Silver/Bronze), open orders, gem. orderwaarde
- Sorteerbaar op: omzet, naam, aantal klanten, open orders
- Periodefilter: YTD (default), Q1, Q2, Q3, Q4

**Periodefilter werking:**
- YTD: aggregeert alle orders van 1 jan t/m vandaag van het lopende jaar
- Q1/Q2/Q3/Q4: aggregeert orders binnen dat kwartaal van het lopende jaar
- Filter wijzigt omzet-kolommen, open orders telt altijd alle actieve statussen ongeacht periode

**Omzet berekening:**
- Per vertegenwoordiger: SUM van `totaal_bedrag` uit orders waar `vertegenw_code` matcht
- Datumfilter op `orderdatum` van de order
- Percentage: (omzet rep / totale omzet alle reps) * 100

**Tier-verdeling:**
- Compact weergegeven als "G:5 S:12 B:17" (Gold/Silver/Bronze count)
- Gebaseerd op `tier` veld uit `klant_omzet_ytd` view

**Open orders:**
- Count van orders met status in ('Nieuw', 'Wacht op voorraad', 'In behandeling', 'Klaar voor verzending')
- Altijd actueel, niet beperkt door periodefilter

**Data sources:**
- `vertegenwoordigers` tabel (naam, code, email, telefoon, actief)
- `orders` tabel (omzet aggregatie per vertegenw_code, gefilterd op orderdatum)
- `klant_omzet_ytd` view (tier-verdeling, aantal klanten per rep)

### Vertegenwoordiger Detail (`/vertegenwoordigers/:code`)

**Header:**
- Naam, code, email, telefoon
- Stat-kaarten: Omzet YTD, Aantal klanten, Open orders, Gem. orderwaarde

**Omzet trend (CSS mini-bars):**
- Horizontale staafjes per maand (jan t/m huidige maand)
- Breedte proportioneel aan hoogste maand
- Bedrag rechts naast elke bar
- Geen externe chart library; puur CSS/Tailwind

**Tabs:**

#### Tab: Klanten
- Tabel met alle klanten van deze vertegenwoordiger
- Kolommen: debiteur_nr, naam, tier badge, omzet YTD, aantal orders, plaats
- Sorteerbaar op: omzet (default desc), naam
- Klik op klant navigeert naar `/klanten/:debiteur_nr`

#### Tab: Orders
- Tabel met orders van deze vertegenwoordiger
- Kolommen: order_nr, klant, orderdatum, status, totaal bedrag
- Standaard gesorteerd op orderdatum (nieuwste eerst)
- Filter op status (Alle / Open / Afgerond)
- Klik op order navigeert naar `/orders/:id`

**Data sources:**
- `vertegenwoordigers` (header info)
- `orders` (omzet per maand, orders tab)
- `klant_omzet_ytd` (klanten tab met omzet en tier)

## Acceptatiecriteria

### Overzicht
1. Tabel toont alle vertegenwoordigers met correcte omzet berekend uit orders
2. Ranking nummering klopt (1, 2, 3...) gebaseerd op gesorteerde omzet
3. Periodefilter (YTD/Q1-Q4) past omzetcijfers aan maar niet open orders count
4. Sorteerkolommen werken correct
5. % van totaal telt op tot ~100% (afrondingsverschillen OK)
6. Tier-verdeling matcht werkelijk aantal klanten per tier
7. Klik op rij navigeert naar detail pagina

### Detail
1. Header toont correcte contactgegevens en summary stats
2. Omzet trend bars zijn proportioneel correct (hoogste maand = volle breedte)
3. Klanten tab toont alle gekoppelde klanten met hun omzet
4. Orders tab toont alle orders van deze rep
5. Orders tab filter op status werkt
6. Links naar klanten en orders navigeren correct

## Edge cases

- Vertegenwoordiger zonder klanten: "Geen klanten gekoppeld" in klanten tab
- Vertegenwoordiger zonder orders: omzet = 0, lege orders tab, lege trend
- Kwartaal zonder orders: omzet = 0 voor dat kwartaal
- Inactieve vertegenwoordiger: toon in tabel maar met visuele indicatie (grijze tekst of badge)
- Alle orders geannuleerd: omzet = 0 (geannuleerde orders tellen niet mee)
- "Niet van Toepassing" vertegenwoordiger: toon normaal in lijst (is een valide record)

## Dependencies

- Spec 03 (database) — vertegenwoordigers tabel, orders tabel, klant_omzet_ytd view
- Spec 05 (frontend core) — layout, routing, PageHeader, StatusBadge
- Spec 07 (debiteuren module) — klant-detail pagina voor doorlinks
- Spec 06 (orders module) — order-detail pagina voor doorlinks

## Technische notities

- Omzet aggregatie: direct op orders tabel met GROUP BY + datumfilter, NIET via klant_omzet_ytd (die is alleen YTD en niet filterbaar per periode)
- Maandelijkse trend: GROUP BY EXTRACT(MONTH FROM orderdatum) op orders tabel
- Open orders count: aparte query zonder datumfilter, alleen status filter
- CSS mini-bars: Tailwind width percentages (style={{ width: `${pct}%` }})
- Bestanden klein houden: overzicht en detail als aparte page components, trend en tabs als eigen componenten
