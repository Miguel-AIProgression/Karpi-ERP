# Verbeterplan: Gedeelde `matchDebiteur`-seam over alle inbound-kanalen

**Datum:** 2026-06-07
**Status:** Slices 0–3 + docs **geïmplementeerd** (2026-06-07). Slices 4–5 open (V2).
**Aanleiding:** Architectuur-review-bevinding #4 — "Debiteur-matching per inbound-kanaal — geen gedeeld seam"

> **Voortgang 2026-06-07:**
> - **Slice 0 (✓)** — Bevinding C bevestigd via `database-schema.md` + migraties (geen
>   `actief`/`email` op `debiteuren`; alleen `status`/`email_factuur/_overig/_2`). Live-query
>   niet nodig: schema-doc + mig 091 + afwezigheid van elke `ALTER TABLE debiteuren ADD` zijn eenduidig.
> - **Slice 1 (✓)** — [`_shared/debiteur-matcher.ts`](../../../supabase/functions/_shared/debiteur-matcher.ts)
>   met `normaliseerNaam`/`glnVarianten`/`isActieveDebiteur`/`ACTIEF_OR_FILTER`/`matchDebiteurOpGln`
>   + 10 tests. `product-matcher.ts` importeert nu de gedeelde `normaliseerNaam`.
> - **Slice 2 (✓)** — Shopify-matcher gerepareerd (`actief`→`ACTIEF_OR_FILTER`, `email`→3 kolommen)
>   + `zeker`-vlag + 6 tests.
> - **Slice 3 (✓)** — EDI `transus-poll matchDebiteur` delegeert naar `matchDebiteurOpGln`.
> - **Slice 6 (✓)** — changelog + architectuur + CLAUDE.md bijgewerkt.
> - **Beslissingen (gebruiker, §5):** (1) `status <> 'Inactief'` incl. NULL; (3) gate alleen op
>   fuzzy; (4) TS-module als seam. (2) Hornbach-skip = generiek `isActieveDebiteur` + GLN-volgorde.
> - **Open (V2):** Slice 4 (uniforme `zeker:false → te-koppelen`-UX buiten EDI) en Slice 5
>   (env-debiteur-kanalen als env-ladder) — raken frontend + meerdere sync-functies.

---

## 1. Probleemstelling

Elk inbound-kanaal (EDI, Shopify, webshop/Lightspeed, e-mail) matcht binnenkomende
orders op zijn **eigen manier** naar een `debiteur_nr`. Er is geen gedeelde
`matchDebiteur`-module. Gevolgen:

- **Drift:** dezelfde klant kan via verschillende kanalen op verschillende (of geen)
  debiteuren landen.
- **Onvindbaarheid:** "waarom landde deze order op deze debiteur?" heeft per kanaal
  een ander antwoord, verspreid over 5 edge functions.
- **Niet-testbaar:** matching zit verweven in HTTP-handlers (poll-loops, webhook-verify,
  SOAP-calls), waardoor het feitelijk alleen end-to-end getest kan worden — en dus
  niet getest *wordt*.

ADR-0011 modelleert **Debiteur** als deep module; matching hoort logisch achter dat seam.

---

## 2. Geverifieerde bevindingen

Onderzocht met 4 parallelle agents + handmatige verificatie tegen schema/migraties.

### Bevinding A — Vijf kanalen, vijf matchers, nul gedeeld interface

| Kanaal | Locatie | Strategie | Return |
|--------|---------|-----------|--------|
| **EDI** | [`transus-poll/index.ts:311-366`](../../../supabase/functions/transus-poll/index.ts) `matchDebiteur()` | 5-staps GLN-ladder (aflever→besteller→gefactureerd→alias) | `number \| null` |
| **Shopify** | [`_shared/shopify-debiteur-matcher.ts:103-186`](../../../supabase/functions/_shared/shopify-debiteur-matcher.ts) `matchDebiteur()` | 8-staps waterfall (note_attr→note→tags→bedrijfsnaam→email→env-fallback) | `DebiteurMatchResult \| null` |
| **Webshop (Lightspeed sync)** | [`sync-webshop-order/index.ts:178`](../../../supabase/functions/sync-webshop-order/index.ts) | **Hardcoded** `FLOORPASSION_DEBITEUR_NR` env-var | — |
| **Lightspeed import** | [`import-lightspeed-orders/index.ts:213`](../../../supabase/functions/import-lightspeed-orders/index.ts) | **Hardcoded** `FLOORPASSION_DEBITEUR_NR` env-var | — |
| **E-mail** | [`294_match_klant_po.sql:14-61`](../../../supabase/migrations/294_match_klant_po.sql) RPC `match_klant_po` | 3-staps SQL (BTW→email-domein→naam), uniekheids-gate | `{debiteur_nr, zeker}` |

