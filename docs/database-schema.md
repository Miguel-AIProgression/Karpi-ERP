# Database Schema — RugFlow ERP (Supabase/PostgreSQL)

> Dit document is de leesbare referentie voor de database-structuur.
> **Bijwerken na elke tabel/kolom/relatie wijziging.**

## Overzicht

44 tabellen, 9 enums, 18 views, 37 functies. Alle tabellen hebben RLS enabled (fase 1: authenticated = volledige toegang).

---

## Entiteiten-diagram (vereenvoudigd)

```
vertegenwoordigers ──┬── debiteuren ──┬── afleveradressen
                     │                ├── klanteigen_namen ──── kwaliteiten ── collecties
                     │                ├── klant_artikelnummers ── producten ── rollen
                     │                ├── orders ──┬── order_regels
                     │                │            ├── zendingen ── zending_regels ── hst_transportorders
                     │                │            └── facturen ── factuur_regels
                     │                ├── edi_handelspartner_config ── vervoerders
                     │                └── samples
                     └── orders

prijslijst_headers ──┬── debiteuren.prijslijst_nr
                     └── prijslijst_regels ── producten

producten ── kwaliteiten ── collecties
rollen ── producten, magazijn_locaties
snijplannen ── order_regels, rollen
snijvoorstellen ── kwaliteiten
snijvoorstel_plaatsingen ── snijvoorstellen, snijplannen, rollen
confectie_orders ── order_regels, snijplannen, rollen
leveranciers ── inkooporders ── inkooporder_regels ── producten

maatwerk_vormen ── order_regels.maatwerk_vorm
afwerking_types ── order_regels.maatwerk_afwerking
                ── kwaliteit_standaard_afwerking ── kwaliteiten
maatwerk_m2_prijzen ── kwaliteiten
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

### medewerkers (was: vertegenwoordigers t/m mig 215)
Interne identity-tabel: vertegenwoordigers, pickers en toekomstige rollen op één tabel met rol-tags. Hernoemd in mig 216 (ADR-0004). FK-target voor `zendingen.picker_id` en `zending_colli.gepickt_door_id` sinds mig 217 (ADR-0005).

Enum `medewerker_rol`: `'vertegenwoordiger' | 'picker'` (uitbreidbaar — magazijnchef, inkoper).

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment, surrogate key |
| code | TEXT UK NULL | 3-4 letter ("19", "16") — alleen vertegenwoordigers; NULL voor pickers |
| naam | TEXT | "Emily Dobbe", "Jan de Vries" |
| email | TEXT NULL | |
| telefoon | TEXT NULL | |
| actief | BOOLEAN | Default true; bepaalt zichtbaarheid in dropdowns |
| rollen | medewerker_rol[] | NOT NULL, default `{}`; multi-rol toegestaan (`{vertegenwoordiger,picker}`) |
| created_at, updated_at | TIMESTAMPTZ | Auto |

Compat-view `vertegenwoordigers` (sinds mig 216) selecteert rijen met `'vertegenwoordiger' = ANY(rollen)`. Pre-mig-216 callers blijven werken zonder code-aanpassing.

FKs `klanten.vertegenw_code` en `orders.vertegenw_code` blijven verwijzen naar `medewerkers.code` (de UNIQUE-kolom is bewaard).

---

### vertegenwoordiger_werkdagen
Werkdagen per vertegenwoordiger (mig 195). Rij aanwezig = werkt die dag.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| vertegenw_code | TEXT FK → medewerkers.code | ON DELETE CASCADE, ON UPDATE CASCADE; FK overleeft tabel-rename |
| dag_van_week | SMALLINT (1-7) | ISO 8601: 1=ma ... 7=zo |
| start_tijd | TIME | NULL = "hele dag" |
| eind_tijd | TIME | NULL = "hele dag" |
| opmerking | TEXT | Vrije tekst (bijv. "thuis", "oneven weken") |
| created_at, updated_at | TIMESTAMPTZ | Auto via trg_set_updated_at |

PK: `(vertegenw_code, dag_van_week)`. CHECK: `start_tijd < eind_tijd` (indien beide gezet).

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
| standaard_breedte_cm | INTEGER | Standaard rolbreedte voor deze kwaliteit. Primaire bron voor `bereken_rol_type()` sinds migratie 086/087. NULL = fallback op artikelnr-heuristiek (laatste 3 cijfers), daarna 400 cm. |
| gewicht_per_m2_kg | NUMERIC(8,3) | **Bron-van-waarheid voor gewicht-density** (kg/m²). Toegevoegd in migratie 184. Drijft `bereken_product_gewicht_kg` + `bereken_orderregel_gewicht_kg` (mig 185). NULL = nog niet ingevuld; producten in deze kwaliteit vallen terug op legacy `producten.gewicht_kg` met flag `gewicht_uit_kwaliteit=false`. |
| goederencode | TEXT | **Mig 446.** CBS/Intrastat-statistieknummer (CN-code, 8 cijfers, bv. `57024200`) — bron-van-waarheid per kwaliteit (niet per artikel: zelfde kwaliteit in verschillende maten deelt 1 code). Gevuld via `import/import_goederencodes.py` uit Alex' export (18-06-2026); 775/1000 kwaliteiten hebben een code, de overige 225 zijn nooit naar het buitenland verkocht (geverifieerd tegen orderhistorie). NULL = onbekend/nog niet ingevuld. Gebruikt op de buitenlandse factuur-PDF (`intracom-statregel.ts` — Stat.nr.-regel, alleen bij `btw_verlegd`) en de CBS-exportview (`cbs_intrastat_export`, mig 448). |
| created_at | TIMESTAMPTZ | Auto |

**Uitwisselbaarheid:** kwaliteiten met dezelfde `collectie_id` zijn uitwisselbaar. Canonieke seam (sinds migratie 138): `SELECT * FROM uitwisselbare_paren('VERI', '15')` — geeft alle (kwaliteit_code, kleur_code)-aliassen terug, incl. zichzelf. Resolver: zelfde `collectie_id` én genormaliseerde kleur-code matcht. Bron-van-waarheid voor snijplanning, order-aanmaak en voorraad-aggregatie. De legacy tabel `kwaliteit_kleur_uitwisselgroepen` (Map1) is een parallel spoor dat fade-out wordt; check dekking via view `uitwisselbaarheid_map1_diff` voordat hij gedropt wordt.

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

> **Verzameldebiteur 900000 'OUD SYSTEEM (PRODUCTIE)'** (mig 327, ADR-0029): fallback-debiteur voor productie-only orders uit Basta waarvan het debiteurnummer niet op een bestaande debiteur matcht.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| debiteur_nr | INTEGER PK | Uit oud systeem, ook logo-bestandsnaam |
| naam | TEXT | Bedrijfsnaam (uppercase) |
| status | TEXT **NOT NULL** | 'Actief' of 'Inactief'. **NOT NULL** (live-DB geverifieerd 2026-06-08 — een insert met NULL faalt met 23502). De gedeelde debiteur-matcher behandelt NULL/≠'Inactief' als actief (`ACTIEF_OR_FILTER`); verzameldebiteur 900000 staat op 'Inactief'. |
| adres, postcode, plaats, land | TEXT | Hoofdadres |
| telefoon | TEXT | |
| fact_naam, fact_adres, fact_postcode, fact_plaats | TEXT | Factuuradres |
| email_factuur, email_overig, email_2 | TEXT | |
| email_verzend | TEXT | Mig 369. Klant-niveau verzend-/T&T-e-mailadres (voorstel Piet-Hein 11-06-2026). Default-ladder voor `orders.afl_email` bij orderaanmaak: `afleveradressen.email` → dit veld → `email_overig`. Gevuld via checkbox "Opslaan als vast verzend-e-mailadres voor deze klant" in het orderformulier of via klant-bewerken. Géén backfill — runtime-fallback. Bij dropshipment-orders geen enkele debiteur-default (mig 370). |
| fax | TEXT | |
| vertegenw_code | TEXT FK → vertegenwoordigers.code | |
| route, rayon, rayon_naam | TEXT | |
| prijslijst_nr | TEXT FK → prijslijst_headers.nr | |
| korting_pct | NUMERIC(5,2) | Debiteurenkorting |
| betaalconditie | TEXT | |
| gratis_verzending | BOOLEAN NOT NULL DEFAULT false | Klant krijgt altijd gratis verzending, ongeacht bundel-totaal vs `verzend_drempel`. Mig 228 (post-hoc — kolom werd al gelezen door frontend, mig 201 had hem overgeslagen). |
| afleverwijze | TEXT DEFAULT 'Bezorgen' | Standaard afleverwijze (Bezorgen/Afhalen) |
| verzendkosten | NUMERIC | Per-klant override verzendkosten (€). Wordt 1× per bundel-zending op de wekelijkse factuur geheven (mig 232). |
| verzend_drempel | NUMERIC | Per-klant drempel gratis verzending (€). Getoetst op het bundel-subtotaal exclusief BTW (mig 229 view + mig 232 factuur-RPC). |
| standaard_maat_werkdagen | INTEGER | Override levertermijn voor standaard-maat karpetten (dagen). NULL = globale default. |
| maatwerk_weken | INTEGER | Override levertermijn voor maatwerk karpetten (weken). NULL = globale default. |
| deelleveringen_toegestaan | BOOLEAN DEFAULT false | Als TRUE: gemengde orders worden bij aanmaken gesplitst in 2 orders (standaard + maatwerk). |
| default_lever_type | lever_type ENUM NOT NULL DEFAULT 'week' | ADR 0014 / mig 244. Voorgevulde `orders.lever_type` bij orderaanmaak. B2C-debiteuren (Floorpassion, particulieren) kunnen standaard op `'datum'` staan. Gebruiker kan per order overschrijven via segmented toggle in order-form. |
| inkoopgroep_code | TEXT FK → inkoopgroepen.code | Inkooporganisatie waaronder de klant inkoopt (1 groep per debiteur). ON UPDATE CASCADE, ON DELETE SET NULL. Vervangt losse TEXT-kolom in mig 189. |
| betaler | INTEGER FK → debiteuren (self-ref) | Betalende partij |
| btw_nummer | TEXT | |
| gln_bedrijf | TEXT | GLN/EAN moederbedrijf |
| tier | TEXT | 'Gold', 'Silver', 'Bronze' (berekend) |
| omzet_ytd, omzet_pct_totaal, gem_omzet_maand | NUMERIC | Berekend/gecached |
| factuurvoorkeur | factuurvoorkeur enum | Default 'per_zending'. 'wekelijks' → verzamelfactuur op maandag. Zie migratie 117. |
| btw_percentage | NUMERIC(5,2) | Default 21.00. Check 0-100. Per klant aan te passen voor EU/export. Zie migratie 117. |
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

### inkoopgroepen
Inkooporganisaties (INKC-codes) waaronder debiteuren samen inkopen — gedeelde prijslijst/korting. 1 debiteur ↔ max 1 groep. Mig 189.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| code | TEXT PK | 'INKC02', 'INKC11', ... — afgeleid uit Excel-bestandsnaam |
| naam | TEXT NOT NULL | 'BEGROS', 'DECOR UNION', 'FACHHANDELSRING', etc. |
| omschrijving | TEXT | Optioneel |
| actief | BOOLEAN DEFAULT true | |
| created_at, updated_at | TIMESTAMPTZ | Auto, trigger `trg_inkoopgroepen_updated_at` |

**View `inkoopgroepen_met_aantal_leden`** — alle kolommen + `aantal_leden INTEGER` (count debiteuren met deze code). Gebruikt door overzichtspagina.

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
| voorraad, backorder, gereserveerd, besteld_inkoop, vrije_voorraad | INTEGER | Sinds migratie 149: `gereserveerd` = SUM van `order_reserveringen.aantal` waar `bron='voorraad'` en `status='actief'`. `vrije_voorraad` = `voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop` meer). |
| kwaliteit_code | TEXT FK → kwaliteiten | |
| kleur_code | TEXT | Eerste 2 cijfers uit karpi_code. **Let op:** fragiel als de leverancier-prefix zelf cijfers bevat (bv. `TAM1` → pakt `11` i.p.v. `13` uit `TAM113400ONG`). Bij nieuwe leveranciers met zulke prefixen: kleur_code handmatig corrigeren of importscript aanpassen (veilig: positie direct na alfabetische prefix). Zie migratie [096](../supabase/migrations/096_tama_kwaliteit_harmoniseren.sql). |
| zoeksleutel | TEXT | kwaliteit_code + "_" + kleur_code |
| inkoopprijs, verkoopprijs | NUMERIC(10,2) | |
| gewicht_kg | NUMERIC(8,2) | **Sinds mig 185 gederiveerde cache; sinds mig 387 AFGEDWONGEN** via BEFORE-trigger `trg_producten_gewicht_derive`: voor `product_type IN ('vast','staaltje')` met maat + kwaliteit-density wordt elke INSERT/UPDATE herleid (vorm-aware: `rond` → `π × (lengte_cm/200)² × density`, anders `(lengte×breedte/10000) × density`) — handmatige waarden worden bewust overschreven; gewicht corrigeren = `kwaliteiten.gewicht_per_m2_kg` aanpassen. Voor 'rol'/'overig' of incomplete data blijft de handmatige/legacy-waarde staan. **Let op (historische bug, gefixt in mig 387):** ~26% van de cache bevatte de density (kg/m²) i.p.v. het stukgewicht. |
| lengte_cm, breedte_cm | INTEGER | Maat in cm voor vaste/staaltje-producten. **Rechthoekig**: geparset uit `karpi_code`-suffix in mig 184 (`^.{8}(\d{3})(\d{3})$`). **Rond** (mig 188): geparset uit `^.{8}(\d{3})RND$` — `lengte_cm = breedte_cm = diameter`. **Ovaal-bbox** (mig 188): geparset uit omschrijving (`NxN cm OVAAL`) als bbox. NULL voor 'rol'/'overig' of afwijkend patroon. Voedt gewicht-resolver. |
| vorm | TEXT | `rechthoek` (default, ook voor ovaal — bbox-aanname) of `rond` (cirkel-oppervlak via `π × (lengte_cm/200)²`). Bepaalt formule in `bereken_product_gewicht_kg`. Mig 188. |
| maatwerk_vorm_code | TEXT FK → maatwerk_vormen(code) | **Logische vormcode** voor de prijs-resolver (mig 191). Onderscheidt `ovaal/organisch_a/organisch_b_sp/pebble/ellips/afgeronde_hoeken` waar `vorm` alleen `rechthoek/rond` kent. Bepaalt vormtoeslag (€0/€75 uit `maatwerk_vormen.toeslag`) bij m²-fallback in `bereken_orderregel_prijs`. NULL = onbekend → resolver behandelt als rechthoek (€0). Backfill via karpi_code-suffix (`RND`/`OVL`) + omschrijving-substring (`ORGANISCH`/`PEBBLE`/`ELLIPS`/`AFGEROND`). Mig 190. |
| gewicht_uit_kwaliteit | BOOLEAN | Default false. TRUE = `gewicht_kg` gederiveerd uit `kwaliteiten.gewicht_per_m2_kg` (cache vers). FALSE = legacy waarde uit oude systeem of kwaliteit heeft nog geen gewicht. UI toont badge "uit oude bron" bij FALSE. Migratie-voortgang-indicator. |
| product_type | TEXT | 'vast' (CA:NNNxNNN >= 1m²), 'staaltje' (CA:NNNxNNN < 1m²), 'rol' (BREED), 'overig' |
| locatie | TEXT | Magazijnlocatie (bijv. "A.01.L", "C.04.H"). Bron: Locaties123.xls |
| actief | BOOLEAN | Default true |
| is_dropship | BOOLEAN | Default false. TRUE op dropshipment-kostenregels (DROPSHIP-KLEIN/GROOT, mig 370): order met zo'n regel gaat rechtstreeks naar de consument — `afl_email` moet dan het consument-adres zijn, nooit het factuur-/debiteur-adres. Predicaat: `is_dropship_order(order_id)`; guard in `fn_zending_fill_email`. |

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
| waarde | NUMERIC(12,2) | Totale inkoopwaarde van de rol. Voor reststuk-rollen aangemaakt vanaf migratie 088: `oppervlak_m2 × bronrol.inkoopprijs_m2`. Oudere reststuk-rollen kunnen NULL zijn. |
| kwaliteit_code | TEXT FK → kwaliteiten | Gedenormaliseerd |
| kleur_code, zoeksleutel | TEXT | |
| status | TEXT | Workflow-status: 'beschikbaar', 'gereserveerd', 'verkocht', 'gesneden', 'reststuk', 'in_snijplan' |
| rol_type | ENUM rol_type | Fysieke classificatie: 'volle_rol', 'aangebroken', 'reststuk'. Automatisch gezet via trigger o.b.v. `bereken_rol_type()`. Standaard breedte komt uit `kwaliteiten.standaard_breedte_cm` (sinds migratie 086/087), fallback op laatste 3 cijfers artikelnr, daarna 400 cm. Lengte <100cm of breedte <standaard → reststuk; gesneden + std breedte + lengte ≥100cm → aangebroken; anders → volle_rol. |
| oorsprong_rol_id | BIGINT FK → rollen (self-ref) | Verwijst naar de originele rol waaruit deze rol is gesneden (aangebroken of reststuk) |
| reststuk_datum | TIMESTAMPTZ | Datum waarop de gesneden rol is aangemaakt. Wordt door `boek_inkooporder_ontvangst_rollen` óók op `NOW()` gezet voor volle IO-rollen (niet alleen reststukken). NIET gebruiken als magazijnleeftijd — zie `in_magazijn_sinds`. Blijft bron voor de net-gesneden-reststuk-filter in `voltooi_snijplan_rol` (`reststuk_datum = CURRENT_DATE`). |
| in_magazijn_sinds | DATE | **Single source of truth voor FIFO-magazijnleeftijd** (ADR-0021, mig 280). Datum waarop dít materiaal fysiek het magazijn binnenkwam. IO-rol → ontvangstdatum (mig 281); reststuk/aangebroken → **erft** van `oorsprong_rol` (reset NIET bij snijden, mig 282); historische/overige → `created_at::date` van het record (mig 287, was sentinel `2000-01-01` in mig 280). Nieuwe rollen zonder expliciete waarde krijgen via trigger `trg_rollen_default_in_magazijn_sinds` `COALESCE(created_at, reststuk_datum, CURRENT_DATE)::date`. NULL → packer behandelt als heel oud. |
| snijden_gestart_op | TIMESTAMPTZ | Timestamp wanneer medewerker "Start met rol" klikte (via `start_snijden_rol`). Voor tijdanalyse snijduur. Migratie 063. |
| snijden_voltooid_op | TIMESTAMPTZ | Timestamp wanneer rol werd afgesloten via `voltooi_snijplan_rol`. Migratie 063. |
| snijden_gestart_door | TEXT | Medewerker die snijden gestart is. Migratie 063. |
| locatie_id | BIGINT FK → magazijn_locaties | |
| inkooporder_regel_id | BIGINT FK → inkooporder_regels | Welke inkooporder-regel deze rol heeft geleverd. NULL voor rollen uit historische voorraad-import. Migratie 127. |

---

### klanteigen_namen
Klanten (of een hele inkoopgroep) geven kwaliteiten eigen namen, eventueel verfijnd per kleur. Resolutie via `resolve_klanteigen_naam(debiteur_nr, kwaliteit, kleur)` — volgorde: klant+kleur > klant+NULL kleur > inkoopgroep+kleur > inkoopgroep+NULL kleur > NULL.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| debiteur_nr | INTEGER FK → debiteuren | CASCADE DELETE. Nullable sinds mig 200 — XOR met `inkoopgroep_code`. |
| inkoopgroep_code | TEXT FK → inkoopgroepen | Nullable. XOR met `debiteur_nr` (CHECK constraint). Mig 200. |
| kwaliteit_code | TEXT FK → kwaliteiten | |
| kleur_code | TEXT | **Mig 199.** Optioneel: NULL = van toepassing op alle kleuren van de kwaliteit (fallback); specifieke waarde overruled de fallback. |
| benaming | TEXT | Eigen naam (bijv. "BREDA" voor BEAC) |
| omschrijving | TEXT | |
| leverancier | TEXT | |
| bron | TEXT | Herkomst (`'ui'`, `'TKA013-…'`, …). Mig 200. |
| created_at, updated_at | TIMESTAMPTZ | Audit-stack. Mig 200. |
| UK: (debiteur_nr, kwaliteit_code, COALESCE(kleur_code,'')) WHERE debiteur_nr IS NOT NULL | | Mig 199 |
| UK: (inkoopgroep_code, kwaliteit_code, COALESCE(kleur_code,'')) WHERE inkoopgroep_code IS NOT NULL | | Mig 200 |

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
| inkooporganisatie | TEXT | Snapshot van de inkoopgroep-code op moment van aanmaak (orders bewegen niet mee bij wijziging op debiteur). |
| status | order_status | Default `'Klaar voor picken'` (mig 275, was `'Nieuw'`). Schrijfpad uitsluitend via `_apply_transitie` binnen Order-lifecycle Module (mig 218). |
| compleet_geleverd | BOOLEAN | |
| aantal_regels, totaal_bedrag, totaal_gewicht | NUMERIC | Berekend door trigger |
| bron_systeem | TEXT | NULL = handmatig aangemaakt. 'lightspeed' = webshop-integratie (migratie 092). |
| bron_shop | TEXT | Sub-identifier binnen bron_systeem. Lightspeed: 'floorpassion_nl' / 'floorpassion_de'. |
| bron_order_id | TEXT | Externe order-ID (Lightspeed orders.id). Samen met bron_systeem uniek (partial index `orders_bron_unique`). |
| heeft_unmatched_regels | BOOLEAN DEFAULT false | TRUE als ≥1 order_regel een NULL artikelnr heeft. Automatisch gesynchroniseerd door trigger op order_regels (migratie 094). |
| lever_modus | TEXT | NULL / 'deelleveringen' / 'in_een_keer'. Per-order keuze hoe om te gaan met (deels) wachten op inkoop. Default uit `debiteuren.deelleveringen_toegestaan`, gevuld via `LeverModusDialog` bij opslaan als ≥1 regel tekort heeft. NULL voor orders zonder tekort. Migratie 144. |
| afhalen | BOOLEAN NOT NULL DEFAULT false | TRUE = klant haalt zelf op. UI in `OrderForm` onderdrukt automatische verzendkosten-regel; logistiek/zending overslaat vervoerder-stap. Migratie 204. |
| lever_type | lever_type ENUM NOT NULL DEFAULT 'week' | ADR 0014 / mig 244. `'week'` = order-belofte op leverweek (B2B-default, ~90%); `'datum'` = exact die afleverdatum (B2C). Bepaalt Pick & Ship-horizon (`werkdagMinN(afleverdatum, 1)` voor dag-orders) en snij-prioriteit (`werkdagMinN(afleverdatum, dag_order_snij_buffer_werkdagen)` voor dag-orders i.p.v. `logistieke_buffer_dagen` voor week-orders). Default per klant in `debiteuren.default_lever_type`. |
| verzonden_at | TIMESTAMPTZ | Mig 217 (ADR-0005). Moment waarop `voltooi_pickronde` de laatste open zending sloot en `orders.status='Verzonden'` zette. Triggert factuur-queue (mig 118). NULL voor orders die nog niet verzonden zijn. |
| edi_bevestigd_op | TIMESTAMPTZ | Mig 158. Tijdstip waarop de operator de EDI-orderbev heeft bevestigd en verstuurd (`bevestigOrderViaEdi`). NULL = leverweek/orderbev nog niet bevestigd ("te bevestigen"). Hergebruikt als gate voor mig 309-310. **Niet te verwarren** met `bevestigd_at` (mig 304 = e-mail-orderbevestiging aan klant). |
| edi_gewenste_afleverdatum | DATE | EDI-only (mig 309): door de partner gewenste leverdatum (snapshot, verandert nooit). `afleverdatum` mag afwijken zodra de allocator/mig 153 een haalbare datum berekent of de operator bij bevestiging corrigeert. NULL voor niet-EDI of als de partner geen leverdatum meestuurde. |
| debiteur_zeker | BOOLEAN | Mig 322. FALSE = de debiteur is via een onzekere (fuzzy) strategie geraden en moet handmatig bevestigd worden ("Debiteur te bevestigen"-flow). TRUE (default) = harde treffer of handmatig aangemaakt. Gezet door `create_webshop_order` uit `p_header.debiteur_zeker`. |
| debiteur_match_bron | TEXT | Mig 322. Welke strategie de debiteur bepaalde (`DebiteurMatchBron` uit `_shared/debiteur-matcher.ts`), bv. `company_name_ilike`, `email`, `env_fallback`. NULL voor handmatig aangemaakte orders. Het "te bevestigen"-predicaat sluit `env_fallback` uit (verzameldebiteur = verwachte eindbestemming). |
| alleen_productie | BOOLEAN NOT NULL DEFAULT false | Mig 327 (ADR-0029). TRUE = productie-only order uit **Basta**: RugFlow doet alleen snijden + confectie, facturatie/verzending/labels blijven in Basta. CHECK `chk_alleen_productie_bron`: `alleen_productie ⇒ bron_systeem='oud_systeem'`. Guards lezen deze vlag (Pick & Ship-uitsluiting, terminale-status-flip). Partiële index `idx_orders_alleen_productie`. |
| levertijd_wijziging_te_bevestigen_sinds | TIMESTAMPTZ | Mig 326. Nullable gate: tijdstip van de laatst gedetecteerde levertijd-wijziging door een leverancier/Karpi-ETA-update op een gekoppelde inkooporderregel (`sync_order_afleverdatum_eta`), nog niet herbevestigd aan de klant. NULL = niets open. Gezet zodra de ISO-leverweek daadwerkelijk verschuift; teruggezet op NULL door `markeer_levertijd_herbevestigd` (puur administratief, geen automatische communicatie). Eén nullable timestamp i.p.v. een gemeld_op/bevestigd_op-paar (zoals `edi_gewenste_afleverdatum`/`edi_bevestigd_op`): deze gate gaat — anders dan de eenmalige EDI-gate — herhaaldelijk open/dicht, en PostgREST kan niet filteren op kolom-vs-kolom-vergelijkingen; `IS NOT NULL` is hier zowel het filterbare predicaat als de weergavewaarde. |
| afl_adres_incompleet_sinds | TIMESTAMPTZ | Mig 395 (+397). Nullable intake-gate: gezet zodra een niet-afhaal-, niet-productie-only-order (status ≠ Verzonden/Geannuleerd; `alleen_productie` uitgesloten sinds mig 397) een onvolledig afleveradres-snapshot heeft (`afl_naam`/`afl_adres`/`afl_postcode`/`afl_plaats` leeg-na-trim). NULL = compleet. Afgeleid door BEFORE-trigger `trg_orders_afl_adres_gate` (single source); wist zichzelf zodra het adres compleet is — geen handmatige bevestiging. **Harde blokkade**: `start_pickronden` weigert de order via `_valideer_intake_gates`. Voedt de status-tab "Afleveradres ontbreekt" + order-detail-banner. Aanleiding: ORD-2026-0097 zonder adres in Pick & Ship → labels zonder adres. |
| prijs_ontbreekt_sinds | TIMESTAMPTZ | Mig 396 (+397). Nullable intake-gate: gezet zodra ≥1 normale regel (NOT `is_admin_pseudo`, artikelnr ≠ `VERZEND`, `korting_pct` < 100) een prijs van 0/NULL heeft, op een **niet-productie-only** order (`alleen_productie` uitgesloten sinds mig 397). NULL = geen ontbrekende prijs of bewust geaccepteerd. Afgeleid door AFTER-trigger `trg_order_regels_prijs_gate` op `order_regels` (single source; `UPDATE OF prijs,korting_pct,artikelnr` zodat allocatie-updates op te_leveren/backorder niet vuren). Teruggezet op NULL door `markeer_prijs_geaccepteerd` (operator accepteert €0 bewust, audit via `order_events` `'prijs_geaccepteerd'`) of door prijscorrectie. **Harde blokkade** via `_valideer_intake_gates`. Voedt de status-tab "Prijs ontbreekt" + order-detail-banner. Aanleiding: Shopify-orders die zonder prijs binnenkwamen. |
| express | BOOLEAN | Mig 450 (Fase 2 snijplanning, NOT NULL DEFAULT false). Handmatige vlag (planner/verkoper, `ExpressToggle` op order-detail) — krijgt hoogste sorteerprioriteit in `sortPieces()` (`_shared/ffdh-packing.ts`), vóór grootte/oppervlak/afleverdatum. Zichtbaar op `snijplanning_overzicht` (mig 450) en `orders_list` (mig 451, voedt de rode Express-badge op orders-overzicht). Toggelen triggert `auto-plan-groep` voor de (kwaliteit, kleur)-groepen van de maatwerk-regels; verdringt een eerder gepland stuk daarvan zijn rol, dan vangt `auto-plan-groep`'s verdringingscheck dat af (zie CLAUDE.md). |

**Productie-only orders (mig 327, ADR-0029):** `alleen_productie=true`-orders worden uit Basta geïmporteerd via RPC `import_productie_only_order` (status `'In productie'`, `bron_systeem='oud_systeem'`, `order_nr='OUD-<oud_order_nr>'`). Idempotent op `oud_order_nr` (partiële UNIQUE-index `orders_oud_order_nr_uniek`). Ze bereiken de terminale status `'Maatwerk afgerond'` (nooit `'Verzonden'`) en vallen buiten Pick & Ship, facturatie en transport. Debiteur = echte match of verzameldebiteur **900000 'OUD SYSTEEM (PRODUCTIE)'**.

---

### order_reserveringen
Harde koppeling orderregel ↔ voorraad/inkooporder-regel. Bron-van-waarheid voor `producten.gereserveerd` en levertijd-berekening (migratie 144, 2026-04-29).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| order_regel_id | BIGINT FK → order_regels | CASCADE DELETE |
| bron | TEXT CHECK | 'voorraad' \| 'inkooporder_regel' |
| inkooporder_regel_id | BIGINT FK → inkooporder_regels | NULL bij bron='voorraad', verplicht bij bron='inkooporder_regel' (CHECK constraint) |
| aantal | INTEGER CHECK > 0 | Aantal stuks in deze claim |
| claim_volgorde | TIMESTAMPTZ DEFAULT now() | FIFO-volgorde: wie eerst claimt, wordt eerst beleverd bij IO-ontvangst |
| status | TEXT CHECK | 'actief' \| 'geleverd' \| 'released' |
| geleverd_op | TIMESTAMPTZ | Gevuld bij status-overgang naar 'geleverd' |
| fysiek_artikelnr | TEXT | Sinds migratie 154: wat fysiek wordt afgenomen uit voorraad. NULL → trigger `trg_default_fysiek_artikelnr` vult uit `order_regels.artikelnr`. Bij uitwisselbaar/omstickeren-claim wijst naar het uitwisselbaar artikel. |
| is_handmatig | BOOLEAN DEFAULT false | Sinds migratie 154: true = gebruiker-gekozen uitwisselbaar-claim. Allocator (`herallocateer_orderregel`) releaset deze claims NIET en telt ze mee als reeds-gedekt. |
| created_at, updated_at | TIMESTAMPTZ | Auto |

**Unieke partial indexen:**
- `idx_order_reserveringen_voorraad_uniek` — één actieve voorraad-claim per (orderregel, fysiek_artikelnr)-combi (mig 154 — eerder per orderregel)
- `idx_order_reserveringen_io_uniek` — één actieve IO-claim per (orderregel, IO-regel)-combi

**Levenscyclus:**
- Orderregel-mutatie / -DELETE → trigger `trg_orderregel_herallocateer` roept `herallocateer_orderregel(id)` aan
- IO-status → 'Geannuleerd' → trigger `trg_inkooporder_status_release` releaset claims; getroffen orderregels worden opnieuw gealloceerd
- `boek_voorraad_ontvangst` consumeert IO-claims in `claim_volgorde`-volgorde en verschuift ze naar voorraad-claims
- INSERT/UPDATE/DELETE → trigger `trg_reservering_sync_producten` roept `herbereken_product_reservering(artikelnr)` aan

---

### order_events
Typed audit-log van `orders.status`-overgangen. Geschreven door `_apply_transitie` binnen Order-lifecycle Module (mig 218, ADR-0006). Append-only.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| order_id | BIGINT FK → orders | CASCADE DELETE |
| event_type | order_event_type | aangemaakt / pickronde_gestart (mig 257) / pickronde_voltooid / deels_verzonden (mig 257) / wacht_status_herberekend / geannuleerd / backfill_fase_normalisatie |
| status_voor | order_status NULL | NULL voor backfill + 'aangemaakt'-events |
| status_na | order_status | Nooit NULL |
| actor_medewerker_id | BIGINT FK → medewerkers | XOR met actor_auth_user_id |
| actor_auth_user_id | UUID FK → auth.users | XOR met actor_medewerker_id |
| reden | TEXT | Vrije tekst, vereist bij `markeer_geannuleerd` |
| metadata | JSONB | bv. `{cleanup: true}` of `{backfill: true}` |
| created_at | TIMESTAMPTZ | DEFAULT now() |

CHECK constraint `order_events_actor_xor`: niet beide actor-velden tegelijk gevuld. Indexen: `(order_id, created_at DESC)` en `(event_type, created_at DESC)`.

**Event-listeners op `order_events` (AFTER INSERT, `WHEN`-gefilterd op `event_type`):** modules reageren ontkoppeld op events i.p.v. direct op `orders.status` (ADR-0006/0015).
| Trigger | WHEN | Module-effect |
|---------|------|---------------|
| `trg_order_events_reservering_release` | `event_type='geannuleerd'` | Mig 255: releaset alle actieve `order_reserveringen` (voorraad + IO) van de order. |
| `trg_order_events_snijplan_release` | `event_type='geannuleerd'` | Mig 290 (ADR-0023): alle nog-levende snijplannen van de order → `Geannuleerd` (ongeacht voortgang); geraakte rollen die hun laatste actieve snijplan verliezen → `beschikbaar`/`reststuk` (`snijden_gestart_op=NULL`), met `NOT EXISTS`-guard voor gedeelde rollen. |
| `trg_order_events_zending_release` | `event_type='geannuleerd'` | Mig 480: per zending van de order met status `'Gepland'`/`'Picken'` (nooit verder — een al-fysiek-verzonden zending van een 'Deels verzonden'-order die toch geannuleerd wordt blijft onaangeroerd) worden de regels/colli van DIE order verwijderd. Bundel-zending-bewust: blijft een andere, niet-geannuleerde order gekoppeld, dan blijft de zending bestaan met herberekende `aantal_colli`/`totaal_gewicht_kg`; was de geannuleerde order de enige, dan vervalt de hele zending. |
| `enqueue_factuur_voor_event` | div. (mig 223) | Facturatie-Module queue-vulling. |

#### order_event_type (enum)
`aangemaakt | pickronde_gestart | pickronde_voltooid | deels_verzonden | wacht_status_herberekend | geannuleerd`

Sinds mig 257 (ADR-0016): `pickronde_gestart` (geschreven door `markeer_pickronde_gestart` als ≥1 zending in `Picken` overgaat) en `deels_verzonden` (geschreven door `markeer_deels_verzonden` wanneer niet-laatste zending in een multi-zending order wordt voltooid). **Mig 474 (2026-06-22):** `enqueue_factuur_voor_event` filterde tot dan strict op `event_type='pickronde_voltooid' AND status_na='Verzonden'` — een deelzending (`event_type='deels_verzonden', status_na='Deels verzonden'`) werd dus nooit gefactureerd totdat de hele order (soms maanden later, bij een trage laatste regel) compleet was. De conditie dekt nu beide combinaties; de bestaande `factuur_queue`-insert (`ON CONFLICT (zending_id) DO NOTHING`) voorkomt dat de latere order-completion een dubbele factuurregel voor de al-gefactureerde deelzending aanmaakt.

---

### order_regels
Productregels per order. artikelnr nullable voor service-items.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| order_id | BIGINT FK → orders | CASCADE DELETE |
| regelnummer | INTEGER | |
| artikelnr | TEXT FK → producten | Nullable |
| karpi_code | TEXT | Nullable |
| omschrijving | TEXT NOT NULL | Regel-beschrijving, verplicht |
| omschrijving_2 | TEXT | Nullable |
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
| is_maatwerk | BOOLEAN | Default false. Regel vereist snijden/confectie |
| maatwerk_lengte_cm | INTEGER | Gewenste lengte in cm |
| maatwerk_breedte_cm | INTEGER | Gewenste breedte in cm |
| maatwerk_afwerking | TEXT FK → afwerking_types(code) | Afwerkingscode (B, FE, LO, ON, SB, SF, VO, ZO). FK: fk_order_regels_afwerking ON DELETE RESTRICT |
| maatwerk_band_kleur | TEXT | Tekst-snapshot van bandkleur-label op moment van order ("Piero Taupe 431"). Historisch — voor nieuwe orders gevuld vanuit `afwerking_kleuren.label` via `maatwerk_band_kleur_id`. |
| maatwerk_band_kleur_id | BIGINT FK → afwerking_kleuren | Strict-FK naar bandkleur-master (mig 194). ON DELETE RESTRICT. NULL voor pre-mig-194 regels en regels zonder bandkleur. |
| maatwerk_instructies | TEXT | Vrije tekst snij/confectie-instructies |
| maatwerk_vorm | TEXT FK → maatwerk_vormen(code) | Vormcode. FK: fk_order_regels_vorm ON DELETE RESTRICT |
| maatwerk_m2_prijs | NUMERIC(10,2) | Verkoopprijs per m² snapshot |
| maatwerk_kostprijs_m2 | NUMERIC(10,2) | Kostprijs per m² snapshot |
| maatwerk_oppervlak_m2 | NUMERIC(8,4) | Berekend prijsoppervlak |
| maatwerk_vorm_toeslag | NUMERIC(10,2) | Vorm toeslag snapshot |
| maatwerk_afwerking_prijs | NUMERIC(10,2) | Afwerking prijs snapshot |
| maatwerk_diameter_cm | INTEGER | Diameter voor ronde vormen |
| maatwerk_kwaliteit_code | TEXT | Kwaliteitscode (voor groepering zonder artikelnr) |
| maatwerk_kleur_code | TEXT | Kleurcode |
| ~~productie_groep~~ | — | **BESTAAT (NOG) NIET** — V2-backlog (zie mig 278: "er bestaat (nog) geen kolom"). Het concept "groepering voor snijplanning (kwaliteit+kleur)" wordt gerealiseerd via `maatwerk_kwaliteit_code` + `maatwerk_kleur_code` (de view `snijplanning_overzicht` COALESCEt die). NIET in INSERTs gebruiken tot de kolom daadwerkelijk wordt toegevoegd. |
| snijden_uit_standaardmaat | BOOLEAN NOT NULL DEFAULT false | Mig 327 (ADR-0029). TRUE = stuk wordt uit een standaard-maat kleed gesneden, NIET uit een rol → verschijnt wel in snijden + confectie maar verbruikt geen rollengte (`fetchStukken` sluit het uit van rol-packing). Gekopieerd naar `snijplannen` door `auto_maak_snijplan`/`auto_sync_snijplan_maten` (mig 328). Partiële index `idx_order_regels_uit_standaardmaat`. |
| vervoerder_code | TEXT FK → vervoerders(code) | Mig 219: per-regel override van order-default vervoerder. NULL = gebruik `effectieve_vervoerder_per_orderregel`-fallback (regel-evaluator → klant-fallback). Wijzigen geblokkeerd door trigger `trg_lock_orderregel_vervoerder` zodra een open zending bestaat. |
| verzendweek | TEXT | Mig 334. Handmatige verzendweek-override per regel (`YYYY-Www`). NULL = auto-computed in de frontend (`VerzendweekCell`). RPC `set_regel_verzendweek(regel_id, week)` (NULL = reset). |
| verzendweek_bron | TEXT CHECK IN ('handmatig','automatisch_voorraad') | Mig 469/471. Herkomst van `verzendweek`: `'handmatig'` = bewust door een operator gezet/aangepast via `set_regel_verzendweek`, `'automatisch_voorraad'` = systeemvoorstel zodra trigger `trg_snijplan_rol_toegewezen_auto_verzendweek` op `snijplannen` detecteert dat een maatwerk-regel volledig gedekt is — elk stuk heeft een `rol_id` (mig 469, "vandaag + N1 weken") ÓF (mig 471) een `verwacht_inkooporder_regel_id` (`GREATEST(vandaag + N1, MAX(IO-eta) + N2)`). Zet nooit een bestaande waarde terug — snapshot, geen live herberekening. NULL = geen verzendweek gezet. |
| UK: (order_id, regelnummer) | | |

---

### facturen
_Aangemaakt in migratie 117 (2026-04-22). Gepatcht in mig 125: `order_id` op header dropped — koppeling met orders loopt via `factuur_regels.order_id`._

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| factuur_nr | TEXT UK | FACT-2026-0001 |
| debiteur_nr | INTEGER FK → debiteuren | |
| factuurdatum, vervaldatum | DATE | |
| status | factuur_status | Default 'Concept' |
| subtotaal, btw_percentage, btw_bedrag, totaal | NUMERIC | |
| fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land | TEXT | Snapshot |
| btw_nummer | TEXT | Snapshot van klant-BTW-nummer (mig 125) |
| btw_verlegd | BOOLEAN NOT NULL DEFAULT FALSE | Mig 371: TRUE ⟺ `btw_regeling='eu_b2b_icl'` (mig 456) → 0% BTW + vermelding "BTW verlegd" op PDF. |
| btw_regeling | TEXT | Mig 456: snapshot van de regeling-code uit `bepaal_btw_regeling` (mig 455) op projectie-moment — `nl_binnenland`/`eu_b2b_icl`/`eu_b2b_binnenland_afwijking`/`export_buiten_eu`. Puur informatief/audit. |
| btw_controle_nodig_sinds | TIMESTAMPTZ | Mig 456: NULL = BTW-regeling automatisch zeker. Gevuld zodra `bepaal_btw_regeling` een afwijking signaleert — de factuur-RPC's (`projecteer_concept_factuur`/`genereer_factuur(_voor_week)`) zetten dit ALTIJD, ook bij een hard-block-regeling (de factuur wordt dus altijd aangemaakt, zichtbaar als Concept met de banner). De HARDE blokkade zit in `factuur-verzenden/index.ts` (na aanmaak, vóór mail/EDI) voor `eu_b2b_binnenland_afwijking`/`export_buiten_eu`; voor `eu_b2b_icl` zonder btw-nummer is het advisory (mig 164-besluit, niet blokkerend). Bevestigen via `markeer_btw_regeling_geaccepteerd(factuur_id)` — wist de gate zonder data te wijzigen; een latere her-projectie herberekent en kan 'm opnieuw zetten. |
| opmerkingen | TEXT | |
| pdf_storage_path | TEXT | Pad in bucket 'facturen' ({debiteur_nr}/FACT-YYYY-NNNN.pdf) |
| verstuurd_op | TIMESTAMPTZ | Wanneer email verzonden |
| verstuurd_naar | TEXT | Email-adres waar factuur naartoe is |
| created_at, updated_at | TIMESTAMPTZ | Auto |

### factuur_regels
_Aangemaakt in migratie 117 (2026-04-22)._

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| factuur_id | BIGINT FK → facturen | CASCADE DELETE |
| order_regel_id | BIGINT FK → order_regels | |
| omschrijving | TEXT | |
| aantal | INTEGER | |
| prijs, korting_pct, bedrag, btw_percentage | NUMERIC | |

---

### verkoopoverzicht_export (VIEW)
_Mig 302._ AFAS-compatibele tab-separated factuurexport. Per factuur 1 rij; bundel-facturen (meerdere orders → 1 factuur) krijgen `ordernummers` en `klant_refs` als `; `-gescheiden DISTINCT-aggregaten uit `factuur_regels`. `naam2` afgeleid uit `debiteuren.inkoopgroep_code` (bv. `(INKC02 DECOR UNION)`). Gevoed door de "Verkoopoverzicht"-knop op [`/facturatie`](../frontend/src/modules/facturatie/pages/facturatie-overview.tsx); frontend filtert op status (`Verstuurd/Betaald/Herinnering/Aanmaning`, géén Concept/Gecrediteerd) en datum-range. Output-bestandsnaam: `VERK_OVERZICHT_VAN_{YYYYMMDD}_TOT_{YYYYMMDD}.XLS`. Bytes geëncodeerd als ISO-8859-1 / Windows-1252 voor backward-compat met legacy AFAS-import.

---

### cbs_intrastat_export (VIEW)
_Mig 448._ Maandelijkse CBS/Intrastat-verzendingen-export (buitenlandse verkoopfacturen) — vervangt de Basta-bijlage "fbacbs" (mail Nando 17-06-2026). Per `factuur_regels`-rij 1 export-rij, alléén facturen met `btw_verlegd=true` (intracommunautair); admin-pseudo-regels (`is_admin_pseudo`, ADR-0018 — VERZEND/DROPSHIP-*/kortingen) uitgesloten. Kolommen matchen de Basta-export 1-op-1: Partner ID (`facturen.btw_nummer`), land bestemming (`normaliseer_land(fact_land)`), land oorsprong (constant `'NL'`), Transactie (constant `'11'`), Vervoerswijze (constant `'3'`, wegvervoer), Goederencode (via `kwaliteiten.goederencode`, NULL toegestaan — rij wordt niet uitgesloten), Netto gewicht (`order_regels.gewicht_kg`, afgerond), Bijzondere maatstaf (constant `0`, zie mig 446-toelichting), Factuurwaarde (`factuur_regels.bedrag`, afgerond), Eigen administratienummer (`factuur_nr`). Gevoed door de "CBS-export"-knop op [`/facturatie`](../frontend/src/modules/facturatie/pages/facturatie-overview.tsx); frontend filtert op datum-range en formatteert numerieke velden 10-cijferig zero-padded + CRLF (`cbs-export-tsv.ts`), exact het Basta-format. Bestandsnaam: `CBS_INTRASTAT_VAN_{YYYYMMDD}_TOT_{YYYYMMDD}.txt`.

---

### factuur_queue
Queue voor asynchrone factuur-generatie + email. Gevuld door trigger (migratie 118) bij
`orders.status='Verzonden'` (klant met `factuurvoorkeur='per_zending'`) of door pg_cron
maandag 05:00 UTC (klanten met `factuurvoorkeur='wekelijks'`). Gedrainst door edge
function `factuur-verzenden`. Zie migraties 118, 121, 122.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| debiteur_nr | INTEGER FK → debiteuren | |
| order_ids | BIGINT[] | Welke orders samen op 1 factuur |
| type | TEXT | 'per_zending' of 'wekelijks' |
| status | factuur_queue_status | pending → processing → done / failed |
| attempts | INTEGER | Aantal retry-pogingen (max 3) |
| last_error | TEXT | Laatste error-message bij falen |
| factuur_id | BIGINT FK → facturen | Gezet na succes |
| bron_event_id | BIGINT FK → order_events | Mig 223 (ADR-0007). Audit-link naar de event-rij die de queue-entry triggerde. NULL voor wekelijkse verzamelfacturen + legacy. |
| verzendweek | TEXT | Mig 231. ISO-week (`YYYY-Www`) waarvoor type=`wekelijks` werd geënqueued. Gebruikt door edge function `factuur-verzenden` om `genereer_factuur_voor_week(debiteur_nr, jaar_week)` aan te roepen i.p.v. `genereer_factuur(order_ids)`. NULL bij type=`per_zending`. Index: `idx_factuur_queue_wekelijks_week (debiteur_nr, verzendweek) WHERE type='wekelijks'`. |
| processing_started_at | TIMESTAMPTZ | Voor stuck-detection. Zie migratie 121. |
| created_at, processed_at | TIMESTAMPTZ | |

**Cron `enqueue_wekelijkse_verzamelfacturen`** (mig 231): groepeert vanaf nu per `(debiteur_nr, verzendweek_voor_datum(orders.afleverdatum))` i.p.v. alleen per debiteur. Filtert op verzendweek = vorige ISO-week (`CURRENT_DATE - 7 days`) en heeft dubbele-vuur-bescherming via `NOT EXISTS`-check op queue-rijen voor dezelfde `(debiteur, week)` met status pending/processing/done.

---

### zendingen
Fysieke leveringen. Werkelijk aangemaakt sinds migratie 169 — bron-van-waarheid voor de logistieke flow (één rij per fysieke zending naar een afleveradres). Adres-snapshot zodat één order in V2 kan splitsen naar verschillende adressen zonder de orderkolommen te muteren. `track_trace` wordt door de vervoerder-adapter teruggeschreven (bv. HST `transportOrderId` of `trackingNumber`).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_nr | TEXT UK | ZEND-2026-0001 (via `volgend_nummer('ZEND')`) |
| order_id | BIGINT FK → orders | ON DELETE RESTRICT |
| status | zending_status NOT NULL | Default 'Gepland' |
| vervoerder_code | TEXT FK → vervoerders.code | Mig 176. Gekozen vervoerder voor deze zending, bepaald door `selecteer_vervoerder_voor_zending()` / `enqueue_zending_naar_vervoerder()` |
| picker_id | BIGINT FK → medewerkers.id | Mig 217. Medewerker met rol picker die deze Pickronde startte/voltooide. ON DELETE SET NULL. |
| vervoerder_selectie_uitleg | JSONB | Mig 176. Audit-uitleg van de selector (V1: enige actieve vervoerder; later voorwaarden/tarieven) |
| verzenddatum | DATE | |
| track_trace | TEXT | HST-tracking-nummer of EDI-equivalent — gevuld door adapter na verzending |
| afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land | TEXT | Adres-snapshot (kopie van orders.afl_*) |
| afl_telefoon | TEXT | Mig 339 (ADR-0030). Snapshot van het leveringstelefoonnummer — HST "belt vóór aflevering" en stuurt dit mee in `ToAddress.PhoneNumber`. Gevuld door BEFORE-INSERT-trigger `trg_zending_fill_telefoon` (functie `fn_zending_fill_telefoon`): ladder `orders.afl_telefoon` → fallback `debiteuren.telefoon`. Via trigger i.p.v. in `start_pickronden` zodat álle zending-aanmaakroutes het veld vullen. Backfill voor nog-niet-verstuurde zendingen. |
| afl_email | TEXT | Mig 365. Snapshot van het **aflever**-e-mailadres voor track & trace door de vervoerder — hst-send stuurt dit mee in `ToAddress.Email`. Gevuld door BEFORE-INSERT-trigger `trg_zending_fill_email` uit `orders.afl_email` (mig 084, sinds mig 364 door het order-formulier gevuld vanuit `afleveradressen.email`). **Bewust géén fallback naar factuur-e-mailadressen** (`debiteuren.email_factuur` e.d.) — de klant moet wél de T&T krijgen maar niet de factuur (mail Piet-Hein/Marjon 11-06-2026). Leeg = geen T&T-mail. Backfill voor nog-niet-verstuurde zendingen. **Dropship-guard (mig 370):** bij dropshipment-orders (`is_dropship_order`) kopieert de trigger het order-afl_email NIET als het gelijk is aan het factuur-/debiteur-e-mailadres — T&T moet daar naar de consument. |
| totaal_gewicht_kg | NUMERIC | **Sinds mig 391 een trigger-afgeleide** van `SUM(zending_colli.gewicht_kg)` (`trg_sync_zending_totaal_gewicht`) — bron-van-waarheid is het per-colli-gewicht, niet meer een losse orderregel-som. Voedt het HST-fallback-pad (aggregate-regel zonder colli) zodat dat consistent is met het per-colli-pad. Sinds mig 206 exclusief de pseudo-regel `artikelnr='VERZEND'`. |
| aantal_colli | INTEGER | Gevuld door `create_zending_voor_order` als som van `order_regels.orderaantal`; gebruikt voor sticker `x VAN y`. Sinds mig 206 exclusief `artikelnr='VERZEND'`. Voor exacte per-stuk identiteit (sticker, SSCC) zie `zending_colli` (mig 209). |
| service_code | TEXT | Mig 210. Service-variant binnen vervoerder (bv. `'internationaal'` bij DPD), gekozen door `selecteer_vervoerder_voor_zending()`. NULL = vervoerder-default. |
| verzendweek | TEXT | Mig 230. ISO-week-snapshot (formaat `YYYY-Www`) van de afleverdatum bij pickronde-start. Bron voor de wekelijkse verzamelfactuur-aggregatie (mig 232) en filter in `genereer_factuur_voor_week`. Onveranderlijk na pickronde-start dankzij `trg_lock_zending_bundel_sleutel`. Backfill via `zending_orders` M2M voor bestaande rijen. Trigger `trg_zending_set_verzendweek` vult bij INSERT als nog NULL. |
| opmerkingen | TEXT | |
| gereed_op | TIMESTAMPTZ | Mig 432. Moment waarop de zending vóór het eerst status `'Klaar voor verzending'` bereikte = **pickronde afgerond**. Eenmalig gezet door BEFORE-trigger `trg_zending_set_gereed_op` (NULL-guard → onveranderlijk; latere transities naar Onderweg/Afgeleverd raken het niet). Voedt sortering/groepering/datumfilter op het logistiek-zendingenoverzicht (`/logistiek`). Backfill = `pickronde_voltooid`-`order_event` via `zending_orders`, fallback `updated_at`. NULL voor nog niet-afgeronde zendingen (bv. `'Picken'`). |
| created_at, updated_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_zendingen_order` (order_id), `idx_zendingen_status` (status), `idx_zendingen_vervoerder` (partial op `vervoerder_code`), `idx_zendingen_verzendweek` (partial op `verzendweek IS NOT NULL`, mig 230), `idx_zendingen_gereed_op` (`gereed_op DESC NULLS LAST`, mig 432). `updated_at` via trigger `set_zendingen_updated_at()`.

