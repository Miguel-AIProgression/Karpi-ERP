# RugFlow ERP — Karpi Tapijtgroothandel

ERP-portaal voor Karpi: beheer van klanten (debiteuren), producten (tapijtrollen), orders, en operationele processen. Gebouwd op Supabase + React/TypeScript.

## Tech Stack
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Frontend:** React 18+, TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Import:** Python 3 (pandas, openpyxl, supabase-py)

## Projectstructuur
```
CLAUDE.md                  ← je bent hier
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
- 26 tabellen, 6 enums, 5 views, 5 functies — zie `docs/database-schema.md`
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

## Conventies
- Taal in code: Engels (variabelen, functies). Taal in UI: Nederlands.
- Bedragen: € 1.234,56 (Nederlands formaat)
- Datums: DD-MM-YYYY in UI, ISO in database
- Status badges: kleurgecodeerd per enum waarde
- Queries: per module in `frontend/src/lib/supabase/queries/`
- **Bestanden klein houden:** splits logisch op als een bestand >200-300 regels groeit
- Componenten: 1 concern per bestand, extracteer herbruikbare delen

## Werkwijze met Claude Code (team-tips van Boris Cherny)
Deze werkafspraken verhogen kwaliteit en snelheid. Geen dogma's — experimenteer en behoud wat werkt.

### Planning & uitvoering
- **Plan-mode eerst bij niet-triviale taken:** maak eerst een solide plan, laat daarna implementeren. Bij complexe features: één Claude schrijft plan, een tweede reviewt als "staff engineer". Loopt het mis → terug naar plan-mode, niet doorduwen.
- **Detailleer specs:** verwijder ambiguïteit vóór overdracht. Specificiteit = autonomie.
- **Daag output uit:** vraag Claude om keuzes te rechtvaardigen ("prove this works", vergelijk main vs branch). Middelmatige fix? Vraag om verse herschrijving ("scrap it, implement the elegant solution").

### Parallelliseren met git worktrees
- Bij 2+ onafhankelijke taken: gebruik git worktrees zodat elke sessie een eigen werkdirectory heeft.
- Eventueel een vaste "analyse"-worktree voor log/data-onderzoek zonder de hoofdbranch te vervuilen.

### Subagents
- Expliciet "gebruik subagents" vragen bij zware taken — houdt hoofdcontext schoon.
- Offload deelonderzoek (codebase-verkenning, research) naar Explore-subagents.

### CLAUDE.md onderhouden
- Corrigeer je Claude? Vraag dán: "werk CLAUDE.md bij zodat dit niet opnieuw gebeurt." Itereer totdat foutmarge daalt.
- Per module/feature eventueel een notes/-map bijhouden, bijgewerkt na elke significante wijziging.

### Herbruikbare skills & commands
- Doe je iets >1x per dag → maak er een slash-command of skill van en commit naar git.
- Kandidaten in deze repo: `/techdebt` (duplicatie opruimen), `/sync-context` (Slack/Drive/issues dump), `/schema-refresh` (regenereer database-schema.md vanuit Supabase).

### Bug-fixing end-to-end
- Plak volledige bug-threads (Slack/issue) en laat Claude de fix uitvoeren — niet micromanagen.
- Bij CI-failures: "fix de failing tests", laat de methode los.
- Wijs naar Docker/Supabase logs voor distributed-systems debugging.

### Data & analytics in Claude Code
- Gebruik Supabase MCP of `psql`/CLI om metrics direct op te halen en inline te analyseren.
- Zelfde patroon voor BigQuery/andere datastores met CLI of MCP.

### Leren & begrijpen
- Onbekende code? Vraag om ASCII-diagram of korte HTML-presentatie ter uitleg.
- Overweeg Learning/Explanatory output-style in `/config` zodat Claude het *waarom* van wijzigingen toelicht.

### Terminal & omgeving
- `/statusline` aan: altijd context-usage en huidige branch zichtbaar.
- Tab-naamgeving/kleur per worktree; overweeg voice-dictation voor rijkere prompts.
