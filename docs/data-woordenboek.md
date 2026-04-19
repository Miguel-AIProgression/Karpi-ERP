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
| **Standaard levertermijn** | Twee aparte getallen: `standaard_maat_werkdagen` (default 5, kalenderdagen, voor karpetten uit voorraad) en `maatwerk_weken` (default 4, voor gesneden+geconfectioneerde karpetten). Globale defaults in `app_config.order_config`; per klant overschrijfbaar. Order-afleverdatum wordt automatisch berekend als max van beide typen in de order. |
| **Deelleveringen** | Per klant boolean (`debiteuren.deelleveringen_toegestaan`, default FALSE). Als TRUE en een order bevat zowel standaard-maat als maatwerk regels: bij aanmaken wordt de order opgesplitst in 2 losse orders — één met de standaard-regels (korte levertermijn) en één met de maatwerk-regels (lange levertermijn). Verzendkosten-regel gaat mee met de standaard-order. |
| **Verzameldebiteur** | Debiteuren-rij die een groep externe eindklanten vertegenwoordigt. Voor webshop-orders gebruikt RugFlow de bestaande **debiteur 260000 "FLOORPASSION"** — particuliere kopers krijgen geen eigen debiteuren-rij, hun naam/adres landt in de `afl_*`-snapshotvelden op de order. (Synthetische rij 99001 uit migratie 091 is niet in productie: keuze viel op 260000 om aan te sluiten bij het oude systeem.) |
| **Webshop-order** | Order die automatisch is aangemaakt door de Lightspeed webhook-integratie (of via batch-import uit het oude systeem). Herkenbaar aan `orders.bron_systeem = 'lightspeed'`. Valt onder debiteur 260000; de shop van herkomst staat in `bron_shop` (`floorpassion_nl` / `floorpassion_de`). |
| **Bron-systeem** | Veld `orders.bron_systeem` dat aangeeft waar een order vandaan komt. NULL = handmatig in RugFlow aangemaakt. Bekende externe bronnen: `'lightspeed'` (Floorpassion webshops). Toekomstig mogelijk: `'edi'`, `'marketplace'`. Samen met `bron_order_id` uniek voor idempotentie bij webhook-retries. |
| **Unmatched-regel** | Orderregel waar geen `artikelnr` aan kon worden gekoppeld. Herkenbaar aan een prefix in `omschrijving`: `[UNMATCHED]` (onbekend), `[STAAL]` (gratis muster/sample), `[MAATWERK]` (Wunschgröße / op maat / volgens tekening), `[MAATWERK-ROND]` (ronde maatwerk met diameter). Order krijgt `heeft_unmatched_regels = TRUE`, wat in de orderlijst als actie-vereist-badge zichtbaar moet worden. |
| **`heeft_unmatched_regels`** | Boolean-vlag op `orders`. TRUE zodra minstens 1 regel `artikelnr IS NULL` heeft. Automatisch onderhouden door trigger op `order_regels` (migratie 094) + expliciete set in `create_webshop_order` RPC. Index `orders_heeft_unmatched_idx` voor snel filteren van review-orders. |

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
| **Volle rol** | Rol met standaard breedte én volledige lengte. `rol_type = 'volle_rol'`. Standaard breedte komt primair uit `kwaliteiten.standaard_breedte_cm` (bron van waarheid sinds migratie 086), fallback op laatste 3 cijfers artikelnr, daarna 400 cm. |
| **Aangebroken rol** | Rol met standaard breedte maar reeds aangesneden (kortere lengte, ≥100 cm). Ontstaat na `voltooi_snijplan_rol()`. `rol_type = 'aangebroken'`, `status = 'beschikbaar'`. |
| **Reststuk** | Rol met afwijkende (smallere) breedte t.o.v. standaard, óf met lengte <100 cm. `rol_type = 'reststuk'`. Classificatie gebeurt automatisch via trigger o.b.v. `bereken_rol_type()`. |
| **Standaard rolbreedte** | Per kwaliteit vastgelegd in `kwaliteiten.standaard_breedte_cm`. Voorbeelden: 400 cm (default, CISC/GALA/VERR/…), 320 cm (OASI/NOMA/RUBI/CAVA/EMIR/…), 200 cm (DUBE/VETB/CLAS), 147-180 cm (BUX-serie lopers), 160 cm (BEAC/BEAB), 500 cm (CROW). |
| **Artikelnr-codering** | Veel (niet alle) Karpi-artikelnummers volgen: 4 letters (kwaliteit) + 2 cijfers (kleur) + 3 cijfers (breedte in cm). Voorbeeld: `CISC12400` = CISC kwaliteit, kleur 12, breedte 400 cm. Voor kwaliteiten zonder dit suffix (OASI-serie e.d.) geldt uitsluitend `kwaliteiten.standaard_breedte_cm`. |

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
| **Maatwerk** | Orderregel die snijden en/of confectie vereist (is_maatwerk = true). Bevat lengte, breedte, afwerking en instructies. |
| **Productie_groep** | Groeperingssleutel voor snijplanning: kwaliteit + kleur. Alle maatwerk-regels met dezelfde productie_groep kunnen uit dezelfde rol gesneden worden. |
| **Scancode** | Unieke code op barcode/QR-sticker, gekoppeld aan een snijplan of confectie-order. Gegenereerd via `genereer_scancode()`. Wordt gescand op elk werkstation. |
| **Reststuk** | Overgebleven stuk na het snijden van een rol. Wordt automatisch aangemaakt via `maak_reststuk()` met eigen rolnummer, gekoppeld aan oorsprong_rol_id. |
| **Snijvoorstel** | Visuele weergave (SVG) van hoe stukken op een rol geplaatst worden. Gebruikt strip-packing algoritme met positie_x/positie_y. |
| **Strip-packing** | 2D-inpakalgoritme dat stukken zo efficient mogelijk op een rol plaatst. Minimaliseert verspilling. |
| **Scan_event** | Registratie van een individuele barcode/QR-scan: wie, wanneer, welk station, welke actie. Opgeslagen in `scan_events` tabel. |
| **Voorraad_mutatie** | Logboekregel van een voorraadwijziging op een rol (gesneden, reststuk aangemaakt, correctie). Opgeslagen in `voorraad_mutaties` tabel. |

## Systeem

| Term | Betekenis |
|------|-----------|
| **Nummering** | Automatische doorlopende nummers per type per jaar. Format: TYPE-JAAR-VOLGNR (bijv. ORD-2026-0001). |
| **RLS** | Row Level Security. Supabase/PostgreSQL feature die toegang per rij regelt. |
| **Activiteiten_log** | Audit trail: wie heeft wat wanneer gewijzigd. Wijzigingen als JSONB. |