**Trigger:** `trg_zending_set_gereed_op` (BEFORE INSERT/UPDATE OF status, mig 432) — stempelt `gereed_op` bij het bereiken van een afgeronde status. Staat los van `trg_zending_klaar_voor_verzending` (mig 172, AFTER, vervoerder-enqueue).

**Trigger:** `trg_zending_klaar_voor_verzending` (AFTER INSERT/UPDATE OF status, mig 172) roept bij transitie naar `'Klaar voor verzending'` de switch-RPC `enqueue_zending_naar_vervoerder()` aan. Sinds mig 176 vult die eerst `zendingen.vervoerder_code` via `selecteer_vervoerder_voor_zending()`.

### zending_regels
Welke artikel-regels in een zending zitten. Sinds migratie 169.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_id | BIGINT FK → zendingen | CASCADE DELETE |
| order_regel_id | BIGINT FK → order_regels | ON DELETE SET NULL |
| artikelnr | TEXT FK → producten | |
| rol_id | BIGINT FK → rollen | Optioneel — voor maatwerk-stukken die uit een specifieke rol komen |
| aantal | INTEGER NOT NULL | Default 1 |
| created_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_zending_regels_zending` (zending_id).

---

### zending_orders
M2M tussen zendingen en orders. Sinds migratie 222 (zending-bundeling op afleveradres + vervoerder). Voor solo-zendingen 1 rij; voor bundel-zendingen N rijen — backfill heeft alle bestaande 1-op-1 koppelingen al gevuld zodat consumenten één uniforme bron hebben. `zendingen.order_id` blijft bestaan als "primaire/eerste" order voor backwards-compat queries.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| zending_id | BIGINT FK → zendingen | CASCADE DELETE — bij delete van de zending verdwijnen alle koppelingen |
| order_id | BIGINT FK → orders | ON DELETE RESTRICT — een order kan niet worden gewist zolang hij in een zending zit |

**PK:** (zending_id, order_id). **Index:** `zending_orders_order_id_idx` (order_id).

**RLS:** ENABLED met all-authenticated policy `zending_orders_all` (mig 241) — spiegel van `zending_regels_all`/`zendingen_all` uit mig 169. Hotfix voor 42501 in `start_pickronden_bundel` bij bundels ≥2 orders: tabel was in mig 222 zonder RLS-policy uitgerold, op live DB werd RLS via Studio-advisor aangezet zonder INSERT-policy voor `authenticated`.

**Canoniciteit (mig 242):** AFTER-INSERT-trigger `trg_zending_set_m2m_a_ins` op `zendingen` schrijft automatisch een M2M-rij in deze tabel (ON CONFLICT DO NOTHING). Daardoor heeft élke zending — solo via `start_pickronden_voor_order` / `create_zending_voor_order`, of bundel via `start_pickronden_bundel` — minstens 1 rij hier. Backfill van mig 242 vulde alle solo-zendingen die sinds mig 222 zonder M2M-rij waren gemaakt. Consumers (frontend pickbaarheid-query, `voltooi_pickronde`-fallback, factuur-cron) kunnen vanaf nu puur via `zending_orders` queryen zonder UNION-fallback op `zendingen.order_id`.

**Producer:** `start_pickronden_bundel(order_ids[], picker_id)` (mig 222) — multi-order bundel-pickronde, valideert zelfde debiteur + identiek genormaliseerd afleveradres + geen lopende/eindstatus-zendingen, groepeert regels op effectieve vervoerder uit mig 219, maakt 1 zending per groep gekoppeld aan alle betrokken orders. Bij 1 order delegeert naar `start_pickronden_voor_order` (mig 220) zodat callers één code-pad hebben.

**Consumer:** `voltooi_pickronde` (mig 222) leest betrokken orders uit deze tabel en flipt élke order via `markeer_verzonden` zodra dit de laatste open zending is — sluitstuk factuur-keten (ADR-0005) blijft kloppend voor zowel solo- als bundel-zendingen.

**Helper:** `_normaliseer_afleveradres(adres, postcode, land)` (mig 222) — TRIM + UPPER + whitespace-normalisatie; gehard in mig 385: JS-identieke whitespace-klasse + ß/ẞ→ss-fold (chr(223)/chr(7838)); contract via golden fixtures (`bundel-sleutel.golden.json`) + `assert_bundel_sleutel_contract`. Wordt door de bundel-RPC gebruikt om de adres-invariant SQL-side te bewaken; de frontend (`bundel-cluster.ts`) dupliceert dezelfde logica om identiek te clusteren vóór de RPC-aanroep.

**Lock-trigger:** `trg_lock_zending_bundel_sleutel` (mig 230, BEFORE UPDATE OF afleverdatum/afl_*/debiteur_nr ON orders) — blokkeert mutatie van bundel-sleutel-dimensies zodra de order in een actieve bundel-zending zit (status `Klaar voor verzending`+). Voorkomt divergentie tussen pakbon-snapshot, wekelijkse factuur-week en werkelijke order-data. Gooit `restrict_violation`. Picken-status mag wel muteren: operator kan dan bewust splitsen door pickronde te annuleren.

---

### voorgestelde_zending_bundels (VIEW)
Pure SQL-view die per (debiteur × genormaliseerd adres × effectieve vervoerder × ISO-verzendweek) alle open orders aggregeert tot voorgestelde bundels. Mig 229 — bron-van-waarheid voor de live preview op Pick & Ship vóór een pickronde is gestart. Geen state, geen triggers, herevalueert per query: wijzigt afleverdatum/adres/vervoerder-override → andere bundel-sleutel → orders schuiven automatisch tussen bundel-rijen bij de eerstvolgende fetch.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| sleutel | TEXT | `bundel_sleutel(debiteur, adres_norm, vervoerder, week)` — formaat `'D{nr}|V{code}|W{YYYY-Www}|A{adres-norm}'` |
| debiteur_nr | INTEGER | |
| debiteur_naam | TEXT | |
| adres_norm | TEXT | Genormaliseerd `postcode|adres|land`, alle uppercase |
| afl_naam, afl_postcode, afl_plaats | TEXT | Snippets voor UI-tooltip (alle orders in groep delen het adres) |
| vervoerder_code | TEXT | Effectieve vervoerder-code, of `'AFHAAL'` / `'GEEN'` |
| is_afhalen | BOOLEAN | TRUE als alle orders op afhalen staan (afzonderlijke vervoerder-categorie) |
| jaar_week | TEXT | ISO-week, formaat `'YYYY-Www'` (bv. `'2026-W22'`) |
| order_ids | BIGINT[] | Order-IDs in deze bundel, gesorteerd |
| aantal_orders | INTEGER | |
| bundel_subtotaal_excl | NUMERIC(12,2) | Som order_regels.bedrag exclusief BTW, zonder VERZEND-pseudo's |
| klant_verzendkosten, klant_drempel, gratis_verzending | NUMERIC, NUMERIC, BOOLEAN | Snapshot van debiteur-config voor UI-tooltip |
| drempel_gehaald | BOOLEAN | TRUE als afhalen, gratis_verzending of subtotaal ≥ drempel |
| te_betalen_verzendkosten | NUMERIC(8,2) | Wat de klant zou betalen als deze bundel nu zou worden gefactureerd |
| bundel_besparing | NUMERIC(10,2) | Geschat verschil met "elke order solo verstuurd". 0 voor 1-order bundels |

**Filter:** alleen open orders (status NOT IN `'Verzonden'`/`'Geannuleerd'`), met afleverdatum, zonder actieve zending (`Picken`+ via `zending_orders` M2M).

**Pure-SQL-keuze (geen materialized view)**: voor het verwachte volume (100-500 open orders × ~5 regels) blijft een reguliere view onder 200ms en vermijdt MV-refresh-complexity rondom `effectieve_vervoerder_per_orderregel`-mutaties. Een MV-upgrade is een logische stap als open-orders > 5k.

**Frontend-consumer:** [`fetchVoorgesteldeBundels`](../frontend/src/modules/logistiek/queries/voorgestelde-bundels.ts) + `useVoorgesteldeBundels`-hook. React Query staleTime 60s; invalidatie via `['voorgestelde-bundels']`-key bij vervoerder-override, afleverdatum-mutatie en pickronde-start.

---

### genereer_factuur_voor_week (RPC, BIGINT)
Mig 232. Genereert wekelijkse verzamelfactuur voor `(debiteur_nr, jaar_week)`. Aanroeper: edge function `factuur-verzenden` bij queue-rij `type='wekelijks'`.

**Signature:** `genereer_factuur_voor_week(p_debiteur_nr INTEGER, p_jaar_week TEXT) RETURNS BIGINT` (factuur_id).

**Werkwijze**:
1. Vind alle orders van `(debiteur_nr, jaar_week)` met status='Verzonden' zonder bestaande `factuur_regels`-rij.
2. Mig 227-style no-op-guard: tel te-factureren orderregels exclusief VERZEND. Bij 0 → `RAISE no_data_found`.
3. INSERT factuur header (zelfde defaults als `genereer_factuur` mig 227).
4. INSERT product-regels (zelfde SELECT-shape als mig 227).
5. Voor elke bundel-zending van die week (`zendingen.verzendweek = p_jaar_week`, status `Klaar voor verzending`+, gekoppeld via `zending_orders` aan een order in de factuur):
   - Bereken bundel-subtotaal uit zojuist geïnserteerde factuur_regels.
   - Drempel-toets: `gratis_verzending=TRUE` of `subtotaal ≥ verzend_drempel` → bedrag = 0; afhalen-zendingen → bedrag = 0; anders → bedrag = `verzendkosten`.
   - INSERT 1 VERZEND-regel met omschrijving zoals `"Verzendkosten 2026-W22 (HST, 2 orders)"` of `"... — gratis vanaf €500,00"`.
6. Hertotaliseer header subtotaal/btw/totaal over alle regels.

**Beleidskeuze**: verzendkosten worden **per bundel-zending** geheven, niet 1× per week. Een bundel = 1 fysieke transportbeweging. Twee verschillende vervoerders in dezelfde week resulteren in 2 verzending-regels (mits onder drempel). Drempel-toets is per bundel.

---

### vervoerders
Lookup-tabel met de beschikbare vervoerders waarmee Karpi werkt (mig 170, uitgebreid mig 174). Routing-keuze, géén berichten — daadwerkelijk verkeer per vervoerder loopt via een **adapter-tabel** (HST → `hst_transportorders`; EDI-vervoerders → `edi_berichten` met `berichttype='verzendbericht'`). Gezaaid met 3 rijen: `hst_api`, `edi_partner_a` (Rhenus, placeholder), `edi_partner_b` (Verhoek, placeholder). Alleen de HST-koppeling is in dit plan actief; EDI-koppelingen volgen in aparte plans en hun rij staat default `actief=FALSE`. Migratie 174 voegt instellingen-, contact- en tarief-kolommen toe als basis voor de `/logistiek/vervoerders`-UI (vrije-tekst tarieven in V1; gestructureerde tariefmatrix volgt in Fase B — zie roadmap in [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md)).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| code | TEXT PK | `'hst_api'`, `'verhoek_sftp'`, `'rhenus_sftp'`, `'dpd'` — wordt als FK gebruikt op `zendingen.vervoerder_code`. De mig 170-placeholders zijn guarded verwijderd ná het omhangen van hun selectie-regels: `edi_partner_b` → `verhoek_sftp` (mig 374, ADR-0031) en `edi_partner_a` → `rhenus_sftp` (mig 379, ADR-0032). |
| display_naam | TEXT NOT NULL | UI-label: `'HST'`, `'Rhenus'`, `'Verhoek'`, `'DPD'` |
| type | TEXT NOT NULL | CHECK in (`'api'`, `'edi'`, `'print'`, `'sftp'`). Mig 207: `'print'` toegevoegd voor lokale label-printer-flow (DPD via Zebra ZT230). Mig 374 (ADR-0031): `'sftp'` toegevoegd voor Verhoek AA2.0-XML via SFTP; Rhenus (mig 379, ADR-0032) gebruikt hetzelfde type. De `'edi'`-tak heeft sinds mig 379 geen kandidaten meer maar blijft voor evt. toekomstige échte EDI-vervoerders. |
| actief | BOOLEAN NOT NULL | Default FALSE — pas TRUE als koppeling werkt. Switch-RPC `enqueue_zending_naar_vervoerder` weigert met `'vervoerder_inactief'` als FALSE |
| is_default | BOOLEAN NOT NULL | Mig 336 (ADR-0030). Default FALSE. Markeert dé default-vervoerder; partial unique index `uk_vervoerders_is_default` (op `is_default` WHERE TRUE) garandeert hooguit één TRUE. `hst_api` is geseed als default. Administratieve bron-van-waarheid; het werkende mechanisme is de **catch-all** rij in `vervoerder_selectie_regels` (prio 99999, `{"land":["NL"]}`) die mig 336 toevoegt — gegate op `hst_api.actief=TRUE` (bewust nog FALSE tot cutover). |
| notities | TEXT | Vrije tekst (bv. "REST API. Auth via Basic.") |
| api_endpoint | TEXT | Mig 174. Basis-URL van de vervoerder-API (alleen relevant voor `type='api'`, bv. `https://accp.hstonline.nl/rest/api/v1`). Read-only referentie in UI; effectieve endpoint voor edge functions blijft uit env-variabelen komen. |
| api_customer_id | TEXT | Mig 174. Klant-/account-identifier bij de vervoerder-API (alleen relevant voor `type='api'`). |
| account_nummer | TEXT | Mig 174. Algemeen account-/klantnummer bij de vervoerder (zowel api als edi). |
| kontakt_naam | TEXT | Mig 174. Naam van de contactpersoon bij de vervoerder. |
| kontakt_email | TEXT | Mig 174. E-mailadres van de contactpersoon. |
| kontakt_telefoon | TEXT | Mig 174. Telefoonnummer van de contactpersoon. |
| tarief_notities | TEXT | Mig 174. Vrije-tekst tariefafspraken voor V1 (bv. "NL t/m 30 kg €9,50, BE +€2"). Gestructureerde `vervoerder_tarieven`-tabel komt in Fase B. |
| printer_naam | TEXT | Mig 207. Windows-printernaam voor `type='print'`. Browser-print-dialoog stuurt PDF hier naartoe. |
| printer_ip | TEXT | Mig 207. Optioneel IP voor directe ZPL-push (TCP 9100). V1 niet gebruikt — alleen voor toekomstige native ZPL-flow. |
| label_breedte_mm, label_hoogte_mm | NUMERIC(5,1) | Mig 207, NUMERIC sinds mig 361 (inch-rollen zijn fractioneel in mm). Verzendlabel-formaat voor álle typen — ook HST (`hst_api` = 152.4×76.2 sinds mig 362: liggend ontwerp op de 3"×6"-rol, driver roteert). Gelezen door printset-page voor `@page`-CSS; NULL → frontend-default 76.2×50.8. |
| service_codes | TEXT[] | Mig 207. Service-varianten die deze vervoerder ondersteunt, bv. `{'srv','classic','predict','internationaal'}` voor DPD. Verzendregels kiezen er één. |
| created_at, updated_at | TIMESTAMPTZ | Auto via `set_vervoerders_updated_at()` |

