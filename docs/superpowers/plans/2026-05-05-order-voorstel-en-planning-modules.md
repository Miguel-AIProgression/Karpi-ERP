# Order-voorstel + Planning als twee deep verticale Modules

**Datum:** 2026-05-05
**Beslissing:** [ADR-0001](../../adr/0001-order-voorstel-en-planning-als-twee-modules.md)
**Status:** Plan vastgesteld na grilling-sessie. Klaar voor `/to-issues`.

## Doel

De order-intake-flow (order-form → line-editor → uitwisselbaar-hint → levertijd-suggestie → claim-persistentie) en de productie-planning (snijplanning, confectie, levertijd-simulatie) worden geherstructureerd als twee deep verticale Modules met een TS-functie-contract als seam. Eerste twee Modules in het al ingezette patroon (na `modules/edi/` en `modules/logistiek/`).

Gewenste uitkomst:
- Frontend roept dunne Module-API's aan (`useOrderVoorstel`, `useOrder`, `simuleerLevertijd`).
- Complexiteit (allocatie, packing, capaciteit, scenario-resolutie) zit in de Module-implementatie, niet verspreid over UI-lagen.
- Wijziging aan packing-algoritme raakt alleen `modules/planning/`. Wijziging aan lever-modus-regels raakt alleen `modules/orders/`. Geen "kleine wijziging → bug elders" meer.

## Vastgestelde keuzes

### Naamgeving
- Concept: **Order-voorstel** (toegevoegd aan `data-woordenboek.md`).
- Module-namen: `modules/orders/` en `modules/planning/`.

### Architectuur (zie ADR-0001)
- Twee aparte deep verticals.
- Seam = pure TS-functie-contract `simuleerLevertijd(maatwerkRegels) → scenario`.
- Cross-Module-aanroep via shared edge-helper, niet via HTTP-tussenstap.

### Backend-diepte
- **`bouw_order_voorstel(p_concept jsonb) → jsonb`** — DB-RPC die voor een conceptuele orderregel-set: claim-allocatie simuleert (voorraad → uitwisselbaar → IO → wacht), lever-modus-vraag bepaalt, afleverdatum berekent, spoed-toeslag-mogelijkheid checkt. Strategie: **SAVEPOINT + ROLLBACK TO** in één RPC-call — hergebruikt `herallocateer_orderregel`-logica, korte lock, geen contention bij Karpi-volume.
- **`commit_order_voorstel(p_voorstel jsonb, p_voorstel_id uuid) → jsonb`** — atomic save: combineert wat nu `create_order_with_lines` + `set_uitwisselbaar_claims` + `herallocateer_orderregel` doen tot één RPC. **Idempotent** via client-supplied `voorstel_id` (UUID): tweede call met zelfde ID retourneert eerste resultaat. **Re-allocate vóór commit** om voorraad-drift af te vangen — afwijking t.o.v. voorstel komt in respons.
- Bestaande RPC's blijven bestaan als interne helpers (privé binnen Module, niet meer door FE aangeroepen): `create_order_with_lines`, `set_uitwisselbaar_claims`, `herallocateer_orderregel`, `release_claims_voor_io_regel`.
- **Edge-functie `orders-bouw-voorstel`** — orchestreert de DB-RPC en (voor maatwerk-regels) de Planning-seam. Frontend doet één `supabase.functions.invoke('orders-bouw-voorstel', { concept })`.
- **Edge-functie `planning-simuleer-levertijd`** — vervangt `check-levertijd` (rename + verhuizing). Helpers `_shared/levertijd-*.ts` verhuizen naar `_shared/planning/`.

### LevertijdSimulatieContract — de seam-vorm

**Input:**
```ts
type MaatwerkRegelConcept = {
  regel_id: string;                  // client-side stable ref
  kwaliteit_code: string;
  kleur_code: string;
  lengte_cm: number;
  breedte_cm: number;
  vorm: 'rechthoek' | 'rond' | 'ovaal' | 'organisch';
  maatwerk_afwerking: string | null;
  gewenste_lever_datum: string;      // ISO date
};
```
- Geen debiteur-context, geen prijsinfo, geen andere regels.

**Output (discriminated union):**
```ts
type SeamResult =
  | { ok: true; scenarios: PerRegelScenario[] }
  | { ok: false; error: 'planning_unavailable' | 'invalid_input'; message: string };

type PerRegelScenario = {
  regel_id: string;
  scenario: 'match_bestaande_rol' | 'nieuwe_rol_gepland' | 'wacht_op_orders' | 'spoed_mogelijk';
  snij_datum: string | null;
  lever_datum: string | null;
  spoed_toeslag_bedrag: number | null;
  onderbouwing: string;              // NL, max 240 chars
};
```
- Stuks-scenario's (`voorraad`, `op_inkoop`, `wacht_op_nieuwe_inkoop`) leven niet in deze seam — komen uit `bouw_order_voorstel` zelf. Planning kent alleen productie-scenario's.
- Geen exceptions over de seam — fouten zijn data.

