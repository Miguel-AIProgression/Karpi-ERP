---
status: accepted
date: 2026-05-07
---

# Facturatie als deep Module — frontend-consolidatie + event-driven trigger op `order_events`

## Context

Facturatie is in V1 (plan [`2026-04-22-facturatie-module.md`](../superpowers/plans/2026-04-22-facturatie-module.md)) uitgebouwd als een complete keten — queue + cron + RPC + edge function + PDF + email + EDI-INVOIC — maar **niet** georganiseerd als Module. De code zit verspreid over zeven frontend-locaties:

- [`pages/facturatie/factuur-detail.tsx`](../../frontend/src/pages/facturatie/factuur-detail.tsx)
- [`pages/facturatie/facturatie-overview.tsx`](../../frontend/src/pages/facturatie/facturatie-overview.tsx)
- [`components/facturatie/factuur-lijst.tsx`](../../frontend/src/components/facturatie/factuur-lijst.tsx)
- [`components/orders/order-facturen.tsx`](../../frontend/src/components/orders/order-facturen.tsx) — facturen-zicht ingebed bij orders
- [`components/klanten/klant-facturering-tab.tsx`](../../frontend/src/components/klanten/klant-facturering-tab.tsx) — `factuurvoorkeur`-mutatie ingebed bij klanten
- [`hooks/use-facturen.ts`](../../frontend/src/hooks/use-facturen.ts) — niet onder een module-folder
- [`lib/supabase/queries/facturen.ts`](../../frontend/src/lib/supabase/queries/facturen.ts) — niet onder een module-folder

Plus twee edge functions (`factuur-verzenden`, `factuur-pdf`) en zes SQL-migraties (117, 118, 119, 121, 122, 124, 125). Voor andere domeinen (Logistiek, Magazijn, EDI, Orders, Planning, Voorraadpositie, Order-lifecycle uit ADR-0006) bestaat een `modules/{naam}/`-folder; voor facturatie niet. ADR-0005 noemde dit als *"aparte concern, kandidaat #3 uit architectuur-review"* en punt'te het door naar de toekomst.

Twee onafhankelijke signalen maken dit nu actueel:

1. **Het Explore-rapport (2026-05-07)** markeerde *Facturatie zonder Module-container* als #1 friction-punt: "factuurvoorkeur is een klant-setting, EDI-module schrijft `edi_handelspartner_config`, facturatie-edge-function leest `debiteuren.factuurvoorkeur`, frontend-tab maakt het wijzigbaar — waar leeft deze setting echt? Het zit midden in de lucht."

2. **ADR-0006 introduceert `order_events`** als typed event-stroom voor `orders.status`-overgangen. Dat opent een echte deepening-keuze die de oude `orders.status`-trigger (mig 118) niet had: facturatie kan luisteren op een typed event ipv op een veld-overgang, met audit-trail per factuur naar het oorzakelijke event.

## Beslissing

Maak **`modules/facturatie/`** als deep verticale Module. Smal frontend-scope (alleen eigen pages + queries verhuist), maar de DB-trigger migreert naar event-driven binding op `order_events`.

### Frontend-scope — smal

Verhuist naar `modules/facturatie/`:

| Was | Wordt |
|---|---|
| `pages/facturatie/factuur-detail.tsx` | `modules/facturatie/pages/factuur-detail.tsx` |
| `pages/facturatie/facturatie-overview.tsx` | `modules/facturatie/pages/facturatie-overview.tsx` |
| `components/facturatie/factuur-lijst.tsx` | `modules/facturatie/components/factuur-lijst.tsx` |
| `hooks/use-facturen.ts` | `modules/facturatie/hooks/use-facturen.ts` |
| `lib/supabase/queries/facturen.ts` | `modules/facturatie/queries/facturen.ts` |

**Blijft staan** (cross-cuts via barrel-import):

- `components/orders/order-facturen.tsx` — importeert `useFacturenVoorOrder` uit `@/modules/facturatie`
- `components/klanten/klant-facturering-tab.tsx` — importeert `useKlantFactuurInstellingen`, `useUpdateKlantFactuurInstellingen` uit `@/modules/facturatie`

### Klant-factuurinstellingen — Module bezit het concept, niet het veld