Drie verschillende return-vormen (`number|null`, een result-object, een `{debiteur_nr, zeker}`-record),
drie verschillende plaatsen (TS edge function, gedeelde TS-module, SQL-RPC).

### Bevinding B — Drie tegenstrijdige "is deze debiteur actief?"-filters

De `debiteuren`-tabel heeft **één** statusvlag: `status TEXT` met waarden `'Actief'`/`'Inactief'`
([`database-schema.md:140`](../../database-schema.md)). Toch filtert elk kanaal er anders op:

- **EDI:** `.neq('status', 'Inactief')` → laat `NULL` en elke andere waarde dóór
  ([`transus-poll/index.ts:343`](../../../supabase/functions/transus-poll/index.ts))
- **E-mail:** `AND status = 'Actief'` → sluit `NULL` en alles-behalve-'Actief' uit
  ([`294_match_klant_po.sql:39`](../../../supabase/migrations/294_match_klant_po.sql))
- **Shopify:** `.eq('actief', true)` → filtert op een **niet-bestaande boolean-kolom** (zie Bevinding C)

De EDI-skip is *bewust* (Hornbach-patroon: inactieve hoofd-AG overslaan zodat de order op
de actieve filiaal-debiteur landt — zie CLAUDE.md). Maar de **semantiek verschilt per kanaal
zonder dat dat ergens gemotiveerd of getest is.**

### Bevinding C — **(HOOG) Shopify-matcher bevraagt niet-bestaande kolommen → vermoedelijk stil kapot**

[`shopify-debiteur-matcher.ts`](../../../supabase/functions/_shared/shopify-debiteur-matcher.ts) filtert op twee kolommen die **niet in `debiteuren` bestaan**:

```ts
// regel 56, 73, 82, 98 — kolom 'actief' bestaat niet op debiteuren
.eq('actief', true)
// regel 97 — kolom 'email' bestaat niet (alleen email_factuur/email_overig/email_2)
.or(`email_factuur.ilike.${email},email.ilike.${email}`)
```

Bewijs dat deze kolommen niet bestaan:
- Gedocumenteerd schema: alleen `status`, `email_factuur`, `email_overig`, `email_2`
  ([`database-schema.md:140,144`](../../database-schema.md))
- Insert in [`091_floorpassion_verzameldebiteur.sql:18-28`](../../../supabase/migrations/091_floorpassion_verzameldebiteur.sql)
  gebruikt `status` + `email_factuur`, géén `actief`/`email`
- De enige `actief BOOLEAN`-kolom in de hele migratieset zit op **`leveranciers`**
  ([`127_inkooporders_leveranciers.sql:39`](../../../supabase/migrations/127_inkooporders_leveranciers.sql)), niet `debiteuren`

In PostgREST geeft een filter op een onbekende kolom een **400** → `data` is `undefined` →
elke helper valt terug op `false`/`null`. Concreet betekent dit dat **álle Shopify-match-strategieën
behalve de env-var-fallback waarschijnlijk stil falen**: ook expliciete `debiteur_nr` uit
`note_attributes`/tags wordt geverifieerd via `zoekDebiteurOpNummer()` (regel 48-59), die óók
op `actief` filtert.

> ⚠️ **Te bevestigen tegen de live DB** vóór implementatie. De Karpi Supabase-MCP heeft geen
> projecttoegang (zie memory), dus dit is afgeleid uit schema + migraties, niet uit een live query.
> Mogelijk is er een legacy/verwijderde migratie die deze kolommen toevoegt. Eerste implementatiestap
> = dit één keer hard verifiëren (`select actief, email from debiteuren limit 1`).

### Bevinding D — `normaliseerNaam()` 3× gedupliceerd

