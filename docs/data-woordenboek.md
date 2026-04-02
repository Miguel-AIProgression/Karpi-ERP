# Data-woordenboek — RugFlow ERP

Domeinbegrippen die je moet kennen om dit project te begrijpen.

## Klanten & Commercieel

| Term | Betekenis |
|------|-----------|
| **Debiteur** | Klant/afnemer. Geïdentificeerd door `debiteur_nr` (INTEGER). |
| **Afleveradres** | Leveradres van een debiteur. Adres_nr 0 = hoofdadres, 1+ = extra adressen. |
| **Vertegenwoordiger** | Sales representative. In debiteuren opgeslagen als naam, in orders als code. De vertegenwoordigers-tabel koppelt beide. |
| **Betaler** | Debiteur die de factuur betaalt. Kan afwijken van de besteller (self-reference in debiteuren). |
| **Tier** | Klantwaarde-classificatie: Gold (top 10% omzet), Silver (top 30%), Bronze (rest). Berekend via `herbereken_klant_tiers()`. |
| **GLN** | Global Location Number. 13-cijferige code voor bedrijfslocaties (niet voor producten). Staat in debiteuren als `gln_bedrijf`. |
| **GLN afleveradres** | GLN specifiek voor een afleveradres. Gebruikt voor EDI-bestellingen. |
| **Prijslijst** | Per klant een prijslijst (header + regels). Bepaalt welke prijs een klant betaalt per artikel. |
| **Betaalconditie** | Betalingstermijn, bijv. "30 dagen netto". |
| **Inkooporganisatie** | Centrale inkoper waar de klant onder valt. |

## Producten & Voorraad

| Term | Betekenis |
|------|-----------|
| **Artikelnr** | Unieke productcode (TEXT). PK in producten-tabel. |
| **Karpi-code** | Samengestelde code: kwaliteit + kleur + afmetingen. Bijv. `CISC21XX160230`. |
| **Kwaliteit** | Tapijtsoort, gecodeerd in 3-4 letters. Bijv. CISC = Cisco, BEAC = Beach Life, MIRA = Mirage. |
| **Kwaliteitscode** | De 3-4 letter code. Eerste letters uit de karpi_code. |
| **Kleur-code** | Eerste 2 cijfers uit de karpi_code na de kwaliteitscode. |
| **Zoeksleutel** | kwaliteit_code + "_" + kleur_code. Bijv. "CISC_21". Gebruikt voor gecombineerd zoeken. |
| **Collectie** | Groep van uitwisselbare kwaliteiten. Bijv. collectie "Vernissage/Lago" bevat VERI, LAGO, GLOR, etc. 56 groepen, 170 codes. |
| **Uitwisselbaar** | Kwaliteiten in dezelfde collectie zijn uitwisselbaar = hetzelfde type tapijt, andere variant. |
| **Rol** | Individuele fysieke tapijtrol in het magazijn. Elke rol heeft een uniek `rolnummer`, specifieke afmetingen en waarde. |
| **Rolnummer** | Unieke identifier per fysieke rol. |
| **VVP** | Verkoopprijs per vierkante meter (Verkoop Vaste Prijs per m2). |
| **Vrije voorraad** | Voorraad minus gereserveerd minus backorder + besteld inkoop. Wat daadwerkelijk beschikbaar is. |
| **Reststuk** | Overgebleven stuk na het snijden van een rol. Heeft status 'reststuk'. |

## Orders & Operationeel

| Term | Betekenis |
|------|-----------|
| **Order** | Klantopdracht. Bevat header (klant, data, adressen) en regels (producten). |
| **Orderregel** | Eén productregel in een order. Bevat artikel, aantal, prijs, korting. |
| **Klant referentie** | Referentie die de klant meegeeft bij een bestelling. Bijv. "BRINK (18)", "#5435/16260113785". |
| **Adres-snapshot** | Kopie van het adres op het moment van de order. Latere adreswijzigingen raken de order niet. |
| **Snijplan** | Instructie om tapijt op maat te snijden uit een rol voor een orderregel. |
| **Confectie** | Nabewerking na het snijden: overzomen, backing, binden. |
| **Zending** | Fysieke levering. Kan producten uit meerdere orderregels bevatten. |
| **Sample/staal** | Monster van een product, verstuurd naar een klant. |
| **Backorder** | Besteld maar niet op voorraad; wacht op levering van leverancier. |

## Systeem

| Term | Betekenis |
|------|-----------|
| **Nummering** | Automatische doorlopende nummers per type per jaar. Format: TYPE-JAAR-VOLGNR (bijv. ORD-2026-0001). |
| **RLS** | Row Level Security. Supabase/PostgreSQL feature die toegang per rij regelt. |
| **Activiteiten_log** | Audit trail: wie heeft wat wanneer gewijzigd. Wijzigingen als JSONB. |