`factuurvoorkeur` en `btw_percentage` blijven op `debiteuren` (geen schema-wijziging). Maar de **queries en hooks** voor dat veld leven onder `modules/facturatie/queries/klant-factuur-instellingen.ts`. De klanten-tab importeert via barrel:

```ts
// components/klanten/klant-facturering-tab.tsx (blijft fysiek bij klanten)
import {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from '@/modules/facturatie';
```

Resultaat: één antwoord op "wie eigent factuurvoorkeur?" (Module), zonder de file fysiek te verhuizen (Klant-detail-context blijft intact).

### Trigger — luisteren op `order_events` ipv `orders.status`

Vervang de huidige trigger uit mig 118:

```sql
-- Vandaag (mig 118):
CREATE TRIGGER trg_enqueue_factuur AFTER UPDATE ON orders
  WHEN (OLD.status <> 'Verzonden' AND NEW.status = 'Verzonden')
  EXECUTE PROCEDURE enqueue_factuur(...);

-- Wordt:
DROP TRIGGER trg_enqueue_factuur ON orders;

CREATE TRIGGER trg_enqueue_factuur_op_event AFTER INSERT ON order_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'pickronde_voltooid'
        AND NEW.status_na = 'Verzonden')
  EXECUTE PROCEDURE enqueue_factuur_voor_event();
```

Twee voordelen die de extra migratie rechtvaardigen:

1. **Oorzaak in audit-trail**: elk `factuur_queue`-record kan via FK naar `order_events.id` traceren waarom het is aangemaakt (welke pickronde, welke picker).
2. ~~**Uitbreidbaar**: per-zending-facturatie (`debiteuren.factuurvoorkeur='per_zending'` is in mig 118 voorzien maar nooit geactiveerd) wordt later één extra `WHEN`-tak op een toekomstig `event_type='zending_klaar'` — zonder de trigger-procedure-handtekening te raken.~~ — *Vervallen per [ADR-0010](0010-factuur-volgt-bundel-zending.md)*: `per_zending` is gedropt en factuur volgt de bundel-zending. De event-driven trigger op `order_events` blijft staan voor audit-traceerbaarheid (punt 1 hieronder), maar de "uitbreidbaarheid"-claim was load-bearing op een dood pad.

### Module-eigenaarschap

Frontend-folder is fysiek eigendom. Edge functions `factuur-verzenden` en `factuur-pdf` blijven fysiek in `supabase/functions/` — convention voor backend-modules — maar zijn mentaal en in `architectuur.md` onderdeel van de Facturatie-Module. SQL-migraties blijven verspreid in `supabase/migrations/`; de Module-doc verwijst er naar.

### Publieke Interface (barrel)

`modules/facturatie/index.ts` exporteert:

- Hooks: `useFacturen`, `useFactuurDetail`, `useFacturenVoorOrder`, `useKlantFactuurInstellingen`, `useUpdateKlantFactuurInstellingen`
- Pages: `FactuurDetailPage`, `FacturatieOverviewPage` (voor router-imports)
- Components: `FactuurLijst` (voor cross-cut-consumers; vandaag intern, maar barrel-export houdt het uitbreidbaar)
- Types: `Factuur`, `FactuurStatus`, `FactuurVoorkeur`, `FactuurInstellingen`

Geen barrel-export van `lib/queries/`-helpers — die blijven intern.

## Overwogen alternatieven

