# ADR-0030: Altijd-een-vervoerder + HST default-carrier

**Status:** Geaccepteerd — 2026-06-09

> **Noot (2026-06-12):** de hieronder genoemde frontend-kopie van `vervoerder-eisen.ts` is vervangen door een re-export-shim (cross-root import) — zie ADR-0033.

> **Bouwt voort op [ADR-0008](0008-vervoerder-keuze-als-deep-module.md)** — de
> per-orderregel-ladder `override → regel → geen` blijft de bron-van-waarheid. Deze ADR
> sluit het `geen`-gat (orders die op niets matchen) zonder de ladder of de resolver-RPC
> te wijzigen, plus een observability-pijler rond de HST-verzendkoppeling.

## Context

De HST-verzendkoppeling (mig 169-176, [Logistiek-module](../architectuur.md#logistiek-module))
gaat van acceptatie naar productie. Twee gaten blokkeerden de cutover:

1. **Orders zonder matchende vervoerder-regel bleven liggen.** De ladder uit
   [ADR-0008](0008-vervoerder-keuze-als-deep-module.md)
   (`override → vervoerder_selectie_regels → geen`) levert `bron='geen'` zodra geen regel
   matcht. HST is vandaag de **enige** actieve koppeling, maar er was geen catch-all-regel
   die HST als bodem onder NL-orders legde — een NL-order zonder specifieke regel viel dus
   stil terug op "geen vervoerder" en verdween uit de verzend-flow zonder signaal.

2. **De HST-verzend-cron faalde stil.** Net als bij de
   [EDI poll silent failure](../../CLAUDE.md) kon de `hst-send`-cron stilvallen of een
   transportorder mid-claim laten hangen op status `'Bezig'` (crash/timeout tussen
   `claim_volgende_hst_transportorder` en de POST) zonder dat dit ergens zichtbaar werd.
   Een ACCP-afkeuring op 2026-06-09 ("Bellen voor aflevering, geef telefoonnummer op")
   liet bovendien zien dat HST een kaal `"HTTP 400"` teruggaf in de operator-UI omdat de
   error-parser het PascalCase-veld `ErrorMessage` niet las, en dat het
   leveringstelefoonnummer (HST belt vóór aflevering) helemaal niet werd meegestuurd.

## Beslissing

Maak van "elke order heeft een vervoerder" en "de verzend-flow is observeerbaar" twee
expliciete, geguarde pijlers — additief op ADR-0008, géén edit aan de resolver-ladder.

### Pijler 1 — HST als default-carrier binnen NL

- **Catch-all selectie-regel.** Eén rij in `vervoerder_selectie_regels`
  (`vervoerder_code='hst_api'`, prio `99999` = laagste, conditie `{"land":["NL"]}`,
  notitie "Default-vervoerder binnen NL"). De bestaande ladder in
  `effectieve_vervoerder_per_orderregel` levert HST nu als bodem binnen NL; **specifieke
  regels (lagere prio) winnen nog steeds**. Geen resolver-edit — puur data.
- **`vervoerders.is_default BOOLEAN DEFAULT FALSE`** (partial unique index
  `uk_vervoerders_is_default` → hooguit één TRUE) markeert welke vervoerder de default is;
  `hst_api` wordt geseed als default. De vlag is de expliciete administratieve bron-van-
  waarheid; de catch-all-regel is het werkende mechanisme.
- **Gegate op `actief = TRUE`.** De catch-all-INSERT vuurt alleen als `hst_api.actief`
  TRUE is — die staat bewust nog FALSE tot de cutover, dus de default wordt pas effectief
  zodra HST live gaat.
- **Buiten NL → `bron='geen'`.** Orders waarvan een regel buiten het HST-bereik valt,
  blijven `bron='geen'` → "handmatig vervoerder kiezen". Dat is nu een **expliciet
  zichtbaar** signaal (view `orders_zonder_vervoerder` + banner), geen stille terugval.

### Pijler 2 — Pre-flight validator als gedeelde seam

Een nieuwe pure validator `valideerVoorVervoerder(ctx) → {ok, problemen[]}`
([`_shared/vervoerder-eisen.ts`](../../supabase/functions/_shared/vervoerder-eisen.ts))
controleert vóór de HST-POST of de zending aan de vervoerder-eisen voldoet
(codes `TELEFOON_ONTBREEKT` / `ADRESVELD_LEEG` / `LAND_BUITEN_BEREIK`,
const `HST_LANDEN_BEREIK=['NL']`). Faalt een eis → de transportorder gaat direct op `Fout`
met heldere reden — geen kansloze HST-call. De validator is gespiegeld als frontend-kopie
([`frontend/src/lib/orders/vervoerder-eisen.ts`](../../frontend/src/lib/orders/vervoerder-eisen.ts))
omdat Deno-edge-code niet door Vite importeerbaar is — zelfde seam-patroon als
[`_shared/debiteur-matcher.ts`](../../supabase/functions/_shared/debiteur-matcher.ts) ↔
de frontend `product-matcher`-spiegel.

### Pijler 3 — Observability (reaper + monitor-views + cron-health)

- **Self-healing reaper.** RPC
  [`herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10) → INTEGER`](../../supabase/migrations/337_herstel_vastgelopen_hst.sql)
  (mig 337, SECURITY DEFINER) zet `hst_transportorders`-rijen die >`p_minuten` op `'Bezig'`
  hangen terug naar `'Wachtrij'`. Bovenin elke `hst-send`-run aangeroepen + handmatig.
- **Aggregaat-monitor.** View `hst_verzend_monitor` (één rij, geen state):
  `verstuurd_vandaag`, `fout_open`, `wachtrij`, `bezig`, `oudste_wachtrij_minuten`,
  `oudste_bezig_minuten`. De laatste twee zijn het **cron-health-signaal** (hoog = de
  verzend-cron staat stil; UI-drempel 5 min) — tegengif tegen de "silent failure"-klasse.
- **Handmatig-nodig-monitor.** View `orders_zonder_vervoerder`: niet-afhaal-orders
  (`afhalen=FALSE`), status NOT IN (`'Geannuleerd'`,`'Verzonden'`,`'Concept'`), met ≥1
  regel waarvan `effectieve_vervoerder_per_orderregel(...).bron = 'geen'` — voedt de
  "handmatig vervoerder kiezen"-teller/banner.

### Bugfixes in de HST-edge-keten

- `hst-client.ts` `extractErrorMsg` leest nu ook HST's PascalCase-veld `ErrorMessage`
  (operator kreeg eerder kaal `"HTTP 400"`).
- `payload-builder.ts` vult `ToAddress.PhoneNumber` uit `zendingen.afl_telefoon`
  (was hardcoded leeg).
- Nieuwe kolom `zendingen.afl_telefoon` (mig 339) — snapshot van het leveringstelefoon-
  nummer, gevuld door BEFORE-INSERT-trigger `trg_zending_fill_telefoon`
  (ladder `orders.afl_telefoon` → fallback `debiteuren.telefoon`), bewust via trigger zodat
  álle zending-aanmaakroutes het veld vullen.

## Overwogen alternatieven

- **Default-vervoerder als kolom `debiteuren.standaard_vervoerder_code`** (klant-fallback,
  zoals het oude concept uit ADR-0008). Afgewezen: dat is precies de tweede ladder-bron die
  ADR-0008 bewust heeft verwijderd. Een catch-all-regel met prio 99999 in
  `vervoerder_selectie_regels` doet hetzelfde zonder een nieuwe bron te introduceren —
  zelfde tabel, expliciete prio t.o.v. specifieke regels.
- **Resolver-RPC `effectieve_vervoerder_per_orderregel` patchen** om HST als hardcoded
  fallback te returnen. Afgewezen: load-bearing RPC met contract-tests, en het zou de
  default in code begraven i.p.v. in beheerbare data. De catch-all-regel houdt de default
  zichtbaar en aanpasbaar onder `/verzendregels`.
- **Validatie binnen de HST-POST laten falen** (geen pre-flight). Afgewezen: levert kansloze
  calls + ruis op de HST-API en een kale foutcode i.p.v. een leesbare reden vooraf.
- **Geen frontend-spiegel, edge-validator herimporteren in Vite.** Niet mogelijk —
  Deno-edge-modules zijn niet door Vite importeerbaar; vandaar de bewuste seam-kopie.

## Gevolgen

- **Tweede vervoerder = eigen regels + vlag omzetten, geen resolver-edit.** Een nieuwe
  default-carrier: `vervoerders.is_default` verplaatsen + een catch-all-regel toevoegen.
  Specifieke routing blijft via lager-prio `vervoerder_selectie_regels`. De ladder en de
  resolver-RPC uit ADR-0008 blijven onaangeraakt.
- **Default pas effectief bij cutover.** Zolang `hst_api.actief=FALSE` vuurt de
  catch-all-INSERT niet; NL-orders blijven tot cutover `bron='geen'` en verschijnen in de
  banner. Dat is bewust: geen verzending naar een nog-niet-werkende koppeling.
- **Cron-health zichtbaar.** `oudste_wachtrij_minuten` > drempel signaleert een stilstaande
  `hst-send`-cron; de reaper voorkomt dat een crash mid-claim transportorders permanent op
  `'Bezig'` parkeert.
- **Additief + geguard.** Alle DB-, view-, RPC-, edge- en frontend-wijzigingen zijn strikt
  additief; bestaande vervoerder-keuze voor orders die wél op een specifieke regel matchen
  verandert niet van gedrag.

## Referenties

- Migraties: **336** (`vervoerders.is_default` + catch-all selectie-regel, gegate op
  `hst_api.actief`), **337** (reaper `herstel_vastgelopen_hst`), **338** (views
  `hst_verzend_monitor` + `orders_zonder_vervoerder`), **339** (`zendingen.afl_telefoon`
  + trigger `fn_zending_fill_telefoon` + backfill — hernummerd van 335 wegens collisie met
  `335_orders_list_bevestigd_at.sql` op main). Handmatig toepassen.
- Edge: [`supabase/functions/_shared/vervoerder-eisen.ts`](../../supabase/functions/_shared/vervoerder-eisen.ts),
  [`supabase/functions/hst-send/`](../../supabase/functions/hst-send/) (`hst-client.ts`,
  `payload-builder.ts`).
- Frontend: [`frontend/src/lib/orders/vervoerder-eisen.ts`](../../frontend/src/lib/orders/vervoerder-eisen.ts)
  (validator-spiegel), `frontend/src/modules/logistiek/` (`queries/hst-monitor.ts`,
  `hooks/use-hst-monitor.ts`, `pages/hst-monitor.tsx` → route `/logistiek/hst-monitor`,
  `components/hst-aandacht-banner.tsx`).
- Bouwt voort op [ADR-0008](0008-vervoerder-keuze-als-deep-module.md).
