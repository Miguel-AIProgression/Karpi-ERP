# Plan: Volledig inkoopproces — bestellen, verwachten, ontvangen, wijzigen + portal-uitrol

**Datum:** 2026-07-02 · **Status:** goedgekeurd na grill-sessie · **Branch:** `feat/inkoopproces` (eigen worktree)

## Doel

Eén sluitend proces voor inkooporders: wat is er ingekocht, wanneer wordt het
geleverd, hoe komt het correct op voorraad — en een wijzig-pad dat de bestaande
beloftes (verkooporder-claims, snijplan-koppelingen, leveranciersportal) nooit
stil breekt. Portal (portal.karpi.nl, nu alleen HENAN) blijft het
ETA-terugkoppel-kanaal en wordt later geleidelijk uitgerold.

## Besluiten uit de grill-sessie (2026-07-02)

1. **Wijzigen = vijf mutaties via RPC's** (ADR-0017-lijn, geen directe writes):
   regel toevoegen, regel verwijderen, besteld aantal wijzigen, prijs wijzigen,
   regel annuleren ("rest komt niet" = besteld verlagen naar geleverd).
   Guard = **Claim-vloer** (zie CONTEXT.md): verlagen/verwijderen mag niet onder
   `geleverd + actieve verkooporder-claims + snijplan-claims ('Wacht op inkoop')`;
   eronder vereist een expliciete vrijgeef-stap zodat getroffen verkooporders
   zíchtbaar terugvallen naar 'Wacht op inkoop'. Let op: FK
   `snijplannen.verwacht_inkooporder_regel_id` is `ON DELETE SET NULL` — een
   kale DELETE laat een snijplan stil achter op status 'Wacht op inkoop' zonder
   verwijzing; daarom altijd via de RPC met release
   (`release_wacht_op_inkoop_stukken` + `herallocateer_orderregel`).
2. **Portal-schrijfrechten blijven ETA + notitie.** Aantallen/prijzen muteert
   een leverancier nooit; afwijkingen komen als notitie binnen, Karpi verwerkt
   ze met de wijzig-RPC's. Uitrol is opt-in per leverancier, **later** — dit
   plan levert alleen de werkwijze. Taal blijft Engels.
3. **Ontvangst = bestaande boek-flow + locatie.** Rol-ontvangst krijgt een
   optioneel locatie-veld per rol. Minder geleverd en rest komt nooit →
   regel-annuleren-mutatie. Over-levering (52m op 50m besteld) → gewoon boeken,
   met redelijkheidsgrens server-side (max +10% zonder expliciete bevestiging).
   Verkeerde kwaliteit/kleur → werkwijze via bestaande `rol_handmatig_toevoegen`
   (ADR-0024), geen bouw.
4. **Aanmaken: `create_inkooporder`-RPC + eenheid-keuze.** Transactioneel
   (header + regels in één call; nu 3 losse inserts zonder rollback), en de UI
   kan eindelijk `eenheid='stuks'`-regels maken — nodig voor de eigen
   bedrijfsregel "antislip-IOs altijd op het stuks-artikel" (mig 408), die nu
   alleen via het Python-importscript kan. Concept-status blijft ongebruikt
   (YAGNI). Het importscript (`import/import_inkoopoverzicht.py`, draagt zelf
   de TODO) kan later op dezelfde RPC over.
5. **Geen nieuw zicht-scherm.** Het Regeloverzicht (`/inkoop`, tab) ís "wat is
   ingekocht, wanneer komt het". Eén toevoeging: markering **ETA-herkomst**
   (`eta_bijgewerkt_door` + `eta_bijgewerkt_op` bestaan al) zodat de inkoper
   ziet welke ETA's vers uit de portal komen — de zichtbare verbinding
   portal ↔ dagelijks werk.
6. **Portal-huishouding:** portal.karpi.nl = de statische `docs/portal/index.html`
   (geverifieerd live; portal.karpi.com bestaat niet). De React-duplicaat in de
   SPA (`frontend/src/pages/portal/*` + routes) is geverifieerd dood → weg
   (zelfde drift-klasse als het SSCC/labelbarcode-incident).

## Slices (verticaal, elk apart werkend + testbaar)

