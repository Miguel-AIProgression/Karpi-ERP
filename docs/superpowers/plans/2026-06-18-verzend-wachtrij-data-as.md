# Verbeterplan: Verzend-wachtrij als één tabel met `vervoerder_code` (data-as)

**Datum:** 2026-06-18
**Status:** plan — nog niet geïmplementeerd
**Voorganger:** [`2026-06-14-verzend-orchestrator-skeleton-seam.md`](2026-06-14-verzend-orchestrator-skeleton-seam.md) (ADR-0035, process-as) + [`2026-06-13-vervoerder-capability-seam.md`](2026-06-13-vervoerder-capability-seam.md) (ADR-0034, capability-as). Beide geland → dit is de derde en laatste as.
**Raakt (live geld-/klantpad):** `hst_transportorders` (mig 171/304/337/338), `verhoek_transportorders` (mig 375), `rhenus_transportorders` (mig 380); de RPC-trits; 3 monitor-views; de dispatch `enqueue_zending_naar_vervoerder` (mig 210→375→380→420); 3 edge functions + `_shared/verzend-orchestrator.ts`; ~7 frontend-consumenten.
**Voorgestelde ADR:** ADR-0038 — Verzend-wachtrij als data-as (gediscrimineerd op `vervoerder_code`), completeert de trilogie keuze-as (ADR-0008/0030) · capability-as (ADR-0034) · process-as (ADR-0035) · **data-as (dit)**.
**Domeinterm:** **Verzend-wachtrij** staat al in [`CONTEXT.md`](../../../CONTEXT.md) → _Avoid_: "per-vervoerder transportorder-tabel, hst/verhoek/rhenus_transportorders als concept". Dit plan bouwt die term eindelijk.

---

## 1. Probleem

Drie near-identieke tabellen met dezelfde operationele state-kern, elk met een volledige eigen RPC-set en monitor-view:

| | HST (mig 171/304) | Verhoek (mig 375) | Rhenus (mig 380) |
|---|---|---|---|
| **Tabel** | `hst_transportorders` | `verhoek_transportorders` | `rhenus_transportorders` |
| **Kern (identiek)** | `id, zending_id, debiteur_nr, status(enum), retry_count, error_msg, is_test, created_at, sent_at, updated_at` + unique-active-index | idem | idem |
| **Correlatiesleutel** | `extern_transport_order_id` | `bestandsnaam` | `bestandsnaam` |
| **Track & trace** | `extern_tracking_number` | `track_trace_id` | — (geen T&T-slot) |
| **Artefact-pad** | `pdf_path`/`pdf_uploaded_at` (mig 304) | `xml_storage_path` | `xml_storage_path` |
| **Zware payload** | `request_payload`/`response_payload`/`response_http_code` (JSONB) | `request_xml` | `request_xml` |

Daarachter staan **3× 5 RPC's** (`enqueue_*`, `claim_volgende_*`, `markeer_*_verstuurd`, `markeer_*_fout`, `herstel_vastgelopen_*`), **3 identieke monitor-views** (`*_verzend_monitor`), en een **dispatch die bij elke nieuwe vervoerder volledig herschreven wordt** (mig 210 → 375 → 380 → 420 = vier keer dezelfde ~70 regels met telkens één `WHEN`-tak erbij).

De carrier-verschillen zijn **puur storage-details**: REST-JSON vs SFTP-XML, wel/geen T&T-slot. Conceptueel is er één ding — een wachtrij van zendingen die naar een vervoerder verstuurd moeten worden, met een operationele state-machine (Wachtrij → Bezig → Verstuurd/Fout) en een retry-teller.

**Deletion-test (de overtuigendste van de vijf deepening-kandidaten):** schrap twee van de drie tabellen+RPC-sets, en exact hetzelfde komt terug bij de vierde vervoerder — want de echte carrier-variatie (payload-vorm, preflight-eisen, transport) zit al achter twee bestaande seams: de **capability-as** (ADR-0034) en de **process-as** (ADR-0035, `verwerkVerzendRij`). De data-as is de enige niet-geseamde laag van de drie. Na dit plan draagt de `VerzendAdapter` **geen per-carrier RPC-namen meer** — de laatste carrier-detail die in de skeleton lekte.

