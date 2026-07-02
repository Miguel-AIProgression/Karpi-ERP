# PROGRESS — audit-remediatie (2026-07-02)

**Voor een verse orchestrator:** lees dit bestand + het plan
(`2026-07-02-audit-remediatie-architectuur.md`, zelfde map) en ga verder bij de
eerste niet-afgevinkte taak. Werkwijze: superpowers:subagent-driven-development
(implementer → spec-review → kwaliteitsreview per taak, Sonnet-subagents,
implementers strikt serieel). Werkdirectory: `.worktrees/audit-remediatie`,
branch `fix/audit-remediatie` (basis: origin/main 7130d579, 2026-07-02).

## Vaste afspraken (grill-besluiten Miguel — staan ook in de plan-header)
- Task 1.5 (B6): HARDE STOP na impact-rapport; `apply_migration` pas na expliciete go.
- Task 2.5: DROP dode RPC's akkoord, mits drievoudige verificatie-poort leeg.
- Worktrees: alleen aantoonbaar gemergde opruimen (uitkomst: GEEN — zie log 0.2).
- Scope-knip bevestigd: gate-registry + CLAUDE.md-ontvlechting = aparte vervolgplannen.
- Miguel wil de orchestrator-context klein houden: subagent-rapporten kort,
  voortgang in DIT bestand, niet in de conversatie.

## Baseline
- Verse worktree op origin/main (7130d579). `frontend/.env` gekopieerd uit de
  hoofdtree (gitignored; nodig voor vitest — anders falen 2 testbestanden op
  supabase-client-init).
- Baseline groen: typecheck OK, 836 tests passed (86 files, 1 skipped).

## Takenlog
- [x] **0.1** worktree + plan-commit (`1a4cc393`) + baseline groen.
- [x] **0.2** stale worktrees: NIETS opgeruimd — geen van de 12 branches is
  aantoonbaar gemerged (ancestor-check én `git cherry` falen; dit repo merged
  via cherry-pick/hernummering). Alles blijft staan; Miguel kan handmatig
  opruimen wat hij live weet.
- [x] **1.1** B1 BevestigingBadge → isOrderBevestigd. Commit `76421e95`,
  suite 838 groen. Spec ✅, kwaliteit APPROVED. Minor-nits (niet blokkerend,
  polish-kandidaat): prop-type → `Pick<OrderRow,...>`; dode
  `?? bevestigd_at`-fallback in de edi-tak; `bevestigdOp!`-asserts vermijdbaar.
- [x] **1.2** B2 claim-status 'verzonden'. Commit `da4df8cc` — ClaimStatus-type
  + `.in('status',['actief','verzonden'])` in fetchClaimsVoorOrder(-Regel);
  fetchClaimsVoorIORegel bewust onaangeroerd. Spec ✅, kwaliteit APPROVED
  (0 issues). Live-verificatie: open punt voor Miguel (zie boven).
- [x] **1.3** B3 VORMTOESLAG-split. Commit `fe5f2432` — beide split-paden
  (gemengd + IO) laten companion zijn parent volgen; 346 tests groen, golden
  fixtures byte-identiek. Spec ✅, kwaliteit APPROVED. Minors (polish): comment
  bij `laatsteBucket`-mixed-coverage-tak (invariant leeft in dekking-preview),
  stijl-asymmetrie lookback vs mutable bucket.
- [x] **1.4** B5 PO-prefill metProductVelden. Commit `44a32840`. Spec ✅
  ("non-maatwerk" bleek inherent: maatwerk-tak heeft nooit een artikelnr),
  kwaliteit APPROVED. Minors: expliciet type op `let productVelden`;
  fetch-fout-pad ongetest (geen testbestand voor order-create — acceptabel).
- [ ] **1.5** B6 wacht-status dekkings-fix (STOP vóór apply!)
- [x] **2.1** assignRolToSnijplan/useAssignRol weg. Commit `bf584779`,
  grep-bewijs 0 callers, 46 tests groen. Spec ✅, kwaliteit APPROVED.
  BIJVANGST reviewer → nieuwe bonustaak **2.6**: `createSnijplan` +
  `updateSnijplanStatus` (+ hooks useCreateSnijplan/useUpdateSnijplanStatus)
  zijn óók dood (0 consumers buiten de module) én rauwe snijplannen-writes
  buiten de RPC-laag = zelfde VERR130-vorm. Zelfde verwijder-recept als 2.1.
