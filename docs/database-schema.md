# Database Schema — RugFlow ERP (Supabase/PostgreSQL)

> Dit document is de leesbare referentie voor de database-structuur.
> **Bijwerken na elke tabel/kolom/relatie wijziging.**

## Overzicht

43 tabellen, 9 enums, 15 views, 36 functies. Alle tabellen hebben RLS enabled (fase 1: authenticated = volledige toegang).

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
| afleverwijze | TEXT DEFAULT 'Bezorgen' | Standaard afleverwijze (Bezorgen/Afhalen) |
| verzendkosten | NUMERIC | Per-klant override verzendkosten (€) |
| verzend_drempel | NUMERIC | Per-klant drempel gratis verzending (€) |
| standaard_maat_werkdagen | INTEGER | Override levertermijn voor standaard-maat karpetten (dagen). NULL = globale default. |
| maatwerk_weken | INTEGER | Override levertermijn voor maatwerk karpetten (weken). NULL = globale default. |
| deelleveringen_toegestaan | BOOLEAN DEFAULT false | Als TRUE: gemengde orders worden bij aanmaken gesplitst in 2 orders (standaard + maatwerk). |
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
| gewicht_kg | NUMERIC(8,2) | **Sinds migratie 185: gederiveerde cache.** Voor `product_type IN ('vast','staaltje')` automatisch herrekend door trigger. Vorm-aware sinds mig 188: `vorm='rond'` → `π × (lengte_cm/200)² × kwaliteiten.gewicht_per_m2_kg`, anders `(lengte_cm × breedte_cm / 10000) × density`. Voor 'rol'/'overig' blijft handmatige waarde staan. |
| lengte_cm, breedte_cm | INTEGER | Maat in cm voor vaste/staaltje-producten. **Rechthoekig**: geparset uit `karpi_code`-suffix in mig 184 (`^.{8}(\d{3})(\d{3})$`). **Rond** (mig 188): geparset uit `^.{8}(\d{3})RND$` — `lengte_cm = breedte_cm = diameter`. **Ovaal-bbox** (mig 188): geparset uit omschrijving (`NxN cm OVAAL`) als bbox. NULL voor 'rol'/'overig' of afwijkend patroon. Voedt gewicht-resolver. |
| vorm | TEXT | `rechthoek` (default, ook voor ovaal — bbox-aanname) of `rond` (cirkel-oppervlak via `π × (lengte_cm/200)²`). Bepaalt formule in `bereken_product_gewicht_kg`. Mig 188. |
| maatwerk_vorm_code | TEXT FK → maatwerk_vormen(code) | **Logische vormcode** voor de prijs-resolver (mig 191). Onderscheidt `ovaal/organisch_a/organisch_b_sp/pebble/ellips/afgeronde_hoeken` waar `vorm` alleen `rechthoek/rond` kent. Bepaalt vormtoeslag (€0/€75 uit `maatwerk_vormen.toeslag`) bij m²-fallback in `bereken_orderregel_prijs`. NULL = onbekend → resolver behandelt als rechthoek (€0). Backfill via karpi_code-suffix (`RND`/`OVL`) + omschrijving-substring (`ORGANISCH`/`PEBBLE`/`ELLIPS`/`AFGEROND`). Mig 190. |
| gewicht_uit_kwaliteit | BOOLEAN | Default false. TRUE = `gewicht_kg` gederiveerd uit `kwaliteiten.gewicht_per_m2_kg` (cache vers). FALSE = legacy waarde uit oude systeem of kwaliteit heeft nog geen gewicht. UI toont badge "uit oude bron" bij FALSE. Migratie-voortgang-indicator. |
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
| waarde | NUMERIC(12,2) | Totale inkoopwaarde van de rol. Voor reststuk-rollen aangemaakt vanaf migratie 088: `oppervlak_m2 × bronrol.inkoopprijs_m2`. Oudere reststuk-rollen kunnen NULL zijn. |
| kwaliteit_code | TEXT FK → kwaliteiten | Gedenormaliseerd |
| kleur_code, zoeksleutel | TEXT | |
| status | TEXT | Workflow-status: 'beschikbaar', 'gereserveerd', 'verkocht', 'gesneden', 'reststuk', 'in_snijplan' |
| rol_type | ENUM rol_type | Fysieke classificatie: 'volle_rol', 'aangebroken', 'reststuk'. Automatisch gezet via trigger o.b.v. `bereken_rol_type()`. Standaard breedte komt uit `kwaliteiten.standaard_breedte_cm` (sinds migratie 086/087), fallback op laatste 3 cijfers artikelnr, daarna 400 cm. Lengte <100cm of breedte <standaard → reststuk; gesneden + std breedte + lengte ≥100cm → aangebroken; anders → volle_rol. |
| oorsprong_rol_id | BIGINT FK → rollen (self-ref) | Verwijst naar de originele rol waaruit deze rol is gesneden (aangebroken of reststuk) |
| reststuk_datum | TIMESTAMPTZ | Datum waarop de gesneden rol is aangemaakt |
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
| status | order_status | Default 'Nieuw' |
| compleet_geleverd | BOOLEAN | |
| aantal_regels, totaal_bedrag, totaal_gewicht | NUMERIC | Berekend door trigger |
| bron_systeem | TEXT | NULL = handmatig aangemaakt. 'lightspeed' = webshop-integratie (migratie 092). |
| bron_shop | TEXT | Sub-identifier binnen bron_systeem. Lightspeed: 'floorpassion_nl' / 'floorpassion_de'. |
| bron_order_id | TEXT | Externe order-ID (Lightspeed orders.id). Samen met bron_systeem uniek (partial index `orders_bron_unique`). |
| heeft_unmatched_regels | BOOLEAN DEFAULT false | TRUE als ≥1 order_regel een NULL artikelnr heeft. Automatisch gesynchroniseerd door trigger op order_regels (migratie 094). |
| lever_modus | TEXT | NULL / 'deelleveringen' / 'in_een_keer'. Per-order keuze hoe om te gaan met (deels) wachten op inkoop. Default uit `debiteuren.deelleveringen_toegestaan`, gevuld via `LeverModusDialog` bij opslaan als ≥1 regel tekort heeft. NULL voor orders zonder tekort. Migratie 144. |
| afhalen | BOOLEAN NOT NULL DEFAULT false | TRUE = klant haalt zelf op. UI in `OrderForm` onderdrukt automatische verzendkosten-regel; logistiek/zending overslaat vervoerder-stap. Migratie 204. |
| verzonden_at | TIMESTAMPTZ | Mig 217 (ADR-0005). Moment waarop `voltooi_pickronde` de laatste open zending sloot en `orders.status='Verzonden'` zette. Triggert factuur-queue (mig 118). NULL voor orders die nog niet verzonden zijn. |

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
| event_type | order_event_type | aangemaakt / pickronde_voltooid / wacht_status_herberekend / geannuleerd |
| status_voor | order_status NULL | NULL voor backfill + 'aangemaakt'-events |
| status_na | order_status | Nooit NULL |
| actor_medewerker_id | BIGINT FK → medewerkers | XOR met actor_auth_user_id |
| actor_auth_user_id | UUID FK → auth.users | XOR met actor_medewerker_id |
| reden | TEXT | Vrije tekst, vereist bij `markeer_geannuleerd` |
| metadata | JSONB | bv. `{cleanup: true}` of `{backfill: true}` |
| created_at | TIMESTAMPTZ | DEFAULT now() |

