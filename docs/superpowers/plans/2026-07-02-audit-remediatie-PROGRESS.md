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
- [ ] **1.3** B3 VORMTOESLAG-split
- [ ] **1.4** B5 PO-prefill metProductVelden
- [ ] **1.5** B6 wacht-status dekkings-fix (STOP vóór apply!)
- [ ] **2.1** assignRolToSnijplan weg
- [ ] **2.2** useStartPickronde weg
- [ ] **2.3** packAcrossRolls (ffdh) weg
- [ ] **2.4** vervoerder-eisen-shim weg
- [ ] **2.5** dode RPC's droppen (mig ~556+, nummer verifiëren)
- [ ] **3.1** CONTEXT.md corrigeren
- [ ] **3.2** order-lifecycle.md listener+triggers
- [ ] **3.3** ADR-0031-addendum + sftp-header
- [ ] **3.4** deploy-fan-out-manifest
- [ ] **4.1** schema-snapshot script+dump
- [ ] **4.2** §3.3 → snapshot-verwijzing
- [ ] **5.1** BTW golden-contract
- [ ] **5.2** verzendweek golden-contract
- [ ] **5.3** compute-reststukken → shim
- [ ] **5.4** reststuk-score één module
- [ ] **6.1** VervoerderType één bron
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