- [x] **2.2** useStartPickronde/startPickronde weg. Commit `ec1b52bd`
  (4 bestanden, 49 deleties, incl. bug B4 no-op query-key). Spec ✅,
  kwaliteit APPROVED. BIJVANGST → Task 2.5-kandidaat erbij: DB-RPC
  `start_pickronde(BIGINT,BIGINT)` (mig 249 hield 'm "voor de
  useStartPickronde-export") is nu wees — UITVRAAG sectie C uitgebreid.
- [x] **2.3** packAcrossRolls VERHUISD naar werklijst-packing.test.ts (1e
  implementer terecht BLOCKED: testbestand gebruikte 'm als test-driver;
  besluit: verplaatsen naar de enige gebruiker, 0 productie-callers). Commit
  `227d629c` — body byte-identiek, 8 cases mee + 1 duplicaat weg, 19/19
  groen. Spec ✅, kwaliteit APPROVED. Minor (polish): testbestand is nu
  twee-doelen-grabbelton — evt. later ffdh-orchestratie.test.ts afsplitsen.
  BASELINE-NOTITIE main: 25 pre-existing deno type-errors (o.a.
  auto-plan-groep supabase.rpc-typing) + 1 pre-existing failure
  guillotine-packing.test.ts "K1756006D" — bewezen los van onze diffs.
- [x] **2.4** vervoerder-eisen-shim weg (0 consumers, grep-bewijs; door
  orchestrator inline). Commit `75fa506e`. CLAUDE.md-verwijzing wordt in de
  docs-bundel bijgewerkt.
  ⚠️ PROCES-NOTITIE: een subagent draaide `git stash` in de gedeelde worktree
  en daarbij zijn ongecommitte PROGRESS-edits teruggedraaid — voortaan geldt:
  subagents mogen NOOIT `git stash`/`git checkout --` op de worktree draaien;
  orchestrator commit progress-updates zo snel mogelijk.
- [ ] **2.5** dode RPC's droppen (mig ~556+, nummer verifiëren)
- [x] **3.1** CONTEXT.md: Verzend-wachtrij-correctie toegepast (`1280a85d`).
  ONTDEKKING: de "Order-aandacht-gate"-sectie bestaat NIET op main — die zat
  alleen in ongecommitte lokale edits van de oude checkout (combi-levering-
  sessie?). Audit-bevinding "CONTEXT.md liegt over registry" geldt dus voor
  die lokale kopie, niet voor main. Geen ONTWERP-disclaimer nodig.
- [x] **3.3** ADR-0031-addendum + sftp-client-header (`1fbfd388`) — relay-
  bedrading geverifieerd, env-namen klopten.
- [x] **3.4** DEPLOY.md (`b9b52e06`) — grep-gecorrigeerd: bouw-factuur-edi
  toegevoegd aan facturatie-rij; `_shared/order-lifecycle/*` heeft 0
  edge-consumers (alleen frontend-contracttest).
- [x] **6.4** vindregel query-lagen in architectuur.md + CLAUDE.md-shim-
  verwijzing bijgewerkt (`48c61772`).
- [ ] **3.2** order-lifecycle.md listener+triggers
- [ ] **3.3** ADR-0031-addendum + sftp-header
- [ ] **3.4** deploy-fan-out-manifest
- [ ] **4.1** schema-snapshot script+dump
- [ ] **4.2** §3.3 → snapshot-verwijzing
- [ ] **5.1** BTW golden-contract
- [ ] **5.2** verzendweek golden-contract
- [x] **4.2** §3.3 herschreven naar snapshot/pg_get_functiondef-verwijzing +
  header-vuistregel gecorrigeerd (`8da28f6b`). 4.1-script gecommit
  (`ce825768`); volledige dump = open punt (Docker/token).
- [x] **5.3** compute-reststukken → pure shim (`1ea10b3d`). Kern was
  byte-identiek (géén drift); 4 frontend-only functies verhuisd naar _shared
  (StukGeometrie-adapter). Spec ✅, kwaliteit APPROVED. Minor: pre-existing
  typo "Angebroken" (meegenomen, niet geïntroduceerd).
- [x] **5.4** reststuk-score → `_shared/reststuk-score.ts` (`56b564b7`).
  Byte-identieke extractie; reststukScoreCm2 blijft als aggregatie-wrapper
  (filter = consumer-specifiek, gedocumenteerd contract); woordenboek-entry
  bij. Spec ✅, kwaliteit APPROVED (0 issues). Deploy-let-op: 3 packing-edge-
  functions mee bij eerstvolgende deploy (DEPLOY.md).
- [x] **6.1** VervoerderType één bron → `_shared/vervoerders/vervoerder-type.ts`
  (`e2f10ace`). CHECK geverifieerd ongewijzigd sinds mig 424:
  api/edi/print/sftp/eigen. 3 niet-exhaustieve plekken blootgelegd door de
  bredere union en aangevuld (vervoerder-tag.tsx Record, use-vervoerder-form.ts
  toUpdateInput-param, vervoerders-overzicht.tsx lokale TypeBadge). ADR-0034
  addendum. typecheck + vitest src/modules/logistiek (141 tests) groen.
- [ ] **6.2** zending-status-predicaten
- [ ] **6.3** drift-test ACTIVE_ORDER_STATUSES
- [ ] **6.4** vindregel query-lagen
- [ ] **7.1** eindverificatie + changelog; merge alleen op commando Miguel

## Open punten voor Miguel
- **B2 live-verificatie (Task 1.2):** draai in de SQL-editor:
  `SELECT o.order_nr, orr.id, orr.te_leveren, SUM(r.aantal) FILTER (WHERE r.status='actief') AS actief, SUM(r.aantal) FILTER (WHERE r.status='verzonden') AS verzonden FROM order_reserveringen r JOIN order_regels orr ON orr.id=r.order_regel_id JOIN orders o ON o.id=orr.order_id WHERE o.status='Deels verzonden' AND r.status='verzonden' GROUP BY 1,2,3 LIMIT 5;`
  en open één zo'n order in de UI — de valse "Wacht op nieuwe inkoop"-subrij moet weg zijn.

## BELANGRIJK: DB-toegang
Supabase MCP `execute_sql` heeft GEEN rechten op dit project (bevestigd
2026-07-02; zie memory reference_karpi_supabase_mcp). Het plan noemt op
meerdere plekken "via MCP" — dat werkt dus niet. Werkwijze voor alle
DB-taken (1.5, 2.5, 3.2-verificatie, 5.1/5.2-asserts, 4.1-fallback):
migratie-/verificatie-SQL als bestand opleveren; Miguel draait ze in de
SQL-editor en rapporteert de output terug. `supabase` CLI is wél gelinkt
(functions deploy + `db dump` voor Task 4.1).

## Notities voor de uitvoerder
- 1.1-detail: orders-query gebruikt `select('*')` → velden waren al aanwezig.
- Bij elke taak-afronding: dit bestand bijwerken (vinkje + commit-SHA + één
  regel bijzonderheden) en mee-committen in de taak-commit of een losse
  `docs:`-commit.