### Batch-policy
**Max 2 maatwerk-regels per Planning-seam-call.** Reden: bij grotere orders willen we per regel of per twee regels een levertijd-belofte zodat losse regels nagestuurd kunnen worden zonder dat één trage regel de hele response blokkeert ("alles leverbaar behalve 1 ding → liever nasturen dan laten liggen"). De `orders-bouw-voorstel`-orchestrator splitst de maatwerk-regels in chunks van 2 en stuurt parallel.

### Verzendkosten bij gesplitste orders — gedragswijziging

**Huidige gedrag:** verzendkosten-regel gaat altijd mee met de standaard-order (snel-leveringsdeel).
**Nieuwe gedrag:** verzendkosten-regel landt op het **duurste** sub-order. Eén keer verzendkosten per fysieke leveringsstroom; bij twee aparte zendingen telt de relatieve waarde — duurste deel draagt de logistieke last.

Dit is geen folder-verhuizing maar een **business-rule-update**, te implementeren in `commit_order_voorstel`. Heeft impact op:
- regression-fixtures (case waar maatwerk duurder is dan standaard moet de verzendkosten op maatwerk-deel zien)
- `data-woordenboek.md` deelleveringen-rij (update bij doorvoering)
- `CLAUDE.md` business-rules-sectie (update bij doorvoering)

### Module-grenzen (afgesproken)

`modules/planning/`:
- Backend: `supabase/functions/{check-levertijd→planning-simuleer-levertijd, auto-plan-groep, optimaliseer-snijplan}/`, `_shared/planning/{levertijd-match, levertijd-capacity, levertijd-resolver, spoed-check, guillotine-packing, snij-marges, shelf-mes-validator}.ts`, DB-functies `backlog_per_kwaliteit_kleur`, `beste_rol_voor_snijplan`, `auto_maak_snijplan`.
- Frontend: `pages/snijplanning/*`, `pages/confectie/*`, `pages/instellingen/productie.tsx`, `components/snijplanning/*`, `components/confectie/*`, `lib/snij-volgorde/*`, queries `{snijplanning, snijvoorstel, confectie, confectie-planning, confectie-mutations, snijplanning-mutations, auto-planning, planning-config}.ts`, utils `{compute-reststukken, confectie-deadline, confectie-forward-planner, snij-marges, snijplan-mapping, bereken-agenda}.ts`.
- UI: `<LevertijdSuggestie>` + `<LevertijdBadge>` verhuizen hierheen (`presentatie/` subfolder), worden geconsumeerd door Orders.
- Barrel: `simuleerLevertijd`, `getCapaciteitsBezetting`, `getBacklog`, page-routes.

`modules/orders/`:
- Backend: nieuwe RPC's `bouw_order_voorstel` + `commit_order_voorstel`; bestaande RPC's blijven bestaan als implementatie-details (privé). View `order_regel_levertijd`. Edge-functie `orders-bouw-voorstel`.
- Frontend: `pages/orders/*`, `components/orders/*` (24 files, exclusief `<LevertijdSuggestie>` en `<LevertijdBadge>`), queries `{orders, order-mutations, op-maat, reserveringen, levertijd, product-equivalents}.ts`, utils `{afleverdatum, regel-dekking, order-lock, vorm-labels, maatwerk-prijs}.ts`.
- Barrel: `useOrderVoorstel`, `useOrder`, `useOrderClaims`, mutaties.

### Module-discipline
- **Strict barrel via ESLint-rule** `no-restricted-imports` op `@/modules/{x}/internal/**`. Externe consumers gebruiken alleen barrel-exports.
- **UI-cross-module toegestaan**: Orders mag direct `<LevertijdSuggestie>` importeren uit Planning's barrel.
- **`_shared/`-splitsing**: dingen door beide kanten + derden gebruikt blijven flat (`transus-soap.ts`, `iso-week.ts`-achtigen). Planning-specifiek (`levertijd-*`, `guillotine-packing`, `spoed-check`, `snij-marges`, `shelf-mes-validator`) verhuist naar `_shared/planning/`.

### Pick-ship — uit scope, voorafgaand mergen
Pick-ship wordt later z'n eigen `modules/pick-ship/`. Bewust nu niet meegenomen. Huidige `pages/pick-ship/`, `components/pick-ship/`, `queries/pick-ship*.ts` blijven voorlopig waar ze zijn.

