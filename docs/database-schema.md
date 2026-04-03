# Database Schema — RugFlow ERP (Supabase/PostgreSQL)

> Dit document is de leesbare referentie voor de database-structuur.
> **Bijwerken na elke tabel/kolom/relatie wijziging.**

## Overzicht

26 tabellen, 6 enums, 5 views, 5 functies. Alle tabellen hebben RLS enabled (fase 1: authenticated = volledige toegang).

---

## Entiteiten-diagram (vereenvoudigd)

```
vertegenwoordigers ──┬── debiteuren ──┬── afleveradressen
                     │                ├── klanteigen_namen ──── kwaliteiten ── collecties
                     │                ├── klant_artikelnummers ── producten ── rollen
                     │                ├── orders ──┬── order_regels
                     │                │            ├── zendingen ── zending_regels
                     │                │            └── facturen ── factuur_regels
                     │                └── samples
                     └── orders

prijslijst_headers ──┬── debiteuren.prijslijst_nr
                     └── prijslijst_regels ── producten

producten ── kwaliteiten ── collecties
rollen ── producten, magazijn_locaties
snijplannen ── order_regels, rollen
confectie_orders ── order_regels, snijplannen, rollen
leveranciers ── inkooporders ── inkooporder_regels ── producten
```

---

## Tabellen

### nummering
Doorlopende nummers per type per jaar.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| type | TEXT PK | 'ORD', 'FACT', 'ZEND', 'SNIJ', 'SAMP', 'INK' |
| jaar | INTEGER PK | Jaar (2026) |
| laatste_nummer | INTEGER | Laatst uitgegeven nummer |

---

### vertegenwoordigers
Sales reps. Code uit orders, naam uit debiteuren.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| code | TEXT UK | "19", "16" etc. |
| naam | TEXT | "Emily Dobbe" etc. |
| email | TEXT | |
| telefoon | TEXT | |
| actief | BOOLEAN | Default true |
| created_at, updated_at | TIMESTAMPTZ | Auto |

---

### collecties
Groepen uitwisselbare kwaliteiten (56 groepen). Bron: aliassen-bestand.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| groep_code | TEXT UK | "x01", "x02" etc. |
| naam | TEXT | "Mirage/Renaissance/Coll" etc. |
| omschrijving | TEXT | |
| actief | BOOLEAN | Default true |
| created_at, updated_at | TIMESTAMPTZ | Auto |

---

### kwaliteiten
Alle 997 kwaliteitscodes (3-4 letters). 170 met collectie, 822 zonder, 5 alleen in klanteigen namen.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| code | TEXT PK | "MIRA", "CISC", "BEAC" etc. |
| collectie_id | BIGINT FK → collecties | NULL als niet in een groep |
| omschrijving | TEXT | Volledige naam |
| created_at | TIMESTAMPTZ | Auto |

**Uitwisselbaarheid:** kwaliteiten met dezelfde collectie_id zijn uitwisselbaar. Query: `SELECT * FROM uitwisselbare_kwaliteiten('VERI')`

---

### magazijn_locaties
Fysieke locaties in het magazijn.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| code | TEXT UK | "A01-R03-P02" (gang-rek-positie) |
| omschrijving | TEXT | |
| type | TEXT | 'rek', 'vloer', 'stellage', 'expeditie' |
| actief | BOOLEAN | Default true |
| created_at | TIMESTAMPTZ | Auto |

---

### debiteuren
Klanten/afnemers. PK = debiteur_nr uit het oude systeem.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| debiteur_nr | INTEGER PK | Uit oud systeem, ook logo-bestandsnaam |
| naam | TEXT | Bedrijfsnaam (uppercase) |
| status | TEXT | 'Actief' of 'Inactief' |
| adres, postcode, plaats, land | TEXT | Hoofdadres |
| telefoon | TEXT | |
| fact_naam, fact_adres, fact_postcode, fact_plaats | TEXT | Factuuradres |
| email_factuur, email_overig, email_2 | TEXT | |
| fax | TEXT | |
| vertegenw_code | TEXT FK → vertegenwoordigers.code | |
| route, rayon, rayon_naam | TEXT | |
| prijslijst_nr | TEXT FK → prijslijst_headers.nr | |
| korting_pct | NUMERIC(5,2) | Debiteurenkorting |
| betaalconditie | TEXT | |
| gratis_verzending | BOOLEAN DEFAULT false | Klant krijgt altijd gratis verzending |
| afleverwijze | TEXT DEFAULT 'Bezorgen' | Standaard afleverwijze (Bezorgen/Afhalen/Franco) |
| inkooporganisatie | TEXT | |
| betaler | INTEGER FK → debiteuren (self-ref) | Betalende partij |
| btw_nummer | TEXT | |
| gln_bedrijf | TEXT | GLN/EAN moederbedrijf |
| tier | TEXT | 'Gold', 'Silver', 'Bronze' (berekend) |
| omzet_ytd, omzet_pct_totaal, gem_omzet_maand | NUMERIC | Berekend/gecached |
| logo_path | TEXT | Pad in Supabase Storage |
| created_at, updated_at | TIMESTAMPTZ | Auto |

