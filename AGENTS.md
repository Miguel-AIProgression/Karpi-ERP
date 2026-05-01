# RugFlow ERP — Karpi Tapijtgroothandel

ERP-portaal voor Karpi: beheer van klanten (debiteuren), producten (tapijtrollen), orders, en operationele processen. Gebouwd op Supabase + React/TypeScript.

## Tech Stack
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Frontend:** React 18+, TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Import:** Python 3 (pandas, openpyxl, supabase-py)

## Projectstructuur
```
AGENTS.md                  ← je bent hier
docs/                      ← levende documentatie (ALTIJD bijwerken na wijzigingen)
  database-schema.md       ← alle tabellen, kolommen, relaties, enums
  architectuur.md          ← tech stack, patterns, beslissingen
  data-woordenboek.md      ← domeinbegrippen (debiteur, kwaliteit, rol, etc.)
  changelog.md             ← chronologisch logboek van wijzigingen
  2026-04-01-*.md          ← origineel planbestand (referentie, niet muteren)
specs/                     ← requirement specs per topic (01-07)
brondata/                  ← Excel exports uit oud systeem (read-only referentie)
  voorraad/                ← producten + rollen imports
  debiteuren/              ← klanten + afleveradressen imports
  logos/                   ← klantlogo's ({debiteur_nr}.jpg)
mockups/                   ← HTML design mockups (inspiratie, niet pixel-perfect)
supabase/migrations/       ← SQL migraties (001-010)
import/                    ← Python import scripts
frontend/                  ← React applicatie
```

## Levende documenten — VERPLICHT bijwerken
Na elke wijziging aan database, frontend of structuur: werk de relevante docs bij.
- **database-schema.md** → bij tabel/kolom/relatie wijzigingen
- **architectuur.md** → bij nieuwe patterns, routes, of technische beslissingen
- **data-woordenboek.md** → bij nieuwe domeinbegrippen
- **changelog.md** → bij elke significante wijziging (datum + wat + waarom)

## Database kernconcepten
- 37 tabellen, 7 enums, 14 views, 24 functies — zie `docs/database-schema.md`
- `debiteur_nr` (INTEGER) = PK voor klanten — alle brondata en logo's verwijzen hiernaar
- `artikelnr` (TEXT) = PK voor producten
- Kwaliteitscodes (3-4 letters) → collecties (groepen uitwisselbare kwaliteiten)
- Orders bevatten adres-snapshots (geen FK naar afleveradressen)
- Nummering: `volgend_nummer('ORD')` → ORD-2026-0001

## Import volgorde (FK dependencies)
vertegenwoordigers → collecties → kwaliteiten → debiteuren → producten → rollen → orders → order_regels

## Frontend V1 scope
1. Orders (overzicht + detail + aanmaken + bewerken) — eerste feature
2. Debiteuren/Klanten (overzicht + detail)
3. Producten (overzicht + detail + rollen)
4. Dashboard (statistieken + recente orders)
Overige modules: placeholder pagina's, worden feature-voor-feature uitgebouwd.