- **Medium-scope (verhuis ook `order-facturen.tsx` en `klant-facturering-tab.tsx`)** — afgewezen ten gunste van smal. Cross-cut-context (order-detail toont z'n facturen, klant-detail bevat een facturering-tab) hoort host-side; slot-pattern via barrel-import lost de seam op zonder fysieke verhuizing. Verlaagt blast-radius van deze ADR.
- **Brede scope (Module claimt mentaal eigendom over edge functions, RPC, queue, EDI-INVOIC-bridge)** — gedeeltelijk overgenomen (mentaal eigendom van edge functions), maar geen scope-uitbreiding qua bestanden. EDI-INVOIC-bridge blijft via shared TS-helper tussen `modules/facturatie/` en `modules/edi/`; geen aparte ADR nodig.
- **`factuurvoorkeur`-queries bij `lib/queries/klanten.ts` laten staan** — afgewezen. Concept-eigenaarschap zou versplinteren: Module die zegt "ik bezit facturatie-domein" maar de klant-voorkeur niet kent, is shallow. Het veld op `debiteuren` is implementatie-detail; de **bron-van-waarheid voor het concept** moet in de Module liggen.
- **Een aparte tabel `klant_factuur_instellingen`** — overwogen voor zuivere scheiding, afgewezen voor V1 wegens migratie-overhead. Twee velden (`factuurvoorkeur`, `btw_percentage`, plus `email_factuur`) op de klant-rij is operationeel begrijpelijk; aparte tabel zou twee FK-lookups in de edge function vereisen.
- **Trigger op `orders.status` behouden** — afgewezen. ADR-0006 schrijft het veld nog steeds via `_apply_transitie`, dus puur technisch werkt de trigger door. Maar event-listener is een echte verdieping: de oorzaak (welke pickronde, welke picker) wordt in plaats van weggegooid juist in de audit-keten geknoopt. De extra migratie is de prijs voor die leverage.
- **Eigen Module-folder voor edge functions (`modules/facturatie-backend/`)** — afgewezen als overengineering. Karpi-conventie: edge functions blijven onder `supabase/functions/`. Mentaal eigendom is genoeg.

## Consequenties

- **Frontend-verhuizing** (geen schema-wijziging):
  - Vijf files verhuizen volgens tabel hierboven.
  - Twee cross-cut-files (`order-facturen.tsx`, `klant-facturering-tab.tsx`) krijgen barrel-imports.
  - Nieuw: `modules/facturatie/queries/klant-factuur-instellingen.ts` + `hooks/use-klant-factuur-instellingen.ts`.
  - Bestaand `klant-facturering-tab.tsx` mutatie-pad vervangt `updateKlant`-import door `useUpdateKlantFactuurInstellingen`.

- **Migratie 219** (na ADR-0006's 218):
  - `DROP TRIGGER trg_enqueue_factuur ON orders;`
  - `CREATE TRIGGER trg_enqueue_factuur_op_event ON order_events ...`
  - Optioneel: voeg kolom `factuur_queue.bron_event_id BIGINT REFERENCES order_events(id)` toe voor audit-traceerbaarheid.
  - Geen data-backfill: bestaande `factuur_queue`-rijen lopen via de oude pad uit; nieuwe rijen via de event-trigger.

- **Tests**:
  - Bestaande edge-function-unit-tests blijven werken (de trigger-aanpassing raakt niet de orchestrator-logic).
  - Nieuwe contract-test op trigger: `INSERT INTO order_events (event_type='pickronde_voltooid', status_na='Verzonden') → factuur_queue krijgt nieuwe rij`.
  - Frontend-tests voor klantvoorkeur-tab updaten naar nieuwe hook-imports.

- **Documenten**:
  - [`architectuur.md`](../architectuur.md) — Module-graf-sectie aanvullen met `modules/facturatie/`. "Facturatie-flow"-sectie aanpassen: trigger-bron is `order_events` ipv `orders.status`.
  - [`data-woordenboek.md`](../data-woordenboek.md) — termen *Facturatie-Module*, *factuurvoorkeur*, *factuur_queue* zijn toegevoegd onder nieuwe sectie `## Facturatie`.
  - Geen wijziging aan implementatie-plan [`2026-04-22-facturatie-module.md`](../superpowers/plans/2026-04-22-facturatie-module.md) — dat blijft historisch correct voor V1-bouw.

- **Open kandidaten op de backlog**:
  - ~~Per-zending-facturatie activeren (extra `WHEN`-tak op event_type='zending_klaar' — vereist nieuwe event-type in `order_event_type`-enum + zending-Module-RPC die het schrijft).~~ **Gesloten per [ADR-0010](0010-factuur-volgt-bundel-zending.md)** (2026-05-08): `per_zending` is gedropt; factuur volgt de bundel-zending.
  - Aparte tabel `klant_factuur_instellingen` als de set instellingen voorbij 4-5 velden groeit (BTW per land, factuur-templates, etc.).
  - Credit-nota's, herinneringen, aanmaningen — buiten V1 (zoals oude plan-doc al vastlegt).
  - Status-strings typed via Postgres-enums + generated TS-types (#4 uit architectuur-review) — orthogonaal aan deze ADR.