Identieke NFKD-diacritiek-strip + lowercase + trim staat los in:
- [`shopify-debiteur-matcher.ts:44-46`](../../../supabase/functions/_shared/shopify-debiteur-matcher.ts)
- [`product-matcher.ts:97-99`](../../../supabase/functions/_shared/product-matcher.ts)
- in SQL als `regexp_replace + lower` in [`294_match_klant_po.sql`](../../../supabase/migrations/294_match_klant_po.sql)

Plus het `.0`-GLN-artefact dat zowel in `matchDebiteur` (inline `variants()`) als in
`db-helpers.ts` (`getKleurVariants`) eigen implementaties heeft.

### Bevinding E — Nul unit-tests op debiteur-matching

Geen enkele van de TS-matchers heeft tests (`shopify-debiteur-matcher`, `transus-poll matchDebiteur`,
beide sync-functies). Alleen de **SQL**-RPC `match_klant_po` is getest
([`scripts/test-match-klant-po.sql`](../../../scripts/test-match-klant-po.sql), T1–T8). Het best-geteste
kanaal is dus tevens het enige met een schone, datagedreven implementatie — sterk argument om de
anderen daarheen te trekken.

### Bevinding F — Precedent bestaat al: `product-matcher.ts`

[`product-matcher.ts`](../../../supabase/functions/_shared/product-matcher.ts) is exact het patroon dat
een gedeelde debiteur-matcher zou moeten volgen: één gedeelde module, expliciete `MatchBron`-enum,
een result-interface met de winnende strategie + reden-bij-geen-match. Dit is de blauwdruk.

---

## 3. Voorgestelde architectuur

Eén gedeelde module `_shared/debiteur-matcher.ts` achter één interface, met **per-kanaal een
strategie-ladder** die gedeelde bouwstenen hergebruikt. Spiegelt `product-matcher.ts`.

```ts
// _shared/debiteur-matcher.ts
export type DebiteurMatchBron =
  | 'gln_afleveradres' | 'gln_bedrijf' | 'gln_alias'      // EDI
  | 'note_attribute' | 'order_note' | 'customer_tag'      // Shopify expliciet
  | 'bedrijfsnaam' | 'email' | 'btw_nummer'               // generiek B2B
  | 'env_fallback' | 'geen'

export interface DebiteurMatch {
  debiteur_nr: number | null
  bron: DebiteurMatchBron
  zeker: boolean            // false = handmatige bevestiging nodig (uniekheids-gate)
}

// Gedeelde bouwstenen (één implementatie, getest):
export function normaliseerNaam(s: string): string
export function glnVarianten(gln: string | null): string[]   // .0-tolerant
export function isActieveDebiteur(status: string | null): boolean  // ÉÉN definitie

// Gedeelde strategie-primitieven die meerdere kanalen delen:
async function matchOpEmail(db, email): Promise<DebiteurMatch | null>
async function matchOpBedrijfsnaam(db, naam): Promise<DebiteurMatch | null>
async function matchOpGln(db, {aflever, besteller, gefactureerd}): Promise<DebiteurMatch | null>
async function matchOpBtw(db, btw): Promise<DebiteurMatch | null>

// Per-kanaal samengestelde ladders (compositie, geen copy-paste):
export const matchDebiteurEDI     = (db, glns) => ladder([matchOpGln(...)])
export const matchDebiteurShopify = (db, order) => ladder([expliciet, bedrijfsnaam, email, fallback])
export const matchDebiteurEmail   = (db, afz)  => ladder([matchOpBtw, matchOpEmail, matchOpBedrijfsnaam])
```

**Kernprincipes:**
1. **Eén `isActieveDebiteur()`** — beslis bewust welke semantiek geldt (waarschijnlijk
   `status <> 'Inactief'` zodat `NULL` meedoet; documenteer de Hornbach-uitzondering als
   expliciete GLN-stap, niet als globaal filter).
2. **Eén normalisatie + één GLN-`.0`-helper**, hergebruikt door alle ladders en `product-matcher`.
3. **`zeker`-vlag** uit het e-mailkanaal wordt generiek: een uniekheids-gate (>1 hit ⇒
   `zeker:false` ⇒ handmatig-koppelen-flow), zodat álle kanalen dezelfde "te koppelen"-UX krijgen.
4. **Hardcoded env-kanalen** (Lightspeed/webshop) worden een triviale ladder met één
   `env_fallback`-stap — zelfde interface, geen speciale behandeling.