**Stap 0 van uitvoering: bestaande pick-ship-werk op branch `codex/pickship` (huidige branch) eerst mergen naar `main`.** Anders ontstaan merge-conflicten op `pages/orders/order-detail.tsx` (zending-aanmaken-knop) tijdens de modules-refactor.

### Read-path
Order-detail (`pages/orders/order-detail.tsx`, `useClaimsVoorOrder`, `<RegelClaimDetail>`) leeft binnen `modules/orders/` — zelfde Module, **andere hook-API**:
- `useOrderVoorstel` voor pre-save (concept + simulatie).
- `useOrder` + `useOrderClaims` voor post-save (gepersisteerde staat).
Beide barrel-exports van dezelfde Module, geen aparte module nodig.

### Order-bewerken — buiten V1-scope
`pages/orders/order-edit.tsx` krijgt **aparte hook `useOrderBewerking`** voor V1. Blijft de bestaande RPC's gebruiken. Wordt deepening-kandidaat #2 in een latere migratie. Reden: `commit_order_voorstel` ook UPDATE-pad geven blaast de RPC op; aparte hook houdt scope behapbaar.

### Save-path
**Eén `commit_order_voorstel`-RPC.** Alle FE-mutaties op order-creation gaan hierdoorheen. `set_uitwisselbaar_claims` wordt privé — uitwisselbaar-keuzes worden onderdeel van het concept-payload aan `bouw_order_voorstel`/`commit_order_voorstel`:

```ts
type OrderRegelConcept = {
  regel_id: string;
  artikelnr: string;
  aantal: number;
  is_maatwerk: boolean;
  // ...
  uitwisselbaar_keuzes?: Array<{ artikelnr: string; aantal: number }>;
};
```

Allocator (`herallocateer_orderregel`) blijft zoals nu uitwisselbare voorraad respecteren (omsticker-flow).

**Respons-shape:**
```ts
{
  order_ids: number[];                                  // 1 of 2
  was_split: boolean;
  split_reason: 'deelleveringen' | null;
  claim_summary: {
    totaal_voorraad: number;
    totaal_omsticker: number;
    totaal_io: number;
    totaal_wacht: number;
  };
  afwijking_t_o_v_voorstel?: { regel_id: string; reden: string }[];   // bij re-alloc-drift
}
```

### Hook-vorm
**Eén `useOrderVoorstel`** met return:
```ts
{
  voorstel: OrderVoorstel | null;
  isSimuleren: boolean;
  isCommitten: boolean;
  fout: SeamError | RpcError | null;
  kanOpslaan: boolean;
  save: () => Promise<{ orderIds: number[]; wasSplit: boolean }>;
}
```
- TanStack Query, debounce 350ms, staleTime 30s, cache-key = stabiele hash van concept-payload.
- Intern split in deel-hooks; externe consumers (order-form) krijgen één punt van waarheid.

### Toekomstige seams (geparkeerd, niet in deze migratie)
- **EDI** (`bron_systeem='edi'`) — `create_edi_order` blijft apart pad. Latere fase: seam voor levertijd-terugkoppeling naar handelspartner via ORDRSP.
- **Webshop** (`bron_systeem='lightspeed'`) — `create_webshop_order` blijft apart pad. Latere fase: seam voor levertijden tonen op Floorpassion-shops.
- **Inkoop** — IO-claim-kant blijft DB-side implementatie-detail van Orders. Eigen Module pas overwegen als die kant ook gaat groeien.
- **Pick-ship** — eigen Module na deze migratie.

## Migratie-stappen

**0. Pick-ship eerst mergen naar `main`.** Branch `codex/pickship` afronden, mergen, schoon basislijn.
**1. Genereer ~20 maatwerk-zware regression-fixtures** als design-validation set (zie sectie hieronder). Synthetisch, in `frontend/src/modules/orders/__tests__/regression/{naam}.fixture.ts`.
**2. Snapshot bedoeld nieuwe gedrag** voor deze fixtures — niet huidige output. Verzendkosten-bij-duurste-deel telt als correctie t.o.v. huidige RPC. Documenteer per fixture wat afwijkt van vandaag.
**3. Worktree aanmaken**: `git worktree add ../karpi-erp-modules-orders-planning refactor/orders-planning-modules`. Branch is duidelijk apart, niet automerge.
**4. Folderverhuizing + barrel-aanmaak** (mechanisch, geen logica wijzigen). ESLint-rule activeren.
**5. Implementatie nieuwe RPC's** `bouw_order_voorstel` (SAVEPOINT-simulatie) + `commit_order_voorstel` (idempotent + verzendkosten-op-duurste-deel + re-alloc).
**6. Edge-functies**: `planning-simuleer-levertijd` (rename van `check-levertijd`) + `orders-bouw-voorstel` (nieuw, orchestreert).
**7. Seam-contract-tests** (`seam.contract.test.ts` in beide modules — zelfde fixtures, beide kanten).
**8. Nieuwe `useOrderVoorstel` hook**; order-form en order-line-editor herbouwen om hook te consumeren.
**9. Run regression-fixtures** — output match expected (inclusief gedragswijzigingen).
**10. Cleanup**: oude callsites verwijderen, onbereikbare code prunen, ESLint-violations fixen.
**11. QA op de branch** — zie QA-plan hieronder. Fix-forward bij vondsten.
**12. Merge naar main** zodra alle drie cutover-vinkjes groen zijn.