### Bewijs dat de consolidatie zijn plek verdient
- **Locality:** retry-logica, een nieuwe status, of een index wijzig je nu op drie plekken/enums; straks één keer.
- **Leverage:** een vierde vervoerder wordt puur data (capability-rij + selectie-regel) + één format-builder + één `VerzendAdapter`. Géén DDL-kopie, géén dispatch-edit, géén nieuwe monitor-view.
- **Echte vereenvoudiging, niet alleen "drie → één breed":** de zware request/response-payload wordt **geschrapt** uit de wachtrij. Die leeft al volledig in [[Externe-payload-audit]] (`externe_payloads`, mig 324/325 — `richting='out'`, één rij per POST/SFTP-put, inclusief request, response, http_code, transport_order_id, tracking_number; élke retry = nieuwe rij). De orchestrator (ADR-0035) schrijft die rij al voor álle drie carriers via `log_externe_payload`. De wachtrij hoeft dus alleen operationele state + een correlatiesleutel te dragen, niet de blobs — dát maakt het een échte deep module i.p.v. een union-tabel met een woud aan nullable kolommen.

---

## 2. Doel-ontwerp — de deep module + de seam

### 2.1 Eén tabel: `verzend_wachtrij`

```sql
CREATE TYPE verzend_status AS ENUM ('Wachtrij','Bezig','Verstuurd','Fout','Geannuleerd');

CREATE TABLE verzend_wachtrij (
  id                BIGSERIAL PRIMARY KEY,
  zending_id        BIGINT  NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  debiteur_nr       INTEGER REFERENCES debiteuren(debiteur_nr),
  vervoerder_code   TEXT    NOT NULL,          -- DISCRIMINATOR: 'hst_api'|'verhoek_sftp'|'rhenus_sftp'|…
  status            verzend_status NOT NULL DEFAULT 'Wachtrij',
  -- Generieke operationele velden (subsumeren de carrier-kolommen):
  extern_referentie TEXT,        -- correlatiesleutel bij de vervoerder: HST transportOrderId | SFTP bestandsnaam
  track_trace       TEXT,        -- consument-T&T: HST trackingNumber | Verhoek zending_nr | NULL (Rhenus)
  document_pad      TEXT,        -- storage-pad van het artefact: PDF (HST) | XML (SFTP)
  -- State-machine:
  retry_count       INTEGER NOT NULL DEFAULT 0,
  error_msg         TEXT,
  is_test           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- De unieke invariant op ÉÉN plek (was 3× uk_*_to_zending_actief):
CREATE UNIQUE INDEX uk_verzend_wachtrij_zending_actief
  ON verzend_wachtrij (zending_id) WHERE status NOT IN ('Fout','Geannuleerd');

CREATE INDEX idx_verzend_wachtrij_claim  ON verzend_wachtrij (vervoerder_code, status, created_at);
CREATE INDEX idx_verzend_wachtrij_zending ON verzend_wachtrij (zending_id);
```

**Wat verdwijnt** (en waarom het mag): `request_payload`/`response_payload`/`response_http_code`/`request_xml` → `externe_payloads` is de aangewezen audit-bron (volledige fout-historie per poging, beter dan de queue die per poging overschreef). De drie carrier-correlatievelden vouwen samen tot `extern_referentie` (de "waar zoek ik dit terug bij de vervoerder"-sleutel), de twee T&T-velden tot `track_trace`, de twee artefact-paden tot `document_pad`. De drie identieke enums worden één `verzend_status`.

> **Eén active-rij-invariant over álle carriers heen** is strikter dan nu (was per tabel) en exact correct: een zending heeft precies één vervoerder, dus precies één actieve verzend-wachtrij-rij. Een betere garantie dan drie losse indexen.

### 2.2 Eén generieke RPC-set (de DB-seam)