## Bedrijfsregels
- **Orders verwijderen:** mag alleen als er geen snijplannen zijn met status 'Snijden', 'Gesneden' of later. Snijplannen met vroege statussen ('Wacht', 'Gepland') moeten eerst handmatig verwijderd worden vóór de order. Gooit anders FK-fout op `snijplannen_order_regel_id_fkey`.
- **Confectie-planning:** bron is `snijplannen` via view `confectie_planning_forward`. Lane (type_bewerking) wordt afgeleid van `maatwerk_afwerking` via `afwerking_types.type_bewerking`. Afwerkingen `ON`/`ZO` hebben geen lane en verschijnen onder "alleen stickeren". Status-transities lopen via RPC's `start_confectie` en `voltooi_confectie`, niet directe UPDATE.
- **Reservering op inkoop (vaste maten, mig 144–152):** orderregels zonder voldoende voorraad alloceren automatisch op openstaande inkooporderregels (status `Besteld`/`Deels ontvangen`, `eenheid='stuks'`) op `verwacht_datum ASC`. Bron-van-waarheid: tabel `order_reserveringen` met rijen voor zowel voorraad- als IO-claims. Centrale RPC: `herallocateer_orderregel(id)` — idempotent, wordt vanuit triggers en handmatig aangeroepen. **Claim-volgorde-prio**: wie eerst claimt, wordt eerst beleverd; geen automatische herallocatie bij urgentere nieuwe orders. Bij IO-annulering schuiven claims naar volgende IO of orders gaan in "Wacht op nieuwe inkoop" (orderregel zonder dekking — order-status blijft `Wacht op inkoop` totdat een nieuwe IO de allocator opnieuw triggert via orderregel-bewerking).
- **Maatwerk levertijd-indicator:** maatwerk reserveert NIET op inkoop in V1. Op de orderregel verschijnt alleen een hint `Eerstvolgende inkoop wk + 2 weken` als er geen rol beschikbaar is. Echte claim op rol-IO (`eenheid='m'`) staat op de V2-backlog.
- **`lever_modus`:** order-niveau keuze "deelleveringen" / "in_een_keer". Default uit `debiteuren.deelleveringen_toegestaan`, gevuld via `LeverModusDialog` bij opslaan als ≥1 regel tekort heeft. Bepaalt levertijd-berekening (eerste IO-week resp. max IO-week) en aantal zendingen. NULL voor orders zonder tekort.
- **`vrije_voorraad`-formule (mig 149):** `voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop` meer). `gereserveerd` is voortaan SUM van actieve `bron='voorraad'`-claims uit `order_reserveringen`, niet meer SUM van `te_leveren` op order_regels. Toekomstige inkoop blijft zichtbaar via `besteld_inkoop` en de claims, maar telt niet meer in "vandaag-leverbaar".
- **Afleverdatum sync met IO-claims (mig 153):** `herwaardeer_order_status` synct na elke alloc-cyclus de `orders.afleverdatum` naar de laatste IO-claim-leverdatum (`MAX(verwacht_datum) + inkoop_buffer_weken_vast × 7` dagen) als die later valt dan de huidige afleverdatum. Schuift alleen vóóruit, nooit terug — de afleverdatum reflecteert dus altijd minimaal de werkelijke claim-belofte aan de klant. Eindstatussen (Verzonden / Geannuleerd / Klaar voor verzending) blijven ongewijzigd.
- **Uitwisselbaar = handmatige claims (mig 154):** orderregel kan multi-source gedekt worden — voorraad eigen artikel + voorraad uitwisselbare(n) (omgestickerd) + IO eigen artikel — zonder de regel zelf te splitsen. Gebruiker kiest in [`UitwisselbaarTekortHint`](frontend/src/components/orders/uitwisselbaar-tekort-hint.tsx) per uitwisselbaar product een **aantal**; bij submit roept `order-form` `set_uitwisselbaar_claims(regel_id, [{artikelnr, aantal}])` aan die `is_handmatig=true` claims aanmaakt. Allocator (`herallocateer_orderregel`) **respecteert handmatige claims** (releaset alleen niet-handmatige) en vult resterend aan met voorraad eigen + IO eigen. **Voorraad uitwisselbaar product wordt ook daadwerkelijk gereserveerd** — `herbereken_product_reservering` telt op `fysiek_artikelnr`. **Factuur en order-regel weergave blijven 1× origineel artikel**; de omstickering is intern. Op order-detail wordt de claim-uitsplitsing per stuks-regel zichtbaar als geneste sub-rijen (eigen voorraad → omsticker → IO → wacht op nieuwe inkoop), met locatie + omschrijving van het uitwisselbare bron-product bij omsticker-rijen — gericht op de verzamelaar in het magazijn. Bron: [`fetchClaimsVoorOrder`](frontend/src/lib/supabase/queries/reserveringen.ts) + hook `useClaimsVoorOrder`.
- **EDI/Transus-koppeling (mig 156–157, fase 1):** vervangt Windows Connect op MITS-CA-01-009. Alle EDI-verkeer gaat via centrale tabel `edi_berichten` (audit + queue) gekoppeld aan Transus' SOAP-API (M10100 versturen, M10110 poll-ontvangen, M10300 ack). Format: fixed-width "Custom ERP" (Transus-Online ID 17653, versie 10) — Transus vertaalt zelf naar/van EDIFACT D96A richting de partners. Karpi-GLN: `8715954999998`. Per-debiteur configuratie staat in `edi_handelspartner_config` (4 berichttype-toggles + `transus_actief` + `test_modus`). **Cutover-constraint** (uit Transus' antwoord): WC en API kunnen niet parallel voor dezelfde partner — cutover is dus big-bang voor alle 39 partners. **Fase 1 (mig 156–157):** inkomende orders alleen loggen + acken (geen order-creatie), uitgaande berichten nog niet actief — eerst rondreis-test met Transus' test-handelspartner. Plan: [`docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md`](docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md).