---

## 4. Implementatie — verticale slices

> Werkwijze: dunne verticale slices, elk testbaar/mergebaar. **Niet** eerst alles abstraheren.

**Slice 0 — Verifieer Bevinding C (blocker).**
Query de live DB: bestaan `debiteuren.actief` / `debiteuren.email`? Bepaalt of Shopify-matching
nu kapot is. Uitkomst stuurt de prioriteit van Slice 2.

**Slice 1 — Extraheer gedeelde bouwstenen (laag risico, geen gedragswijziging).**
Maak `_shared/debiteur-matcher.ts` met `normaliseerNaam`, `glnVarianten`, `isActieveDebiteur`
+ unit-tests. Laat `shopify-debiteur-matcher` en `transus-poll` deze importeren i.p.v. eigen
kopieën. Bevestig identiek gedrag.

**Slice 2 — Repareer + migreer Shopify naar de gedeelde matcher.**
Vervang `.eq('actief', true)` → `isActieveDebiteur`-equivalent en `email` → `email_factuur`
(/`email_overig`/`email_2`). Voeg de eerste echte unit-tests toe (mock `debiteuren`). Dit
herstelt Bevinding C en is meteen de eerste consument van het seam.

**Slice 3 — Trek EDI's `matchDebiteur` in de gedeelde module** als `matchDebiteurEDI`, met de
GLN-ladder + de bewuste inactieve-skip nu als expliciete, becommentarieerde stap. Tests voor de
Hornbach- en BDSK-alias-paden.

**Slice 4 — Uniformeer de "geen match / niet zeker"-uitkomst.** Laat alle kanalen dezelfde
`DebiteurMatch{zeker}` teruggeven en koppel aan de bestaande "te koppelen"-flow (EDI heeft die al
via `koppel_edi_*`-RPC's + banner). E-mail levert `zeker` al; Shopify/Lightspeed erbij.

**Slice 5 — Hardcoded kanalen als env-ladder** (Lightspeed/webshop) zodat ze hetzelfde contract
volgen; opent later de deur naar echte matching voor Floorpassion-B2B zonder nieuwe code-paden.

**Slice 6 — Documentatie:** ADR "Gedeelde debiteur-matcher (seam achter ADR-0011 deep module)",
update `architectuur.md` + `changelog.md` + CLAUDE.md-bullet.

---

## 5. Open vragen (vóór bouw uitvragen)

> De review-bevinding noemt dit terecht "groter dan 1-3 en verdient grilling — niet alles is écht
> identiek". Daarom eerst beslissen:

1. **Welke `actief`-semantiek wint?** `status <> 'Inactief'` (NULL doet mee) of `status = 'Actief'`
   (strikt)? Heeft impact op welke orders nu wél/niet matchen.
2. **Is de Hornbach inactieve-skip kanaal-specifiek of generiek?** Voorstel: generiek
   `isActieveDebiteur` + Hornbach als expliciete GLN-volgorde, niet als globaal filter.
3. **Moet de uniekheids-gate (`zeker`) overal gelden?** Voor EDI is een GLN-hit per definitie uniek;
   voor naam/email niet. Waarschijnlijk alleen op de fuzzy strategieën.
4. **Eén TS-module of consolideren naar SQL-RPC?** Het e-mailkanaal zit al in SQL (getest). Optie:
   alles naar een `match_debiteur(...)`-RPC trekken zodat ook EDI/Shopify datagedreven en
   in-DB-testbaar worden — tegenover de overhead van GLN/Shopify-payload-parsing in PL/pgSQL.
   Aanbeveling: TS-module als seam (parsing blijft in TS), gedeelde *uitkomst*-semantiek met de RPC.

---

## 6. Verwachte opbrengst

- **Leverage:** een nieuw kanaal (bv. een toekomstige marketplace) hergebruikt de matchladder i.p.v.
  een zesde eigen implementatie.
- **Locality:** één antwoord op "waarom landde deze order op deze debiteur?".
- **Testbaarheid:** matching wordt unit-testbaar via één interface i.p.v. via 5 edge functions.
- **Directe bugfix:** herstelt de vermoedelijk stil-falende Shopify-matching (Bevinding C) en de
  tegenstrijdige actief-filters (Bevinding B).