### Slice 1 — `create_inkooporder(p_header JSONB, p_regels JSONB)` (mig NNN)
- Eén RPC: `volgend_nummer('INK')` + header-INSERT + regel-INSERTs atomair;
  retourneert id + inkooporder_nr. Validaties: leverancier bestaat, ≥1 regel,
  eenheid ∈ ('m','stuks'), besteld > 0.
- **JSONB-valkuil:** RPC's droppen onbekende sleutels stil — kolomlijst in de
  RPC compleet houden bij elke latere velduitbreiding.
- Frontend: `createInkooporder()` → één `.rpc()`-call; regel-tabel in
  `inkooporder-form-dialog.tsx` krijgt eenheid-select ('m' default).
- Bestaande triggers doen de rest vanzelf (`trg_sync_besteld_inkoop`,
  `trg_io_regel_insert_swap_evaluate` op regel-INSERT).

### Slice 2 — Wijzig-RPC's met Claim-vloer (mig NNN+1)
- `voeg_inkooporder_regel_toe(p_inkooporder_id, p_regel JSONB)` — regelnummer =
  MAX+1; swap-evaluatie + (inerte) auto-plan-triggers vuren vanzelf.
- `wijzig_inkooporder_regel(p_regel_id, p_besteld, p_prijs)` — prijs vrij;
  besteld verlagen: guard op Claim-vloer, verhogen vrij (te_leveren mee).
- `annuleer_inkooporder_regel(p_regel_id, p_vrijgeven BOOLEAN DEFAULT FALSE)` —
  besteld := geleverd (te_leveren → 0). Zonder `p_vrijgeven` weigeren zodra er
  actieve claims/snijplan-koppelingen op de regel zitten, mét duidelijke melding
  wat er hangt (aantallen + ordernummers); met `p_vrijgeven=TRUE`: eerst
  `release_wacht_op_inkoop_stukken` (voor de (kwaliteit,kleur)-groep) en
  `herallocateer_orderregel` per claimende verkooporderregel, dán verlagen.
- `verwijder_inkooporder_regel(p_regel_id, p_vrijgeven ...)` — alleen als
  geleverd = 0; zelfde vrijgeef-mechaniek. Anders: annuleren i.p.v. verwijderen.
