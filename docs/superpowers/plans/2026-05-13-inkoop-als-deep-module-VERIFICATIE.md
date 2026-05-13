# Inkoop-Module verificatie-rapport (Task 13)

Datum: 2026-05-13
Branch: feat/inkoop-deep-module
HEAD: c323459

## Geautomatiseerd geverifieerd (door Task 13 implementer)

| Check | Status | Notitie |
|---|---|---|
| TypeScript typecheck | OK | `tsc --noEmit -p .` exit 0, geen output |
| Frontend build (vite) | OK | `vite build` success in 930ms; 1 pre-existing chunk-size warning (geen error). Node_modules tijdelijk gelinkt via NTFS-junction naar main repo voor draaien |
| ESLint full-run | OK | 72 problems (68 errors, 4 warnings) — exact het pre-existing aantal uit Task 11 report; **0 nieuwe `no-restricted-imports` violations** door Inkoop-Module |
| lint-no-direct-inkooporder-regel-write.sh | OK | "geen directe schrijfacties op inkooporder_regels / inkooporders.status buiten Inkoop-Module allowlist" |
| Andere lint-scripts | OK | `lint-no-direct-orders-status-update.sh` en `lint-no-direct-order-reserveringen-write.sh` beide OK |
| Git state | OK | Working tree clean; 13 commits sinds main (Tasks 1-12 + review-fixes) |
| Module-folder volledigheid | OK | 9 components (1 meer dan spec — `voorraad-ontvangst-dialog.tsx` extra), 5 pages, 3 hooks, 2 queries, 1 test |
| Mig 271 aanwezig op disk | OK | `supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql` (299 regels) |
| Docs (ADR + architectuur + woordenboek + changelog) | OK | ADR-0017 bestaat, alle drie docs hebben Inkoop-Module-referenties (changelog regel 3, woordenboek regel 133, architectuur regels 119-122/279-282) |

### Detail-noten

- **Components count = 9 i.p.v. 8**: spec verwachtte 8 maar `voorraad-ontvangst-dialog.tsx` zit ook in de map. Dit is een verwachte ouder file die in scope van Inkoop hoort. Geen blocker.
- **ESLint pre-existing errors** zijn in pages buiten Inkoop-Module: `pages/producten/product-row.tsx` (react-hooks/refs, 3x), `pages/snijplanning/snijvoorstel-review.tsx` (rules-of-hooks). Niet geintroduceerd door deze branch.
- **Worktree had geen `node_modules`**: opgelost door NTFS-junction te maken (`mklink /J` via PowerShell `New-Item -ItemType Junction`) naar de main-repo `frontend/node_modules`. Junction blijft staan voor toekomstige worktree-runs maar kan veilig worden verwijderd voor cleanup.

## User-action items (handmatig verifieren)

- [ ] **Mig 271 toepassen op productie-DB**: open Supabase Dashboard -> SQL Editor -> plak inhoud van `supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql` -> Run. Verifieer 0 errors. Run smoke-test SQL onderaan de migratie.
- [ ] **Smoke-test in browser**:
  - `/inkoop` — overzicht laadt, filters werken, "Nieuwe inkooporder"-knop opent dialog
  - `/inkoop/:id` — detail laadt, "Ontvangst boeken" opent dialog. Boek stuks-ontvangst -> `producten.voorraad` opgehoogd, een IO-claim -> `geleverd`, nieuwe voorraad-claim, order-status reageert
  - `/leveranciers` + `/leveranciers/:id` — pages laden, stats-card toont openstaande orders
  - Order-detail-pagina met regel in `Wacht op inkoop`: IO-rij in `RegelClaimDetail` toont nu `<InkoopRegelSamenvatting>` met inkooporder_nr + leverancier + status
- [ ] **Smoke-test SQL** in Supabase SQL Editor:
  ```sql
  SELECT routine_name FROM information_schema.routines
   WHERE routine_schema='public'
     AND routine_name IN (
       'boek_inkooporder_ontvangst_stuks',
       'boek_inkooporder_ontvangst_rollen',
       'boek_voorraad_ontvangst',
       'boek_ontvangst',
       'boek_io_ontvangst_claims'
     );
  -- Verwacht: 5 rijen.
  ```
- [ ] **Push branch + open PR** (of merge naar main per Karpi-conventie van directe-merge-zonder-PR):
  ```bash
  git push -u origin feat/inkoop-deep-module
  # OF voor directe merge naar main:
  # git checkout main && git merge feat/inkoop-deep-module
  ```
- [ ] **Worktree cleanup** na merge:
  ```bash
  # Verwijder eerst de NTFS-junction die Task 13 heeft aangemaakt:
  cmd /c rmdir "c:\Users\migue\Documents\karpi-inkoop\frontend\node_modules"
  # Daarna worktree weg:
  cd c:/Users/migue/Documents/Karpi\ ERP
  git worktree remove ../karpi-inkoop
  git branch -d feat/inkoop-deep-module
  ```

## Open backlog (vervolg-werk)

- [ ] **Backward-compat thin wrappers verwijderen** (in nieuwe migratie, na 1 release): `boek_voorraad_ontvangst` + `boek_ontvangst` -> DROP
- [ ] **Rol-creatie + voorraad_mutaties verhuizen** naar toekomstige Voorraad/Producten-Module (ADR-0017 open backlog item)
- [ ] **Inkoopgroepen-pages** verhuizen naar Debiteur-Module (klant-attribuut, niet Inkoop-domein)
- [ ] **`create_inkooporder`-RPC** invoeren zodat Python-import-script niet langer directe table-writes doet (vervang het door RPC-aanroep)
- [ ] **EDI-DESADV** koppeling voor inkomende ontvangst-bevestigingen