---

### afleveradressen
Per debiteur meerdere afleveradressen. adres_nr 0 = hoofdadres.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| debiteur_nr | INTEGER FK → debiteuren | CASCADE DELETE |
| adres_nr | INTEGER | 0 = hoofdadres |
| naam, naam_2 | TEXT | Naam + toevoeging |
| gln_afleveradres | TEXT | GLN voor EDI (10-14 cijfers) |
| adres, postcode, plaats, land | TEXT | |
| telefoon, email, email_2 | TEXT | |
| route | TEXT | |
| vertegenw_code | TEXT FK → vertegenwoordigers.code | |
| UK: (debiteur_nr, adres_nr) | | Unieke combinatie |

---

### prijslijst_headers
Metadata per prijslijst.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| nr | TEXT PK | "0210", "0101" etc. |
| naam | TEXT | "BENELUX PER 16.03.2026" |
| geldig_vanaf | DATE | |
| actief | BOOLEAN | Default true |

---

### prijslijst_regels
Artikelprijzen per prijslijst.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| prijslijst_nr | TEXT FK → prijslijst_headers | CASCADE DELETE |
| artikelnr | TEXT FK → producten | |
| ean_code, omschrijving, omschrijving_2 | TEXT | |
| prijs | NUMERIC(10,2) | |
| gewicht | NUMERIC(8,2) | |
| UK: (prijslijst_nr, artikelnr) | | |

---

### producten
Artikelen uit het oude systeem.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| artikelnr | TEXT PK | |
| karpi_code | TEXT | Volledige code (kwaliteit+kleur+afmeting) |
| ean_code | TEXT | EAN barcode |
| omschrijving, vervolgomschrijving | TEXT | |
| voorraad, backorder, gereserveerd, besteld_inkoop, vrije_voorraad | INTEGER | |
| kwaliteit_code | TEXT FK → kwaliteiten | |
| kleur_code | TEXT | Eerste 2 cijfers uit karpi_code |
| zoeksleutel | TEXT | kwaliteit_code + "_" + kleur_code |
| inkoopprijs, verkoopprijs | NUMERIC(10,2) | |
| gewicht_kg | NUMERIC(8,2) | |
| product_type | TEXT | 'vast' (CA:NNNxNNN >= 1m²), 'staaltje' (CA:NNNxNNN < 1m²), 'rol' (BREED), 'overig' |
| locatie | TEXT | Magazijnlocatie (bijv. "A.01.L", "C.04.H"). Bron: Locaties123.xls |
| actief | BOOLEAN | Default true |

---

### rollen
Individuele fysieke tapijtrol. Elk met uniek rolnummer.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| rolnummer | TEXT UK | Uniek per rol |
| artikelnr | TEXT FK → producten | 100% overlap geverifieerd |
| karpi_code, omschrijving | TEXT | |
| lengte_cm, breedte_cm | INTEGER | |
| oppervlak_m2 | NUMERIC(10,2) | |
| vvp_m2 | NUMERIC(10,2) | Verkoopprijs per m2 |
| waarde | NUMERIC(12,2) | Totale waarde |
| kwaliteit_code | TEXT FK → kwaliteiten | Gedenormaliseerd |
| kleur_code, zoeksleutel | TEXT | |
| status | TEXT | 'beschikbaar', 'gereserveerd', 'verkocht', 'gesneden', 'reststuk' |
| locatie_id | BIGINT FK → magazijn_locaties | |

---

### klanteigen_namen
Klanten geven kwaliteiten eigen namen. Key = debiteur_nr + kwaliteit_code (NIET artikelnr!).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| debiteur_nr | INTEGER FK → debiteuren | CASCADE DELETE |
| kwaliteit_code | TEXT FK → kwaliteiten | |
| benaming | TEXT | Eigen naam (bijv. "BREDA" voor BEAC) |
| omschrijving | TEXT | |
| leverancier | TEXT | |
| UK: (debiteur_nr, kwaliteit_code) | | |

---

