# RugFlow ERP — Karpi Tapijtgroothandel

ERP-portaal voor Karpi: beheer van klanten (debiteuren), producten (tapijtrollen), orders, en operationele processen. Gebouwd op Supabase + React/TypeScript.

## Tech Stack
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Frontend:** React 18+, TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Import:** Python 3 (pandas, openpyxl, supabase-py)

## Projectstructuur
```
CLAUDE.md                  ← je bent hier: index + conventies + werkwijze
CONTEXT.md                 ← domeintaal (Order, Snijplan, Pickbaarheid, …) — lees dit vroeg
docs/
  modules/                 ← module-kaart: per module huidige bedrijfsregels + valkuilen
  adr/                     ← 40+ architectuurbeslissingen (genummerd)
  database-schema.md       ← alle tabellen, kolommen, relaties, enums
  architectuur.md          ← tech stack, patterns, beslissingen
  data-woordenboek.md      ← technische naslag per domeinterm
  order-lifecycle.md       ← statusmodel, transities, gates, intake-kanalen
  changelog.md             ← chronologisch logboek (append-only; géén naslagwerk)
  superpowers/plans+specs/ ← plan-/designbestanden per feature (referentie)
supabase/migrations/       ← SQL-migraties, append-only (500+)
supabase/schema/           ← GEGENEREERD snapshot: actuele RPC-bodies (functies.sql) + views.sql
                             ververs via: node scripts/dump-schema.mjs — nooit handmatig bewerken
supabase/functions/        ← edge functions; gedeelde pure logica in _shared/ (ADR-0033)
frontend/                  ← React-applicatie (src/modules/, src/lib/, src/components/)
import/                    ← Python import-scripts
brondata/                  ← Excel-exports uit Basta (read-only referentie)
scripts/git-hooks/         ← pre-commit docs-poort (zie Levende documenten)
```

## Module-kaart
Bedrijfsregels, kernbestanden en valkuilen per module staan in `docs/modules/` — **niet meer in dit bestand**. Regels dáár bijwerken = vervangen, niet stapelen.

| Module | Doc | Scope |
|---|---|---|
| Orders | [docs/modules/orders.md](docs/modules/orders.md) | intake-kanalen, lifecycle/statussen, gates, bevestiging, orderregels, combi-levering |
| Snijplanning | [docs/modules/snijplanning.md](docs/modules/snijplanning.md) | snijplannen, auto-plan/packing, haalbaarheid, rol-toewijzing, marges, capaciteit, confectie |
| Voorraad & inkoop | [docs/modules/voorraad-inkoop.md](docs/modules/voorraad-inkoop.md) | allocator/claims, vrije_voorraad, uitwisselbaar, rol-CRUD, inkooporders |
| Magazijn / Pick & Ship | [docs/modules/magazijn-pickship.md](docs/modules/magazijn-pickship.md) | pickbaarheid, startbaarheid, pickrondes, deelzendingen, manco |
| Logistiek & verzending | [docs/modules/logistiek-verzending.md](docs/modules/logistiek-verzending.md) | zendingen, bundeling, colli, labels, pakbon, vervoerders (HST/Verhoek/Rhenus/eigen), dropshipment |
| Facturatie & BTW | [docs/modules/facturatie.md](docs/modules/facturatie.md) | factuur-queue, concept-fase, verzamelfactuur, BTW-regelingen, documentrenderers |
| EDI / Transus | [docs/modules/edi.md](docs/modules/edi.md) | in-/uitgaande berichten, GLN-matching, leverweek-bevestiging, payload-audit |

Raakt je wijziging meerdere modules → werk élk geraakt module-doc bij. Domein-brede begrippen horen in `CONTEXT.md`, beslissingen in een ADR.