| Was (3×) | Wordt (1×) |
|---|---|
| `enqueue_{hst,verhoek,rhenus}_transportorder(zending, debiteur, is_test)` | `enqueue_transportorder(p_zending_id, p_debiteur_nr, p_vervoerder_code, p_is_test)` |
| `claim_volgende_{…}_transportorder()` | `claim_volgende_transportorder(p_vervoerder_code)` → `verzend_wachtrij` |
| `markeer_{…}_verstuurd(id, …carrier-params…)` | `markeer_transportorder_verstuurd(p_id, p_extern_referentie, p_track_trace, p_document_pad)` |
| `markeer_{…}_fout(id, error, …payloads…, max_retries)` | `markeer_transportorder_fout(p_id, p_error, p_max_retries)` |
| `herstel_vastgelopen_{…}(minuten)` | `herstel_vastgelopen_verzending(p_vervoerder_code, p_minuten)` |

Gedragsbehoud, expliciet vastgelegd:
- `markeer_transportorder_verstuurd` zet `zendingen.track_trace` **alleen als `p_track_trace IS NOT NULL`** → Rhenus (geeft NULL door) gedraagt zich exact als nu (geen T&T-update); HST/Verhoek schrijven track_trace zoals voorheen. De zending-statusflip `Klaar voor verzending → Onderweg` blijft identiek.
- `markeer_transportorder_fout` houdt de retry-cascade: `retry_count+1`, status → `Fout` bij `≥ p_max_retries` anders terug naar `Wachtrij`.
- `claim_volgende_transportorder` houdt `FOR UPDATE SKIP LOCKED` + `ORDER BY created_at` + `vervoerder_code`-filter, zodat de drie crons elkaars rijen niet pakken.

### 2.3 Eén monitor-view

```sql
CREATE VIEW verzend_monitor AS
SELECT vervoerder_code,
       COUNT(*) FILTER (WHERE status='Verstuurd' AND sent_at::date=CURRENT_DATE)::int AS verstuurd_vandaag,
       COUNT(*) FILTER (WHERE status='Fout')::int     AS fout_open,
       COUNT(*) FILTER (WHERE status='Wachtrij')::int AS wachtrij,
       COUNT(*) FILTER (WHERE status='Bezig')::int    AS bezig,
       COALESCE(EXTRACT(EPOCH FROM (now()-MIN(created_at) FILTER (WHERE status='Wachtrij')))/60,0)::int AS oudste_wachtrij_minuten,
       COALESCE(EXTRACT(EPOCH FROM (now()-MIN(updated_at) FILTER (WHERE status='Bezig')))/60,0)::int    AS oudste_bezig_minuten
FROM verzend_wachtrij GROUP BY vervoerder_code;
```

Frontend leest `verzend_monitor WHERE vervoerder_code = 'hst_api'` i.p.v. een eigen view per carrier. `oudste_wachtrij_minuten` blijft het cron-health-signaal.

### 2.4 De dispatch verliest zijn inner CASE (de switch-point-seam)

`enqueue_zending_naar_vervoerder` behoudt alles tot en met vervoerder-resolutie + de hold-guard (mig 420, `held_handmatig`). Daarna verdwijnt de geneste `CASE v_type → CASE v_vervoerder_code → PERFORM enqueue_<carrier>`:

```sql
  CASE v_type
    WHEN 'api', 'sftp' THEN          -- alle queue-gebaseerde carriers
      PERFORM enqueue_transportorder(p_zending_id, v_debiteur_nr, v_vervoerder_code, v_is_test);
      RETURN 'enqueued_' || v_vervoerder_code;
    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';
    WHEN 'edi' THEN  RETURN 'no_adapter_voor_' || v_vervoerder_code;
    ELSE             RETURN 'onbekend_type_' || v_type;
  END CASE;
```

Een nieuwe `api`/`sftp`-vervoerder vereist **nul dispatch-edits** — exact de mig 210→375→380→420-churn die dit wegneemt. (Return-string wordt `enqueued_<code>` i.p.v. `enqueued_hst`; geen consument doet een exacte string-match — verifiëren in slice 0.)

