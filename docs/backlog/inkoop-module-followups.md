# Inkoop-Module — open follow-ups (ADR-0017)

Bron: code-review-excellence van de Inkoop-Module-merge op 2026-05-13. Twee
🟡 important items met harde deadlines + 4 🟢 minor / 💡 suggesties als
optionele polish.

---

## 🟡 1. DEPRECATED thin wrappers verwijderen

**Wat**: in mig 271 zijn `boek_voorraad_ontvangst` en `boek_ontvangst` als
DEPRECATED thin wrappers blijven bestaan. Doel was "1 release lang back-compat,
daarna verwijderen". Risico: onbeperkt parallel-onderhoud van twee namen.

**Streefdatum verwijdering**: **2026-07-13** (2 maanden na deploy mig 271).

**Concrete acties**:

1. Verifieer dat geen consumer meer de oude namen aanroept:
   ```bash
   grep -rn "boek_voorraad_ontvangst\|boek_ontvangst" \
     frontend/src supabase/functions import/ \
     --include="*.ts" --include="*.tsx" --include="*.py"
   # Verwacht: alleen in mig 271 (de wrapper-bodies zelf) en in deze backlog-doc.
   ```
2. Vóór verwijdering: optioneel een mig 27X die de wrappers `RAISE WARNING
   'DEPRECATED, gebruik boek_inkooporder_ontvangst_{stuks,rollen}'` laat
   loggen. Productie-logs vangen dan eventuele resterende callers op.
3. Cleanup-migratie mig 27X: `DROP FUNCTION boek_voorraad_ontvangst(...)` +
   `DROP FUNCTION boek_ontvangst(...)`. Lint-script `lint-no-direct-inkooporder-
   regel-write.sh` is al boundary-bescherming voor nieuwe callers.

**Status**: ⏳ Open. Open een issue / herinnering voor 2026-07-13.

---

## 🟡 2. Slot-fetch performance — batch-prefetch geïmplementeerd, monitoring open

**Wat**: `<InkoopRegelSamenvatting>` doet 1 query per IO-claim-rij. Bij een
orderregel met N unieke IO-claims in `Wacht op inkoop` was dat N+1 round-trips
per popover-render.

**Mitigatie (2026-05-13)**: batch-prefetch hook
`usePrefetchInkoopRegelSamenvattingen(ioRegelIds[])` toegevoegd in Inkoop's
barrel + aangeroepen door Reservering's `RegelClaimDetail` zodra claims-data
binnen is. De individuele slots lezen daarna uit warme cache (staleTime 30s)
zonder eigen round-trip.

**Resterende monitoring**:

- Verifieer in DevTools Network-tab dat bij een 5-claim popover slechts
  **1 batch-RPC** wordt afgevuurd (niet 5 individuele). Doe dit op een
  echte productie-order met meerdere IO-claims.
- Onder load (>20 simultane popover-opens): meet of TanStack's
  `setQueryData`-laag de individuele queries effectief dedupliceert.

**Race-noot**: er bestaat een theoretische race waarbij de individuele
`useInkoopRegelSamenvatting`-hooks parallel met de batch-fetch hun eigen
RPC starten (eerste render, vóór de prefetch-effect heeft gedraaid). In
productie hebben we nog niet gemeten of dit problematisch is. Indien wel:
overweeg dual-mode-slot (`ioRegelId` + optionele `initialData`-prop) zoals
ADR-0017 oorspronkelijk schetste.

**Status**: ✅ Geïmplementeerd, ⏳ monitoring open.

---

## 🟢 3. `queries/inkooporders.ts` is 605L (>300 conventie)

Pre-existing groot bestand dat verder is gegroeid door slot-fetch +
helpers. Logische splitsing in een vervolg-PR:

- `queries/inkooporders.ts` (header + regels + stats + create/update)
- `queries/ontvangst.ts` (`boekOntvangst`, `boekVoorraadOntvangst`)
- `queries/rol-stickers.ts` (`fetchRollenVoorStickers`)
- `queries/openstaande.ts` (`fetchOpenstaandeInkoopregelsVoorArtikel`,
  `fetchRollenVoorArtikel`)

Geen haast — pak op zodra het bestand >700L of een nieuw concern wordt
toegevoegd.

**Status**: ⏳ Open.

---

## 🟢 4. Mig 271 wrapper-comment

De rollen-wrapper gebruikt `RETURN QUERY SELECT * FROM ...`
(TABLE-returning), de stuks-wrapper `PERFORM` (void). Verschil is correct
maar niet inline gedocumenteerd. Een toekomstige onderhouder die alleen
naar de wrapper-body kijkt zou denken "waarom asymmetrisch?". Eén comment-
regel in elke wrapper-body zou een uur sparen.

**Status**: ⏳ Open. Combineer met vervolg-migratie uit punt 1 of 3.

---

## 🟢 5. Contract-test echte DB-gedrag-todos uitwerken

`frontend/src/modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts`
heeft 14 `it.todo`-stubs voor echte DB-gedrag-tests (voorraad-bump, claim-
consume FIFO, herwaardeer-trigger, eenheid-mismatch). Runnen vereist een
test-DB met seed-data + transactie-rollback per test.

Zonder die infra blijft de DB-gedrag-laag ongetest. Niet kritisch zolang
productie-gedrag stabiel blijft, wel een testpyramide-gat dat met
toenemende complexiteit pijnlijker wordt.

**Status**: ⏳ Open — afhankelijk van test-DB-infrastructuur-keuze (zie
ook open backlog van ADR-0015 Reservering en ADR-0013 Snijplanning).

---

## 💡 6. Defensive double-cast in `fetchInkoopRegelSamenvatting`

`as unknown as RegelSamenvattingRow` (regel 608 + de batch-variant) is
nodig omdat Supabase's nested-select-types niet altijd correct uit
`gen types` komen. Bij een volgende types-regeneratie via
`supabase gen types`: probeer de cast weg te halen en zien of TypeScript
de defensieve array/object-handling nog steeds nodig vindt.

**Status**: ⏳ Open. Trigger: volgende `supabase gen types`-run.

---

## Trekken / herinnering

Plaats deze datums in agenda of issue-tracker:

- 📅 **2026-07-13** — DEPRECATED-wrappers `boek_voorraad_ontvangst` +
  `boek_ontvangst` opruimen (punt 1)
- 📅 **Bij eerstvolgende `supabase gen types`** — defensieve cast
  evalueren (punt 6)
- 📅 **Voor V2** — contract-test-DB-infra opzetten (punt 5)

Andere punten kunnen meeliften met natuurlijke aanleidingen (vervolg-mig,
file-split, monitoring-incident).
