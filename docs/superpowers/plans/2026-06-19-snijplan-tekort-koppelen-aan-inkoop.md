# Snijplan-tekorten automatisch koppelen aan openstaande rol-inkooporders

## Context

Vandaag toont de Snijplanning-pagina een "Tekort"-melding voor elke kwaliteit+kleur-groep zonder fysiek beschikbare rol (bv. "BANG 12 · 7 stukken · Geen voorraad in uitwisselbare kwaliteiten... Inkoop nodig"), zelfs als er al een openstaande inkooporder voor exact die kwaliteit+kleur loopt (zoals INK-2026-9651, 360m BANGKOK kleur 12, ETA wk 26). Dit is een bekende leemte: CLAUDE.md documenteert expliciet dat maatwerk/rol-producten in V1 **niet** reserveren op inkoop — alleen vaste-maten-producten (`order_reserveringen`) doen dat. Onderzoek bevestigt: er bestaat vandaag geen enkele koppeling tussen snijplan-stukken en `inkooporder_regels`.

De gebruiker wil dat zo'n tekort-groep automatisch (FIFO) gekoppeld wordt aan de openstaande inkooporder, met een nauwkeurige ("echte pak-simulatie", niet zomaar m²-aftrek) berekening van hoeveel van de inkomende rol nog over is nadat de tekort-stukken erop gepland zijn — gegroepeerd per hele kwaliteit+kleur-tekortgroep, en zichtbaar als een eigen status ("Wacht op inkoop") in plaats van als "Tekort".

**Belangrijke les uit de codebase-geschiedenis (mig 112/113 → mig 182):** er bestond ooit een vergelijkbaar idee — "placeholder-rollen" (PH-*, 0×0 cm) in de `rollen`-tabel om iets te laten "meebestaan" zonder fysieke voorraad. Dat is bewust afgeschaft omdat fake rijen in `rollen` overal waar voorraad/m² geteld wordt een risico zijn. Dit plan vermijdt die fout: een "verwachte rol" wordt **nooit** als rij in `rollen` gemaakt. De packer (`guillotine-packing.ts`) accepteert een plain TS-object (`Roll`-interface) — een virtuele rol bestaat alleen tijdens de berekening in de edge function, in het geheugen.

## Architectuur in één zin

`auto-plan-groep` (de bestaande edge function die nu al per kwaliteit+kleur-groep automatisch plant) krijgt een **tweede pas**: stukken die na de normale (fysieke-rollen) pak-poging nog "niet geplaatst" zijn, worden opnieuw door dezelfde packer gestuurd tegen in-memory "virtuele rollen" gebouwd uit openstaande inkooporder-regels (eenheid='m', FIFO op `verwacht_datum`). Wat daar wél past krijgt een nieuwe snijplan-status **"Wacht op inkoop"** + een verwijzing naar de inkooporder_regel (i.p.v. naar een echte rol); de pak-simulatie levert direct de exacte "hoeveel cm/m² van deze rol is nu belegd" op (`RollResult.gebruikte_lengte_cm`), die als snapshot op de inkooporder_regel komt te staan. Elke relevante wijziging (nieuwe/gewijzigde IO-regel, IO geannuleerd, order/snijplan geannuleerd, échte rol komt binnen) triggert een herberekening **vanaf nul** voor die ene (kwaliteit,kleur)-groep — exact het patroon dat `auto-plan-groep` al hanteert voor fysieke rollen (release → recompute), dus geen nieuwe drift-gevoelige optel/aftrek-logica.

**Scope-keuze:** de IO-matching gebeurt op **exacte kwaliteit_code**, niet over het hele uitwisselbare-kwaliteiten-net (BANG/BRSO/FLUF/MARB/SILV). Reden: zodra twee verschillende tekort-groepen dezelfde inkooporder_regel zouden mogen claimen, kan de "hoeveel is er nog over"-teller niet meer veilig in één run herberekend worden zonder de andere groep se claim te overschrijven. De screenshot-case (BANG-tekort ↔ BANG-inkooporder) valt hier volledig binnen. Cross-kwaliteit IO-matching kan een latere uitbreiding zijn.

## Database-wijzigingen

- **Mig 437** — `ALTER TYPE snijplan_status ADD VALUE 'Wacht op inkoop' AFTER 'Wacht'` (eigen migratie, Postgres-beperking).
- **Mig 438** — `snijplannen.verwacht_inkooporder_regel_id` (FK, wederzijds exclusief met `rol_id` via CHECK), `inkooporder_regels.snijplan_gebruikte_lengte_cm` (snapshot), RPC's `claim_wacht_op_inkoop` / `release_wacht_op_inkoop_stukken` (spiegelt `release_gepland_stukken`, mig 133).
- **Mig 439** — `snijplanning_tekort_analyse()` sluit `status='Wacht op inkoop'` uit in zowel de `groepen`- als `stuk_checks`-CTE.
- **Mig 440** — nieuwe RPC `snijplanning_wacht_op_inkoop_analyse()`: per (kwaliteit, kleur, inkooporder_regel) → inkooporder_nr, leverancier, verwacht_datum, te_leveren_m/m², gebruikte/resterend cm/m², aantal_stukken.
- **Mig 441** — pg_net-triggers op `inkooporder_regels` (INSERT/UPDATE) en `inkooporders` (UPDATE, oud-vs-nieuw status-vergelijking via transition tables) die `auto-plan-groep` her-triggeren — spiegelt mig 100/111. Postgres laat geen kolomlijst + transition tables toe in combinatie; triggers vuren daarom op alle UPDATE's en de functie filtert zelf.
- **Mig 442** — `trg_order_events_snijplan_release()` (mig 290) uitgebreid: verzamelt naast geraakte rollen ook (kwaliteit,kleur)-paren met een verloren `verwacht_inkooporder_regel_id`-claim en her-triggert `auto-plan-groep` daarvoor (één UPDATE...RETURNING CTE, twee aggregaties — geen temp table).
- **Mig 443** — vervolg-contract-assert (mig 344-patroon) met de 10-waarden-snapshot incl. `'Wacht op inkoop'`.
- **Mig 444** — `openstaande_inkooporder_regels` (mig 320) toont `snijplan_gebruikte_lengte_cm` (kolom toegevoegd aan het einde, non-breaking).

