# Handoff: Gedeelde debiteur-matcher — V2 (Slices 4 & 5)

## Context
Slices 0–3 van het verbeterplan zijn **klaar en gecommit naar `main`** (2026-06-07).
De gedeelde matching-seam bestaat nu; de stil-falende Shopify-matcher is gerepareerd.
Lees eerst, dupliceer niet:
- **Plan + voortgangsblok:** [docs/superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md](docs/superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md) (§4 = de 6 slices, §5 = beslissingen)
- **Wat er staat:** changelog-entry "Gedeelde debiteur-matcher-seam" + architectuur-sectie "Gedeelde debiteur-matcher-seam" + CLAUDE.md-bullet "Gedeelde debiteur-matcher-seam (2026-06-07)"
- **De seam zelf:** [supabase/functions/_shared/debiteur-matcher.ts](supabase/functions/_shared/debiteur-matcher.ts)

## Reeds genomen beslissingen (NIET heropenen)
1. `isActieveDebiteur` = `status <> 'Inactief'` met **NULL meegerekend** → `ACTIEF_OR_FILTER = 'status.is.null,status.neq.Inactief'`. Gebruik altijd `.or(ACTIEF_OR_FILTER)`, nooit `.neq('status','Inactief')`.
2. Uniekheids-gate (`zeker`) **alleen op fuzzy** (naam-deelmatch/email → `zeker:false`); GLN/expliciet nr/exacte naam/BTW → `zeker:true`.
3. **TS-module als seam**, payload-parsing blijft per kanaal.

## Wat nog moet — V2

### Slice 4 — Uniforme "`zeker:false` → handmatig koppelen"-UX buiten EDI
**Doel:** elk kanaal levert een `DebiteurMatch{zeker}` en een `zeker:false`-uitkomst voedt dezelfde "te koppelen"-flow als EDI al heeft.

**Bestaand referentiepatroon (EDI — kopiëren, niet opnieuw uitvinden):**
- "Te koppelen"-definitie + banner: zie CLAUDE.md-bullet "EDI centrale-facturatie + filiaal-mapping (mig 306)" → `countTeKoppelenEdiOrders`/`isTeKoppelen`, `EdiTeKoppelenBanner`, `useTeKoppelenEdiCount()`.
- Koppel-RPC's: `koppel_edi_afleveradres` (mig 306), `koppel_edi_debiteur_alias` (mig 307), widget [koppel-vestiging-widget.tsx](frontend/src/modules/edi/components/koppel-vestiging-widget.tsx).

**Concreet werk:**
- **Shopify** ([sync-shopify-order/index.ts:246-250](supabase/functions/sync-shopify-order/index.ts)): nu wordt bij `!debiteurMatch` een 422 teruggegeven en bij een match wordt `zeker` genegeerd. Beslis: bij `zeker:false` → order wél aanmaken maar markeren als "te koppelen / te bevestigen debiteur" (analoog EDI), i.p.v. stil de fuzzy-match accepteren. Vereist een vlag/kolom op de order (hergebruik óf een nieuwe). **Open vraag voor de gebruiker:** moet een `zeker:false`-match de order blokkeren, of aanmaken-met-waarschuwing?
- **Lightspeed/webshop**: zie Slice 5 — die kanalen hebben nu helemaal geen match (env-var), dus `zeker` is daar pas relevant ná Slice 5.
- **Generaliseer de telling**: nu is "te koppelen" puur EDI (`edi_berichten.order_id IS NULL`). Voor Shopify is er geen inbound-berichtentabel; de gate moet op order-niveau (bv. `orders.debiteur_zeker=false`). Ontwerp één order-niveau "debiteur te bevestigen"-predicaat dat álle kanalen voedt, en sluit aan op de bestaande banner-infrastructuur op het orders-overzicht.

**Let op:** dit raakt frontend (banner, filter, mogelijk een koppel-widget voor niet-EDI) + minstens één migratie (order-vlag) + `sync-shopify-order`. Grilling vooraf op bovenstaande open vraag.

### Slice 5 — Hardcoded env-debiteur-kanalen als env-ladder
**Doel:** Lightspeed-import en webshop-sync, die nu hard `FLOORPASSION_DEBITEUR_NR` gebruiken, achter hetzelfde `DebiteurMatch`-contract zetten (triviale ladder met één `env_fallback`-stap → `zeker:false`). Opent later de deur naar échte B2B-matching voor Floorpassion zonder nieuw code-pad.

**Ankers:**
- [sync-webshop-order/index.ts:178](supabase/functions/sync-webshop-order/index.ts) — `FLOORPASSION_DEBITEUR_NR`
- [import-lightspeed-orders/index.ts:213](supabase/functions/import-lightspeed-orders/index.ts) — idem
- Maak in [debiteur-matcher.ts](supabase/functions/_shared/debiteur-matcher.ts) een helper `matchDebiteurViaEnv(envKey)` die een `DebiteurMatch{bron:'env_fallback', zeker:false}` of `null` teruggeeft; laat beide functies die aanroepen i.p.v. de inline `parseInt(Deno.env.get(...))`.
- **Bewust klein houden:** géén gedragswijziging — alleen het contract uniformeren. Echte Floorpassion-B2B-matching staat los op de backlog.

## Werkwijze-tips
- **TDD**: de seam heeft nu tests ([debiteur-matcher.test.ts](supabase/functions/_shared/debiteur-matcher.test.ts), [shopify-debiteur-matcher.test.ts](supabase/functions/_shared/shopify-debiteur-matcher.test.ts)). Gebruik de daar gedefinieerde `mockSupabase`-helper (chainable PostgREST-mock) als blauwdruk voor nieuwe tests.
- **Tests draaien:** `deno test --no-check --allow-env --allow-read supabase/functions/_shared/`. Pre-existing falende test (negeren, niet van jou): `guillotine-packing.test.ts` (1 failure, faalt ook op HEAD).
- **Typecheck:** `deno check` op edge functions geeft pre-existing rpc/update-`undefined`/`never`-errors (geen DB-types gegenereerd) — dat is bestaand, niet jouw regressie. Tel errors vóór/na als bewijs.
- **Aanbevolen skills:** `superpowers:brainstorming` of `grill-with-docs` voor de open vraag in Slice 4; `superpowers:test-driven-development` voor de implementatie; `code-reviewer`-agent na elke slice (CLAUDE.md-werkwijze).

## Git / omgeving
- Branch `main`, direct mergen (geen PR's — auto-memory `feedback_git_workflow.md`).
- Migraties **handmatig** toepassen (MCP heeft geen Karpi-toegang, project-id `wqzeevfobwauxkalagtn`). Volgend vrij migratienr: **322** (laatste in tree = 321).
- Niet gecommit gelaten (bewust): `docs/changelog.md` + `docs/architectuur.md` bevatten mijn entries **plus** veel andere lopende doc-edits (ISO-week-consolidatie, EDI-werk 04-06, import/lib). Die twee docs landen in een aparte docs-batch-commit; mijn entries staan er al in.
- Taal: Nederlands voor communicatie/comments, code-identifiers Engels.