## Conventies
- Taal in code: Engels (variabelen, functies). Taal in UI: Nederlands.
- Bedragen: € 1.234,56 (Nederlands formaat)
- Datums: DD-MM-YYYY in UI, ISO in database
- Status badges: kleurgecodeerd per enum waarde
- Queries: per module in `frontend/src/lib/supabase/queries/`
- **Bestanden klein houden:** splits logisch op als een bestand >200-300 regels groeit
- Componenten: 1 concern per bestand, extracteer herbruikbare delen

## Werkwijze met Codex (team-tips van Boris Cherny)
Deze werkafspraken verhogen kwaliteit en snelheid. Geen dogma's — experimenteer en behoud wat werkt.

### Planning & uitvoering
- **Plan-mode eerst bij niet-triviale taken:** maak eerst een solide plan, laat daarna implementeren. Bij complexe features: één Codex schrijft plan, een tweede reviewt als "staff engineer". Loopt het mis → terug naar plan-mode, niet doorduwen.
- **Detailleer specs:** verwijder ambiguïteit vóór overdracht. Specificiteit = autonomie.
- **Daag output uit:** vraag Codex om keuzes te rechtvaardigen ("prove this works", vergelijk main vs branch). Middelmatige fix? Vraag om verse herschrijving ("scrap it, implement the elegant solution").

### Parallelliseren met git worktrees
- Bij 2+ onafhankelijke taken: gebruik git worktrees zodat elke sessie een eigen werkdirectory heeft.
- Eventueel een vaste "analyse"-worktree voor log/data-onderzoek zonder de hoofdbranch te vervuilen.

### Subagents
- Expliciet "gebruik subagents" vragen bij zware taken — houdt hoofdcontext schoon.
- Offload deelonderzoek (codebase-verkenning, research) naar Explore-subagents.

### AGENTS.md onderhouden
- Corrigeer je Codex? Vraag dán: "werk AGENTS.md bij zodat dit niet opnieuw gebeurt." Itereer totdat foutmarge daalt.
- Per module/feature eventueel een notes/-map bijhouden, bijgewerkt na elke significante wijziging.

### Herbruikbare skills & commands
- Doe je iets >1x per dag → maak er een slash-command of skill van en commit naar git.
- Kandidaten in deze repo: `/techdebt` (duplicatie opruimen), `/sync-context` (Slack/Drive/issues dump), `/schema-refresh` (regenereer database-schema.md vanuit Supabase).

### Bug-fixing end-to-end
- Plak volledige bug-threads (Slack/issue) en laat Codex de fix uitvoeren — niet micromanagen.
- Bij CI-failures: "fix de failing tests", laat de methode los.
- Wijs naar Docker/Supabase logs voor distributed-systems debugging.

### Data & analytics in Codex
- Gebruik Supabase MCP of `psql`/CLI om metrics direct op te halen en inline te analyseren.
- Zelfde patroon voor BigQuery/andere datastores met CLI of MCP.

### Leren & begrijpen
- Onbekende code? Vraag om ASCII-diagram of korte HTML-presentatie ter uitleg.
- Overweeg Learning/Explanatory output-style in `/config` zodat Codex het *waarom* van wijzigingen toelicht.

### Terminal & omgeving
- `/statusline` aan: altijd context-usage en huidige branch zichtbaar.
- Tab-naamgeving/kleur per worktree; overweeg voice-dictation voor rijkere prompts.