### klant_artikelnummers
Eigen artikelnummers per klant voor pakbonnen/facturen.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| debiteur_nr | INTEGER FK → debiteuren | CASCADE DELETE |
| artikelnr | TEXT FK → producten | |
| klant_artikel | TEXT | Nummer dat de klant gebruikt |
| omschrijving, vervolg | TEXT | |
| UK: (debiteur_nr, artikelnr) | | |

---

### orders
Orderheaders. Adressen zijn snapshots (niet FK naar afleveradressen).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| order_nr | TEXT UK | ORD-2026-0001 (gegenereerd) |
| oud_order_nr | BIGINT UK | Uit oud systeem (nullable) |
| debiteur_nr | INTEGER FK → debiteuren | |
| klant_referentie | TEXT | |
| orderdatum | DATE | |
| afleverdatum | DATE | |
| week | TEXT | |
| fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land | TEXT | Snapshot |
| afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land | TEXT | Snapshot |
| betaler | INTEGER FK → debiteuren | |
| vertegenw_code | TEXT FK → vertegenwoordigers.code | |
| inkooporganisatie | TEXT | |
| status | order_status | Default 'Nieuw' |
| compleet_geleverd | BOOLEAN | |
| aantal_regels, totaal_bedrag, totaal_gewicht | NUMERIC | Berekend door trigger |

---

### order_regels
Productregels per order. artikelnr nullable voor service-items.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| order_id | BIGINT FK → orders | CASCADE DELETE |
| regelnummer | INTEGER | |
| artikelnr | TEXT FK → producten | Nullable |
| karpi_code, omschrijving, omschrijving_2 | TEXT | |
| orderaantal, te_leveren, backorder, te_factureren, gefactureerd | INTEGER | |
| prijs | NUMERIC(10,2) | |
| korting_pct | NUMERIC(5,2) | |
| bedrag | NUMERIC(12,2) | |
| gewicht_kg | NUMERIC(8,2) | |
| is_inkooporder | BOOLEAN | |
| oud_inkooporder_nr | BIGINT | |
| vrije_voorraad, verwacht_aantal | NUMERIC | Snapshot |
| volgende_ontvangst | DATE | |
| laatste_bon | DATE | |
| fysiek_artikelnr | TEXT FK → producten | Fysiek te leveren artikel bij substitutie (NULL = zelfde als artikelnr) |
| omstickeren | BOOLEAN | Product moet omgestickerd worden naar bestelde naam (default false) |
| UK: (order_id, regelnummer) | | |

---

### facturen
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| factuur_nr | TEXT UK | FACT-2026-0001 |
| order_id | BIGINT FK → orders | |
| debiteur_nr | INTEGER FK → debiteuren | |
| factuurdatum, vervaldatum | DATE | |
| status | factuur_status | Default 'Concept' |
| subtotaal, btw_percentage, btw_bedrag, totaal | NUMERIC | |
| fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land | TEXT | Snapshot |
| opmerkingen | TEXT | |

### factuur_regels
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| factuur_id | BIGINT FK → facturen | CASCADE DELETE |
| order_regel_id | BIGINT FK → order_regels | |
| omschrijving | TEXT | |
| aantal | INTEGER | |
| prijs, korting_pct, bedrag, btw_percentage | NUMERIC | |

---

### zendingen
Fysieke leveringen.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| zending_nr | TEXT UK | ZEND-2026-0001 |
| order_id | BIGINT FK → orders | |
| status | zending_status | Default 'Gepland' |
| verzenddatum | DATE | |
| track_trace | TEXT | |
| afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land | TEXT | Snapshot |
| totaal_gewicht_kg | NUMERIC | |
| aantal_colli | INTEGER | |
| opmerkingen | TEXT | |

### zending_regels
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| zending_id | BIGINT FK → zendingen | CASCADE DELETE |
| order_regel_id | BIGINT FK → order_regels | |
| artikelnr | TEXT FK → producten | |
| rol_id | BIGINT FK → rollen | Optioneel |
| aantal | INTEGER | |

---

### snijplannen
Tapijt op maat snijden uit rollen.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| snijplan_nr | TEXT UK | SNIJ-2026-0001 |
| order_regel_id | BIGINT FK → order_regels | |
| rol_id | BIGINT FK → rollen | |
| lengte_cm, breedte_cm | INTEGER | Snijinstructies |
| status | snijplan_status | Default 'Gepland' |
| gesneden_datum | DATE | |
| opmerkingen | TEXT | |

---