CHECK constraint `order_events_actor_xor`: niet beide actor-velden tegelijk gevuld. Indexen: `(order_id, created_at DESC)` en `(event_type, created_at DESC)`.

#### order_event_type (enum)
`aangemaakt | pickronde_voltooid | wacht_status_herberekend | geannuleerd`

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
| productie_groep | TEXT | Groepering voor snijplanning (kwaliteit+kleur) |
| UK: (order_id, regelnummer) | | |

---

### facturen
_Aangemaakt in migratie 117 (2026-04-22)._

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
| processing_started_at | TIMESTAMPTZ | Voor stuck-detection. Zie migratie 121. |
| created_at, processed_at | TIMESTAMPTZ | |

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
| totaal_gewicht_kg | NUMERIC | Gevuld door `create_zending_voor_order` vanuit orderregelgewichten; handmatig corrigeerbaar in latere UI. Sinds mig 206 exclusief de pseudo-regel `artikelnr='VERZEND'`. |
| aantal_colli | INTEGER | Gevuld door `create_zending_voor_order` als som van `order_regels.orderaantal`; gebruikt voor sticker `x VAN y`. Sinds mig 206 exclusief `artikelnr='VERZEND'`. Voor exacte per-stuk identiteit (sticker, SSCC) zie `zending_colli` (mig 209). |
| service_code | TEXT | Mig 210. Service-variant binnen vervoerder (bv. `'internationaal'` bij DPD), gekozen door `selecteer_vervoerder_voor_zending()`. NULL = vervoerder-default. |
| opmerkingen | TEXT | |
| created_at, updated_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_zendingen_order` (order_id), `idx_zendingen_status` (status), `idx_zendingen_vervoerder` (partial op `vervoerder_code`). `updated_at` via trigger `set_zendingen_updated_at()`.

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

### vervoerders
Lookup-tabel met de beschikbare vervoerders waarmee Karpi werkt (mig 170, uitgebreid mig 174). Routing-keuze, géén berichten — daadwerkelijk verkeer per vervoerder loopt via een **adapter-tabel** (HST → `hst_transportorders`; EDI-vervoerders → `edi_berichten` met `berichttype='verzendbericht'`). Gezaaid met 3 rijen: `hst_api`, `edi_partner_a` (Rhenus, placeholder), `edi_partner_b` (Verhoek, placeholder). Alleen de HST-koppeling is in dit plan actief; EDI-koppelingen volgen in aparte plans en hun rij staat default `actief=FALSE`. Migratie 174 voegt instellingen-, contact- en tarief-kolommen toe als basis voor de `/logistiek/vervoerders`-UI (vrije-tekst tarieven in V1; gestructureerde tariefmatrix volgt in Fase B — zie roadmap in [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md)).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| code | TEXT PK | `'hst_api'`, `'edi_partner_a'`, `'edi_partner_b'`, `'dpd'` — wordt als FK gebruikt op `zendingen.vervoerder_code` |
| display_naam | TEXT NOT NULL | UI-label: `'HST'`, `'Rhenus'`, `'Verhoek'`, `'DPD'` |
| type | TEXT NOT NULL | CHECK in (`'api'`, `'edi'`, `'print'`). Mig 207: `'print'` toegevoegd voor lokale label-printer-flow (DPD via Zebra ZT230). |
| actief | BOOLEAN NOT NULL | Default FALSE — pas TRUE als koppeling werkt. Switch-RPC `enqueue_zending_naar_vervoerder` weigert met `'vervoerder_inactief'` als FALSE |
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
| label_breedte_mm, label_hoogte_mm | INTEGER | Mig 207. Label-formaat in mm (bv. 80×150 voor DPD/Zebra). Gelezen door printset-page voor `@page`-CSS. |
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
| gewicht_kg | NUMERIC | Per-colli gewicht; afgeleid van orderregel/product, handmatig overschrijfbaar in latere UI. |
| omschrijving_snapshot | TEXT | Sticker-tekst zoals gerenderd, bv. `MAATW. SISAL-GOLD 21 160x090 cm, KI21 Band:KI21`. Snapshot zodat re-print consistent blijft na product-rename. |
| aantal | INTEGER NOT NULL | Default 1, CHECK ≥ 1. V1 = altijd 1. |
| pick_uitkomst | pick_uitkomst | Mig 211. Default 'open'; bij voltooi_pickronde → 'gepickt'. Enum-waardes: open, gepickt, niet_gevonden. |
| pick_opmerking | TEXT | Mig 211. Operator-notitie bij niet_gevonden. |
| gepickt_at | TIMESTAMPTZ | Mig 211. Moment van voltooi_pickronde. |
| gepickt_door_id | BIGINT FK → medewerkers.id | Mig 217. Picker die deze colli markeerde. Per-colli audit zodat shift-overgang traceerbaar blijft. ON DELETE SET NULL. |
| created_at | TIMESTAMPTZ | Auto |

**Indexen:** `idx_zending_colli_zending` (zending_id), `idx_zending_colli_orderregel` (order_regel_id).

**Generator-RPC:** `genereer_zending_colli(p_zending_id)` splitst zending-regels in 1-tapijt-per-stuk colli-rijen, vult SSCC en omschrijving-snapshot. Idempotent (skipt als er al colli's zijn). Aangeroepen door `enqueue_zending_naar_vervoerder` voor `type='print'` vervoerders (mig 210).

**SSCC-generator:** `genereer_sscc()` produceert 18 cijfers — extension `0` + Karpi GS1-prefix `8715954` + 9-cijferig serial (sequence `sscc_serial_seq`) + Mod-10 check digit. Helper `sscc_check_digit(text)` voor verificatie.

---

### hst_transportorders
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
| confectie_afgerond_op | TIMESTAMPTZ | Moment waarop confectie klaar is (NULL = nog niet afgerond) |
| ingepakt_op | TIMESTAMPTZ | Moment waarop het stuk is ingepakt voor verzending |
| locatie | TEXT | Magazijnlocatie waar het ingepakte stuk ligt (vrije tekst bv. "A-12") |

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
| UK: (inkooporder_id, regelnummer) | | |

**Koppeling aan rollen:** `rollen.inkooporder_regel_id` (BIGINT FK → inkooporder_regels) legt vast uit welke regel een fysieke rol ontvangen is. Gevuld door RPC `boek_ontvangst`.

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
| capaciteit_per_week | number | 450 | Max tapijten per week |
| capaciteit_marge_pct | number | 10 | Buffer % boven capaciteit |
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
| zending_id | BIGINT | FK volgt zodra zendingen-tabel DESADV-velden krijgt |
| bron_tabel | TEXT | Voor uitgaand: welke tabel triggerde ('orders'/'facturen'/'zendingen') |
| bron_id | BIGINT | PK van het bron-record. Idempotent met (berichttype, bron_tabel, bron_id) UK |
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
- `uk_edi_berichten_uitgaand_actief` — UNIQUE op `(berichttype, bron_tabel, bron_id)` waar `richting='uit' AND status NOT IN ('Fout','Geannuleerd')` (voorkomt dubbele triggers)

**RPCs:** `log_edi_inkomend`, `markeer_edi_ack`, `create_edi_order`, `match_edi_artikel`, `enqueue_edi_uitgaand`, `claim_volgende_uitgaand`, `markeer_edi_verstuurd`, `markeer_edi_fout`. Sinds migratie 166 gebruikt `create_edi_order` de debiteur-prijslijst (`debiteuren.prijslijst_nr -> prijslijst_regels`) voor orderregelprijzen, met fallback op `producten.verkoopprijs`.

---

## Enums

| Enum | Waarden |
|------|---------|
| order_status | Nieuw, Actie vereist, Wacht op picken, Wacht op voorraad, **Wacht op inkoop** (mig 144), In snijplan, In productie, Deels gereed, Klaar voor verzending, Verzonden, Geannuleerd |
| zending_status | Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd (mig 169) |
| factuur_status | Concept, Verstuurd, Betaald, Herinnering, Aanmaning, Gecrediteerd |
| factuurvoorkeur | per_zending, wekelijks |
| factuur_queue_status | pending, processing, done, failed |
| snijplan_status | Gepland, Wacht, Gesneden, In confectie, Ingepakt, In productie, Gereed, Geannuleerd |
| inkooporder_status | Concept, Besteld, Deels ontvangen, Ontvangen, Geannuleerd |
| confectie_status | Wacht op materiaal, In productie, Kwaliteitscontrole, Gereed, Geannuleerd |
| edi_bericht_status | Wachtrij, Bezig, Verstuurd, Verwerkt, Fout, Geannuleerd (mig 157) |
| edi_orderbev_format | transus_xml, fixed_width (mig 161) |
| edi_transus_test_status | niet_getest, goedgekeurd, afgekeurd (mig 161) |
| hst_transportorder_status | Wachtrij, Bezig, Verstuurd, Fout, Geannuleerd (mig 171) |

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
| snijplanning_overzicht | Snijplannen met order-, klant- en rolgegevens voor de planningsweergave. `snij_lengte_cm`/`snij_breedte_cm` zijn **nominale (bestelde) maten**. Migratie 143 voegt `marge_cm` toe (single-source via `stuk_snij_marge_cm()` migratie 126; ZO +6, rond/ovaal +5, max bij combi) en `geroteerd` toe — beide nodig voor de SnijVolgorde-transformer ([frontend/src/lib/snij-volgorde/derive.ts](../frontend/src/lib/snij-volgorde/derive.ts)) die de rol-uitvoer modal voedt. Fysieke snij-maat = bestelde + marge. |
| confectie_overzicht | Confectie-orders met scan- en voortgangsstatus |
| confectie_planning_overzicht | Confectie-orders (status Wacht op materiaal / In productie) met klant, order, maatwerk-afmetingen en strekkende meter voor planningsweergave |
| confectie_planning_forward | Vooruitkijkende confectie-planning — alle open maatwerk-snijplannen (Gepland..In confectie/Ingepakt) met afgeleide type_bewerking + confectie_startdatum + backward-compat aliassen |
| productie_dashboard | Aggregaties voor het productie-dashboard: aantallen per status, capaciteit, doorlooptijd |
| leveranciers_overzicht | Per leverancier: openstaande orders/meters + eerstvolgende verwachte levering. Basis voor Leveranciers-overzichtspagina. Migratie 127. |
| inkooporders_overzicht | Per inkooporder: leveranciersnaam + aantal regels + totaal besteld/geleverd/te_leveren. Basis voor Inkooporders-overzichtspagina. Migratie 127. |
| openstaande_inkooporder_regels | Open regels (`te_leveren_m > 0` én order in Concept/Besteld/Deels ontvangen) met leverancier, product, kwaliteit/kleur. Migratie 127. |
| order_regel_levertijd | Per orderregel: levertijd-status (`voorraad` / `op_inkoop` / `wacht_op_nieuwe_inkoop` / `maatwerk`), claim-aantallen (`aantal_voorraad`, `aantal_io`, `aantal_tekort`), eerste/laatste IO-datum en berekende `verwachte_leverweek` (ISO `YYYY-Www`) op basis van `lever_modus` + buffer uit `app_config.order_config`. Migratie 150. |
| inkooporder_regel_claim_zicht | Per IO-regel: `aantal_geclaimd` / `aantal_vrij` / `aantal_orderregels` (alleen voor `eenheid='stuks'`-regels relevant). Migratie 150. |
| uitwisselbaarheid_map1_diff | Diagnostiek (migratie 138): Map1-paren in `kwaliteit_kleur_uitwisselgroepen` die NIET door `uitwisselbare_paren()` afgedekt worden, met `reden`-kolom (input-kw zonder collectie_id, kwaliteiten in andere collecties, kleur-code-mismatch, target ontbreekt in producten/rollen/maatwerk_m2_prijzen). Moet 0 rijen geven voordat Map1 fysiek gedropt mag worden. |
| vervoerder_stats | Per-vervoerder dashboard-aggregaties (mig 174, aangepast mig 176): `aantal_klanten` (distinct debiteuren uit zendingen), `aantal_zendingen_totaal` + `aantal_zendingen_deze_maand` (uit `zendingen.vervoerder_code`), `hst_aantal_verstuurd` + `hst_aantal_fout` (uit `hst_transportorders`, alleen niet-NULL voor de `hst_api`-rij). Voedt de `/logistiek/vervoerders`-overzichts- en detailpagina's. EDI-equivalent uit `edi_berichten` met `berichttype='verzendbericht'` volgt later. |

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
| `herwaardeer_order_status(p_order_id BIGINT)` | Herwaardeer `orders.status` op basis van claim-staat: `Wacht op inkoop` > `Wacht op voorraad` > `Nieuw`. Eindstatussen / actieve productie/picking blijven ongewijzigd. Migratie 145. |
| `release_claims_voor_io_regel(p_io_regel_id BIGINT)` | Bij IO-regel annulering: alle orderregels met claim op deze IO worden via `herallocateer_orderregel` opnieuw gealloceerd. Migratie 145. |
| `bereken_late_claim_afleverdatum(p_order_id BIGINT)` | Returnt afleverdatum voor een order op basis van de laatste actieve IO-claim (`MAX(verwacht_datum) + inkoop_buffer_weken_vast × 7` dagen). NULL als er geen IO-claims zijn. Migratie 153. |
| `sync_order_afleverdatum_met_claims(p_order_id BIGINT)` | Schuift `orders.afleverdatum` + `week` vooruit naar de laatste IO-claim-leverdatum als die later is. Schuift alleen vooruit, nooit terug. Eindstatussen blijven ongewijzigd. Aangeroepen vanuit `herwaardeer_order_status`. Migratie 153. |
| `set_uitwisselbaar_claims(p_order_regel_id BIGINT, p_keuzes JSONB)` | Vervangt handmatige uitwisselbaar-claims voor een orderregel met de in `p_keuzes` opgegeven `[{artikelnr, aantal}]`-lijst. Roept daarna `herallocateer_orderregel` aan om voorraad eigen + IO aan te vullen voor het resterende deel. Migratie 154. |
| `trg_default_fysiek_artikelnr()` | BEFORE-trigger op `order_reserveringen`: vult `fysiek_artikelnr` uit `order_regels.artikelnr` als die NULL is. Migratie 154. |
| `zoek_equivalente_producten(artikelnr TEXT, min_voorraad INTEGER)` | Zoekt producten met dezelfde collectie + kleur_code die op voorraad zijn (substitutie-suggesties) |
| `genereer_scancode()` | Genereert een unieke scancode (bijv. SNIJ-XXXX of CONF-XXXX) voor barcode/QR-stickers |
| `beste_rol_voor_snijplan(kwaliteit TEXT, kleur TEXT, lengte INTEGER, breedte INTEGER)` | Selecteert de optimale rol (minste verspilling) voor een snijplan op basis van kwaliteit, kleur en afmetingen |
| `maak_reststuk(rol_id BIGINT, nieuwe_lengte INTEGER, snijplan_id BIGINT)` | Maakt een reststuk-rol aan na het snijden, werkt originele rol bij en logt voorraadmutatie |
| `voltooi_snijplan_rol(p_rol_id BIGINT, p_gesneden_door TEXT, p_override_rest_lengte INTEGER, p_reststukken JSONB, p_snijplan_ids BIGINT[])` | Markeert snijplannen als gesneden + maakt reststukken aan. Met `p_snijplan_ids` gevuld: alleen die IDs → Gesneden; overige `Snijden` stukken op de rol → terug naar `Wacht` (rol_id/positie gereset) voor volgende optimalisatie-run. Zet ook `rollen.snijden_voltooid_op=NOW()`. Reststukken: geef `p_reststukken` JSONB array mee → één rol per rechthoek ≥70×140 cm. Returns: TABLE(reststuk_id, reststuk_rolnummer, reststuk_lengte_cm). (migraties 060, 066) |
| `start_snijden_rol(p_rol_id BIGINT, p_gebruiker TEXT)` | Idempotent: zet `rollen.snijden_gestart_op=NOW()` en `snijden_gestart_door` als nog niet gevuld. Voor tijdanalyse snijduur. (migratie 064) |
| `auto_markeer_maatwerk()` | Trigger: markeert nieuwe order_regels automatisch als is_maatwerk=true wanneer product_type='rol' |
| `auto_maak_snijplan()` | Trigger: maakt automatisch een snijplan aan (status 'Wacht') voor nieuwe maatwerk order_regels |
| `keur_snijvoorstel_goed(voorstel_id BIGINT)` | Keurt een snijvoorstel goed: wijst rollen toe aan snijplannen, zet status 'Gepland', met concurrency guards |
| `verwerp_snijvoorstel(voorstel_id BIGINT)` | Verwerpt een concept-snijvoorstel zonder wijzigingen |
| `kleuren_voor_kwaliteit(p_kwaliteit TEXT)` | Retourneert kleuren met m²-prijs, kostprijs, gewicht en max breedte voor een kwaliteit. **Sinds mig 181: gewicht_per_m2_kg komt uit `kwaliteiten` (één bron-van-waarheid)**; voorheen uit `maatwerk_m2_prijzen` per kleur. |
| `gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code TEXT) → NUMERIC` | **Gewicht-resolver — publiek seam #1.** Eenvoudige lookup van density per kwaliteit. NULL als kwaliteit nog geen gewicht heeft. STABLE. Mig 185. |
| `bereken_product_gewicht_kg(p_artikelnr TEXT) → TABLE(gewicht_kg, uit_kwaliteit)` | **Gewicht-resolver — publiek seam #2.** Gewicht (kg/stuk) voor een vast/staaltje-product. Vorm-aware sinds mig 188: `vorm='rond'` → `π × (lengte_cm/200)² × density`; anders `(lengte × breedte / 10000) × density`. Bij volledige cache-bron retourneert `(gewicht, true)`; bij ontbrekende kwaliteit-density of maat-data retourneert `(legacy_gewicht, false)`. STABLE. Mig 185, vorm-logica mig 188. |
| `bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT) → NUMERIC` | **Gewicht-resolver — publiek seam #3.** Gewicht (kg/stuk) voor een orderregel. Maatwerk: `oppervlak × kwaliteit-density`. Vast: copy van `producten.gewicht_kg`. Service-items zonder artikelnr → NULL. STABLE. Mig 185. |
| `bereken_orderregel_prijs(p_artikelnr TEXT, p_prijslijst_nr TEXT) → JSONB` | **Prijs-resolver voor order-aanmaak.** 5-stappen fallback-keten: `prijslijst_vast` (prijslijst_regels) → `prijslijst_m2` (m²-prijs van kleur-specifiek MAATWERK-artikel × oppervlak + vormtoeslag) → `maatwerk_artikel_m2` (`producten.verkoopprijs` van MAATWERK-artikel × oppervlak + vormtoeslag) → `kwaliteit_m2` (`maatwerk_m2_prijzen` × oppervlak + vormtoeslag) → `product_verkoopprijs` (eigen verkoopprijs). Vormtoeslag uit `maatwerk_vormen.toeslag` via `producten.maatwerk_vorm_code`. Retourneert `{ prijs, bron, breakdown }`. STABLE. Mig 191. |
| `trg_kwaliteit_gewicht_recalc()` | Trigger op `kwaliteiten` (AFTER UPDATE OF gewicht_per_m2_kg). Cascade: herrekent producten in die kwaliteit + open maatwerk-orderregels. Mig 185. |
| `trg_product_gewicht_recalc()` | Trigger op `producten` (AFTER UPDATE OF gewicht_kg). Cascade: kopieert gewicht naar open vaste-orderregels met dat artikelnr. Mig 185. |
| ~~`rollen_uitwissel_voorraad()`~~ | **GEDROPT in mig 187 (T005)** — vervangen door `voorraadposities()` (mig 179/180). Geen externe callers meer; functie definitief verwijderd. |
| `normaliseer_kleur_code(code TEXT)` | Normaliseert kleur_code: strip trailing ".0" (bijv. "12.0" → "12") — IMMUTABLE helper |
| `snijplanning_groepen_gefilterd(p_tot_datum)` | Gegroepeerde snijplanning met optionele afleverdatum-filter (groepeert op genormaliseerde kleur_code) |
| `stuk_snij_marge_cm(afwerking TEXT, vorm TEXT)` | Extra cm op elke dimensie bij snijden: ZO-afwerking +6, rond/ovaal +5. Combi → grootste wint (niet cumulatief). IMMUTABLE. Wordt gebruikt in `snijplanning_tekort_analyse()`. TS-equivalent in `_shared/snij-marges.ts`. (migratie 126) |
| `snijplanning_tekort_analyse()` | Per snijden-groep: uitwisselbare kwaliteits (Map1 primair, collectie-fallback), aantal beschikbare rollen, totaal m², `max_lange/max_korte` rolmaten, en `grootste_onpassend_stuk_*` met marge-check. Sluit placeholder-rollen (0×0) uit, synchroon met `auto-plan-groep` edge. `heeft_collectie` = heeft uitwissel-partners (Map1 OR collectie). (migratie 134, basis 102/117/126) |
| `snijplanning_status_counts_gefilterd(p_tot_datum)` | Status counts met optionele afleverdatum-filter |
| `release_gepland_stukken(kwaliteit TEXT, kleur TEXT)` | Geeft Gepland-snijplannen van de BESTEL-groep (`order_regels.maatwerk_kwaliteit_code / _kleur_code`) vrij voor heroptimalisatie: clear `rol_id`/posities, rollen zonder resterende Gepland/Snijden/Gesneden stukken terug naar `beschikbaar`/`reststuk`. Raakt rollen met `snijden_gestart_op IS NOT NULL` niet aan. Filter op BESTEL-kwaliteit i.p.v. rol-kwaliteit is essentieel voor cross-kwaliteit plaatsingen via uitwisselbaarheid (migratie 133, fixt regressie uit 073). |
| `start_productie_rol(rol_id BIGINT)` | Zet alle Gepland stukken op een rol naar In productie (beschermt tegen heroptimalisatie) |
| `acquire_snijplan_lock(kwaliteit TEXT, kleur TEXT)` | Atomisch lock verkrijgen voor auto-planning (5 min staleness timeout) |
| `release_snijplan_lock(kwaliteit TEXT, kleur TEXT)` | Lock vrijgeven na auto-planning |
| `start_confectie(p_snijplan_id BIGINT)` | Zet snijplan-status op 'In confectie'. Idempotent. Valideert dat status vooraf Gesneden/In confectie is. |
| `voltooi_confectie(p_snijplan_id BIGINT, p_afgerond BOOLEAN DEFAULT true, p_ingepakt BOOLEAN DEFAULT false, p_locatie TEXT DEFAULT NULL)` | Rondt confectie af. p_afgerond=false clears + status terug naar Gesneden. p_ingepakt=true zet status Gereed + ingepakt_op. p_locatie="" wist locatie; NULL laat ongemoeid. |
| `update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)` | Merge-update van order header + regels: UPDATE bestaande regels op `id`, INSERT nieuwe, DELETE regels die uit payload verdwenen zijn. Preserveert `snijplannen.order_regel_id` FK-koppelingen (migratie 074) |
| `backlog_per_kwaliteit_kleur(p_kwaliteit TEXT, p_kleur TEXT)` | Aggregeert wachtende snijplan-stukken voor real-time levertijd-check: returnt `(totaal_m2, aantal_stukken, vroegste_afleverdatum)`. Match op kleur-varianten (X, X.0). Gebruikt door `check-levertijd` edge function (migratie 080) |
| `genereer_factuur(p_order_ids BIGINT[])` | Atomair: maakt factuur + regels aan voor 1+ orders van dezelfde debiteur, markeert order_regels.gefactureerd. Retourneert factuur_id. Migratie 119. |
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
| `enqueue_zending_naar_vervoerder(p_zending_id BIGINT) → TEXT` | **Single switch-point voor multi-vervoerder dispatch** — enige plek in de codebase waar op `vervoerder_code` wordt geswitcht. Leest `zendingen.vervoerder_code` of vult die via `selecteer_vervoerder_voor_zending()` en dispatcht naar de juiste adapter-RPC: `'hst_api'` → `enqueue_hst_transportorder`; toekomstige `'edi_partner_a/b'` → `enqueue_edi_verzendbericht` (op `edi_berichten`). Returnt textuele status (`enqueued_hst` / `geen_actieve_vervoerder` / `meerdere_actieve_vervoerders_geen_criteria` / `vervoerder_inactief` / `no_adapter_voor_<code>`) — alleen voor logging/debugging, niet voor caller-control-flow. Migratie 172, aangepast in 176. |
| `enqueue_hst_transportorder(p_zending_id BIGINT, p_debiteur_nr INTEGER, p_is_test BOOLEAN) → BIGINT` | HST-adapter: plaatst transportorder op wachtrij in `hst_transportorders`. Idempotent via `uk_hst_to_zending_actief`. Migratie 171. |
| `claim_volgende_hst_transportorder() → hst_transportorders` | HST-adapter: pakt oudste `Wachtrij`-rij (`FOR UPDATE SKIP LOCKED`), zet status `Bezig`. Aangeroepen door edge function `hst-send`. Migratie 171. |
| `markeer_hst_verstuurd(p_id, p_extern_transport_order_id, p_extern_tracking_number, p_request_payload, p_response_payload, p_response_http_code) → VOID` | HST-adapter: na 200-respons. Status → `Verstuurd`; schrijft `track_trace` terug op `zendingen` en promoveert zending-status van `'Klaar voor verzending'` naar `'Onderweg'`. Migratie 171. |
| `markeer_hst_fout(p_id, p_error, p_request_payload, p_response_payload, p_response_http_code, p_max_retries DEFAULT 3) → VOID` | HST-adapter: incrementeert `retry_count`. Bij `>=` max_retries → status `Fout`, anders terug naar `Wachtrij`. Migratie 171. |
| `create_or_get_magazijn_locatie(p_code TEXT, p_omschrijving TEXT DEFAULT NULL, p_type TEXT DEFAULT 'rek') → BIGINT` | Idempotent: vindt-of-maakt `magazijn_locaties.id` voor `code` (UPPER+TRIM). Wordt gebruikt door `MagazijnLocatieEdit` (rol-locatie zetten) en `boek_ontvangst`. Migratie 169. |
| `set_locatie_voor_orderregel(p_order_regel_id INTEGER, p_code TEXT) → BIGINT` | **Atomair**: vindt-of-maakt `magazijn_locaties`-rij voor `code` én zet `snijplannen.locatie = code` voor alle `Ingepakt`-rijen van de orderregel. Vervangt twee opeenvolgende RPC-calls (`createOrGetMagazijnLocatie + UPDATE snijplannen`) in `useUpdateMaatwerkLocatie` — voorkomt dangling `magazijn_locaties`-rijen wanneer de tweede call faalt. Returnt `magazijn_locaties.id`. Migratie 0183 (ADR-0002). |

### Triggers op order_regels (maatwerk)

| Trigger | Event | Timing | Functie |
|---------|-------|--------|---------|
| `trg_auto_maatwerk` | INSERT | BEFORE | `auto_markeer_maatwerk()` — zet is_maatwerk=true voor rol-producten |
| `trg_auto_snijplan` | INSERT | AFTER | `auto_maak_snijplan()` — maakt snijplan aan voor maatwerk regels |

---

## Storage

| Bucket | Doel | Toegang |
|--------|------|---------|
| logos | Klantlogo's ({debiteur_nr}.jpg) | Publiek lezen, auth upload/delete |
| facturen | Verstuurde factuur-PDFs ({debiteur_nr}/FACT-YYYY-NNNN.pdf) | Privé, frontend leest via signed URL (10 min); uploads via service role |
| documenten | Algemene documenten (algemene-voorwaarden-karpi-bv.pdf) | Publiek lezen, uploads via service role |
| order-documenten | Bijlagen bij orders en inkooporders. Paden `orders/{id}/...` en `inkooporders/{id}/...`. Max 25 MB; alleen PDF/JPG/PNG/WebP/Excel/Word/TXT toegestaan. | Privé, authenticated SELECT/INSERT/UPDATE/DELETE; frontend leest via signed URL |