---

### vervoerder_selectie_regels
Verzendregels die bepalen welke vervoerder voor een zending wordt gekozen (mig 208). Eerste matchende regel wint, prio ASC. Geëvalueerd door `selecteer_vervoerder_voor_zending()` (mig 210). Conditie als JSONB voor uitbreidbaarheid — onbekende sleutels worden door de evaluator genegeerd (forward-compat).

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| vervoerder_code | TEXT FK → vervoerders | ON DELETE CASCADE |
| prio | INTEGER NOT NULL | Default 100. Lager = eerst geëvalueerd. Tiebreaker: `id ASC`. |
| conditie | JSONB NOT NULL | AND-conjunctie van conditie-sleutels. V1: `land` (TEXT[]), `kleinste_zijde_cm_min/max` (INT, MAX over orderregels), `gewicht_kg_min/max` (NUMERIC), `debiteur_nrs` (INT[]), `inkoopgroep_codes` (TEXT[]). Lege JSONB `{}` = altijd-match (fallback-regel). Onbekende sleutels = genegeerd (forward-compat). |
| service_code | TEXT | Service-variant binnen vervoerder (bv. `'internationaal'`). Moet voorkomen in `vervoerders.service_codes` als die gevuld is. NULL = vervoerder-default. |
| actief | BOOLEAN NOT NULL | Default TRUE |
| notitie | TEXT | Vrije uitleg over de regel |
| created_at, updated_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_vsr_prio_actief` (partial op `prio` waar `actief=TRUE`), `idx_vsr_vervoerder` (vervoerder_code).

**Seed (mig 208):** twee voorbeeld-regels (Karpi-praktijk):
- Rhenus, prio 10, `{land:["DE"], kleinste_zijde_cm_min:131}` → DE + tapijt >130cm = pallet
- DPD, prio 20, `{land:["DE"], kleinste_zijde_cm_max:130}` + service `'internationaal'` → DE + tapijt ≤130cm = pakket

**Land-normalisatie (mig 214):** `matcht_regel` past zowel `conditie.land[]` als `zending.afl_land` door `normaliseer_land(TEXT)` voor de match. Functie strip whitespace/diakritieken en mapt `'Nederland'`/`'Holland'` → `'NL'`, `'BELGIË'`/`'Belgium'` → `'BE'`, `'Deutschland'`/`'Germany'` → `'DE'` etc. Resultaat: een regel met `land:['NL']` matcht zowel orders met `afl_land='NL'` als met `afl_land='Nederland'`.

---

### zending_colli
Eén rij per fysieke colli binnen een zending (mig 209). Bron-van-waarheid voor verzendstickers: per colli SSCC + welk tapijt erin zit. V1: strikt 1 tapijt = 1 colli (afspraak 2026-05-07); `aantal` reserveert ruimte voor toekomstige multi-tapijt-per-colli.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_id | BIGINT FK → zendingen | CASCADE DELETE |
| colli_nr | INTEGER NOT NULL | 1-based volgorde binnen zending; `(zending_id, colli_nr)` UNIQUE. |
| order_regel_id | BIGINT FK → order_regels | ON DELETE SET NULL |
| rol_id | BIGINT FK → rollen | ON DELETE SET NULL — als de colli uit een specifieke rol komt |
| sscc | TEXT UK | 18-cijferig GS1 SSCC, gegenereerd door `genereer_sscc()` (mig 209). Op label getoond met AI(00)-prefix (totaal 20 chars). |
| gewicht_kg | NUMERIC | Per-colli gewicht. Sinds mig 387 gevuld via ladder `NULLIF(order_regels.gewicht_kg,0)` → `bereken_orderregel_gewicht_kg` (live, vorm-aware) → `NULLIF(producten.gewicht_kg,0)`. Verplicht > 0 voor de Rhenus/Verhoek-preflight. Handmatig overschrijfbaar in latere UI. |
| omschrijving_snapshot | TEXT | Karpi-product + maat, bv. `MAATW. SISAL-GOLD 21 160x090 cm, KI21 Band:KI21` (`compose_colli_omschrijving`). Bevroren snapshot — **single source** voor de Karpi-naam op verzendlabel/pakbon/DPD (sinds mig 390) én voor HST/Verhoek `GoodsDescription`/`Omschrijving`. Re-print blijft consistent na product-rename. |
| klant_omschrijving_snapshot | TEXT | **Mig 390.** Bevroren, ontdubbelde klant-omschrijving (`order_regels.omschrijving` + `_2` via `compose_klant_omschrijving`). Single source voor de klant-naam op label/pakbon — de print-laag leidt niets meer live af. NULL = geen klant-omschrijving (label valt terug op artikelnr). |
| lengte_cm | INTEGER | **Mig 399.** Bevroren colli-lengte (cm) = `COALESCE(order_regels.maatwerk_lengte_cm, producten.lengte_cm)` bij colli-aanmaak. **Single source** voor de afmeting die Rhenus (`dimension/depth`) en Verhoek (`Lengte`) versturen — de carriers leiden niets meer live af via een eigen maatwerk→product-join. NULL = onbekend (carrier-preflight beslist of dat blokkeert: Rhenus eist lengte, Verhoek lengte+breedte). |
| breedte_cm | INTEGER | **Mig 399.** Bevroren colli-breedte (cm) = `COALESCE(order_regels.maatwerk_breedte_cm, producten.breedte_cm)`. Zie `lengte_cm`. Verhoek eist dit per colli; Rhenus stuurt alleen depth (=lengte) en raakt dit niet. |
| klanteigen_naam_snapshot | TEXT | **Mig 419.** Bevroren klant-eigennaam voor de kwaliteit (`resolve_klanteigen_naam`, bron `klanteigen_namen` mig 199/200). NULL = geen afwijkende naam voor deze klant. De drie labelvarianten tonen "Uw referentie: <naam>" onder de kwaliteitscode alleen als dit veld gevuld is. |
| aantal | INTEGER NOT NULL | Default 1, CHECK ≥ 1. V1 = altijd 1. |
| pick_uitkomst | pick_uitkomst | Mig 211. Default 'open'; bij voltooi_pickronde → 'gepickt'. Enum-waardes: open, gepickt, niet_gevonden. |
| pick_opmerking | TEXT | Mig 211. Operator-notitie bij niet_gevonden. |
| gepickt_at | TIMESTAMPTZ | Mig 211. Moment van voltooi_pickronde. |
| gepickt_door_id | BIGINT FK → medewerkers.id | Mig 217. Picker die deze colli markeerde. Per-colli audit zodat shift-overgang traceerbaar blijft. ON DELETE SET NULL. |
| created_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_zending_colli_zending` (zending_id), `idx_zending_colli_orderregel` (order_regel_id).