### confectie_orders
Nabewerking: overzomen, backing, binden.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| confectie_nr | TEXT UK | |
| order_regel_id | BIGINT FK → order_regels | |
| snijplan_id | BIGINT FK → snijplannen | |
| rol_id | BIGINT FK → rollen | |
| type_bewerking | TEXT | "overzomen", "backing", "binden" |
| instructies | TEXT | |
| status | confectie_status | Default 'Wacht op materiaal' |
| gereed_datum | DATE | |
| opmerkingen | TEXT | |

---

### samples
Stalen/monsters.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| sample_nr | TEXT UK | SAMP-2026-0001 |
| debiteur_nr | INTEGER FK → debiteuren | |
| artikelnr | TEXT FK → producten | |
| omschrijving | TEXT | |
| status | TEXT | 'Aangevraagd', 'In voorbereiding', 'Verzonden', 'Geannuleerd' |
| verzenddatum | DATE | |
| opmerkingen | TEXT | |

---

### leveranciers
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| naam | TEXT | |
| adres, postcode, plaats, land | TEXT | |
| contactpersoon, telefoon, email | TEXT | |
| betaalconditie | TEXT | |
| actief | BOOLEAN | |

### inkooporders
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| inkooporder_nr | TEXT UK | INK-2026-0001 |
| leverancier_id | BIGINT FK → leveranciers | |
| besteldatum, verwacht_datum | DATE | |
| status | inkooporder_status | Default 'Concept' |
| opmerkingen | TEXT | |

### inkooporder_regels
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| inkooporder_id | BIGINT FK → inkooporders | CASCADE DELETE |
| artikelnr | TEXT FK → producten | |
| aantal | INTEGER | |
| inkoopprijs | NUMERIC(10,2) | |
| ontvangen | INTEGER | Default 0 |

---

### activiteiten_log
Audit trail: wie heeft wat wanneer gedaan.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| tabel | TEXT | Tabelnaam |
| record_id | TEXT | ID van het record |
| actie | TEXT | 'aangemaakt', 'gewijzigd', 'verwijderd' |
| wijzigingen | JSONB | {"veld": {"oud": x, "nieuw": y}} |
| gebruiker_id | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | |

---

## Enums

| Enum | Waarden |
|------|---------|
| order_status | Nieuw, Actie vereist, Wacht op picken, Wacht op voorraad, In snijplan, In productie, Deels gereed, Klaar voor verzending, Verzonden, Geannuleerd |
| zending_status | Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd |
| factuur_status | Concept, Verstuurd, Betaald, Herinnering, Aanmaning, Gecrediteerd |
| snijplan_status | Gepland, In productie, Gereed, Geannuleerd |
| inkooporder_status | Concept, Besteld, Deels ontvangen, Ontvangen, Geannuleerd |
| confectie_status | Wacht op materiaal, In productie, Kwaliteitscontrole, Gereed, Geannuleerd |

---

## Views

| View | Doel |
|------|------|
| producten_overzicht | Producten + rollen-aggregatie (aantal_rollen, oppervlak, waarde) + locatie |
| dashboard_stats | Aggregaties: producten, rollen, waarde, marge, open orders, klanten |
| klant_omzet_ytd | Per klant: omzet YTD, % totaal, gem/maand, tier, vertegenwoordiger |
| rollen_overzicht | Per kwaliteit/kleur: aantal, oppervlak, waarde |
| recente_orders | Laatste 50 orders met klantnaam |
| orders_status_telling | Aantal per order_status |

---

## Functies

| Functie | Doel |
|---------|------|
| `update_updated_at()` | Trigger: auto-update updated_at |
| `volgend_nummer(type TEXT)` | Geeft ORD-2026-0001, FACT-2026-0001, etc. |
| `uitwisselbare_kwaliteiten(code TEXT)` | Alle kwaliteiten in dezelfde collectie |
| `herbereken_klant_tiers()` | Gold (top 10%), Silver (top 30%), Bronze (rest) |
| `update_order_totalen()` | Trigger: herbereken order bedrag/gewicht/regels |
| `herbereken_product_reservering(artikelnr TEXT)` | Herbereken gereserveerd + vrije_voorraad voor één product op basis van actieve orders |
| `update_reservering_bij_orderregel()` | Trigger: bij INSERT/UPDATE/DELETE op order_regels → herbereken reservering |
| `update_reservering_bij_order_status()` | Trigger: bij statuswijziging order → herbereken reservering alle producten in die order |
| `zoek_equivalente_producten(artikelnr TEXT, min_voorraad INTEGER)` | Zoekt producten met dezelfde collectie + kleur_code die op voorraad zijn (substitutie-suggesties) |

---

## Storage

| Bucket | Doel | Toegang |
|--------|------|---------|
| logos | Klantlogo's ({debiteur_nr}.jpg) | Publiek lezen, auth upload/delete |