### 2.5 De edge-seam: `VerzendAdapter` verliest zijn RPC-namen

Vandaag (ADR-0035) draagt de adapter o.a. `claimRpc`/`reaperRpc`/`markeerVerstuurdRpc`/`markeerFoutRpc` + een carrier-specifieke afbeelding naar de markeer-parameters. Na consolidatie roept `verwerkVerzendRij` de **generieke** RPC's aan met `adapter.capabilityCode` als discriminator. De adapter krimpt tot wat écht per carrier verschilt:

```ts
interface VerzendAdapter {
  vervoerderCode: 'hst_api' | 'verhoek_sftp' | 'rhenus_sftp'   // discriminator + capability-key
  // render + transport (ongewijzigd, echte protocolverschillen):
  build(ctx): Payload
  transport(ctx, payload, ref): Promise<TransportResult>
  // mapping transport-resultaat → generieke markeer-velden (vervangt de carrier-markeer-RPC's):
  naarUitkomst(payload, result): { externReferentie: string|null; trackTrace: string|null; documentPad: string|null }
  // storage van het artefact (PDF vs XML — blijft carrier-specifiek):
  bewaarArtefact(sb, ctx, payload, result): Promise<string|null>
}
```

De claim/reaper/markeer-RPC-namen, select-kolomlijsten-voor-payload en markeer-param-volgorde verdwijnen uit de adapter. Dit is de seam-aanscherping die de trilogie sluit: **na #1 lekt er geen carrier-naam meer in de orchestrator.**

---

## 3. Beslissingen & afwegingen

1. **Payload schrappen i.p.v. nullable union-tabel.** _Gekozen._ Een union-tabel (alle HST- én SFTP-kolommen nullable) zou de tellingen verbergen maar de complexiteit niet wegnemen — geen deep module. Schrappen kan veilig omdat `externe_payloads` de volledige in/out-payload-historie al draagt (CLAUDE.md "Rauwe-payload-audit, in- én uitgaand"). De fout-monitor toont nu `response_http_code` rechtstreeks uit `hst_transportorders`; **na schrappen komt die uit een join op `externe_payloads`** (`payload_json->>'http_code'`, laatste rij per zending). `error_msg` (de operator-leesbare reden) blijft op de wachtrij — dat is operationeel, geen audit. → **Vastgelegd (beslissing A): http_code via join op `externe_payloads`, geen denormalisatie.**
2. **Tabelnaam `verzend_wachtrij`** (niet `transportorders`) — matcht de bestaande CONTEXT.md-domeinterm exact en vermijdt de `_Avoid_`-formulering.
3. **Cutover = drain + atomisch venster, crons gepauzeerd** (niet RPC-shims). _Vastgelegd (beslissing B)._ Een wachtrij is stateful: een per-carrier RPC-shim kan de oude rowtype (met `request_payload` etc.) niet reproduceren nadat de kolommen weg zijn, dus de oude edge-functie zou na de migratie alsnog breken. Omdat de wachtrij in minuten leegloopt, is "pauzeer cron → drain → migreer → deploy → hervat cron" de veiligste en simpelste route. De **oude tabellen blijven staan** (ongebruikt) t/m slice 5 als rollback-vangnet; alleen de monitor-**views** krijgen een lees-shim voor een release.
4. **Eén active-invariant over alle carriers** (zie §2.1) — strikter en correcter dan drie losse indexen.

---

## 4. Slices (verticaal, vangnet eerst)

> Eigen branch `refactor/verzend-wachtrij-data-as` (substantieel, raakt live pad — CLAUDE.md git-workflow). Merge pas op commando.