## Levende documenten — afgedwongen bijwerken
Na elke wijziging aan database, frontend of structuur: werk de relevante docs bij.
- **docs/modules/<module>.md** → bij elke bedrijfsregel-/gedragswijziging in die module (vervang de oude regel, stapel niet — twee tegenstrijdige regels is erger dan geen)
- **database-schema.md** → bij tabel/kolom/relatie-wijzigingen; **supabase/schema/** verversen via `node scripts/dump-schema.mjs` bij RPC-/view-wijzigingen
- **changelog.md** → bij elke significante wijziging (datum + wat + waarom)
- **order-lifecycle.md** → bij wijzigingen aan order-statussen, transities, gates, intake-kanalen of de productie-/magazijnflow
- **architectuur.md / data-woordenboek.md / CONTEXT.md** → bij nieuwe patterns, termen of domeinbegrippen

**Handhaving:** de pre-commit-hook (`scripts/git-hooks/pre-commit`, actief via `git config core.hooksPath scripts/git-hooks`) blokkeert elke commit die `supabase/migrations|functions/` of `frontend/src/` raakt zonder wijziging onder `docs/`, `CLAUDE.md` of `CONTEXT.md`. Bewust omzeilen bij écht triviale wijzigingen: `KARPI_SKIP_DOCS_CHECK=1 git commit …`. Nieuwe clone/machine: het `core.hooksPath`-config éénmalig zetten.

## Database kernconcepten
- Aantallen tabellen/views/functies: zie de kop van `docs/database-schema.md` (dé bron; hier niet dupliceren)
- Actuele RPC-/view-definities: `supabase/schema/functies.sql` + `views.sql` (gegenereerd) — niet chronologisch door migraties graven
- `debiteur_nr` (INTEGER) = PK voor klanten — alle brondata en logo's verwijzen hiernaar
- `artikelnr` (TEXT) = PK voor producten
- Kwaliteitscodes (3-4 letters) → collecties (groepen uitwisselbare kwaliteiten)
- Orders bevatten adres-snapshots (geen FK naar afleveradressen)
- Nummering: `volgend_nummer('ORD')` → ORD-2026-0001

## Import volgorde (FK dependencies)
vertegenwoordigers → collecties → kwaliteiten → debiteuren → producten → rollen → orders → order_regels

## Conventies
- Taal in code: Engels (variabelen, functies). Taal in UI: Nederlands.
- Bedragen: € 1.234,56 (Nederlands formaat)
- Datums: DD-MM-YYYY in UI, ISO in database
- Status badges: kleurgecodeerd per enum waarde
- Queries: per module in `frontend/src/lib/supabase/queries/`
- **Bestanden klein houden:** splits logisch op als een bestand >200-300 regels groeit
- Componenten: 1 concern per bestand, extracteer herbruikbare delen
- **Gedeelde TS-logica edge ↔ frontend (ADR-0033):** pure modules leven éénmalig in `supabase/functions/_shared/`; de frontend importeert/re-exporteert ze cross-root (zie de shims `@/lib/utils/iso-week`, `@/lib/utils/snijplan-status`, `@/lib/email-recipients`, `@/lib/orders/vervoerder-eisen`, en `@/lib/utils/land-vlag` dat `landNaarIso2Strikt` uit `_shared/adres-split.ts` re-exporteert). Nieuwe gedeelde logica wordt **nooit gekopieerd**; kan het niet puur (Deno-API's/https-imports/DB), dan aparte modules per runtime + golden-file-contracttest (patroon `derive-status.golden.json`).
- **Landnaam→ISO-2-normalisatie (single source, 2026-06-13):** vrije landnamen ('Nederland', 'BELGIË', 'Österreich') → ISO-2 loopt via **één** seam `_shared/adres-split.ts`: `normalizeCountry` (lenient — onbekend land komt uppercased/diakriet-vrij terug, voor vrachtbrief/EDI/factuur) en `landNaarIso2Strikt` (strikt — onbekend → null, voor de frontend-vlag). Beide spiegelen de SQL-bron `normaliseer_land` (mig 214) één-op-één. **SQL↔TS-contract (mig 389):** golden fixtures `frontend/src/lib/orders/__tests__/golden/normaliseer-land.golden.json` getoetst door `normaliseer-land.contract.test.ts` (Vitest) + `assert_normaliseer_land_contract()`. Wie `normaliseer_land` of de seam wijzigt: golden bijwerken + nieuwe `*_normaliseer_land_contract*.sql`.

## Werkwijze met Claude Code (team-tips van Boris Cherny)
Deze werkafspraken verhogen kwaliteit en snelheid. Geen dogma's — experimenteer en behoud wat werkt.

### Verplichte poorten (geen narratief — altijd toepassen)
- **Impact-preflight vóór elke inhoudelijke wijziging:** bepaal welke tabellen/RPC's je raakt, grep de codebase op álle lezers/schrijvers daarvan, en meld welke modules geraakt worden — óók ongenoemde (inkoop, maatwerk, snijplanning, facturatie). Check daarna het module-doc van elke geraakte module (`docs/modules/`) op geldende regels en valkuilen.
- **Runtime-bewijs vóór "klaar":** een wijziging met een DB-schrijfactie is niet klaar tot een test of directe query bewijst dat de rij ECHT veranderde, en elke geraakte UI-knop getraceerd is knop→handler→RPC→tabel. "De code/trigger staat er" is geen bewijs. Dit naast de bestaande golden/contract-tests, niet in plaats daarvan.

### Planning & uitvoering
- **Verticaal implementeren als standaard:** bouw features waar mogelijk in dunne verticale slices — één samenhangend stukje functionaliteit end-to-end door alle lagen (DB/migratie → RPC/edge function → query → UI), zodat het meteen werkt en testbaar is. NIET horizontaal (eerst alle DB, dan alle backend, dan alle frontend). Elke slice levert werkende, demonstreerbare waarde op; pas als verticaal echt niet kan, val terug op een horizontale aanpak.
- **Plan-mode eerst bij niet-triviale taken:** maak eerst een solide plan, laat daarna implementeren. Bij complexe features: één Claude schrijft plan, een tweede reviewt als "staff engineer". Loopt het mis → terug naar plan-mode, niet doorduwen.
- **Detailleer specs:** verwijder ambiguïteit vóór overdracht. Specificiteit = autonomie.
- **Daag output uit:** vraag Claude om keuzes te rechtvaardigen ("prove this works", vergelijk main vs branch). Middelmatige fix? Vraag om verse herschrijving ("scrap it, implement the elegant solution").

### Git-workflow (branch-strategie)
- **Grotere wijzigingen krijgen automatisch een eigen branch.** Begin substantieel werk (nieuwe feature, refactor over meerdere bestanden, migratie, alles met >~1 logische stap of meerdere bestanden) zónder te vragen op een eigen branch — bv. `feat/<korte-naam>`, `refactor/<korte-naam>`, `fix/<korte-naam>`. Commit het werk daar, en **merge pas naar `main` wanneer ik dat expliciet zeg** ("merge maar", "naar main"). Niet automatisch mergen.
- **Kleine, triviale wijzigingen** (één-regel-fix, typo, docs-tweak) mogen direct op `main` — gebruik je oordeel; bij twijfel: aparte branch.
- **Reden:** er draaien vaak meerdere Claude-sessies tegelijk in deze working tree. Direct op `main` werken laat sessies elkaars ongecommitte werk overschrijven/oppakken (zie incident 2026-06-07: gedeelde `changelog.md`/`architectuur.md` raakten verstrengeld). Een eigen branch per substantiële taak isoleert het werk tot ik bewust merge.
- **Merge-moment:** bij "merge naar main" → `git checkout main && git pull --ff-only && git merge <branch>` (of fast-forward), daarna push. Los merge-conflicten op de branch op, niet op `main`.
- **Auto-opruimen na merge:** zodra een branch naar `main` is gemerged én die merge live op de remote staat (gepusht), ruim je het lokale werk automatisch op zonder te vragen: verwijder de bijbehorende git-worktree (`git worktree remove <pad>`, gebruik `--force` als er alleen rommel als `.pyc`/test-output instaat) **plus** de gemergde branch (`git branch -d <branch>`), en `git worktree prune`. Verifieer "gemerged" met `git merge-base --is-ancestor <branch> origin/main` vóór verwijderen. **Nooit** opruimen: de actieve working dir, niet-gemergde branches/worktrees, of `locked` worktrees (mogelijk actieve sessies). Op Windows kan `git worktree remove` falen met "Invalid argument" terwijl de admin wél verdwijnt — wis dan de achtergebleven map met `Remove-Item -Recurse -Force` en draai `git worktree prune`.
- Géén PR's nodig (tenzij ik erom vraag) — branch + merge-op-commando volstaat.

### Parallelliseren met git worktrees
- Bij 2+ onafhankelijke taken: gebruik git worktrees zodat elke sessie een eigen werkdirectory heeft.
- Eventueel een vaste "analyse"-worktree voor log/data-onderzoek zonder de hoofdbranch te vervuilen.

### Subagents
- Expliciet "gebruik subagents" vragen bij zware taken — houdt hoofdcontext schoon.
- Offload deelonderzoek (codebase-verkenning, research) naar Explore-subagents.

### CLAUDE.md onderhouden
- Dit bestand is een **index**, geen archief: bedrijfsregels horen in `docs/modules/`, beslissingen in `docs/adr/`, historie in de changelog. Groeit een sectie hier voorbij een paar regels per onderwerp → verplaats naar het juiste doc en laat een verwijzing achter.
- Corrigeer je Claude? Vraag dán: "werk het relevante module-doc (of CLAUDE.md bij proces-afspraken) bij zodat dit niet opnieuw gebeurt." Itereer totdat foutmarge daalt.
- **Vervangen, niet stapelen:** een gewijzigde regel overschrijft de oude formulering — nooit een tweede bullet over hetzelfde onderwerp toevoegen (zo ontstonden voorheen tegenstrijdige duplicaten).

### Herbruikbare skills & commands
- Doe je iets >1x per dag → maak er een slash-command of skill van en commit naar git.
- Kandidaten in deze repo: `/techdebt` (duplicatie opruimen), `/sync-context` (Slack/Drive/issues dump); schema-verversen bestaat al: `node scripts/dump-schema.mjs`.

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