## Test-strategie

Vier lagen:

- **(a) Contract-tests op de seam** — `modules/orders/__tests__/planning-seam.contract.test.ts` + `modules/planning/__tests__/planning-seam.contract.test.ts`. Beide draaien dezelfde fixtures via dezelfde `LevertijdSimulatieContract`-interface.
- **(b) Unit-tests per Module** — bestaande `levertijd-resolver.test.ts` etc blijven; nieuwe pgTAP-tests voor `bouw_order_voorstel` en `commit_order_voorstel` (savepoint-rollback).
- **(c) Integration-tests** — 5–15 cases in `modules/orders/__tests__/integration/` met seed-fixtures tegen lokale Supabase (`supabase start`).
- **(d) Design-validation snapshot** — 20 fixtures uit stap 1 als golden-master. Niet "regression van oude" maar "expected new", met expliciete diff-doc voor gedragswijzigingen (verzendkosten-regel).

## Regression-fixtures — eerste lijst (concept)

Synthetisch, focus op maatwerk-edges. Genereren als TS-files met input-concept + verwachte output. Lijst om in stap 1 uit te werken (genereren + door jou reviewen op dekking):

1. **stuks-voorraad-volledig** — alle regels in voorraad, geen splitsing.
2. **stuks-deels-IO** — voorraad ontoereikend, IO-claim, lever_modus-vraag.
3. **stuks-volledig-IO** — geen voorraad, alles op IO.
4. **stuks-uitwisselbaar-omsticker** — eigen artikel onvoldoende, uitwisselbaar product wel.
5. **stuks-multi-source** — voorraad-eigen + omsticker + IO + wacht in één regel.
6. **stuks-alles-tekort** — geen voorraad, geen IO → "Wacht op nieuwe inkoop".
7. **maatwerk-match-bestaande-rol** — past op rol in pipeline (status Gepland).
8. **maatwerk-nieuwe-rol-gepland** — voorraadrol breed/lang genoeg, snijweek beschikbaar.
9. **maatwerk-wacht-op-orders** — geen rol breed/lang genoeg, inkoop nodig.
10. **maatwerk-spoed-mogelijk** — capaciteit deze week + spoed-buffer.
11. **maatwerk-spoed-niet-mogelijk** — capaciteit vol, spoed niet kunnen aanbieden.
12. **maatwerk-2-regels-1-leverbaar** — batch van 2 regels, één spoed-mogelijk, één wacht-op-orders.
13. **maatwerk-rond-vorm** — vorm-toeslag + +5cm marge.
14. **maatwerk-ZO-afwerking** — +6cm marge, geen lane.
15. **gemengd-deelleveringen-toegestaan** — standaard + maatwerk, klant deelleveringen=true → 2 orders, **verzendkosten op duurste deel**.
16. **gemengd-deelleveringen-toegestaan-maatwerk-duurder** — verzendkosten landt op maatwerk-order (regressie van gedragswijziging).
17. **gemengd-in-een-keer** — klant deelleveringen=false → max(IO-week, maatwerk-snijweek+buffer).
18. **idempotent-commit** — zelfde voorstel_id tweemaal verzonden, tweede call retourneert eerste resultaat.
19. **drift-tijdens-commit** — voorraad weggeboekt tussen voorstel en commit, `afwijking_t_o_v_voorstel` gevuld.
20. **klanteigen-naam** — debiteur heeft eigen naam voor kwaliteit/kleur, voorstel toont die.

## QA-plan op refactor-branch

Drie-vinkjes-cutover, alle drie groen vóór merge:

### (i) Geautomatiseerd
- Alle 20 design-fixtures groen tegen `bouw_order_voorstel` + `commit_order_voorstel` + Planning-seam.
- Bestaande `npm test` groen.
- pgTAP-tests groen op lokale Supabase.
- ESLint-rule passes (geen `internal/`-imports buiten Module).
- TypeScript-check passes.