### Slice 0 — Vangnet (verplicht, vóór elke DDL)
- **Karakterisatie-tests scherpzetten.** De 15 bestaande `*-send/verwerk-row.test.ts` (met de `_shared/__tests__/fake-supabase.ts`-recorder) leggen de RPC-call-sequence vast. Draai ze groen op `main` als baseline. Dit is het edge-gedragscontract.
- **DB-gedrag vastpinnen.** Schrijf een verificatie-SQL-blok (in de slice-1-migratie als `DO $$ … $$`-asserts + een handmatig SQL-Editor-recept) dat de generieke RPC's exact het oude gedrag reproduceren: verstuurd-zonder-track_trace laat `zendingen.track_trace` ongemoeid; verstuurd-met-track_trace schrijft 'm; fout < max → terug naar Wachtrij; fout ≥ max → Fout; claim respecteert `vervoerder_code` + SKIP LOCKED.
- **Consument-inventaris bevestigen** (deze §): grep op de drie tabelnamen + `*_verzend_monitor` + de 5×3 RPC-namen — geen verrassingen buiten de lijst in §6.

### Slice 1 — DB: nieuwe tabel + generieke RPC's + view + backfill + dispatch
Eén migratie (volgend nummer, her-verifiëren vlak vóór merge — collisie-historie):
- `verzend_status`-enum + `verzend_wachtrij`-tabel + indexen + RLS + `updated_at`-trigger.
- Backfill uit de drie tabellen (incl. historie voor monitor-/audit-continuïteit), kolom-mapping per carrier:
  - HST: `extern_referentie ← extern_transport_order_id`, `track_trace ← extern_tracking_number`, `document_pad ← pdf_path`.
  - Verhoek: `extern_referentie ← bestandsnaam`, `track_trace ← track_trace_id`, `document_pad ← xml_storage_path`.
  - Rhenus: `extern_referentie ← bestandsnaam`, `track_trace ← NULL`, `document_pad ← xml_storage_path`.
  - `vervoerder_code` = `'hst_api'|'verhoek_sftp'|'rhenus_sftp'`; status 1-op-1.
- De 5 generieke RPC's (§2.2) + de `verzend_monitor`-view (§2.3).
- Dispatch vereenvoudigd (§2.4); `meld_zending_handmatig_aan` + hold-guard ongewijzigd (delegeren naar de nieuwe dispatch).
- Oude 3 monitor-views → lees-shim (`SELECT … FROM verzend_monitor WHERE vervoerder_code='…'`) zodat een gemiste frontend-ref niet 404't.
- **Oude tabellen + oude RPC's NIET droppen** (rollback-vangnet) — dat is slice 5.
- `DO $$ … $$`-asserts (slice 0) draaien aan het eind van de migratie.

### Slice 2 — Edge: `VerzendAdapter` krimpt, orchestrator roept generieke RPC's
- `_shared/verzend-orchestrator.ts`: claim/reaper/markeer via de generieke RPC's met `adapter.vervoerderCode`.
- De drie `*-send/verwerk-row.ts`: adapter afgeslankt (§2.5), `naarUitkomst` levert `{externReferentie, trackTrace, documentPad}`, payload gaat alleen nog naar `log_externe_payload`.
- Karakterisatie-tests bijwerken naar de generieke RPC-namen + nieuwe arg-shape; alle 15 weer groen = gedragsneutraal bewezen.
- **Cutover-venster:** crons pauzeren → wachtrijen leeg (geen `Wachtrij`/`Bezig`) → slice-1-migratie toepassen → 3 edge functions deployen → crons hervatten. Draaiboek apart (zie slice 6).

### Slice 3 — Frontend: generieke monitor + zending-detail + retry
Sweep over de consumenten (§6):
- `hst-monitor.ts` → `verzend-monitor.ts` generiek (param `vervoerderCode`); `fetchHstFouten` → `verzend_wachtrij` filter + http_code via `externe_payloads`-join (beslissing A).
- `zendingen.ts`: embeds `hst_transportorders(…)` → `verzend_wachtrij(…)`; `verstuurZendingOpnieuw` directe `UPDATE`s → `verzend_wachtrij` (filter `vervoerder_code`); de unique-active-guard-logica blijft identiek.
- `zending-detail.tsx` / `zendingen-overzicht.tsx` / `verzend-fout-banner.tsx`: PostgREST-embed-naam + typenamen.
- `colli-bundel.ts` `fetchRhenusAanmelding` → `verzend_wachtrij` filter `vervoerder_code='rhenus_sftp'`.
- `npm run typecheck` vóór merge (PD-branch-conventie).