**Generator-RPC:** `genereer_zending_colli(p_zending_id)` splitst zending-regels in 1-tapijt-per-stuk colli-rijen, vult SSCC, `omschrijving_snapshot` (`compose_colli_omschrijving`), `klant_omschrijving_snapshot` (`compose_klant_omschrijving`, mig 390), `lengte_cm`/`breedte_cm` (`COALESCE(maatwerk_*, product_*)`, mig 399) en het gewicht via de gewicht-ladder (mig 387). Idempotent (skipt als er al colli's zijn). Aangeroepen door `enqueue_zending_naar_vervoerder` voor `type='print'` vervoerders (mig 210). **Superset-let-op:** elke `CREATE OR REPLACE` van deze functie moet de complete mig-390-body bevatten + de eigen wijziging (mig 399 is de superset van 390 → 387) — verifieer met `pg_get_functiondef` na apply tegen drift.

**Ontdubbel-helper:** `compose_klant_omschrijving(omschrijving, omschrijving_2)` (mig 390) — spiegelt de TS-ontdubbeling van `productNamen` (`shipping-label-data.ts`): laat `omschrijving_2` weg als die als substring in `omschrijving` zit. Sinds mig 390 de enige plek waar die logica leeft (voorheen 3 TS-varianten: label substring-match, pakbon geen, DPD eigen).

**Gewicht-sync-trigger:** `trg_sync_zending_totaal_gewicht` (mig 391) op `zending_colli` (AFTER INSERT/DELETE/UPDATE OF gewicht_kg) houdt `zendingen.totaal_gewicht_kg = SUM(zending_colli.gewicht_kg)` — afgeleide som zodat de HST-fallback hetzelfde totaal stuurt als het per-colli-pad en als wat Rhenus/Verhoek sommeren (audit A2, 2026-06-13).

**SSCC-generator:** `genereer_sscc()` produceert 18 cijfers — extension `0` + Karpi GS1-prefix `8715954` + 9-cijferig serial (sequence `sscc_serial_seq`) + Mod-10 check digit. Helper `sscc_check_digit(text)` voor verificatie.

---

### verzend_wachtrij
**Geconsolideerde verzend-wachtrij** (mig 426, ADR-0038, data-as) — één rij per zending die naar een vervoerder verstuurd moet worden, gediscrimineerd op `vervoerder_code` (`'hst_api'|'verhoek_sftp'|'rhenus_sftp'`). Vervangt de drie per-vervoerder-tabellen hieronder (die blijven t/m de contract-drop staan als rollback-vangnet). Draagt alléén operationele state + drie generieke correlatievelden; de rauwe request/response-payload leeft in `externe_payloads` (mig 325) — dát maakt de generalisatie *deep* i.p.v. *shallow* (de eerdere afweging hieronder ging uit van payload-op-de-rij; die is nu geschrapt).

| Kolom | Type | Opmerking |
|---|---|---|
| id | BIGSERIAL PK | |
| zending_id | BIGINT NOT NULL FK → zendingen | ON DELETE CASCADE |
| debiteur_nr | INTEGER FK → debiteuren | |
| vervoerder_code | TEXT NOT NULL | discriminator |
| status | verzend_status NOT NULL | Default `'Wachtrij'` |
| extern_referentie | TEXT | HST transportOrderId \| SFTP bestandsnaam |
| track_trace | TEXT | HST trackingNumber \| Verhoek zending_nr \| NULL (Rhenus) |
| document_pad | TEXT | storage-pad PDF (HST) \| XML (SFTP) |
| retry_count | INTEGER NOT NULL | Default 0 |
| error_msg | TEXT | |
| is_test | BOOLEAN NOT NULL | Default FALSE |
| created_at / sent_at / updated_at | TIMESTAMPTZ | |

**Enum `verzend_status`:** `'Wachtrij' | 'Bezig' | 'Verstuurd' | 'Fout' | 'Geannuleerd'`

**Index:** `uk_verzend_wachtrij_zending_actief` — UNIQUE op `zending_id` waar `status NOT IN ('Fout','Geannuleerd')` (één actieve rij per zending over álle carriers).

**Generieke RPC's** (geparametriseerd op `vervoerder_code`):
- `enqueue_transportorder(p_zending_id, p_debiteur_nr, p_vervoerder_code, p_is_test DEFAULT FALSE) → BIGINT` — idempotent.
- `claim_volgende_transportorder(p_vervoerder_code) → verzend_wachtrij` — oudste `Wachtrij`-rij voor die carrier, `FOR UPDATE SKIP LOCKED` → `Bezig`.
- `markeer_transportorder_verstuurd(p_id, p_extern_referentie, p_track_trace, p_document_pad)` — `track_trace` op de zending alleen bij non-NULL; status-flip Klaar→Onderweg; HST-PDF → order_documenten via `trg_verzend_wachtrij_pdf`.
- `markeer_transportorder_fout(p_id, p_error, p_max_retries DEFAULT 3)` — retry-cascade.
- `herstel_vastgelopen_verzending(p_vervoerder_code, p_minuten DEFAULT 10) → INTEGER` — reaper.

**View `verzend_monitor`** — cron-health per `vervoerder_code` (GROUP BY): `verstuurd_vandaag, fout_open, wachtrij, bezig, oudste_wachtrij_minuten, oudste_bezig_minuten`.

### hst_transportorders
> **⚠️ Superseded door `verzend_wachtrij`** (mig 426, ADR-0038). Blijft als rollback-vangnet t/m de contract-drop (slice 5); na de cutover niet meer gelezen.

**HST-adapter-tabel** (mig 171) — één rij per transportorder die naar HST is/wordt verstuurd. **HST-specifiek**: géén multi-vervoerder-abstractie, géén berichttype-discriminator (alle rijen zijn transportorders), géén `vervoerder_code` (deze tabel ÍS HST). Toekomstige EDI-vervoerders (Rhenus, Verhoek) hergebruiken de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'` (DESADV) — geen wijziging aan `hst_transportorders`. Het ontwerp is bewust per-vervoerder verticaal omdat een gegeneraliseerde `vervoerder_berichten`-queue *shallow* zou zijn: de interface (JSONB-payload + tekstuele extern_id + retry) is bijna net zo complex als de twee implementaties zelf.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_id | BIGINT FK → zendingen | NOT NULL, ON DELETE CASCADE |
| debiteur_nr | INTEGER FK → debiteuren | Snapshot voor query-gemak |
| status | hst_transportorder_status NOT NULL | Default `'Wachtrij'` |
| extern_transport_order_id | TEXT | HST `transportOrderId` uit response |
| extern_tracking_number | TEXT | HST `trackingNumber` uit response (mogelijk leeg bij creatie) |
| request_payload | JSONB | Door payload-builder gevuld bij claim of bij `markeer_hst_verstuurd` |
| response_payload | JSONB | Volledige HST-response (200 of foutbody) |
| response_http_code | INTEGER | HTTP-status — voor retry-strategie |
| retry_count | INTEGER NOT NULL | Default 0; max 3 (configureerbaar in `markeer_hst_fout`) |
| error_msg | TEXT | Laatste foutomschrijving |
| is_test | BOOLEAN NOT NULL | Default FALSE — markeert acceptatie-omgeving-orders |
| created_at, sent_at, updated_at | TIMESTAMPTZ | Lifecycle-timestamps |

**Indexen:**
- `idx_hst_to_status` (status) — voor cron-claim-query
- `idx_hst_to_zending` (zending_id)
- `idx_hst_to_debiteur` (debiteur_nr, created_at DESC)
- `uk_hst_to_zending_actief` — UNIQUE op `zending_id` waar `status NOT IN ('Fout', 'Geannuleerd')` (idempotentie: één actieve transportorder per zending; retry via `verstuurZendingOpnieuw` zet de oude rij eerst op `Geannuleerd`)

**Triggers:** `trg_hst_to_updated_at` via `set_hst_to_updated_at()`.

**RPCs (HST-adapter):**
- `enqueue_hst_transportorder(p_zending_id BIGINT, p_debiteur_nr INTEGER, p_is_test BOOLEAN DEFAULT FALSE) → BIGINT` — adapter-RPC, idempotent (no-op bij bestaande actieve rij). Wordt aangeroepen door `enqueue_zending_naar_vervoerder` als `vervoerder_code='hst_api'`. Request-payload wordt **niet** hier gebouwd, maar door de edge function bij claim-tijd (zo blijft data vers).
- `claim_volgende_hst_transportorder() → hst_transportorders` — pakt oudste `Wachtrij`-rij via `FOR UPDATE SKIP LOCKED`, zet status `Bezig`. Aangeroepen door edge function `hst-send` per cron-tick.
- `markeer_hst_verstuurd(p_id, p_extern_transport_order_id, p_extern_tracking_number, p_request_payload, p_response_payload, p_response_http_code) → VOID` — na 200-respons: status `Verstuurd`, schrijft `track_trace` terug op `zendingen` en zet zending-status van `'Klaar voor verzending'` naar `'Onderweg'`.
- `markeer_hst_fout(p_id, p_error, p_request_payload, p_response_payload, p_response_http_code, p_max_retries DEFAULT 3) → VOID` — verhoogt `retry_count`; bij `>=` max → status `Fout`, anders terug naar `Wachtrij`.

---

### verhoek_transportorders
**Verhoek-adapter-tabel** (mig 375, ADR-0031) — één rij per XML-bestand dat via SFTP naar Verhoek is/wordt verstuurd. Spiegelt `hst_transportorders`; bewust verticaal per vervoerder (zie ADR-0031). Audit-historie van pogingen: `externe_payloads` kanaal `'verhoek'`; XML-kopie in storage `order-documenten/verhoek-xml/`.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_id | BIGINT FK → zendingen | NOT NULL, ON DELETE CASCADE |
| debiteur_nr | INTEGER FK → debiteuren | Snapshot voor query-gemak |
| status | verhoek_transportorder_status NOT NULL | Default `'Wachtrij'` |
| bestandsnaam | TEXT | `Karpi_<timestamp>_<zending_nr>.xml` — de dedup-sleutel bij Verhoek; wordt vóór upload gepersisteerd zodat retries dezelfde naam hergebruiken |
| xml_storage_path | TEXT | Pad in storage-bucket `order-documenten/verhoek-xml/` |
| track_trace_id | TEXT | Door ons gegenereerd (= `zending_nr`), historisch uniek |
| request_xml | TEXT | Laatste verstuurde XML |
| retry_count | INTEGER NOT NULL | Default 0; max 3 (configureerbaar in `markeer_verhoek_fout`) |
| error_msg | TEXT | Laatste foutomschrijving |
| is_test | BOOLEAN NOT NULL | Default FALSE |
| created_at, sent_at, updated_at | TIMESTAMPTZ | Lifecycle-timestamps |

**Enum `verhoek_transportorder_status`:** `'Wachtrij' | 'Bezig' | 'Verstuurd' | 'Fout' | 'Geannuleerd'`

**Indexen:**
- `idx_verhoek_to_status` (status) — voor cron-claim-query
- `idx_verhoek_to_zending` (zending_id)
- `uk_verhoek_to_zending_actief` — UNIQUE op `zending_id` waar `status NOT IN ('Fout', 'Geannuleerd')` (idempotentie: één actieve transportorder per zending)

**Triggers:** `trg_verhoek_to_updated_at` via `set_verhoek_to_updated_at()`.

**RPCs (Verhoek-adapter):**
- `enqueue_verhoek_transportorder(p_zending_id BIGINT, p_debiteur_nr INTEGER, p_is_test BOOLEAN DEFAULT FALSE) → BIGINT` — adapter-RPC, idempotent (no-op bij bestaande actieve rij). Wordt aangeroepen door `enqueue_zending_naar_vervoerder` als `vervoerder_code='verhoek_sftp'`. Mig 375.
- `claim_volgende_verhoek_transportorder() → verhoek_transportorders` — pakt oudste `Wachtrij`-rij via `FOR UPDATE SKIP LOCKED`, zet status `Bezig`. Aangeroepen door edge function `verhoek-send` per cron-tick. Mig 375.
- `markeer_verhoek_verstuurd(p_id, p_bestandsnaam, p_xml_storage_path, p_track_trace_id, p_request_xml) → VOID` — na geslaagde SFTP-upload: status `Verstuurd`, schrijft `track_trace` terug op `zendingen` en zet zending-status van `'Klaar voor verzending'` naar `'Onderweg'`. Mig 375.
- `markeer_verhoek_fout(p_id, p_error, p_request_xml DEFAULT NULL, p_max_retries DEFAULT 3) → VOID` — verhoogt `retry_count`; bij `>=` max → status `Fout`, anders terug naar `Wachtrij`. Mig 375.
- `herstel_vastgelopen_verhoek(p_minuten INTEGER DEFAULT 10) → INTEGER` — **self-healing reaper** (mig 375, SECURITY DEFINER). Zet `verhoek_transportorders`-rijen die >`p_minuten` op `'Bezig'` hangen terug naar `'Wachtrij'`. Bovenin elke `verhoek-send`-run + handmatig.

---

### rhenus_transportorders
**Rhenus-adapter-tabel** (mig 380, ADR-0032) — één rij per GS1 TransportInstruction-XML-bestand (RHE 3.1) dat via SFTP naar Rhenus is/wordt verstuurd. Spiegelt `verhoek_transportorders`, met één verschil: **geen `track_trace_id`** — het RHE-formaat kent geen T&T-slot (statusterugkoppeling via Rhenus' /out-map = V2-backlog). Audit-historie van pogingen: `externe_payloads` kanaal `'rhenus'`; XML-kopie in storage `order-documenten/rhenus-xml/`.

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| zending_id | BIGINT FK → zendingen | NOT NULL, ON DELETE CASCADE |
| debiteur_nr | INTEGER FK → debiteuren | Snapshot voor query-gemak |
| status | rhenus_transportorder_status NOT NULL | Default `'Wachtrij'` |
| bestandsnaam | TEXT | `RHE_<datum>_<zending_nr>.xml` (alleen datum `YYYYMMDD`, géén tijd — Rhenus-akkoord 2026-06-17, oude datum+tijd-vorm was te lang) — vóór upload gepersisteerd zodat retries dezelfde naam hergebruiken (geen dubbele transportorder bij Rhenus). Uniekheid via globaal-unieke `zending_nr`; datum dient alleen voor sortering |
| xml_storage_path | TEXT | Pad in storage-bucket `order-documenten/rhenus-xml/` |
| request_xml | TEXT | Laatste verstuurde XML |
| retry_count | INTEGER NOT NULL | Default 0; max 3 (configureerbaar in `markeer_rhenus_fout`) |
| error_msg | TEXT | Laatste foutomschrijving |
| is_test | BOOLEAN NOT NULL | Default FALSE |
| created_at, sent_at, updated_at | TIMESTAMPTZ | Lifecycle-timestamps |

**Enum `rhenus_transportorder_status`:** `'Wachtrij' | 'Bezig' | 'Verstuurd' | 'Fout' | 'Geannuleerd'`

**Indexen:** `idx_rhenus_to_status`, `idx_rhenus_to_zending`, `uk_rhenus_to_zending_actief` (UNIQUE op `zending_id` waar `status NOT IN ('Fout','Geannuleerd')`).

**Triggers:** `trg_rhenus_to_updated_at` via `set_rhenus_to_updated_at()`.

**RPCs (Rhenus-adapter, alle mig 380):**
- `enqueue_rhenus_transportorder(p_zending_id, p_debiteur_nr, p_is_test DEFAULT FALSE) → BIGINT` — idempotent; aangeroepen door `enqueue_zending_naar_vervoerder` als `vervoerder_code='rhenus_sftp'`.
- `claim_volgende_rhenus_transportorder() → rhenus_transportorders` — oudste `Wachtrij`-rij via `FOR UPDATE SKIP LOCKED` → `Bezig`. Aangeroepen door edge function `rhenus-send` per cron-tick.
- `markeer_rhenus_verstuurd(p_id, p_bestandsnaam, p_xml_storage_path, p_request_xml) → VOID` — status `Verstuurd` + zending-status `'Klaar voor verzending'` → `'Onderweg'` (géén track_trace — geen T&T-slot in het formaat).
- `markeer_rhenus_fout(p_id, p_error, p_request_xml DEFAULT NULL, p_max_retries DEFAULT 3) → VOID` — retry-teller; bij `>=` max → `Fout`, anders terug naar `Wachtrij`.
- `herstel_vastgelopen_rhenus(p_minuten DEFAULT 10) → INTEGER` — self-healing reaper (spiegel `herstel_vastgelopen_verhoek`).

**Monitor-view:** `rhenus_verzend_monitor` (spiegel `verhoek_verzend_monitor`): verstuurd_vandaag / fout_open / wachtrij / bezig / oudste_wachtrij_minuten / oudste_bezig_minuten.

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
| scancode | TEXT UK | Unieke scancode voor barcode/QR (gegenereerd via genereer_scancode()) |
| prioriteit | INTEGER | Sorteervolgorde binnen planning |
| planning_week | INTEGER | Weeknummer waarvoor gepland |
| planning_jaar | INTEGER | Jaar waarvoor gepland |
| positie_x_cm | NUMERIC | X-positie op de rol in cm (strip-packing) |
| positie_y_cm | NUMERIC | Y-positie op de rol in cm (strip-packing) |
| geroteerd | BOOLEAN | Of het stuk 90° gedraaid is t.o.v. originele afmetingen |
| afleverdatum | DATE | Gewenste afleverdatum (overgenomen uit order) |
| gesneden_datum | DATE | |
| grondstofkosten | NUMERIC(12,2) | Toegerekende inkoopkosten in € incl. proportioneel afval. Gezet bij `voltooi_snijplan_rol`. NULL = bronrol had geen waarde/oppervlak. Zie migratie 088. |
| grondstofkosten_m2 | NUMERIC(10,4) | Aan dit stuk toegerekend oppervlak in m² = stuk_m² + aandeel × afval_m². Snapshot. |
| inkoopprijs_m2 | NUMERIC(10,2) | Snapshot `rol.waarde / rol.oppervlak_m2` op moment van snijden. |
| opmerkingen | TEXT | |
| confectie_afgerond_op | TIMESTAMPTZ | Moment waarop confectie klaar is (NULL = nog niet afgerond). Productie-only orders flippen naar `'Maatwerk afgerond'` zodra ÁLLE snijplannen van de order deze gezet hebben (`voltooi_confectie`, mig 330). |
| ingepakt_op | TIMESTAMPTZ | Moment waarop het stuk is ingepakt voor verzending |
| locatie | TEXT | Magazijnlocatie waar het ingepakte stuk ligt (vrije tekst bv. "A-12") |
| snijden_uit_standaardmaat | BOOLEAN NOT NULL DEFAULT false | Mig 327 (ADR-0029). Gekopieerd van `order_regels` door `auto_maak_snijplan`/`auto_sync_snijplan_maten` (mig 328). Uitgesloten van rol-packing (`fetchStukken`) — verbruikt geen rollengte. |
| verwacht_inkooporder_regel_id | BIGINT FK → inkooporder_regels | Mig 438. Gezet zodra `status='Wacht op inkoop'` (mig 437) — stuk past op een nog niet ontvangen rol uit deze openstaande inkooporder_regel (virtuele rol, in-memory in `auto-plan-groep`, nooit een rij in `rollen`). CHECK wederzijds exclusief met `rol_id`. |
| is_handmatig_toegewezen | BOOLEAN NOT NULL DEFAULT false | Mig 453 (Fase 4). TRUE = een planner heeft dit stuk handmatig aan `rol_id` toegewezen via `wijs_snijplan_handmatig_toe()`. `release_gepland_stukken()` slaat vergrendelde stukken over — `auto-plan-groep` kan de keuze dus nooit terugdraaien (het stuk wordt door `fetchBezettePlaatsingen` gezien als bezette shelf-ruimte, net als al-gesneden stukken). Ontgrendelen via `ontgrendel_handmatige_toewijzing()`. |

---

### snijvoorstellen
Geoptimaliseerde snijvoorstellen per kwaliteit+kleur groep. Gegenereerd door de `optimaliseer-snijplan` Edge Function.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| voorstel_nr | TEXT UK | SNIJV-2026-0001 |
| kwaliteit_code | TEXT FK → kwaliteiten | |
| kleur_code | TEXT | |
| status | TEXT CHECK | 'concept', 'goedgekeurd', 'verworpen' |
| totaal_stukken | INTEGER | Aantal snijplannen in voorstel |
| totaal_rollen | INTEGER | Aantal rollen gebruikt |
| totaal_m2_gebruikt | NUMERIC(10,2) | Totaal materiaalverbruik |
| totaal_m2_afval | NUMERIC(10,2) | Totaal afval |
| afval_percentage | NUMERIC(5,2) | Gemiddeld afvalpercentage |
| aangemaakt_door | TEXT | Gebruiker die voorstel genereerde |
| fifo_badge | TEXT CHECK | ADR-0021/mig 284: `'grijs'` (leeftijd speelde niet / 0 extra afval), `'geel'` (matig extra afval voor FIFO), `'rood'` (fors → NIET auto-approven in `auto-plan-groep`). NULL voor pre-mig 284 voorstellen **én voor alle voorstellen in `app_config.snijplanning.modus='simpel'`** (mig 285 — geavanceerde laag geparkeerd). |
| extra_afval_m2, extra_afval_pct | NUMERIC | Extra snijafval van dit leeftijd-slimme voorstel t.o.v. de pure-efficiency-variant. 0 bij grijs/short-circuit. |
| oudste_rol_dagen, efficient_oudste_rol_dagen | INTEGER | Magazijnleeftijd (dgn) van de oudste gebruikte rol — gekozen vs. efficiëntst. |
| rolwissels, efficient_rolwissels | INTEGER | Aantal aangesneden rollen — gekozen vs. efficiëntst. |
| fifo_rationale | JSONB | `{ reden, rollen: [{rol_id, rolnummer, leeftijd_dagen}] }` voor de uitklapbare badge-uitleg. |

### snijvoorstel_plaatsingen
Individuele stuk-plaatsingen per rol binnen een snijvoorstel.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | |
| voorstel_id | BIGINT FK → snijvoorstellen | CASCADE DELETE |
| snijplan_id | BIGINT FK → snijplannen | |
| rol_id | BIGINT FK → rollen | |
| positie_x_cm | NUMERIC | X-positie op de rol (over de breedte) |
| positie_y_cm | NUMERIC | Y-positie op de rol (langs de lengte) |
| geroteerd | BOOLEAN | Of het stuk 90° gedraaid is |
| lengte_cm | INTEGER | Effectieve lengte na evt. rotatie |
| breedte_cm | INTEGER | Effectieve breedte na evt. rotatie |

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
| scancode | TEXT UK | Unieke scancode voor barcode/QR |
| status | confectie_status | Default 'Wacht op materiaal' |
| gestart_op | TIMESTAMPTZ | Wanneer confectie is gestart |
| gereed_op | TIMESTAMPTZ | Wanneer confectie is afgerond |
| medewerker | TEXT | Naam/code van de medewerker die de confectie uitvoert |
| gereed_datum | DATE | |
| opmerkingen | TEXT | |

---

### confectie_werktijden
Configuratie per `type_bewerking` voor de confectie-planning (minuten per strekkende meter + wisseltijd). Eén rij per type; seed in migratie 053.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| type_bewerking | TEXT PK | 'breedband', 'smalband', 'feston', 'smalfeston', 'locken', 'volume afwerking', 'stickeren' |
| minuten_per_meter | NUMERIC(6,2) NOT NULL | Tijd per strekkende meter |
| wisseltijd_minuten | INTEGER NOT NULL DEFAULT 5 | Pakken + wegleggen volgend stuk |
| parallelle_werkplekken | INTEGER NOT NULL DEFAULT 1 | Aantal parallelle werkplekken. Planning rekent beschikbare minuten × dit getal per week. |
| actief | BOOLEAN NOT NULL DEFAULT true | False = type wordt niet gepland (bv. stickeren) |
| bijgewerkt_op | TIMESTAMPTZ DEFAULT NOW() | Auto-update via trigger `set_bijgewerkt_op()` |

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
_Aangemaakt in migratie 127 (2026-04-24)._

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| leverancier_nr | INTEGER UK | Extern nummer uit oud systeem (Inkoopoverzicht.xlsx). NULL voor handmatig aangemaakt. |
| naam | TEXT NOT NULL | |
| woonplaats | TEXT | |
| adres, postcode, land | TEXT | |
| contactpersoon, telefoon, email | TEXT | |
| betaalconditie | TEXT | |
| actief | BOOLEAN NOT NULL DEFAULT true | |
| created_at, updated_at | TIMESTAMPTZ | Auto (trigger) |

### inkooporders
_Aangemaakt in migratie 127 (2026-04-24)._

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| inkooporder_nr | TEXT UK NOT NULL | INK-2026-0001, via `volgend_nummer('INK')` bij handmatige invoer; bij import berekend uit oud_inkooporder_nr |
| oud_inkooporder_nr | BIGINT UK | Ordernummer uit oud systeem (Inkoopoverzicht.xlsx). NULL voor nieuwe orders. |
| leverancier_id | BIGINT FK → leveranciers(id) | ON DELETE RESTRICT |
| besteldatum | DATE | |
| leverweek | TEXT | Format "NN/YYYY" uit oud systeem, bijv. "18/2026" |
| verwacht_datum | DATE | Maandag van leverweek (NULL bij dummy-weken buiten 2024–2030) |
| status | inkooporder_status NOT NULL DEFAULT 'Concept' | |
| bron | TEXT NOT NULL DEFAULT 'handmatig' | `'import'` of `'handmatig'` |
| opmerkingen | TEXT | |
| created_at, updated_at | TIMESTAMPTZ | Auto (trigger) |

### inkooporder_regels
_Aangemaakt in migratie 127 (2026-04-24)._

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| inkooporder_id | BIGINT FK → inkooporders | CASCADE DELETE |
| regelnummer | INTEGER NOT NULL DEFAULT 1 | |
| artikelnr | TEXT FK → producten(artikelnr) ON DELETE SET NULL | NULL voor regels met onbekend artikel (import) |
| artikel_omschrijving | TEXT | Snapshot Excel-kolom "Omschrijving 1" |
| karpi_code | TEXT | Snapshot Excel-kolom "Omschrijving" (bijv. TWIS15400VIL) |
| inkoopprijs_eur | NUMERIC(10,2) | |
| besteld_m | NUMERIC(10,2) NOT NULL DEFAULT 0 | Besteld aantal — meters als `eenheid='m'`, stuks als `eenheid='stuks'`. Kolomnaam blijft `besteld_m` voor backwards-compat. |
| geleverd_m | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| te_leveren_m | NUMERIC(10,2) NOT NULL DEFAULT 0 | = besteld_m − geleverd_m |
| eenheid | TEXT NOT NULL DEFAULT 'm' CHECK ('m','stuks') | `'m'` voor rolproducten, `'stuks'` voor vaste afmetingen / staaltjes. Afgeleid uit `producten.product_type` bij import. |
| status_excel | INTEGER | Status-code uit bron-Excel (1 actief, 8 geannuleerd, 0 onbekend) |
| snijplan_gebruikte_lengte_cm | INTEGER NOT NULL DEFAULT 0 | Mig 438. Snapshot: cm van deze (nog niet ontvangen) rol belegd door `snijplannen.status='Wacht op inkoop'`. Single writer `claim_wacht_op_inkoop()`/`release_wacht_op_inkoop_stukken()` — volledige overwrite per `auto-plan-groep`-run, geen optelling. |
| UK: (inkooporder_id, regelnummer) | | |

**Koppeling aan rollen:** `rollen.inkooporder_regel_id` (BIGINT FK → inkooporder_regels) legt vast uit welke regel een fysieke rol ontvangen is. Gevuld door RPC `boek_ontvangst`.

**Koppeling aan snijplannen (mig 437/438):** vóór fysieke ontvangst kan een snijplan-stuk al "Wacht op inkoop" claimen op een openstaande regel via `snijplannen.verwacht_inkooporder_regel_id` — zie sectie `snijplannen`.

### order_documenten
_Aangemaakt in migratie 178 (2026-05-01)._

PDF/afbeelding/Excel/Word/TXT-bijlagen bij een verkooporder (klant-PO, bevestiging, bijlagen).

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| order_id | BIGINT FK → orders ON DELETE CASCADE | |
| bestandsnaam | TEXT NOT NULL | Originele filename incl. extensie |
| storage_path | TEXT UK NOT NULL | `orders/{order_id}/{uuid}-{sanitized}` in bucket `order-documenten` |
| mime_type | TEXT | |
| grootte_bytes | BIGINT | |
| omschrijving | TEXT | Optioneel, inline editbaar in UI |
| geupload_door | UUID FK → auth.users ON DELETE SET NULL | |
| geupload_op | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### inkooporder_documenten
_Aangemaakt in migratie 178 (2026-05-01)._

PDF/afbeelding/Excel/Word/TXT-bijlagen bij een inkooporder (orderbevestiging leverancier, pakbon, factuur).

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| inkooporder_id | BIGINT FK → inkooporders ON DELETE CASCADE | |
| bestandsnaam | TEXT NOT NULL | |
| storage_path | TEXT UK NOT NULL | `inkooporders/{inkooporder_id}/{uuid}-{sanitized}` in bucket `order-documenten` |
| mime_type | TEXT | |
| grootte_bytes | BIGINT | |
| omschrijving | TEXT | |
| geupload_door | UUID FK → auth.users ON DELETE SET NULL | |
| geupload_op | TIMESTAMPTZ NOT NULL DEFAULT now() | |

---

### scan_events
Registratie van elke barcode/QR-scan in het productieproces.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| scancode | TEXT | De gescande code |
| scan_type | TEXT | 'snijplan', 'confectie', 'inpak', 'expeditie' |
| actie | TEXT | 'start', 'gereed', 'controle' |
| medewerker | TEXT | Wie heeft gescand |
| station | TEXT | Welk werkstation/tablet |
| metadata | JSONB | Extra data per scan |
| created_at | TIMESTAMPTZ | Tijdstip van de scan |

---

### voorraad_mutaties
Logboek van alle voorraadwijzigingen (snijden, reststuk, correctie, inkoop).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment (`GENERATED ALWAYS AS IDENTITY`) |
| rol_id | BIGINT FK → rollen | Betrokken rol (NOT NULL) |
| type | TEXT | CHECK: `'inkoop'`, `'snij'`, `'reststuk'`, `'correctie'`, `'afgekeurd'` |
| lengte_cm | NUMERIC | Lengte van de mutatie (bij inkoop = nieuwe rol-lengte, bij snij = afgesneden lengte) — NOT NULL |
| breedte_cm | NUMERIC | Breedte (nullable) |
| referentie_id | BIGINT | ID van gerelateerd record (bv. snijplan_id, inkooporder_regel_id) |
| referentie_type | TEXT | Soort referentie: `'snijplan'`, `'inkooporder_regel'`, etc. |
| notitie | TEXT | Vrije tekst/toelichting |
| aangemaakt_op | TIMESTAMPTZ | Auto (`DEFAULT now()`) |
| aangemaakt_door | TEXT | Wie heeft de mutatie uitgevoerd |

⚠️ **Let op:** eerdere versies van deze docs beschreven verzonnen kolommen (`lengte_voor_cm`, `lengte_na_cm`, `reden`, `medewerker`, type=`'ontvangst'`/`'gesneden'`). De werkelijke schema komt uit commit `ece9ecd` en is hierboven weergegeven. Migratie 136 herstelt `boek_ontvangst` naar deze echte kolommen.

---

### rol_mutaties
Audittrail voor handmatige rol-CRUD (voorraadcorrectie/inventarisatie). Mig 290 (ADR-0024).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | `GENERATED ALWAYS AS IDENTITY` |
| rol_id | BIGINT | **Bewust GEEN FK** — auditregel overleeft een verwijderde rol |
| rolnummer | TEXT | Snapshot |
| artikelnr | TEXT | Snapshot |
| actie | TEXT | CHECK: `'toevoegen'`, `'bewerken'`, `'verwijderen'` |
| oppervlak_delta_m2 | NUMERIC(10,2) | Effect op de getoonde m²-som (+/−/0), informatief |
| oud_json | JSONB | Rol-velden vóór mutatie (NULL bij toevoegen) |
| nieuw_json | JSONB | Rol-velden na mutatie (NULL bij verwijderen) |
| reden | TEXT NOT NULL | Verplicht |
| medewerker | TEXT | Doorgegeven vanuit frontend |
| created_at | TIMESTAMPTZ | `DEFAULT now()` |

---

### migratie_blokkering
**Tijdelijke** FIFO-lengtereservering van nog-niet-gesneden oud-systeem maatwerk-orders op fysieke rollen (ADR-0028, mig 313). Doel: voorkomen dat de bij migratie overgenomen voorraad dubbel wordt verkocht terwijl de openstaande op-maat-orders nog niet zijn gesneden. Bron-van-waarheid zolang de overgang naar het nieuwe systeem loopt. De tabel is leeg zodra alle geblokkeerde orders zijn gesneden en vrijgegeven.

**Snijmethodiek:** `breedte_nodig_cm = max(A, B)` moet passen binnen `rollen.breedte_cm`; `gereserveerde_lengte_cm = min(A, B)` wordt verbruikt over de volledige rolbreedte. Voor ronde maten (`RND`): diameter geldt voor beide dimensies. FIFO-volgorde: `rollen.in_magazijn_sinds ASC NULLS LAST`. Geen 2D-nesting — bewust pessimistisch (full-width strip).

| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | `GENERATED ALWAYS AS IDENTITY` |
| rol_id | BIGINT NOT NULL FK → rollen(id) | ON DELETE CASCADE |
| gereserveerde_lengte_cm | INTEGER NOT NULL | CHECK > 0. Lengte (min-zijde van het stuk) die full-width wordt geblokkeerd. |
| breedte_nodig_cm | INTEGER NOT NULL | CHECK > 0. Max-zijde van het stuk — moet ≤ `rollen.breedte_cm`. |
| oud_ordernr | TEXT NOT NULL | Ordernummer uit oud systeem (audit-referentie). |
| oud_orderregel | TEXT NOT NULL | Regelnummer/omschrijving uit oud systeem. |
| deel_index | INTEGER NOT NULL DEFAULT 1 | 1..Aantal voor regels met `Aantal > 1` (per stuk een eigen blokkering). |
| kwaliteit_code | TEXT | Kwaliteitscode van het geblokkeerde stuk (informatief, nullable). |
| kleur_code | TEXT | Kleurcode (informatief, nullable). |
| status | TEXT NOT NULL DEFAULT 'actief' | CHECK IN (`'actief'`, `'vrijgegeven'`). Actief = blokkeert packer; Vrijgegeven = order is gesneden, blokkering inactief. |
| aangemaakt_op | TIMESTAMPTZ NOT NULL DEFAULT now() | Tijdstip aanmaak. |
| vrijgegeven_op | TIMESTAMPTZ | NULL zolang actief; gevuld door release-script. |
| UK: (oud_ordernr, oud_orderregel, deel_index) | | Voorkomt dubbele blokkering per stuk. |

**Indexen:**
- `idx_migratie_blokkering_rol_actief` — partial index op `(rol_id)` WHERE `status = 'actief'`; voedt `fetchBezettePlaatsingen`.
- `idx_migratie_blokkering_order` — op `(oud_ordernr, oud_orderregel)`; voedt release-script lookup.

**RLS:** enabled; `SELECT` voor `authenticated` (read-only policy).

**Packer-injectie (`fetchBezettePlaatsingen`, `supabase/functions/_shared/db-helpers.ts`):** injecteert per getroffen rol één full-width bodem-strip als synthetische `Placement` (`x=0, y=0, lengte_cm=rol.breedte_cm, breedte_cm=gereserveerde_lengte_cm, snijplan_id=−rol_id`) zodat de guillotine-packer er geen nieuw stuk overheen plant. Dit loopt altijd, ook als de kwal/kleur-groep géén rollen met `status='in_snijplan'` heeft. `fetchBeschikbareRollen` is bewust **niet** aangepast (vermijdt dubbele blokkering).

**`voorraadposities` RPC (mig 314, o.b.v. mig 296):** trekt de som van actieve blokkering-m² (`SUM(rollen.breedte_cm × gereserveerde_lengte_cm) / 10000` — de strip is altijd de volle rolbreedte) af van `eigen_totaal_m2`, vloer op 0 via `GREATEST`. `vrij_voor_nieuw_maatwerk_m2`, `familie_aggr` en `beste_partner` gebruiken bewust de fysieke m² (ongewijzigd).

**Scripts:**
- `import/reserveer_maatwerk_migratie.py` — eenmalig; alloceert ~1 462 actieve maatwerk-stukken, gesneden-historiek via de union van alle snijlijst-versies met per-sheet header-detect. Standaard dry-run; `--commit` schrijft naar de database.
- `import/release_migratie_blokkeringen.py` — dagelijks; zet blokkeringen op `'vrijgegeven'` zodra de order in het nieuwe systeem als gesneden is geboekt.

---

### app_config
Applicatie-instellingen (key-value). Gebruikt voor productie-configuratie en auto-planning.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| sleutel | TEXT PK | Configuratiesleutel (bijv. 'productie_planning', 'snijplanning.auto_planning') |
| waarde | JSONB | Waarde (type-vrij) |

**productie_planning waarde-structuur:**
| Veld | Type | Default | Toelichting |
|------|------|---------|-------------|
| planning_modus | 'weken' \| 'capaciteit' | 'weken' | Planmodus |
| capaciteit_per_week_streef | number | 350 | Streefwaarde tapijten/week (mig 452, Fase 3) — vervangt het verouderde `capaciteit_per_week` (450). Mag automatisch escaleren naar `capaciteit_per_week_max` binnen dezelfde week. Raakt alleen de levertijd-belofte (`check-levertijd`), niet `auto-plan-groep`. |
| capaciteit_per_week_max | number | 400 | Absolute max tapijten/week (mig 452) — de enige echte blokkerende grens in `capaciteitsCheck()`. |
| max_rollen_per_dag_streef | number | 20 | Streefwaarde max aantal verschillende rollen (wissels) per dag (mig 452) — vertaald naar een week-grens via `werkdagenInIsoWeek` (feestdagen-bewust). Puur informatief (`rollen_overschreden`), blokkeert niet. |
| capaciteit_marge_pct | number | 10 | Buffer % boven capaciteit (geldt voor beide stuks-velden) |
| weken_vooruit | number | 4 | Hoeveel weken vooruit plannen |
| max_reststuk_verspilling_pct | number | 15 | Max afval % voor reststuk-suggesties |
| wisseltijd_minuten | number | 15 | Tijd om nieuwe rol op machine te leggen |
| snijtijd_minuten | number | 5 | Gemiddelde snijtijd per karpet |
| logistieke_buffer_dagen | number | 2 | Kalenderdagen tussen snij-datum en lever-datum (transport/afhandeling). Gebruikt door `check-levertijd` edge function (migratie 081) |
| backlog_minimum_m2 | number | 12 | Informatieve drempel: backlog (m²) per kwaliteit/kleur waaronder een nieuwe rol "inefficiënt" wordt benut. Wordt getoond in `check-levertijd` `details.backlog`, maar blokkeert NIET — sinds 2026-04-17 plant de resolver altijd ASAP een nieuwe rol mits voorraadmateriaal beschikbaar is (migratie 081) |
| spoed_buffer_uren | number | 4 | Minimum aantal vrije werkuren dat per ISO-week beschikbaar moet blijven om de week niet als "vol" te markeren in de spoed-evaluatie (migratie 082) |
| spoed_toeslag_bedrag | number | 50 | Vast bedrag (€) dat als SPOEDTOESLAG-orderregel wordt toegevoegd wanneer de gebruiker spoed activeert in `<LevertijdSuggestie>` (migratie 082) |
| spoed_product_id | string | "SPOEDTOESLAG" | Artikelnr voor de spoed-toeslag-orderregel; analoog aan VERZEND-shipping logica (migratie 082) |

**order_config waarde-structuur:**
| Veld | Type | Default | Toelichting |
|------|------|---------|-------------|
| standaard_maat_werkdagen | number | 5 | Globale levertermijn voor standaard-maat (kalenderdagen); per klant overschrijfbaar via `debiteuren.standaard_maat_werkdagen` |
| maatwerk_weken | number | 4 | Globale levertermijn voor maatwerk (weken); per klant overschrijfbaar via `debiteuren.maatwerk_weken` |

**verhoek waarde-structuur** (mig 374, ADR-0031 — gelezen per run door `verhoek-send`; antwoorden van Verhoek = SQL-UPDATE, géén redeploy):
| Veld | Type | Default | Toelichting |
|------|------|---------|-------------|
| opdrachtgever_nummer | string | `''` | Karpi-klantnummer bij Verhoek. Leeg = `verhoek-send` weigert niet-dry-run verzending. |
| ~~scancode_met_00_prefix~~ | boolean | — | **Vervallen 2026-06-14** (dode JSONB-key, niet meer gelezen): ScanCode = de gedeelde Labelbarcode-seam `labelBarcode()` (AI(00)+SSCC), niet langer per-carrier configureerbaar. |
| verpakkingseenheid | string | `'Rol'` | Vrije tekst in AA2.0-XML `<Verpakkingseenheid>`. |
| levering | string | `'1'` | AA2.0-XML `<Levering>` code. |
| soort_levering | string | `'1'` | AA2.0-XML `<SoortLevering>` code. |

**werkagenda waarde-structuur** (mig 384 — één bron voor UI, edge-functions en Pick & Ship; gelezen via `fetchWerkagendaConfig()` + `_shared/werkagenda.ts`):
| Veld | Type | Default | Toelichting |
|------|------|---------|-------------|
| werkdagen | number[] | `[1,2,3,4,5]` | ISO-weekdagnummers (1=ma … 7=zo) waarop er gewerkt wordt. |
| start | 'HH:mm' | `'08:00'` | Start werktijd (lokale tijd). |
| eind | 'HH:mm' | `'17:00'` | Einde werktijd. |
| pauzeStart | 'HH:mm' | `'12:00'` | Begin middagpauze. |
| pauzeEind | 'HH:mm' | `'12:30'` | Einde middagpauze. |
| vrij | `{datum: string, naam?: string}[]` | `[]` | Lijst van vrije dagen (feestdagen/bedrijfsvakantie) in ISO-datumformaat. Gelezen door UI (productie-instellingen, snijplanning-agenda), `check-levertijd`/`spoed-check` (edge) en de Pick & Ship-dag-order-horizon (`werkdagMinN`). |

---

### snijplan_groep_locks
Race condition preventie voor automatische snijplanning. Voorkomt dat twee processen tegelijk dezelfde kwaliteit/kleur groep optimaliseren.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| kwaliteit_code | TEXT PK | Onderdeel van composite PK |
| kleur_code | TEXT PK | Onderdeel van composite PK |
| locked | BOOLEAN | Of een optimalisatie bezig is (default false) |
| locked_at | TIMESTAMPTZ | Wanneer de lock is gezet (staleness check: >5 min = verlaten) |

---

### maatwerk_vormen
Beschikbare vormen voor op-maat tapijt (rechthoek, rond, ovaal, organisch).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| code | TEXT UK | Unieke vormcode (rechthoek, rond, ovaal, organisch_a, organisch_b_sp) |
| naam | TEXT | Display naam |
| afmeting_type | TEXT | 'lengte_breedte' of 'diameter' |
| toeslag | NUMERIC(10,2) | Vaste toeslag in EUR (default 0) |
| actief | BOOLEAN | Default true |
| volgorde | INTEGER | Sorteer-volgorde in dropdowns |

---

### afwerking_types
Afwerkingsopties voor op-maat tapijt (banden, feston, locken, etc.).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| code | TEXT UK | Afwerkingscode (B, FE, LO, ON, SB, SF, VO, ZO) |
| naam | TEXT | Display naam |
| prijs | NUMERIC(10,2) | Prijs per stuk (default 0) |
| heeft_band_kleur | BOOLEAN | True voor B en SB |
| actief | BOOLEAN | Default true |
| volgorde | INTEGER | Sorteer-volgorde |
| type_bewerking | TEXT FK → confectie_werktijden.type_bewerking | Lane waar dit afwerkingstype wordt gedaan. NULL = geen confectie (alleen stickeren). |

---

### kwaliteit_standaard_afwerking
Standaard afwerking per kwaliteit (bijv. MIRA → SB).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| kwaliteit_code | TEXT PK, FK → kwaliteiten | Kwaliteitscode |
| afwerking_code | TEXT FK → afwerking_types | Standaard afwerkingscode |

---

### afwerking_kleuren
Master-lijst van kleurlabels per afwerking (bv. "Piero Taupe 431" onder SB). Voedt order-form bandkleur-dropdown en /producten kleur-tussenlaag (mig 194).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| afwerking_code | TEXT FK → afwerking_types(code) ON DELETE CASCADE | Onder welke afwerking dit label valt |
| label | TEXT | Vrije tekst, bv. "Piero Taupe 431" |
| volgorde | INTEGER | Sortering in dropdowns |
| actief | BOOLEAN | Soft-delete; default true |
| created_at | TIMESTAMPTZ | |
| UK: (afwerking_code, label) | | |

---

### maatwerk_band_defaults
Default-bandkleur per (kwaliteit, kleur). Wordt voorgeselecteerd in de order-form en ingesteld via /producten kleur-uitvouw. Vóór mig 194 alleen vrije-tekst; vanaf mig 194 strict-FK naar `afwerking_kleuren`.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| kwaliteit_code | TEXT PK | Kwaliteitscode |
| kleur_code | TEXT PK | Kleurcode |
| afwerking_kleur_id | BIGINT FK → afwerking_kleuren ON DELETE RESTRICT | Strict-FK naar bandkleur-master (mig 194). NULL voor niet-Piero rijen die handmatig gevuld moeten worden. |
| band_kleur | TEXT | Legacy: bandkleur-code (bv. "431"). Sinds mig 194 nullable; blijft als fallback voor niet-gemigreerde rijen. |
| band_omschrijving | TEXT | Legacy: kleurnaam (bv. "taupe"). |
| band_merk | TEXT | Legacy: merk (bv. "Piero", default in code). Vóór mig 194 hardcoded prefix in UI. |

---

### maatwerk_m2_prijzen
M²-prijzen per kwaliteit+kleur voor op-maat berekening (admin-instelbaar, geseeded vanuit rollen).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| kwaliteit_code | TEXT FK → kwaliteiten | Kwaliteitscode |
| kleur_code | TEXT | Kleurcode |
| verkoopprijs_m2 | NUMERIC(10,2) | Verkoopprijs per m² |
| kostprijs_m2 | NUMERIC(10,2) | Kostprijs per m² (nullable) |
| gewicht_per_m2_kg | NUMERIC(8,3) | Gewicht per m² in kg |
| max_breedte_cm | INTEGER | Maximale rolbreedte voor validatie |
| UK: (kwaliteit_code, kleur_code) | | Unieke combinatie |

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

### edi_handelspartner_config
Per debiteur welke EDI-Transus-berichttypen actief zijn (mig 156).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| debiteur_nr | INTEGER PK FK → debiteuren | CASCADE DELETE |
| transus_actief | BOOLEAN DEFAULT false | Hoofdschakelaar — false = debiteur wordt door EDI-laag genegeerd |
| order_in | BOOLEAN DEFAULT false | Ontvangen we orders van deze klant? |
| orderbev_uit | BOOLEAN DEFAULT false | Sturen we orderbevestigingen? |
| factuur_uit | BOOLEAN DEFAULT false | Sturen we facturen via EDI? |
| verzend_uit | BOOLEAN DEFAULT false | Sturen we verzendberichten? |
| test_modus | BOOLEAN DEFAULT false | Alle uitgaande berichten met IsTestMessage-marker |
| orderbev_format | edi_orderbev_format DEFAULT 'transus_xml' | Default formaat voor uitgaande orderbevestiging: `transus_xml` of `fixed_width` (mig 161). |
| vervoerder_code | TEXT FK → vervoerders.code | Legacy/voorlopig veld uit mig 170. Niet meer leidend voor logistieke dispatch sinds mig 176; gekozen vervoerder staat op `zendingen.vervoerder_code`. |
| notities | TEXT | Vrije tekst voor partner-specifieke notes |
| created_at, updated_at | TIMESTAMPTZ | Auto |

Komt overeen met de toggles per partner in Transus Online → Handelspartners → Processen. De logistieke vervoerderkeuze gebeurt sinds mig 176 op zendingniveau via `selecteer_vervoerder_voor_zending()` en niet meer via de klantkaart.

**UI:** Bewerkbaar via klant-detail → tab "EDI" ([klant-edi-tab.tsx](../frontend/src/modules/edi/components/klant-edi-tab.tsx)). Klanten-overzicht heeft EDI-filter en toont een EDI-tag op kaarten van debiteuren met `transus_actief=true`. Proces-lijst wordt gegenereerd uit [`modules/edi/registry.ts`](../frontend/src/modules/edi/registry.ts).

---

### edi_berichten
Centrale audit-/queue-tabel voor alle EDI-berichten via Transus (in én uit) (mig 157).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| richting | TEXT CHECK | 'in' (M10110-ontvangen) of 'uit' (M10100-versturen) |
| berichttype | TEXT CHECK | 'order' / 'orderbev' / 'factuur' / 'verzendbericht' |
| status | edi_bericht_status enum | Wachtrij / Bezig / Verstuurd / Verwerkt / Fout / Geannuleerd |
| transactie_id | TEXT UNIQUE | Transus' TransactionID (uniek per bericht) — idempotency-key voor inkomend |
| debiteur_nr | INTEGER FK → debiteuren | NULL als GLN niet matcht |
| order_id | BIGINT FK → orders | Voor inkomende orders + uitgaande orderbev/verzending |
| factuur_id | BIGINT FK → facturen | Voor uitgaande factuurberichten |
| zending_id | BIGINT FK → zendingen | Voor `berichttype='verzendbericht'` (mig 475): de specifieke fysieke zending waarover dit bericht gaat — samen met `order_id` de idempotentie-as (zie hieronder). Voor andere berichttypes ongebruikt (NULL). |
| bron_tabel | TEXT | Voor uitgaand: welke tabel triggerde ('orders'/'facturen'/'zendingen') |
| bron_id | BIGINT | PK van het bron-record. Idempotent met (berichttype, bron_tabel, bron_id) UK — geldt sinds mig 475 niet meer voor `berichttype='verzendbericht'` (zie hieronder) |
| payload_raw | TEXT | Letterlijke fixed-width / EDIFACT / XML |
| payload_parsed | JSONB | Geparseerde data |
| is_test | BOOLEAN | Test-marker (uit IsTestMessage of `edi_handelspartner_config.test_modus`) |
| order_response_seq | INTEGER | Sequentie per order voor TransusXML `<OrderResponseNumber>` (Karpi ordernr + 4-digit suffix), mig 161. |
| retry_count | INTEGER | Aantal mislukte verzendpogingen — `markeer_edi_fout` zet door tot max 3 |
| error_msg | TEXT | Foutbeschrijving |
| ack_status | INTEGER | 0=ge-ackt OK, 1=ge-ackt fout, 2=pending |
| ack_details | TEXT | M10300 statusDetails-tekst |
| transus_test_status | edi_transus_test_status DEFAULT 'niet_getest' | Handmatige validatiestatus na upload in Transus Online "Bekijken en testen" (mig 161). |
| transus_test_resultaat | TEXT | Vrije tekst met Transus-validatie-output of foutmelding (mig 161). |
| transus_test_at | TIMESTAMPTZ | Moment waarop het handmatige Transus-testresultaat is vastgelegd (mig 161). |
| created_at, sent_at, acked_at, updated_at | TIMESTAMPTZ | Lifecycle-timestamps |

**Unieke partial indexen:**
- `uk_edi_berichten_transactie_id` — UNIQUE op `transactie_id` (idempotentie inkomend)
- `uk_edi_berichten_uitgaand_actief` — UNIQUE op `(berichttype, bron_tabel, bron_id)` waar `richting='uit' AND berichttype <> 'verzendbericht' AND status NOT IN ('Fout','Geannuleerd')` (voorkomt dubbele triggers; verengd in mig 475 — verzendbericht heeft zijn eigen index, zie hieronder)
- `uk_edi_berichten_verzendbericht_actief` (mig 475) — UNIQUE op `(order_id, zending_id)` waar `richting='uit' AND berichttype='verzendbericht' AND status NOT IN ('Fout','Geannuleerd')`. Eenheid is de fysieke zending, niet de order: een order met ≥2 zendingen (deelzending) krijgt zo per zending zijn eigen DESADV; een bundel-zending (mig 222, meerdere orders in 1 zending) krijgt per order zijn eigen DESADV. Voor de oude `(berichttype, bron_tabel, bron_id)`-index (`bron_id`=order_id) zou de tweede deelzending van een order altijd als "al aanwezig" zijn overgeslagen.

**RPCs:** `log_edi_inkomend`, `markeer_edi_ack`, `create_edi_order`, `match_edi_artikel`, `enqueue_edi_uitgaand`, `claim_volgende_uitgaand`, `markeer_edi_verstuurd`, `markeer_edi_fout`. Sinds migratie 166 gebruikt `create_edi_order` de debiteur-prijslijst (`debiteuren.prijslijst_nr -> prijslijst_regels`) voor orderregelprijzen, met fallback op `producten.verkoopprijs`. Sinds mig 368 vult `create_edi_order` ook de e-mail-snapshots: `fact_email` (`email_factuur` → `email_overig`) en `afl_email` (e-mail van het GLN-gematchte afleveradres → `email_overig`); `create_webshop_order` idem, waarbij expliciete `p_header`-waarden winnen en `env_fallback`-orders worden overgeslagen.

**Cron `verzendbericht-edi-sweep`** (mig 377, */15 min — **ACTIEF sinds 12-06-2026, jobid 12**): roept edge function `bouw-verzendbericht-edi` aan. **Herontwerp mig 475 (2026-06-22):** sweep zoekt voortaan op `zendingen.gereed_op IS NOT NULL` (eerste moment 'Klaar voor verzending', venster ≤7 dagen) i.p.v. `orders.status='Verzonden' AND verzonden_at` — een deelzending bereikt dat moment vaak terwijl de order nog 'Deels verzonden' staat, dus de order-status was het verkeerde trigger-moment. Regels per DESADV komen uit `SUM(zending_regels.aantal)` per `order_regel_id` (wat in déze zending werkelijk verzonden is), niet uit `order_regels.orderaantal` (het volledige bestelde aantal). Minus al-bestaande `(order_id, zending_id)`-paren (idempotent; DB-backstop: `uk_edi_berichten_verzendbericht_actief`). Format `karpi-verzendbericht.ts` is byte-identiek gevalideerd tegen Transus-bericht 172390327 + Testen-tab-akkoord. Verstuurd door bestaande cron `transus-send` (mig 305). Plan: [`docs/superpowers/plans/2026-06-22-deelzending-correctheid.md`](superpowers/plans/2026-06-22-deelzending-correctheid.md).

---

### externe_payloads
Generieke, append-only audit van **rauwe externe payloads** per kanaal, **in- én uitgaand** (mig 324 als `inkomende_payloads`, hernoemd in mig 325). Bewaart de letterlijke payload zodat verwerkings-/verzendfouten altijd herleidbaar zijn. **Geen verwerkings-queue** — dat blijft `orders` / `edi_berichten` / `hst_transportorders`. EDI heeft z'n eigen `edi_berichten.payload_raw`; dit kanaal-onafhankelijke vangnet bedient inbound **Shopify** (slice 1, `sync-shopify-order`) en later e-mail/webshop/lightspeed, plus outbound **vervoerders** (HST via `hst-send`, `richting='out'`).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| kanaal | TEXT NOT NULL | `'shopify'` / `'edi'` / `'email'` / `'lightspeed'` / `'webshop'` / `'hst'` |
| bron | TEXT | shop-domein / systeem-identifier (bv. `'hst'`) |
| externe_id | TEXT | externe order-/transactie-/message-id; bij HST de OrderNumber of `zending_nr`. **Geen UNIQUE** — append-only, een resend/retry = extra rij |
| richting | TEXT NOT NULL DEFAULT 'in' | `'in'` (inbound) / `'out'` (carrier) |
| content_type | TEXT | bv. `application/json` |
| headers | JSONB | relevante request-headers |
| payload_raw | TEXT NOT NULL | letterlijke body — bij outbound de verstuurde request-JSON |
| payload_json | JSONB | geparset gemak; bij outbound `{ request, response, http_code, ok, transport_order_id, tracking_number }` |
| order_id | BIGINT FK → orders ON DELETE SET NULL | gevuld zodra de order bekend is (outbound: direct) |
| status | TEXT NOT NULL DEFAULT 'ontvangen' | `'ontvangen'` → `'verwerkt'` / `'fout'` (outbound: eindstatus direct) |
| fout | TEXT | foutbeschrijving bij status `'fout'` |
| ontvangen_op, verwerkt_op | TIMESTAMPTZ | lifecycle-timestamps |

**Indexen:** `(kanaal, externe_id)`, `(order_id)`, `(ontvangen_op DESC)`, partial `(ontvangen_op DESC) WHERE status='fout'` (snel de probleemgevallen), `(richting, kanaal, ontvangen_op DESC)` (carrier-verkeer per richting).

**RPCs:** `log_externe_payload(p_kanaal, p_payload_raw, p_bron, p_externe_id, p_content_type, p_headers, p_payload_json, p_richting, p_order_id, p_status, p_fout) → BIGINT` (logt, geeft id terug; outbound geeft richting/order_id/eindstatus direct mee) en `markeer_externe_payload_verwerkt(p_id, p_status, p_order_id, p_fout) → VOID` (two-step inbound status/koppeling bijwerken). Beide best-effort — logging mag verwerking/verzending nooit blokkeren. De oude namen `log_inkomende_payload` / `markeer_inkomende_payload_verwerkt` bestaan als **deprecated wrappers** (mig 325) tot de Shopify-functie herdeployed is.

**Diagnose-queries:**
- Mislukte Shopify-orders → `SELECT externe_id, fout, ontvangen_op, payload_json FROM externe_payloads WHERE kanaal='shopify' AND status='fout' ORDER BY ontvangen_op DESC;`
- Mislukte HST-verzendingen (incl. volledige retry-historie per order) → `SELECT externe_id, order_id, fout, ontvangen_op, payload_json FROM externe_payloads WHERE kanaal='hst' AND richting='out' AND status='fout' ORDER BY ontvangen_op DESC;`

---

### verstuurde_emails
Log van **daadwerkelijk verstuurde e-mails per order** (mig 366) — voedt de sectie "E-mails" (tijdlijn) op order-detail. Geschreven door edge functions [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts) en [`stuur-orderbevestiging`](../supabase/functions/stuur-orderbevestiging/index.ts) **ná** een geslaagde Microsoft Graph-send; logging is best-effort en blokkeert het mailen nooit. Een bundel-factuur over meerdere orders krijgt één rij per order; de betaler-kopie is een eigen rij. **Niet te verwarren** met `externe_payloads` (raw-payload-diagnose-vangnet) — dit is de nette, klikbare weergave-log voor operators.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| order_id | BIGINT NOT NULL FK → orders ON DELETE CASCADE | tijdlijn-sleutel |
| factuur_id | BIGINT FK → facturen ON DELETE SET NULL | alleen bij soort `'factuur'` |
| soort | TEXT CHECK | `'factuur'` / `'orderbevestiging'` |
| onderwerp | TEXT NOT NULL | letterlijke mail-subject |
| verzonden_aan | TEXT NOT NULL | komma-gescheiden ontvangers |
| verzonden_op | TIMESTAMPTZ DEFAULT now() | |
| html | TEXT | volledige mail-body; **NULL = inhoud niet bewaard** (backfill van vóór mig 366) |
| bijlagen | JSONB DEFAULT '[]' | `[{filename, bucket, path}]` → klikbaar via signed URL in de dialog |

**Index:** `(order_id)`. **RLS:** SELECT voor authenticated; géén insert/update/delete-policies — schrijven uitsluitend via service-role. Backfill in mig 366 reconstrueert eerdere mails uit `facturen.verstuurd_op/verstuurd_naar` (rij per order, EDI-only overgeslagen) en `orders.bevestigd_at/bevestiging_email` (html NULL, geen PDF). Frontend: [`order-emails.tsx`](../frontend/src/components/orders/order-emails.tsx) + [`order-email-dialog.tsx`](../frontend/src/components/orders/order-email-dialog.tsx) (body in **sandboxed iframe**), query [`verstuurde-emails.ts`](../frontend/src/lib/supabase/queries/verstuurde-emails.ts).

### shopify_sync_runs
Audit-trail van de geplande Shopify-orderpoll `sync-shopify-orders-poll` (mig 323). Eén rij per cron-tick (elke 10 min); `details` JSONB bevat per-order resultaat (`aangemaakt`/`overgeslagen (bestond al)`/`fout`). Voedt de storingsbanner op het orders-overzicht ([`ShopifySyncStatusBanner`](../frontend/src/components/orders/shopify-sync-status-banner.tsx)) — analoog aan de EDI "Te koppelen"-banner, maar dan voor sync-gezondheid i.p.v. ongekoppelde berichten.
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| gestart_op, afgerond_op | TIMESTAMPTZ | Run-lifecycle |
| status | TEXT CHECK | 'lopend' / 'ok' / 'fout' |
| shop_domain | TEXT | bv. `karpi-group.myshopify.com` |
| opgehaald, aangemaakt, overgeslagen, fouten | INTEGER | Tellers per run |
| watermark_voor, watermark_na | TIMESTAMPTZ | Snapshot van de watermark vóór/na deze run |
| details | JSONB | Array `{shopify_order, order_nr, actie, fout?}` per verwerkte order |
| foutmelding | TEXT | Bij fatale fout (bv. Shopify-API 4xx/5xx, ontbrekende secrets) |

### shopify_sync_watermark
Eén-rij-tabel (`id=1`) met `watermark TIMESTAMPTZ` = de `created_at` van de laatst succesvol verwerkte Shopify-order. Schuift na élke afgehandelde order (incl. skips) progressief vooruit binnen `sync-shopify-orders-poll` — zodat een mid-run timeout geen orders dubbel verwerkt en gemiste runs door de volgende tick zelf-helend worden ingehaald. Default-seed `2026-05-01T00:00:00Z` (ruim vóór de ontbrekende #5562-#5577-gap).

---

## Enums

| Enum | Waarden |
|------|---------|
| order_status | **Klaar voor picken** (mig 257, ADR-0016, default sinds mig 275), **Wacht op maatwerk** (mig 257), Wacht op voorraad, **Wacht op inkoop** (mig 144), **In pickronde** (mig 257), **Deels verzonden** (mig 257), Verzonden, Geannuleerd, **Maatwerk afgerond** (mig 327, ADR-0029 — terminale status uitsluitend voor productie-only orders uit Basta; bereikt zodra alle snijplannen confectie-afgerond zijn; valt buiten Pick & Ship/facturatie/transport). Legacy (niet meer geschreven post-mig 275, behalve `In productie` als import-status voor productie-only orders): Nieuw, Actie vereist, Wacht op picken, In snijplan, In productie, Deels gereed, Klaar voor verzending. |
| zending_status | Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd (mig 169). **`Gepland`** was tot mig 477 een dood, ongebruikt lid (geen schrijf-/leespad); sinds mig 477 betekent het "deelzending aangemaakt (regels gereserveerd via `start_deelzending`) maar nog niet gestart" — `start_pickronden` promoot 'm naar `Picken` zodra de picker 'm via Pick & Ship's "Picken starten" daadwerkelijk oppakt. `Ingepakt` blijft ongebruikt (niet in de V1-flow, mig 218). |
| factuur_status | Concept, Verstuurd, Betaald, Herinnering, Aanmaning, Gecrediteerd |
| factuurvoorkeur | per_zending, wekelijks |
| factuur_queue_status | pending, processing, done, failed |
| snijplan_status | Gepland, Wacht, Snijden, Gesneden, In confectie, Ingepakt, In productie, Gereed, Geannuleerd (`Snijden` toegevoegd mig 051, `BEFORE 'Gesneden'`); **Wacht op inkoop** (mig 437, `AFTER 'Wacht'` — stuk geclaimd op openstaande rol-inkoop, zie `snijplannen.verwacht_inkooporder_regel_id`) |
| inkooporder_status | Concept, Besteld, Deels ontvangen, Ontvangen, Geannuleerd |
| confectie_status | Wacht op materiaal, In productie, Kwaliteitscontrole, Gereed, Geannuleerd |
| edi_bericht_status | Wachtrij, Bezig, Verstuurd, Verwerkt, Fout, Geannuleerd (mig 157) |
| edi_orderbev_format | transus_xml, fixed_width (mig 161) |
| edi_transus_test_status | niet_getest, goedgekeurd, afgekeurd (mig 161) |
| hst_transportorder_status | Wachtrij, Bezig, Verstuurd, Fout, Geannuleerd (mig 171) |
| lever_type | week, datum (mig 244 — ADR 0014) |

---

## Views

| View | Doel |
|------|------|
| producten_overzicht | Producten + rollen-aggregatie (aantal_rollen, oppervlak, waarde) + locatie |
| dashboard_stats | Aggregaties: producten, rollen (aantal), **voorraadwaarde_inkoop = SUM(rollen.waarde) over alle rollen**, **voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) − SUM(VERZEND-regels), excl. Geannuleerd**, marge (op beschikbare rollen), open orders, klanten |
| klant_omzet_ytd | Per klant: omzet YTD, % totaal, gem/maand, tier, vertegenwoordiger |
| rollen_overzicht | Per kwaliteit/kleur: aantal, oppervlak, waarde |
| recente_orders | Laatste 50 orders met klantnaam |
| orders_status_telling | Aantal per order_status |
| snijplanning_overzicht | Snijplannen met order-, klant- en rolgegevens voor de planningsweergave. `snij_lengte_cm`/`snij_breedte_cm` zijn **nominale (bestelde) maten**. Migratie 143 voegt `marge_cm` toe (single-source via `stuk_snij_marge_cm()` migratie 126; ZO +6, rond/ovaal +2,5 sinds mig 464 (was +5), max bij combi) en `geroteerd` toe — beide nodig voor de SnijVolgorde-transformer ([frontend/src/lib/snij-volgorde/derive.ts](../frontend/src/lib/snij-volgorde/derive.ts)) die de rol-uitvoer modal voedt. Fysieke snij-maat = bestelde + marge. `marge_cm`/`placed_lengte_cm`/`placed_breedte_cm` zijn **NUMERIC sinds mig 464** (was INTEGER — 2,5 is geen heel getal); de uiteindelijke snij-instructie wordt pas in `derive.ts` afgerond naar hele cm. Mig 290: `WHERE o.status <> 'Geannuleerd'` (defense-in-depth bij ADR-0023; bewust NIET ook `'Verzonden'` — de view voedt ook de fysieke rol-uitvoer + packer). Mig 331 (ADR-0029): +3 kolommen `alleen_productie`, `oud_order_nr`, `snijden_uit_standaardmaat` zodat productie-only orders (status `In productie`/`Maatwerk afgerond`) zichtbaar blijven; geen filterwijziging. Mig 447: +2 kolommen `lever_type` (orders) en `verwacht_inkooporder_regel_id` (snijplannen, mig 438) voor het maatwerk-haalbaarheid-overzicht (`/snijplanning/haalbaarheid`, Fase 1, 2026-06-19). Mig 463: +`LEFT JOIN kwaliteiten` voor de korte-zijde-marge-uitzondering (zie `stuk_snij_marge_cm` hieronder). **Let op:** deze view heeft een harde `pg_depend`-koppeling met `stuk_snij_marge_cm` — een returntype-wijziging van die functie vereist `DROP ... CASCADE`, wat ook `confectie_planning_overzicht` meeneemt (leest van deze view). |
| confectie_overzicht | Confectie-orders met scan- en voortgangsstatus |
| confectie_planning_overzicht | Confectie-orders (status Wacht op materiaal / In productie) met klant, order, maatwerk-afmetingen en strekkende meter voor planningsweergave |
| confectie_planning_forward | Vooruitkijkende confectie-planning — alle open maatwerk-snijplannen (Gepland..In confectie/Ingepakt) met afgeleide type_bewerking + confectie_startdatum + backward-compat aliassen. Kwaliteit/kleur valt terug van rol → product → maatwerk-snapshot (mig 243) |
| productie_dashboard | Aggregaties voor het productie-dashboard: aantallen per status, capaciteit, doorlooptijd |
| leveranciers_overzicht | Per leverancier: openstaande orders/meters + eerstvolgende verwachte levering. Basis voor Leveranciers-overzichtspagina. Migratie 127. |
| inkooporders_overzicht | Per inkooporder: leveranciersnaam + aantal regels + totaal besteld/geleverd/te_leveren. Basis voor Inkooporders-overzichtspagina. Migratie 127. |
| openstaande_inkooporder_regels | Open regels (`te_leveren_m > 0` én order in Concept/Besteld/Deels ontvangen) met leverancier, product, kwaliteit/kleur. Migratie 127. |
| order_regel_levertijd | Per orderregel: levertijd-status (`voorraad` / `op_inkoop` / `wacht_op_nieuwe_inkoop` / `maatwerk`), claim-aantallen (`aantal_voorraad`, `aantal_io`, `aantal_tekort`), eerste/laatste IO-datum en berekende `verwachte_leverweek` (ISO `YYYY-Www`) op basis van `lever_modus` + buffer uit `app_config.order_config`. Migratie 150. |
| inkooporder_regel_claim_zicht | Per IO-regel: `aantal_geclaimd` / `aantal_vrij` / `aantal_orderregels` (alleen voor `eenheid='stuks'`-regels relevant). Migratie 150. |
| uitwisselbaarheid_map1_diff | Diagnostiek (migratie 138): Map1-paren in `kwaliteit_kleur_uitwisselgroepen` die NIET door `uitwisselbare_paren()` afgedekt worden, met `reden`-kolom (input-kw zonder collectie_id, kwaliteiten in andere collecties, kleur-code-mismatch, target ontbreekt in producten/rollen/maatwerk_m2_prijzen). Moet 0 rijen geven voordat Map1 fysiek gedropt mag worden. |
| vervoerder_stats | Per-vervoerder dashboard-aggregaties (mig 174, aangepast mig 176): `aantal_klanten` (distinct debiteuren uit zendingen), `aantal_zendingen_totaal` + `aantal_zendingen_deze_maand` (uit `zendingen.vervoerder_code`), `hst_aantal_verstuurd` + `hst_aantal_fout` (uit `hst_transportorders`, alleen niet-NULL voor de `hst_api`-rij). Voedt de `/logistiek/vervoerders`-overzichts- en detailpagina's. EDI-equivalent uit `edi_berichten` met `berichttype='verzendbericht'` volgt later. |
| hst_verzend_monitor | Mig 338 (ADR-0030). Aggregaat (één rij, geen state) over `hst_transportorders`: `verstuurd_vandaag`, `fout_open`, `wachtrij`, `bezig`, `oudste_wachtrij_minuten`, `oudste_bezig_minuten`. De laatste twee = **cron-health-signaal** (hoog = `hst-send`-cron staat stil; UI-drempel 5 min). Voedt de HST-verzendmonitor (tab op `/logistiek/vervoerders/hst_api/monitor`) + aandacht-banner op Pick & Ship. Tegengif tegen de "silent failure"-klasse. |
| verhoek_verzend_monitor | Mig 375 (ADR-0031). Aggregaat (één rij, geen state) over `verhoek_transportorders`: `verstuurd_vandaag`, `fout_open`, `wachtrij`, `bezig`, `oudste_wachtrij_minuten`, `oudste_bezig_minuten`. Spiegelt `hst_verzend_monitor`. `oudste_wachtrij_minuten` = cron-health-signaal voor `verhoek-send`. Frontend-paneel volgt in een later plan. |
| orders_zonder_vervoerder | Mig 338 (ADR-0030) + 345 + 372. Niet-afhaal-orders (`afhalen=FALSE`), niet productie-only (`NOT alleen_productie` — verzending blijft in Basta, ADR-0029; guard toegevoegd in mig 345), status NOT IN (`'Geannuleerd'`,`'Verzonden'`,`'Concept'`), met ≥1 regel waarvan `effectieve_vervoerder_per_orderregel(o.id).bron='geen'` (geen matchende **actieve** vervoerder → handmatig kiezen nodig). Telt dus álle open orders, óók wat Pick & Ship (nog) niet toont. Sinds mig 372 ook `status` (TEXT) en `afl_land_norm` (`normaliseer_land`, mig 214) zodat de banner per land kan uitsplitsen + "waarvan klaar voor picken" toont. Voedt de "handmatig vervoerder kiezen"-teller/banner. |
| orderregel_pickbaarheid | Mig 170; mig 288: `'Snijden'`-rang-fix; **mig 386 (v4):** (a) generieke admin-pseudo-skip `AND NOT is_admin_pseudo(oreg.artikelnr)` (ADR-0018) — vervangt de VERZEND-specifieke TS-skip én fixt de latente dropship-blokkade (DROPSHIP-KLEIN/-GROOT-regels kregen geen claim → stonden als `wacht_op='inkoop'` → dropship-orders werden nooit "alles pickbaar"); (b) nieuwe kolom `gewicht_kg` (uit `order_regels`) zodat de aparte gewicht-query in TS vervalt. Per orderregel (open orders, niet-pseudo): `order_regel_id`, `order_id`, `regelnummer`, `artikelnr`, `is_maatwerk`, `orderaantal`, maatwerk-afmetingen, `is_pickbaar`, `bron` (`snijplan`\|`rol`\|`producten_default`\|NULL), `fysieke_locatie`, `wacht_op` (`snijden`\|`confectie`\|`inpak`\|`inkoop`\|NULL), `gewicht_kg`. Single source voor Pick & Ship; de TS-laag leidt niets meer af. |
| order_pickbaarheid | **Mig 386** (hernummerd van 383 via 385; in de live DB op 12-06 onder werknummer 383 toegepast). Aggregaat per order over `orderregel_pickbaarheid`. Kolommen: `order_id`, `totaal_regels` (INT), `pickbare_regels` (INT), `alle_regels_pickbaar` (BOOL), `heeft_pickbare_regel` (BOOL), `deelleveringen_toegestaan` (BOOL, uit `debiteuren`), `pick_ship_zichtbaar` (BOOL — zie mig 476 voor de volledige formule). **Geen rij** = order heeft geen (niet-pseudo) regels = niets te picken. Single source voor het Pick & Ship-orderfilter ([`fetchPickShipOrders`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)) en de pick-start-knop (`StartPickrondesButton.alle_regels_pickbaar`); alleen de dag-order-horizon (ADR 0014) blijft client-side. **Deploy-voorwaarde:** mig 386 moet op de live DB staan vóór de frontend van deze branch deployt — er is geen fallback meer. **Mig 476 (2026-06-23):** `pick_ship_zichtbaar` = `alle_regels_pickbaar OR (deelleveringen_toegestaan AND heeft_pickbare_regel) OR EXISTS(actieve zending — status IN ('Gepland','Picken') — voor deze order)`. De derde tak is nieuw: een order met een al-lopende pickronde moet zichtbaar blijven in Pick & Ship om afgerond te kunnen worden, ook als de statische pickbaarheid-snapshot (bv. door een override-deelzending bij `deelleveringen_toegestaan=false`, of een regel die ná het starten van de pickronde niet meer pickbaar bleek) anders zou zeggen "onzichtbaar". Geverifieerd: voor orders zonder actieve zending een no-op. **Mig 479 (2026-06-23):** nieuwe kolom `heeft_gepland_zending` (BOOL, losse EXISTS alleen op `status='Gepland'`) — voedt de frontend-startbaarheid (`bepaalStartbaarheid`/`startbaarheid.ts`): die blokkeerde de "Picken starten"-knop op `!alle_regels_pickbaar` volledig los van een al-klaarstaande Gepland-zending, waardoor mig 477's promotielogica in `start_pickronden` onbereikbaar bleef voor exact het scenario waarvoor ze gebouwd was. |

---

### vervoerder_stats
Mig 174, aangepast in mig 176. Read-only view die de `/logistiek/vervoerders`-overzichts- en detailpagina's voedt. Per `vervoerders.code` levert de view klant- en zending-tellingen plus per-vervoerder success/fail-counters.

**Kolommen:** `code`, `display_naam`, `type`, `actief` (uit `vervoerders`), `aantal_klanten`, `aantal_zendingen_totaal`, `aantal_zendingen_deze_maand`, `hst_aantal_verstuurd`, `hst_aantal_fout`.

**Joins:**
- `vervoerders` LEFT JOIN op `zendingen` JOIN `orders`, gegroepeerd per `zendingen.vervoerder_code`; `aantal_klanten` is `COUNT(DISTINCT orders.debiteur_nr)`.
- LEFT JOIN op `zendingen` (COUNT per `vervoerder_code`) → `aantal_zendingen_totaal`; idem met `WHERE z.created_at >= date_trunc('month', now())` → `aantal_zendingen_deze_maand`.
- LEFT JOIN op `hst_transportorders`-aggregaten (`status='Verstuurd'` resp. `status='Fout'`) — gehard-coded gekoppeld aan `code='hst_api'`. Voor `edi_partner_a/b` blijven deze kolommen 0 totdat een vergelijkbaar EDI-aggregaat (uit `edi_berichten` met `berichttype='verzendbericht'`) is toegevoegd.

`GRANT SELECT ... TO authenticated`. Gebruik in frontend: `frontend/src/modules/logistiek/queries/vervoerders.ts → fetchVervoerderStats()`.

---

## Functies

| Functie | Doel |
|---------|------|
| `update_updated_at()` | Trigger: auto-update updated_at |
| `volgend_nummer(type TEXT)` | Geeft ORD-2026-0001, FACT-2026-0001, etc. |
| `uitwisselbare_kwaliteiten(code TEXT)` | Alle kwaliteiten in dezelfde collectie. **Note:** voor snijplanning/order-aanmaak gebruikt sinds migratie 138 de bredere functie `uitwisselbare_paren(kw, kl)` die ook kleur-matching meeneemt. |
| `uitwisselbare_paren(kw TEXT, kleur TEXT)` | **Canonieke uitwisselbaarheids-seam** (migratie 138). Returns TABLE(`target_kwaliteit_code`, `target_kleur_code`, `is_zelf BOOLEAN`). Resolver: zelfde `kwaliteiten.collectie_id` én genormaliseerde kleur-code matcht. Bron: producten ∪ rollen ∪ maatwerk_m2_prijzen. Self-row altijd gegarandeerd. Vervangt de versplinterde uitwissel-implementaties in `_shared/db-helpers.ts`, `snijplanning_tekort_analyse()`, `kleuren_voor_kwaliteit()` en `op-maat.ts`. |
| `herbereken_klant_tiers()` | Gold (top 10%), Silver (top 30%), Bronze (rest) |
| `update_order_totalen()` | Trigger: herbereken order bedrag/gewicht/regels |
| `herbereken_product_reservering(artikelnr TEXT)` | Sinds migratie 149: `gereserveerd` = SUM van `order_reserveringen.aantal` waar `bron='voorraad'` en `status='actief'`; `vrije_voorraad = voorraad − gereserveerd − backorder`. |
| `iso_week_plus(p_datum DATE, p_weken INTEGER)` | NULL-safe: returnt ISO-week-string `YYYY-Www` voor `p_datum + p_weken*7`. IMMUTABLE. Migratie 145. |
| `voorraad_beschikbaar_voor_artikel(p_artikelnr TEXT, p_excl_order_regel_id BIGINT)` | Beschikbare voorraad voor allocatie aan deze orderregel: `voorraad − backorder − ANDERE actieve voorraadclaims`. Migratie 145. |
| `io_regel_ruimte(p_io_regel_id BIGINT)` | Resterende claim-ruimte op een IO-regel (alleen `eenheid='stuks'`): `FLOOR(te_leveren_m) − SUM(actieve claims)`. Migratie 145. |
| `herallocateer_orderregel(p_order_regel_id BIGINT)` | **Centrale seam**. Idempotent: release alle actieve claims voor de orderregel + alloceer opnieuw (voorraad-eerst, dan oudste IO via `verwacht_datum ASC`). Sluit maatwerk en regels zonder artikelnr uit. Migratie 145. |
| `herwaardeer_order_status(p_order_id BIGINT)` | Delegeert naar `herbereken_wacht_status()` (single source, mig 346) + `sync_order_afleverdatum_met_claims()`. De mig-145-beschrijving hieronder is historisch: deze functie is later herschreven, de directe `UPDATE orders SET status=...`-body bestaat niet meer. Migratie 145, herschreven mig 218/346. |
| `derive_wacht_status(p_huidig order_status, p_heeft_io_claim BOOLEAN, p_heeft_tekort BOOLEAN, p_heeft_maatwerk BOOLEAN) RETURNS order_status` | **Single source of truth** voor `orders.status`-herwaardering (mig 346/352), aangeroepen via `herbereken_wacht_status()`. Prioriteit: io-claim > tekort > maatwerk > (anders) klaar-voor-picken. **Mig 470:** `'Wacht op inkoop'` = nog géén IO-claim (moet besteld worden), `'Wacht op voorraad'` = IO-claim bestaat al (wacht op levering) — omgedraaid t.o.v. de oorspronkelijke mig-346-betekenis. TS-spiegel `deriveWachtStatus()` in `_shared/order-lifecycle/derive-status.ts`, golden-fixture-contracttest (ADR-0033/0006). |
| `release_claims_voor_io_regel(p_io_regel_id BIGINT)` | Bij IO-regel annulering: alle orderregels met claim op deze IO worden via `herallocateer_orderregel` opnieuw gealloceerd. Migratie 145. |
| `bereken_late_claim_afleverdatum(p_order_id BIGINT)` | Returnt afleverdatum voor een order op basis van de laatste actieve IO-claim (`MAX(verwacht_datum) + inkoop_buffer_weken_vast × 7` dagen). NULL als er geen IO-claims zijn. Migratie 153. |
| `sync_order_afleverdatum_met_claims(p_order_id BIGINT)` | Schuift `orders.afleverdatum` + `week` vooruit naar de laatste IO-claim-leverdatum als die later is. Schuift alleen vooruit, nooit terug. Eindstatussen blijven ongewijzigd. Aangeroepen vanuit `herwaardeer_order_status`. Migratie 153. |
| `converteer_regel_naar_maatwerk(p_order_regel_id BIGINT, p_lengte_cm INTEGER, p_breedte_cm INTEGER DEFAULT NULL, p_vorm TEXT DEFAULT 'rechthoek')` | Mig 472: zet een vaste-maat-orderregel om naar maatwerk (snijden uit een rol i.p.v. uit voorraad/inkoop bestellen). Bewust minimale functie — alleen guards (niet al maatwerk, `te_leveren>0`, order niet in eindstatus) + één UPDATE op `is_maatwerk`/`maatwerk_*`-kolommen. Snijplan-aanmaak en claim-release/status-herwaardering gebeuren al automatisch via bestaande triggers (`trg_auto_sync_snijplan_maten`, `trg_orderregel_herallocateer`) — geen eigen orchestratie. |
| `kandidaat_rollen_voor_conversie(p_kwaliteit_code TEXT, p_kleur_code TEXT, p_lengte_cm INTEGER, p_breedte_cm INTEGER, p_afwerking TEXT DEFAULT NULL, p_vorm TEXT DEFAULT 'rechthoek')` | Mig 472: puur lezende kandidaat-rollen-lookup (eigen + uitwisselbaar via `uitwisselbare_paren()`) voor een orderregel die nog GEEN snijplan heeft — mirrort `kandidaat_rollen_voor_handmatige_toewijzing()` (mig 453) maar vanaf ruwe maten i.p.v. een bestaand snijplan-id. Voedt de "geen rol beschikbaar"-blokkade in de omzetten-naar-maatwerk-UI. |
| `set_uitwisselbaar_claims(p_order_regel_id BIGINT, p_keuzes JSONB)` | Vervangt handmatige uitwisselbaar-claims voor een orderregel met de in `p_keuzes` opgegeven `[{artikelnr, aantal}]`-lijst. Roept daarna `herallocateer_orderregel` aan om voorraad eigen + IO aan te vullen voor het resterende deel. Migratie 154. |
| `trg_default_fysiek_artikelnr()` | BEFORE-trigger op `order_reserveringen`: vult `fysiek_artikelnr` uit `order_regels.artikelnr` als die NULL is. Migratie 154. |
| `zoek_equivalente_producten(artikelnr TEXT, min_voorraad INTEGER)` | Zoekt producten met dezelfde collectie + kleur_code die op voorraad zijn (substitutie-suggesties) |
| `genereer_scancode()` | Genereert een unieke scancode (bijv. SNIJ-XXXX of CONF-XXXX) voor barcode/QR-stickers |
| `beste_rol_voor_snijplan(kwaliteit TEXT, kleur TEXT, lengte INTEGER, breedte INTEGER)` | Selecteert de optimale rol (minste verspilling) voor een snijplan op basis van kwaliteit, kleur en afmetingen |
| `maak_reststuk(rol_id BIGINT, nieuwe_lengte INTEGER, snijplan_id BIGINT)` | Maakt een reststuk-rol aan na het snijden, werkt originele rol bij en logt voorraadmutatie |
| `voltooi_snijplan_rol(p_rol_id BIGINT, p_gesneden_door TEXT, p_override_rest_lengte INTEGER, p_reststukken JSONB, p_snijplan_ids BIGINT[])` | Markeert snijplannen als gesneden + maakt reststukken aan. Met `p_snijplan_ids` gevuld: alleen die IDs → Gesneden; overige `Snijden` stukken op de rol → terug naar `Wacht` (rol_id/positie gereset) voor volgende optimalisatie-run. Zet ook `rollen.snijden_voltooid_op=NOW()`. Reststukken: geef `p_reststukken` JSONB array mee → één rol per rechthoek ≥70×140 cm. Returns: TABLE(reststuk_id, reststuk_rolnummer, reststuk_lengte_cm). (migraties 060, 066) |
| `start_snijden_rol(p_rol_id BIGINT, p_gebruiker TEXT)` | Idempotent: zet `rollen.snijden_gestart_op=NOW()` en `snijden_gestart_door` als nog niet gevuld. Voor tijdanalyse snijduur. (migratie 064) |
| `auto_markeer_maatwerk()` | Trigger: markeert nieuwe order_regels automatisch als is_maatwerk=true wanneer product_type='rol' |
| `auto_maak_snijplan()` | Trigger: maakt automatisch een snijplan aan (status 'Wacht') voor nieuwe maatwerk order_regels. Mig 328 (ADR-0029): kopieert `order_regels.snijden_uit_standaardmaat` naar het snijplan (additief — gewone regels → false). |
| `keur_snijvoorstel_goed(voorstel_id BIGINT)` | Keurt een snijvoorstel goed: wijst rollen toe aan snijplannen, zet status 'Gepland', met concurrency guards |
| `verwerp_snijvoorstel(voorstel_id BIGINT)` | Verwerpt een concept-snijvoorstel zonder wijzigingen |
| `kleuren_voor_kwaliteit(p_kwaliteit TEXT)` | Retourneert kleuren met m²-prijs, kostprijs, gewicht en max breedte voor een kwaliteit. **Sinds mig 181: gewicht_per_m2_kg komt uit `kwaliteiten` (één bron-van-waarheid)**; voorheen uit `maatwerk_m2_prijzen` per kleur. |
| `gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code TEXT) → NUMERIC` | **Gewicht-resolver — publiek seam #1.** Eenvoudige lookup van density per kwaliteit. NULL als kwaliteit nog geen gewicht heeft. STABLE. Mig 185. |
| `bereken_product_gewicht_kg(p_artikelnr TEXT) → TABLE(gewicht_kg, uit_kwaliteit)` | **Gewicht-resolver — publiek seam #2.** Gewicht (kg/stuk) voor een vast/staaltje-product. Vorm-aware sinds mig 188: `vorm='rond'` → `π × (lengte_cm/200)² × density`; anders `(lengte × breedte / 10000) × density`. Bij volledige cache-bron retourneert `(gewicht, true)`; bij ontbrekende kwaliteit-density of maat-data retourneert `(legacy_gewicht, false)`. STABLE. Mig 185, vorm-logica mig 188. |
| `bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT) → NUMERIC` | **Gewicht-resolver — publiek seam #3.** Gewicht (kg/stuk) voor een orderregel. Maatwerk: `oppervlak × kwaliteit-density`. Vast: sinds mig 387 live via `bereken_product_gewicht_kg` (vorm-aware) i.p.v. cache-copy; 0 → NULL. Service-items zonder artikelnr → NULL. STABLE. Mig 185/387. |
| `bereken_orderregel_prijs(p_artikelnr TEXT, p_prijslijst_nr TEXT) → JSONB` | **Prijs-resolver voor order-aanmaak.** 5-stappen fallback-keten: `prijslijst_vast` (prijslijst_regels) → `prijslijst_m2` (m²-prijs van kleur-specifiek MAATWERK-artikel × oppervlak + vormtoeslag) → `maatwerk_artikel_m2` (`producten.verkoopprijs` van MAATWERK-artikel × oppervlak + vormtoeslag) → `kwaliteit_m2` (`maatwerk_m2_prijzen` × oppervlak + vormtoeslag) → `product_verkoopprijs` (eigen verkoopprijs). Vormtoeslag uit `maatwerk_vormen.toeslag` via `producten.maatwerk_vorm_code`. Retourneert `{ prijs, bron, breakdown }`. STABLE. Mig 191. |
| `trg_kwaliteit_gewicht_recalc()` | Trigger op `kwaliteiten` (AFTER UPDATE OF gewicht_per_m2_kg). Cascade: herrekent producten in die kwaliteit + open maatwerk-orderregels. Mig 185. |
| `trg_product_gewicht_recalc()` | Trigger op `producten` (AFTER UPDATE OF gewicht_kg). Cascade: kopieert gewicht naar open vaste-orderregels met dat artikelnr. Mig 185. **Interactie met mig 387:** voor vast/staaltje met complete data vuurt de BEFORE-trigger `trg_producten_gewicht_derive` eerst en herleidt de waarde — deze cascade propageert dus altijd het gederiveerde gewicht naar open regels (handmatige input overleeft de keten niet); voor 'rol'/'overig' en incomplete data ongewijzigd gedrag. |
| `producten_gewicht_derive()` | BEFORE-trigger op `producten` (INSERT + UPDATE OF gewicht_kg/lengte_cm/breedte_cm/kwaliteit_code/vorm/product_type). Self-healing gederiveerde gewicht-cache voor vast/staaltje met complete data; NULL-veilige product_type-guard. Mig 387. |
| ~~`rollen_uitwissel_voorraad()`~~ | **GEDROPT in mig 187 (T005)** — vervangen door `voorraadposities()` (mig 179/180). Geen externe callers meer; functie definitief verwijderd. |
| `normaliseer_kleur_code(code TEXT)` | Normaliseert kleur_code: strip trailing ".0" (bijv. "12.0" → "12") — IMMUTABLE helper |
| `snijplanning_groepen_gefilterd(p_tot_datum)` | Gegroepeerde snijplanning met optionele afleverdatum-filter (groepeert op genormaliseerde kleur_code) |
| `stuk_snij_marge_cm(afwerking TEXT, vorm TEXT, lengte_cm INTEGER DEFAULT NULL, breedte_cm INTEGER DEFAULT NULL, standaard_breedte_cm INTEGER DEFAULT NULL) RETURNS NUMERIC` | Extra cm op elke dimensie bij snijden: ZO-afwerking +6, rond/ovaal **+2,5 (mig 464, was +5)**. Combi → grootste wint (niet cumulatief). **Mig 463:** de vorm-component wordt 0 als `LEAST(lengte_cm, breedte_cm) = standaard_breedte_cm` (exacte match — een stuk waarvan de korte zijde al precies de standaard rolbreedte is heeft geen ruimte voor marge en past in de praktijk gewoon; ZO-component blijft ongewijzigd, geldt nog steeds met 2,5cm). De 3 extra parameters zijn optioneel; een 2-argument-aanroep evalueert de clamp niet. **RETURNS NUMERIC sinds mig 464** (was INTEGER — 2,5 is geen heel getal; returntype-wijziging kon niet via `CREATE OR REPLACE`, vereiste `DROP ... CASCADE` + her-aanmaak van `snijplanning_overzicht` ÉN `confectie_planning_overzicht`, zie hierboven). IMMUTABLE. Bron-van-waarheid; toegepast in view `snijplanning_overzicht` (kolommen `marge_cm`, `placed_lengte_cm`, `placed_breedte_cm`, +`LEFT JOIN kwaliteiten` voor `standaard_breedte_cm`), `snijplanning_tekort_analyse()` en `kandidaat_rollen_voor_handmatige_toewijzing()` (mig 453) — de enige 3 aanroepers; hun `RETURNS TABLE`-kolommen blijven `::INTEGER`-gecast, geen wijziging nodig. Geen TS-spiegels meer sinds mig 233; het scanstation leest `marge_cm` 1-op-1 uit de view-kolom en rondt pas bij de uiteindelijke snij-instructie af naar hele cm (`derive.ts`: `Math.round`). (migratie 126, view-kolommen mig 143/233, korte-zijde-uitzondering mig 463, 2,5cm + NUMERIC mig 464) |
| `snijplanning_tekort_analyse()` | Per snijden-groep: uitwisselbare kwaliteits (Map1 primair, collectie-fallback), aantal beschikbare rollen, totaal m², `max_lange/max_korte` rolmaten, en `grootste_onpassend_stuk_*` met marge-check. Sluit placeholder-rollen (0×0) uit, synchroon met `auto-plan-groep` edge. `heeft_collectie` = heeft uitwissel-partners (Map1 OR collectie). (migratie 134, basis 102/117/126) |
| `snijplanning_status_counts_gefilterd(p_tot_datum)` | Status counts met optionele afleverdatum-filter |
| `release_gepland_stukken(kwaliteit TEXT, kleur TEXT)` | Geeft Gepland-snijplannen van de BESTEL-groep (`order_regels.maatwerk_kwaliteit_code / _kleur_code`) vrij voor heroptimalisatie: clear `rol_id`/posities, rollen zonder resterende Gepland/Snijden/Gesneden stukken terug naar `beschikbaar`/`reststuk`. Raakt rollen met `snijden_gestart_op IS NOT NULL` niet aan. Filter op BESTEL-kwaliteit i.p.v. rol-kwaliteit is essentieel voor cross-kwaliteit plaatsingen via uitwisselbaarheid (migratie 133, fixt regressie uit 073). |
| `start_productie_rol(rol_id BIGINT)` | Zet alle Gepland stukken op een rol naar In productie (beschermt tegen heroptimalisatie) |
| `acquire_snijplan_lock(kwaliteit TEXT, kleur TEXT)` | Atomisch lock verkrijgen voor auto-planning (5 min staleness timeout) |
| `release_snijplan_lock(kwaliteit TEXT, kleur TEXT)` | Lock vrijgeven na auto-planning |
| `start_confectie(p_snijplan_id BIGINT)` | Zet snijplan-status op 'In confectie'. Idempotent. Valideert dat status vooraf Gesneden/In confectie is. |
| `voltooi_confectie(p_snijplan_id BIGINT, p_afgerond BOOLEAN DEFAULT true, p_ingepakt BOOLEAN DEFAULT false, p_locatie TEXT DEFAULT NULL)` | Rondt confectie af. p_afgerond=false clears + status terug naar Gesneden. p_ingepakt=true zet status Gereed + ingepakt_op. p_locatie="" wist locatie; NULL laat ongemoeid. Mig 330 (ADR-0029): na-stap flipt een productie-only order (`alleen_productie=true`) naar `'Maatwerk afgerond'` zodra ÁLLE snijplannen van de order confectie-afgerond zijn (`confectie_afgerond_op IS NOT NULL`). Strikt geguard — gewone orders ongemoeid. |
| `import_productie_only_order(p_header JSONB, p_regels JSONB) → TABLE(order_nr TEXT, was_existing BOOLEAN)` | Mig 329 (ADR-0029), SECURITY DEFINER. Idempotente import van één Basta-order als productie-only order: maakt `orders`-rij (status `'In productie'`, `alleen_productie=true`, `bron_systeem='oud_systeem'`, `order_nr='OUD-<oud_order_nr>'`) + maatwerk-`order_regels` (`is_maatwerk=true`, geen artikelnr/prijs — facturatie in Basta). Idempotent op `oud_order_nr`: bestaat de order al → `was_existing=true`, niets gemuteerd. Debiteur = echte match of verzameldebiteur **900000**. Géén allocator-aanroep (maatwerk reserveert niet op inkoop); `auto_maak_snijplan` expandeert naar snijplannen. |
| `update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)` | Merge-update van order header + regels: UPDATE bestaande regels op `id`, INSERT nieuwe, DELETE regels die uit payload verdwenen zijn. Preserveert `snijplannen.order_regel_id` FK-koppelingen (migratie 074) |
| `backlog_per_kwaliteit_kleur(p_kwaliteit TEXT, p_kleur TEXT)` | Aggregeert wachtende snijplan-stukken voor real-time levertijd-check: returnt `(totaal_m2, aantal_stukken, vroegste_afleverdatum)`. Match op kleur-varianten (X, X.0). Gebruikt door `check-levertijd` edge function (migratie 080) |
| `genereer_factuur(p_order_ids BIGINT[])` | Atomair: maakt factuur + regels aan voor 1+ orders van dezelfde debiteur, markeert order_regels.gefactureerd. Retourneert factuur_id. Migratie 119. |
| `effectief_btw_pct(p_verlegd BOOLEAN, p_btw_percentage NUMERIC) → NUMERIC` | Mig 371: effectief BTW-percentage voor een debiteur — verlegd → 0, anders `COALESCE(pct, 21)`. IMMUTABLE. Gebruikt door `bepaal_btw_regeling`; gespiegeld in `supabase/functions/_shared/btw.ts` (`effectiefBtwPct`). |
| `is_eu_land(p_iso2 TEXT) → BOOLEAN` | Mig 454: TRUE als `p_iso2` (al genormaliseerd via `normaliseer_land`) een van de 27 EU-lidstaten is. CH/NO (EER, geen EU-lid) en GB (post-Brexit) bewust uitgesloten. Hardcoded array, geen tabel. Gespiegeld in `_shared/btw.ts` (`isEuLand`). |
| `bepaal_btw_regeling(p_afl_land, p_debiteur_land, p_afhalen, p_verlegd_vlag, p_btw_nummer, p_btw_percentage) → TABLE(regeling, effectief_pct, controle_nodig, controle_reden, land_iso2)` | Mig 455: combineert het effectieve afleverland (`afl_land`, fallback `debiteuren.land`, leeg bij beide → `nl_binnenland` zonder blokkade — 62% van de actieve debiteuren heeft een leeg land-veld) met de `btw_verlegd_intracom`-vlag en het btw-nummer tot een regeling: `nl_binnenland`/`eu_b2b_icl`/`eu_b2b_binnenland_afwijking`/`export_buiten_eu`. Pure/IMMUTABLE, geen side-effects — de factuur-RPC's (mig 456) snapshotten alleen het resultaat; `factuur-verzenden/index.ts` beslist over de daadwerkelijke blokkade (vóór mail/EDI). Gespiegeld in `_shared/btw.ts` (`bepaalBtwRegeling`). |
| `markeer_btw_regeling_geaccepteerd(p_factuur_id BIGINT)` | Mig 456: bevestigt dat de BTW-regeling op een concept-factuur klopt ondanks signalering door `bepaal_btw_regeling`; wist `facturen.btw_controle_nodig_sinds` zonder data te wijzigen (analoog `markeer_prijs_geaccepteerd`). Een latere her-projectie herberekent en kan de gate opnieuw zetten. |
| `enqueue_factuur_bij_verzonden()` | Trigger: bij orders.status → 'Verzonden' vult factuur_queue voor per_zending-klanten. Migratie 118. |
| `enqueue_wekelijkse_verzamelfacturen()` | Verzamelt niet-gefactureerde Verzonden-orders per wekelijks-klant in de queue. Maandag 05:00 UTC via pg_cron. Migratie 122. |
| `recover_stuck_factuur_queue()` | Zet queue-items >10 min in 'processing' terug op 'pending'. Elke 5 min via pg_cron. Migratie 121. |
| `sync_besteld_inkoop_voor_artikel(p_artikelnr TEXT)` | Herbereken `producten.besteld_inkoop` als som van `te_leveren_m` over open inkooporder_regels, omgerekend naar m² via `kwaliteiten.standaard_breedte_cm` (fallback: meters). Migratie 127. |
| `trg_sync_besteld_inkoop()` | Trigger op inkooporder_regels INSERT/UPDATE/DELETE die bovenstaande aanroept. Migratie 127. |
| `besteld_per_kwaliteit_kleur()` | **INTERN voor de Voorraadpositie-Module sinds mig 187 (T005).** Aggregeert `openstaande_inkooporder_regels` per (kwaliteit_code, kleur_code) → `besteld_m`, `besteld_m2`, `orders_count`, `eerstvolgende_leverweek` + `eerstvolgende_verwacht_datum`, plus het deel (`eerstvolgende_m`/`eerstvolgende_m2`) dat in díe eerstvolgende levering valt. M² via `kwaliteiten.standaard_breedte_cm` (regels zonder bekende breedte: m² = 0). Migratie 137. **Aanroep-richtlijn:** alleen via Voorraadpositie-Module (`@/modules/voorraadpositie` → `fetchVoorraadpositie` / `fetchVoorraadposities` / `fetchGhostBesteldParen`). GRANT EXECUTE blijft voor anon/authenticated omdat `voorraadposities()` (SECURITY INVOKER) en `fetchGhostBesteldParen` (browser-call) dezelfde permissies eisen. |
| `uitwisselbare_partners()` | **INTERN voor de Voorraadpositie-Module sinds mig 187 (T005).** Voor elk (kwaliteit, kleur) met partners in `kwaliteit_kleur_uitwisselgroepen`: alle uitwissel-kandidaten met aantal beschikbare rollen + totaal m² (rollen met `status NOT IN ('verkocht','gesneden')` en `oppervlak_m2 > 0`, mig 115). Symmetrie via zelfjoin op `basis_code + variant_nr`. **Aanroep-richtlijn:** alleen via Voorraadpositie-Module — externe callers gebruiken `fetchVoorraadpositie(kw, kl).partners`. GRANT EXECUTE blijft voor anon/authenticated omdat `voorraadposities()` (SECURITY INVOKER) deze RPC als CTE-bron consumeert. Migratie 114/115. |
| `voorraadposities(p_kwaliteit TEXT, p_kleur TEXT, p_search TEXT)` | **Voorraadpositie-Module-seam** (mig 179 → mig 180). Drie modi: (a) **single-paar** (p_kwaliteit + p_kleur beide gevuld) → exacte match incl. ghost-paren — bron voor product-detail / maatwerk-hint; (b) **batch** (beide leeg) → álle paren met eigen voorraad; (c) **batch+filter** (één van beide of `p_search` los) → server-side filtering op kwaliteit (ILIKE-substring), kleur (exact na normalisatie), `p_search` (ILIKE op `kw-kl` of `producten.omschrijving`). Bestaans-regel: batch retourneert ALLEEN paren met eigen voorraad — caller mergt ghosts indien nodig. Returns TABLE per (kw, kl): `kwaliteit_code`, `kleur_code`, `product_naam TEXT`, `eigen_volle_rollen / eigen_aangebroken_rollen / eigen_reststuk_rollen / eigen_totaal_m2`, `rollen JSONB[{id, rolnummer, lengte_cm, breedte_cm, oppervlak_m2, status, rol_type, locatie, oorsprong_rol_id, reststuk_datum, artikelnr, kwaliteit_code, kleur_code}]` (gesorteerd `rol_type ASC, rolnummer ASC`), `partners JSONB[{kwaliteit_code, kleur_code, rollen, m2}]` (gesorteerd m² DESC, kw ASC, kl ASC), `beste_partner JSONB` (= partners[0] alleen wanneer eigen_m²=0 en partners[0].m²>0; anders NULL — invariant 1), `besteld_m`/`besteld_m2`/`besteld_orders_count`/`eerstvolgende_leverweek`/`eerstvolgende_verwacht_datum`/`eerstvolgende_m`/`eerstvolgende_m2`. Bouwt op `uitwisselbare_partners()` (mig 115) + `besteld_per_kwaliteit_kleur()` (mig 137) + directe scan op `rollen` (status NOT IN ('verkocht','gesneden') AND oppervlak_m2 > 0) + `producten` (voor omschrijving-LEFT-JOIN). Kleur-normalisatie via `regexp_replace(kleur, '\.0+$', '')` aan input én output. `partners` is altijd een (mogelijk lege) JSONB-array — nooit NULL. Frontend-Module: `@/modules/voorraadpositie` met `fetchVoorraadpositie` + `fetchVoorraadposities(filter)` + hooks `useVoorraadpositie` / `useVoorraadposities`. |
| `boek_ontvangst(p_regel_id BIGINT, p_rollen JSONB, p_medewerker TEXT)` | Atomair: maakt N rollen aan op basis van `[{lengte_cm, breedte_cm, rolnummer?}, ...]`, logt `voorraad_mutaties` (type=`'inkoop'`, referentie_type=`'inkooporder_regel'`), werkt `geleverd_m`/`te_leveren_m` bij (boekt **m²**, niet strekkende meters — fix migratie 133) en zet order-status op 'Deels ontvangen'/'Ontvangen'. Alleen voor eenheid='m'. Rolnummer optioneel — leeg = auto-genereer `R-YYYY-NNNN` via `volgend_nummer('R')` (migratie 135). Returns TABLE(rol_id, rolnummer). Migraties 127/133/135/136. |
| `boek_voorraad_ontvangst(p_regel_id BIGINT, p_aantal INTEGER, p_medewerker TEXT)` | Voor vaste producten (eenheid='stuks'): verhoogt `producten.voorraad` met p_aantal en werkt regel + order-status bij. Sinds migratie 148: consumeert IO-claims in `claim_volgorde`-volgorde en verschuift ze naar voorraad-claims op dezelfde orderregel; roept `herwaardeer_order_status` aan per geraakte order. |
| `create_zending_voor_order(p_order_id BIGINT) → BIGINT` | Maakt één `zendingen`-rij + bijbehorende `zending_regels` voor één order. Adres-snapshot uit `orders.afl_*`, één zending_regel per `order_regels`-rij met `orderaantal > 0`; migratie 177 vult `zending_regels.aantal`, `zendingen.aantal_colli` en `zendingen.totaal_gewicht_kg` vanuit `orderaantal`/`gewicht_kg` voor Pick & Ship stickers en pakbon. Idempotent: returnt bestaande actieve zending als die er al is (alle statussen behalve `Afgeleverd`) en enqueue't opnieuw als status `'Klaar voor verzending'` is. Status direct op `'Klaar voor verzending'` zodat de zending-trigger meteen vuurt. Aangeroepen vanuit order-detail en Pick & Ship Verzendset. Migratie 172, aangescherpt in 177. |
| `selecteer_vervoerder_voor_zending(p_zending_id BIGINT) → TABLE(gekozen_vervoerder_code, keuze_uitleg)` | Centrale vervoerderselector (mig 176). V1 kiest alleen als precies één vervoerder actief is. Bij 0 actieve of meerdere actieve vervoerders zonder criteria geeft de functie NULL + JSON-uitleg terug. Latere uitbreiding: voorwaarden, zones en tarieven per zending. |
| `enqueue_zending_naar_vervoerder(p_zending_id BIGINT) → TEXT` | **Single switch-point voor multi-vervoerder dispatch** — enige plek in de codebase waar op `vervoerder_code` wordt geswitcht. Leest `zendingen.vervoerder_code` of vult die via `selecteer_vervoerder_voor_zending()` en dispatcht naar de juiste adapter-RPC op basis van `vervoerders.type`: `type='api'` + `'hst_api'` → `enqueue_hst_transportorder`; `type='sftp'` + `'verhoek_sftp'` → `enqueue_verhoek_transportorder` (mig 375, ADR-0031); `type='print'` → `genereer_zending_colli`; `type='edi'` → nog geen adapter-RPC. Returnt textuele status (`enqueued_hst` / `enqueued_verhoek` / `vervoerder_inactief` / `no_adapter_voor_<code>` / …) — alleen voor logging/debugging, niet voor caller-control-flow. Migratie 172, aangepast in 176 + 375. |
| `enqueue_hst_transportorder(p_zending_id BIGINT, p_debiteur_nr INTEGER, p_is_test BOOLEAN) → BIGINT` | HST-adapter: plaatst transportorder op wachtrij in `hst_transportorders`. Idempotent via `uk_hst_to_zending_actief`. Migratie 171. |
| `claim_volgende_hst_transportorder() → hst_transportorders` | HST-adapter: pakt oudste `Wachtrij`-rij (`FOR UPDATE SKIP LOCKED`), zet status `Bezig`. Aangeroepen door edge function `hst-send`. Migratie 171. |
| `markeer_hst_verstuurd(p_id, p_extern_transport_order_id, p_extern_tracking_number, p_request_payload, p_response_payload, p_response_http_code) → VOID` | HST-adapter: na 200-respons. Status → `Verstuurd`; schrijft `track_trace` terug op `zendingen` en promoveert zending-status van `'Klaar voor verzending'` naar `'Onderweg'`. Migratie 171. |
| `markeer_hst_fout(p_id, p_error, p_request_payload, p_response_payload, p_response_http_code, p_max_retries DEFAULT 3) → VOID` | HST-adapter: incrementeert `retry_count`. Bij `>=` max_retries → status `Fout`, anders terug naar `Wachtrij`. Migratie 171. |
| `herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10) → INTEGER` | **Self-healing reaper** (mig 337, ADR-0030, SECURITY DEFINER, GRANT authenticated). Zet `hst_transportorders`-rijen die >`p_minuten` op status `'Bezig'` hangen terug naar `'Wachtrij'` (beschermt tegen crash/timeout tussen `claim_volgende_hst_transportorder` en de POST). Returnt aantal herstelde rijen. Bovenin elke `hst-send`-run aangeroepen + handmatig. |
| `enqueue_verhoek_transportorder(p_zending_id BIGINT, p_debiteur_nr INTEGER, p_is_test BOOLEAN DEFAULT FALSE) → BIGINT` | Verhoek-adapter: plaatst transportorder op wachtrij in `verhoek_transportorders`. Idempotent via `uk_verhoek_to_zending_actief`. Mig 375 (ADR-0031). |
| `claim_volgende_verhoek_transportorder() → verhoek_transportorders` | Verhoek-adapter: pakt oudste `Wachtrij`-rij (`FOR UPDATE SKIP LOCKED`), zet status `Bezig`. Aangeroepen door edge function `verhoek-send`. Mig 375. |
| `markeer_verhoek_verstuurd(p_id, p_bestandsnaam, p_xml_storage_path, p_track_trace_id, p_request_xml) → VOID` | Verhoek-adapter: na geslaagde SFTP-upload. Status → `Verstuurd`; schrijft `track_trace` terug op `zendingen` en promoveert zending-status van `'Klaar voor verzending'` naar `'Onderweg'`. Mig 375. |
| `markeer_verhoek_fout(p_id, p_error, p_request_xml DEFAULT NULL, p_max_retries DEFAULT 3) → VOID` | Verhoek-adapter: incrementeert `retry_count`. Bij `>=` max_retries → status `Fout`, anders terug naar `Wachtrij`. Mig 375. |
| `herstel_vastgelopen_verhoek(p_minuten INTEGER DEFAULT 10) → INTEGER` | **Self-healing reaper** (mig 375, ADR-0031, SECURITY DEFINER, GRANT authenticated). Spiegelt `herstel_vastgelopen_hst`. Bovenin elke `verhoek-send`-run + handmatig. |
| `create_or_get_magazijn_locatie(p_code TEXT, p_omschrijving TEXT DEFAULT NULL, p_type TEXT DEFAULT 'rek') → BIGINT` | Idempotent: vindt-of-maakt `magazijn_locaties.id` voor `code` (UPPER+TRIM). Wordt gebruikt door `MagazijnLocatieEdit` (rol-locatie zetten) en `boek_ontvangst`. Migratie 169. |
| `set_locatie_voor_orderregel(p_order_regel_id INTEGER, p_code TEXT) → BIGINT` | **Atomair**: vindt-of-maakt `magazijn_locaties`-rij voor `code` én zet `snijplannen.locatie = code` voor alle `Ingepakt`-rijen van de orderregel. Vervangt twee opeenvolgende RPC-calls (`createOrGetMagazijnLocatie + UPDATE snijplannen`) in `useUpdateMaatwerkLocatie` — voorkomt dangling `magazijn_locaties`-rijen wanneer de tweede call faalt. Returnt `magazijn_locaties.id`. Migratie 0183 (ADR-0002). |
| `match_klant_po(p_extractie jsonb) → jsonb` | **Klant-PO parsing — deterministische koppellaag** (mig 294). Matcht AI-extractie van een klant-inkooporder-PDF tegen de database. Debiteur: btw → e-maildomein → exacte naam (telkens precies 1 hit = `zeker`, anders geen debiteur; alleen actieve debiteuren). Per regel: kwaliteit via reverse-lookup op `klanteigen_namen.benaming` (debiteur-/inkoopgroep-scoped) + exacte `kwaliteiten.omschrijving`; kleur via numeriek suffix; artikel via `klant_artikelnummers` / `producten`. Debiteur en elke regel dragen een eigen `zeker`-label — de frontend vult alleen `zeker`-regels/-debiteur voor (adres + klant-referentie altijd concept). STABLE, geen side-effects. GRANT anon/authenticated/service_role. |
| `rol_handmatig_toevoegen(p_artikelnr TEXT, p_rol_type rol_type, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_in_magazijn_sinds DATE, p_rolnummer TEXT, p_reden TEXT, p_medewerker TEXT) → TABLE(rol_id BIGINT, rolnummer TEXT)` | Handmatige rol/reststuk-correctie (voorraadcorrectie/inventarisatie). Geen IO-koppeling, geen producten.voorraad-mutatie. Audit in `rol_mutaties`. Mig 291 (ADR-0024). |
| `rol_handmatig_bewerken(p_rol_id BIGINT, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_status TEXT, p_reden TEXT, p_medewerker TEXT) → VOID` | Corrigeer afmetingen/locatie/status. Weigert mutatie op rollen die aan snijplan/claim hangen. Mig 292 (ADR-0024). |
| `rol_verwijderen(p_rol_id BIGINT, p_reden TEXT, p_medewerker TEXT) → VOID` | Verwijder rol met guard (alleen beschikbaar of los reststuk, niet in snijplan). Auditregel vooraf. Mig 293 (ADR-0024). |
| `effectieve_vervoerder_per_orderregel(p_order_id BIGINT) → TABLE(...)` | **Per-orderregel-resolver (mig 219).** Returnt voor elke pickbare regel: `override_code`, `evaluator_code`/`evaluator_service`, `klant_fallback_code`, `effectief_code`/`effectief_service` en `bron` (`override` / `regel` / `klant_fallback` / `geen` / `afhalen`). Bron-precedentie: override > regel > klant_fallback > geen. Globaal-actief blijft een UI-fallback. Gebruikt door `start_pickronden_voor_order` (mig 220) voor groepering en door pick-card UI voor per-regel pill. STABLE. |
| `evalueer_orderregel_attributes(p_orderregel_id BIGINT) → TABLE(...)` | **Per-regel attributen voor regel-evaluator (mig 219).** Symmetrisch met `evalueer_zending_attributes` (mig 210), maar `kleinste_zijde_cm` en `gewicht_kg` zijn per regel zodat de evaluator per regel kan beslissen. Land/debiteur/inkoopgroep blijven order-niveau. STABLE. |
| `start_pickronden_voor_order(p_order_id BIGINT, p_picker_id BIGINT) → TABLE(zending_id, zending_nr, vervoerder_code, aantal_regels, is_nieuw)` | **Splits-aware pickronde-starter (mig 220).** Voor élke unieke effectieve vervoerder maakt 1 zending aan (regels uit groep, vervoerder direct gezet bij INSERT). Idempotent op (order, vervoerder): bestaande Picken-zendingen worden hergebruikt. Eindstatus-guard uit mig 218 blijft van kracht. `start_pickronde` (oude single-zending wrapper) returnt nu het eerste zending_id van deze RPC voor backward compat. |
| `assert_bundel_sleutel_contract(JSONB) → void` | Mig 385 (in DB toegepast als 383 op 12-06): toetst `_normaliseer_afleveradres` + `verzendweek_voor_datum` + `bundel_sleutel` tegen de golden fixtures (RAISE EXCEPTION bij mismatch, vorm-guard tegen lege arrays); aanroepen aan het eind van elke migratie die een van de drie wijzigt (`*_bundel_sleutel_contract*.sql`-conventie). |

### Triggers op order_regels (maatwerk)

| Trigger | Event | Timing | Functie |
|---------|-------|--------|---------|
| `trg_auto_maatwerk` | INSERT | BEFORE | `auto_markeer_maatwerk()` — zet is_maatwerk=true voor rol-producten |
| `trg_auto_snijplan` | INSERT | AFTER | `auto_maak_snijplan()` — maakt snijplan aan voor maatwerk regels |
| `trg_snijplan_rol_toegewezen_auto_verzendweek` (op `snijplannen`, niet `order_regels`) | INSERT/UPDATE OF rol_id, verwacht_inkooporder_regel_id | AFTER | Mig 469/471: `trg_snijplan_rol_toegewezen_auto_verzendweek()` — schrijft naar `order_regels.verzendweek`/`verzendweek_bron` van de bijbehorende maatwerk-regel zodra ALLE snijplan-stukken van die regel gedekt zijn (`rol_id` ÓF `verwacht_inkooporder_regel_id`, XOR per stuk), mits `verzendweek` nog NULL is (snapshot, geen overschrijving). |

---

## Storage

| Bucket | Doel | Toegang |
|--------|------|---------|
| logos | Klantlogo's ({debiteur_nr}.jpg) | Publiek lezen, auth upload/delete |
| facturen | Verstuurde factuur-PDFs ({debiteur_nr}/FACT-YYYY-NNNN.pdf) | Privé, frontend leest via signed URL (10 min); uploads via service role |
| documenten | Algemene documenten (algemene-voorwaarden-karpi-bv.pdf) | Publiek lezen, uploads via service role |
| order-documenten | Bijlagen bij orders en inkooporders. Paden `orders/{id}/...` en `inkooporders/{id}/...`. Max 25 MB; alleen PDF/JPG/PNG/WebP/Excel/Word/TXT toegestaan. | Privé, authenticated SELECT/INSERT/UPDATE/DELETE; frontend leest via signed URL |
| bug-bijlagen | Screenshots/bijlagen bij bug-meldingen (mig 342). Paden `{auth_uid}/{uuid}-{naam}`. Max 10 MB; afbeeldingen + PDF. | Privé, authenticated SELECT/INSERT; frontend leest via signed URL |
| orderbevestigingen | Verstuurde orderbevestiging-PDFs ({order_id}/Orderbevestiging-{order_nr}.pdf, mig 366 — upsert bij hersturen). Bijlage-bron voor de e-mailtijdlijn op order-detail. | Privé, frontend leest via signed URL (10 min); uploads via service role |

## Bug-meldtool (mig 342)

| Tabel | Doel |
|-------|------|
| `bug_meldingen` | In-app feedback/bug-meldingen. Kolommen o.a. `titel`, `omschrijving`, `urgentie` (enum `bug_urgentie`), `pagina_url`, `status` (enum `bug_melding_status`: Open→Verwerkt→Geaccepteerd), `bijlage_path`, `gemeld_door` (→auth.users), `gemeld_door_email`, `verwerkt_op`, `geaccepteerd_op`. **Mig 360:** `verwerkt_opgelost`/`verwerkt_testen` (toelichting van de beheerder bij verwerken — wat opgelost + hoe te testen, zichtbaar voor de melder) en `verwerkt_gezien_op` (wanneer de melder de verwerking zag; `NULL` + status Verwerkt = ongezien → teller op het belletje rechtsboven). RLS: melder ziet eigen rijen, beheerder (`is_bug_beheerder()`) ziet alles. Statuswissel via SECURITY DEFINER-RPC `set_bug_status(p_id, p_status, p_opgelost, p_testen)` (mig 360, was `(p_id, p_status)`); melder dooft de teller via `markeer_verwerkt_gezien()`. |
