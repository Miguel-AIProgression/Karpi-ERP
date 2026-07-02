# Deploy-fan-out: wie moet mee bij een _shared-wijziging?

Edge functions bundelen `_shared/` bij deploy. Wijzig je een gedeelde module,
herdeploy dan ÁLLE functies die hem importeren — anders draait een deel op de
oude versie (precies de divergentie die ADR-0036 code-side elimineerde).

Vind de consumers altijd vers met:

    git grep -l "_shared/<module>" supabase/functions

Vaste fan-outs (2026-07-02 — her-verifieer met bovenstaande grep):

| Module | Herdeployen |
|---|---|
| `_shared/facturatie/*`, `_shared/btw.ts` | bouw-factuur-edi, factuur-pdf, factuur-verzenden, stuur-orderbevestiging |
| `_shared/pakbon/*` | factuur-verzenden (+ frontend leest via shims — Vercel deployt zelf) |
| `_shared/vervoerders/*`, `_shared/verzend-orchestrator.ts` | hst-send, rhenus-send, verhoek-send |
| `_shared/order-lifecycle/*` | momenteel géén edge-function-consumer — `derive-status.ts`/`order-status.ts` worden alleen cross-root geïmporteerd door de frontend-contracttest (`frontend/src/lib/orders/__tests__/derive-status.test.ts`, ADR-0033-patroon). Her-grep vóór het aannemen dat dit nog klopt. |
| `_shared/werkagenda.ts`, `_shared/snij-haalbaarheid.ts` | auto-plan-groep, check-levertijd |

Deploy-commando per functie:
`supabase functions deploy <naam> --project-ref wqzeevfobwauxkalagtn`