- Order-status herafleiden na elke mutatie (zelfde CASE als in de
  ontvangst-RPC's: alle regels te_leveren=0 → 'Ontvangen', etc.).
- Audit: per mutatie een `voorraad_mutaties`-achtige spoor is overkill; wél
  `inkooporders.opmerkingen` ongemoeid laten en de wijziging loggen in een
  `order_events`-stijl is NIET nodig — de RPC-meldingen + bestaande
  `levertijd_gewijzigd_door_eta`-keten dekken de zichtbaarheid. (Bewust simpel;
  uitbreiden kan als er behoefte blijkt.)
- UI op `inkooporder-detail.tsx`: "Regel toevoegen"-knop, per regel een
  bewerk-menu (aantal/prijs), "Regel annuleren" met bevestigings-dialog die de
  hangende claims toont vóór `p_vrijgeven=TRUE` wordt meegestuurd.

### Slice 3 — Ontvangst met locatie + over-leveringsgrens (mig NNN+2)
- `boek_inkooporder_ontvangst_rollen`: per rol optioneel `locatie` (code-string)
  in `p_rollen` → `create_or_get_magazijn_locatie` → `rollen.locatie_id`.
  **Superset-regel:** complete mig-281-body + deze wijziging (drift-check
  `pg_get_functiondef`).
- Server-side grens: totaal geleverd > besteld × 1,10 → weigeren met melding
  (client kan met expliciete bevestiging alsnog, via `p_sta_overlevering_toe`).
- `ontvangst-boeken-dialog.tsx`: locatie-invoerveld per rol (vrij, uppercased),
  zelfde patroon als `MagazijnLocatieEdit`.

### Slice 4 — Regeloverzicht: ETA-herkomst (frontend-only)
- Kolom/badge in `inkoop-regel-overzicht-tab.tsx`: "leverancier · 2 d geleden"
  vs "karpi · 30 d geleden" vs "— geen ETA" uit `eta_bijgewerkt_door/_op`.

### Slice 5 — Portal-huishouding + uitrol-werkwijze (frontend-only + docs)
- Verwijderen: `frontend/src/pages/portal/portal-login.tsx`,
  `supplier-portal.tsx`, beide routes + imports in `router.tsx`.
- Werkinstructie uitrol (in werkwijze-doc): credentials instellen op
  leverancier-detail → link portal.karpi.nl + korte Engelse instructie mailen →
  eerste login verifiëren → terugval blijft `update_regel_eta` `p_door='karpi'`.
  Nu géén nieuwe leveranciers aansluiten (besluit 02-07).

### Slice 6 — Deprecated wrappers opruimen (deadline 2026-07-13!)
- Caller-check op `boek_ontvangst`/`boek_voorraad_ontvangst` (DB: `pg_proc`-scan
  + edge functions; TS: `boekOntvangst`/`boekVoorraadOntvangst` in
  `queries/inkooporders.ts`). Daarna: TS-functies weg, DROP FUNCTION-migratie.
- Bijvangst-check: `import/sync_inkoopoverzicht_2026_06.py` staat niet in de
  lint-whitelist van `scripts/lint-no-direct-inkooporder-regel-write.sh` —
  eenmalig script? Zo ja, verplaatsen/markeren; zo nee, whitelisten of omzetten.

### Slice 7 — Werkinstructie + testdraaiboek (docs)
- `docs/werkwijze-inkoop.md`: het hele proces in operator-taal — bestellen
  (incl. stuks vs meters, antislip-regel), verwachten (Regeloverzicht, portal,
  ETA-gate op verkooporders), ontvangen (boeken, locatie, stickers, afwijkingen:
  minder/meer/verkeerd), wijzigen (wanneer welke mutatie, wat de vrijgeef-stap
  betekent), portal-uitrol per leverancier.

## Testen

1. **RPC-guards — rolled-back transacties op de live DB** (huisconventie,
   `supabase db query --linked`): per RPC de happy path + de gevaarlijke randen:
   - besteld verlagen onder de Claim-vloer met (a) actieve verkooporder-claim,
     (b) snijplan-'Wacht op inkoop'-koppeling → weigert met melding;
   - zelfde met vrijgeef-stap → verkooporder valt zichtbaar terug naar 'Wacht
     op inkoop', snijplan terug naar 'Wacht', `snijplan_gebruikte_lengte_cm`
     teruggezet;
   - regel annuleren → order-status klapt correct om; over-levering >110% →
     weigert; ontvangst met locatie → `rollen.locatie_id` gevuld.
2. **E2E-rondreis met testleverancier** (niet HENAN's echte data): testleverancier
   + credentials → login portal.karpi.nl → ETA wijzigen → gekoppelde
   verkooporder krijgt de amber levertijd-gate (mig 326) + Regeloverzicht toont
   "leverancier"-herkomst → ontvangst boeken mét locatie → rol op voorraad op
   locatie, claims 'geleverd', verkooporder leverbaar. Scriptmatig (curl tegen
   `supplier-portal`-edge-function + DB-checks); Miguel kan desgewenst zelf
   door de portal-UI klikken als acceptatie. Testdata daarna opruimen.
3. **Regressie:** bestaande Vitest-suite groen; `npm run build` (tsc -b) vóór push.

## Volgorde & risico's

- Slice 6 (deadline 13-07) en Slice 1 eerst; daarna 2 → 3 → 4/5 parallel → 7.
- **Migratienummers bij bouw verifiëren** tegen origin/main én live DB
  (mig t/m 575 is al live per 02-07; deze werk-branch stond op 484 — bekende
  collisie-valkuil bij parallelle sessies).
- Deploy-volgorde: migraties vóór frontend (nieuwe RPC's moeten bestaan vóór de
  UI ze aanroept); geen edge-function-wijzigingen behalve géén — de
  `supplier-portal`-function blijft ongewijzigd.
- Bij merge: docs bijwerken (database-schema.md, data-woordenboek.md,
  changelog.md, CLAUDE.md-bullet) — CONTEXT.md is al bijgewerkt tijdens de
  grill-sessie (Claim-vloer, Leveranciersportal).