### Slice 4 — Docs + ADR
- ADR-0038 (data-as), changelog, `database-schema.md` (tabel + view), CONTEXT.md (Verzend-wachtrij van _Avoid_-belofte naar geïmplementeerd; `VerzendAdapter` draagt geen RPC-namen meer), `architectuur.md`.

### Slice 5 — Contract: oude artefacten droppen
Ná live-bewijs (≥ 1 echte HST- én Rhenus-zending end-to-end via de nieuwe wachtrij):
- DROP de oude monitor-view-shims, de 3 oude tabellen, de 3 oude enums, de 5×3 oude RPC's.
- Eén opruim-migratie; backfill-data is al in `verzend_wachtrij`.

### Slice 6 — Cutover-draaiboek
Klein draaiboek (à la `2026-06-14-rhenus-go-live-canary-draaiboek.md`): cron-jobids pauzeren, drain-check-query, deploy-volgorde (DB → 3 edge → frontend), rook-test (forceer één HST-zending, verifieer `verzend_wachtrij`-rij + `externe_payloads` + `zendingen.track_trace`), rollback-stap (oude edge herdeployen + dispatch terugzetten — oude tabellen staan nog).

---

## 5. Risico's
- **Live HST-pad** — gemitigeerd door slice 0 (karakterisatie-net), drain+venster (slice 2/6), en oude tabellen-als-rollback (drop pas slice 5).
- **PostgREST-embeds** — `hst_transportorders ( … )` is een relatie-naam in de frontend-queries; die wijzigt naar `verzend_wachtrij ( … )`. Mechanisch maar breed → typecheck + de embed handmatig nalopen (geen impliciete FK-ambiguïteit, want één relatie).
- **Migratienummer-collisie** — her-verifiëren vlak vóór merge (repo-historie).
- **`externe_payloads`-dekking** — bevestigen dat álle drie carriers er werkelijk in loggen (ADR-0035 zegt ja); zo niet, eerst dichten vóór payload-drop.

## 6. Te migreren consumenten (bevestigd via code-read)
**Edge:** `_shared/verzend-orchestrator.ts` (claim/reaper/markeer); `hst-send`/`verhoek-send`/`rhenus-send` `index.ts` + `verwerk-row.ts`; de 3 `verwerk-row.test.ts` + `_shared/__tests__/fake-supabase.ts`.
**Frontend:** `queries/hst-monitor.ts:42`; `queries/zendingen.ts:214,267,420-447`; `queries/colli-bundel.ts:37-48`; `pages/zending-detail.tsx:60,251-259`; `pages/zendingen-overzicht.tsx:58,148,242`; `components/orders/verzend-fout-banner.tsx:15,33,50`; `modules/logistiek/registry.ts:4-6` (commentaar).

## 7. Bewust buiten scope
- **Keuze-as** (`vervoerder_selectie_regels`, resolver) — al data-driven (ADR-0008/0030).
- **Capability-as** (`_shared/vervoerders/capabilities.ts`) — al geland (ADR-0034); blijft de bron voor preflight/landbereik/defaults.
- **Format-builders + transport** (`bouwTransportOrderPayload`/`bouwVerhoekXml`/`bouwRhenusXml`, REST vs SFTP) — echte protocolverschillen; de adapter omhult ze, dit plan raakt ze niet.
- **EDI-carriers** (transus) — eigen `edi_berichten`-audit/queue, geen transportorder-tabel.

## 8. Beslissingen (vastgelegd 2026-06-18)
- **A. `response_http_code` in de fout-monitor → join op `externe_payloads`** (lean; geen denormale kolom op de wachtrij).
- **B. Cutover-stijl → drain + atomisch venster met gepauzeerde crons** (geen RPC-shims; oude tabellen als rollback-vangnet t/m slice 5).