### (ii) Handmatige UI-walkthrough
Test-flow in browser tegen lokale Supabase, alle stappen visueel verifiëren:

**Order-aanmaak — happy paths:**
- [ ] Nieuwe order, voorraad-only, één debiteur → snel doorlopen, geen lever-modus-vraag, afleverdatum = vandaag + standaard-werkdagen.
- [ ] Nieuwe order, gemixt voorraad+maatwerk, deelleveringen aan → LeverModusDialog verschijnt → kies deelleveringen → 2 orders, **verzendkosten op duurste deel** verifieerbaar in beide order-detail-pagina's.
- [ ] Nieuwe order, gemixt, deelleveringen aan, **maatwerk duurder** → verzendkosten op maatwerk-order (de cruciale gedragswijziging, expliciet visueel checken).
- [ ] Nieuwe order, gemixt, in_een_keer → 1 order, afleverdatum = max IO-week of maatwerk-snijweek+buffer.
- [ ] Nieuwe order, alles-tekort op stuks → status `Wacht op inkoop`, claim-uitsplitsing toont voorraad → omsticker → IO → wacht.
- [ ] Nieuwe order, maatwerk binnen spoed-buffer → spoed-toggle aanbieding → toggle aan → spoedtoeslag-regel toegevoegd, afleverdatum geüpdatet.
- [ ] Nieuwe order met klanteigen-naam debiteur → kwaliteit-kleur kiezer toont eigen naam.
- [ ] Nieuwe order met op-maat + ronde vorm → vorm-toeslag berekend, snij-marge correct.

**Order-detail / read-path:**
- [ ] Order-detail toont claim-uitsplitsing per regel (eigen voorraad → omsticker → IO → wacht).
- [ ] Omsticker-rij toont locatie + uitwisselbare bron-product.
- [ ] LevertijdBadge toont juiste week/scenario.

**Order-mutaties:**
- [ ] Order bewerken (oude flow via `useOrderBewerking`) blijft werken zoals voorheen.
- [ ] Order annuleren — claims releaset, andere orders heralloceren naar vrijgekomen IO-ruimte.
- [ ] IO ontvangen — claims consumeren in FIFO, orders schuiven naar `Klaar voor verzending`.

**Idempotency / netwerk-edge:**
- [ ] Save-knop dubbel klikken → één order aangemaakt, geen duplicaten (voorstel_id-check).
- [ ] Tab close + re-open midden in concept → concept verloren, opnieuw beginnen werkt.

**Externe paden ongewijzigd:**
- [ ] EDI-order via Transus-poll → `create_edi_order` werkt zoals voorheen, geen impact.
- [ ] Webshop-order via Lightspeed-webhook → `create_webshop_order` werkt zoals voorheen, geen impact.

### (iii) Codereview op de branch
- Alle nieuwe RPC's hebben pgTAP-tests.
- Seam-contract-tests aanwezig in beide Modules.
- Geen `console.log`, geen TODO zonder ticket-ref.
- ESLint + Prettier clean.
- `data-woordenboek.md`, `architectuur.md`, `CLAUDE.md` (deelleveringen-regel) bijgewerkt.

## Rollback / fix-forward

- Default: **fix-forward**. Worktree blijft staan voor snelle reproductie van vondsten na merge.
- Geen feature flag — branch-gebaseerde QA is het vangnet.
- Ernstig probleem ontdekt binnen 24u na merge → `git revert <merge>` naar main, fix in worktree, opnieuw mergen.

## Open punten

Alle ontwerpvragen zijn beantwoord. Resterende uitwerking gebeurt tijdens implementatie:
- Exacte SQL-shape van `bouw_order_voorstel` en `commit_order_voorstel` (PL/pgSQL bodies).
- Concrete TS-types voor `OrderConcept`, `OrderVoorstel`, `OrderRegelConcept`.
- ESLint-rule-config-snippet voor barrel-strictheid.
- Exacte hash-functie voor TanStack Query cache-key.

## Niet in deze migratie

- Geen wijziging aan EDI-flow, factuur-flow, HST-koppeling.
- Geen wijziging aan klanten-/producten-modules (blijven horizontaal verspreid; volgen pas in latere migraties als ze toch openliggen).
- Geen wijziging aan auth, RLS, of Supabase-projectstructuur.
- Geen UX-redesign — order-form blijft visueel identiek (behalve waar verzendkosten landen).
- Geen edit-pad refactor (`useOrderBewerking` blijft V1-bestaand).