## Backend: `auto-plan-groep` / `_shared`

- `_shared/db-helpers.ts`: nieuwe helpers `fetchOpenInkoopRegels` (query op `openstaande_inkooporder_regels`, `eenheid='m'`, exacte kwaliteit, FIFO `verwacht_datum ASC NULLS LAST`) en `fetchStandaardBreedte` (`kwaliteiten.standaard_breedte_cm`).
- `auto-plan-groep/index.ts`: Step 2b release't bestaande "Wacht op inkoop"-claims vóór de normale recompute. De early-returns bij 0 rollen / 0 geplaatste stukken zijn vervangen door een doorloop naar de IO-claim-pas: `nietGeplaatst`-stukken worden via `packAcrossRolls` opnieuw gepakt tegen in-memory virtuele `Roll`-objecten (`id: -regel_id`, `sort_priority: 3`, breedte uit `kwaliteiten.standaard_breedte_cm`). Resultaat → `claim_wacht_op_inkoop` RPC. Steps 6-8 (voorstel/goedkeuren/shelf-validator) blijven exclusief voor de échte-rollen-pas (die vereist `rol_id`).

## Frontend

- `_shared/snijplan-status.ts` + golden-fixture (`status-enums.golden.json`) + contract-test: `'Wacht op inkoop'` toegevoegd aan `SNIJPLAN_STATUSSEN` (eigen categorie, niet in `PLANBAAR`/`TE_SNIJDEN` etc.).
- `frontend/src/lib/utils/constants.ts` (`SNIJPLAN_STATUS_COLORS`) en `frontend/src/lib/orders/maatwerk-productie.ts` (`FASE_VOOR_STATUS`): nieuwe key toegevoegd (compiler dwingt dit af via `Record<SnijplanStatus, ...>`).
- Nieuwe query `fetchWachtOpInkoopAnalyse` + hook `useWachtOpInkoopAnalyse` (groepeert per kwaliteit+kleur).
- Nieuw component `wacht-op-inkoop-sectie.tsx` (oranje, spiegelt de bestaande order-status-kleur) + derde tab "Wacht op inkoop" op `snijplanning-overview.tsx` naast Te snijden/Tekort.
- Inkooporders Regeloverzicht (`inkoop-regel-overzicht-tab.tsx`): kleine oranje regel onder "Te leveren" met `snijplan_gebruikte_lengte_cm` indien > 0.

## Expliciete beperkingen (v1)

- IO-matching = exacte kwaliteit_code, geen cross-kwaliteit-substitutie via inkoop.
- Een inkooporder_regel wordt gemodelleerd als één rol van de volledige `te_leveren_m` lengte, ook al levert de leverancier in praktijk meerdere losse rollen — aanvaardbare benadering omdat stukken doorgaans veel korter zijn dan rol-lengtes; bij fysieke ontvangst herberekent de bestaande rollen-insert-trigger alles met de échte rol(len).
- De pg_net-triggers (mig 441/442) zijn **inert** tot `app_config.snijplanning.auto_planning.edge_url`/`auth_header` gevuld zijn — een al langer bestaande, niet door dit plan geïntroduceerde leemte. De wél-actieve aanroep-paden (order-aanmaak, snijplan-aanmaak, de "Auto-plan opnieuw draaien"-knop) activeren de nieuwe logica direct.

## Verificatie (uitgevoerd)

1. Migraties 437-444 toegepast op productie via Management API (`/database/query`), elk individueel geverifieerd.
2. `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/_shared/` — 365 passed, 2 pre-existing/niet-gerelateerde failures (guillotine K1756006D-regressie, CRLF-fixture) bevestigd ongewijzigd t.o.v. voor dit werk.
3. `npx vitest run` op snijplanning/inkoop/constants/maatwerk-productie — 46 passed.
4. `npx tsc -b --noEmit` — geen nieuwe fouten (4 pre-existing fouten uit eerder, ongerelateerd merge-werk blijven staan).
5. Edge function `auto-plan-groep` gedeployed; live aangeroepen voor kwaliteit=BANG, kleur=12:
   - Resultaat: 7/7 stukken geclaimd tegen INK-2026-9651, 16,9 m gebruikt van 180 m, 163,1 m resterend, `niet_geplaatst: []`.
   - `snijplannen`-rijen bevestigd: `status='Wacht op inkoop'`, `rol_id=NULL`, `verwacht_inkooporder_regel_id=151`.
   - `snijplanning_tekort_analyse()` toont BANG/12 niet meer.
   - `snijplanning_wacht_op_inkoop_analyse()` levert de juiste regel terug.
