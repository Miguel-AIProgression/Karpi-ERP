# Design — HST-verzendkoppeling productie-klaar: observability + altijd-een-vervoerder

**Datum:** 2026-06-09
**Branch:** `feat/hst-observability-vervoerder-default`
**Status:** Ontwerp — wacht op review vóór implementatieplan

## Aanleiding

De HST-koppeling (REST TransportOrder-API) gaat binnenkort opschalen naar honderden
orders per dag. Een live verbindingstest op 2026-06-09 (`hst-ping`) bewees dat het
productiepad werkt: Supabase bereikt HST (geen IP-blokkade), Basic-auth wordt
geaccepteerd en HST verwerkt de aanvraag. De ACCP-omgeving keurde de test-payload
echter af met `HTTP 400 — "Bellen voor aflevering. Geef een telefoonnummer tussen 10
en 15 getallen op."` Dat legde meteen drie dingen bloot:

1. De **foutmelding van HST wordt nu weggegooid** — de operator ziet kaal "HTTP 400".
2. De payload-builder stuurt **`PhoneNumber` altijd leeg** mee.
3. Er is **geen totaaloverzicht of proactieve foutmelding**; fouten zijn alleen
   zichtbaar als je een specifieke zending opent.

Tegelijk speelt een tweede, gerelateerde wens: **elke order moet altijd een
vervoerder gekoppeld hebben** (behalve bij afhalen). Nu blijven orders zonder
matchende vervoerder-regel als "⚠ Geen regel" liggen (bv. ORD-2026-0108 / -0097),
gaan nooit via de API de deur uit, en niemand ziet het. Zolang HST de enige
koppeling is, moet HST de default zijn — maar alleen binnen HST's bereik.

Doel: de koppeling **goed neerzetten vóór de opschaling**, zodat we zien dat orders
correct verzonden worden en bij HST aankomen, en fouten snel naar voren komen.

## Besliste scope (uit brainstorm 2026-06-09)

| Vraag | Keuze |
|---|---|
| Aankomst-scope | **Verzend-bevestiging bij HST** (HTTP 201 + Success=true + OrderNumber). Géén afleverstatus-polling. |
| Default-bereik | **Alleen waar HST geldig is.** Buiten bereik → expliciete "handmatig vervoerder kiezen"-vlag, niet stil blijven liggen. |
| Alerting-reik | **In-app**: monitoring-overzicht + rode badge/banner. Géén e-mail/push. |
| Vervoerder-regels | **Pre-flight**: vooraf controleren tegen HST's eisen i.p.v. reactief op afkeuring. |
| HST-landenbereik | **NL only** (catch-all-conditie `{landen:['NL']}`, uitbreidbaar). |
| Telefoon-fallback | `zending.afl_telefoon` → fallback `debiteuren.telefoon` → anders pre-flight-vlag. |

## Architectuur — twee pijlers, één raakvlak

```
┌─ PIJLER B: Altijd een vervoerder ────────┐   ┌─ PIJLER A: Observability ───────────┐
│ ladder: override → regel → DEFAULT(HST)  │   │ monitoring-view (vandaag-cijfers)   │
│         → (alleen afhalen = géén)        │   │ reaper voor vastgelopen 'Bezig'     │
│ buiten HST-bereik → 'handmatig kiezen'   │   │ cron-health (oudste-wachtrij-leeft.)│
└──────────────────┬───────────────────────┘   │ badge/banner + overzichtspagina     │
                   │                            └─────────────────┬───────────────────┘
            ┌──────┴───────── PRE-FLIGHT VALIDATOR (gedeelde seam) ┴──────┐
            │ kent HST's eisen (telefoon, adresvelden, land-bereik)        │
            │ → Pick & Ship-vlag  +  laatste poort in hst-send             │
            └─────────────────────────────────────────────────────────────┘
```

De pre-flight validator is het scharnier: hij bepaalt zowel of een order *klaar is
om te verzenden* (pijler B / UI) als of `hst-send` mag POSTen (pijler A / edge).

## Datamodel-wijzigingen (klein, additief, idempotent)

1. **`vervoerders.is_default BOOLEAN DEFAULT FALSE`** — markeert de huidige
   default-vervoerder. Seed: `UPDATE vervoerders SET is_default=TRUE WHERE
   code='hst_api'`. Toekomst-proof: bij een 2e vervoerder zet je de vlag om, geen
   code-edit. Partial unique index zodat er hooguit één default tegelijk is.
2. **`vervoerder_selectie_regels`** — één **catch-all HST-regel**: laagste
   prioriteit (`prio = 99999`), `conditie = {"landen":["NL"]}`, `vervoerder_code =
   'hst_api'`, `actief = TRUE`, notitie "Default-vervoerder binnen NL". Dit ís de
   "default binnen bereik".
3. **`zendingen.afl_telefoon TEXT`** — snapshot, gevuld bij zending-aanmaak vanuit
   `orders.afl_telefoon` (met fallback `debiteuren.telefoon`). De payload-builder
   heeft hierdoor een echt telefoonnummer.
4. **`hst_transportorders`** — geen nieuwe kolommen. `status`, `error_msg`,
   `retry_count`, `response_http_code`, `created_at`, `updated_at`, `sent_at` dekken
   reaper én monitoring volledig.

Geen tabel wordt herschreven; alles `ADD COLUMN IF NOT EXISTS` / idempotente seed.

## Pijler B — altijd een vervoerder (aanpak B1)

De ladder in `effectieve_vervoerder_per_orderregel` (mig 225, ADR-0008) blijft
`override → regel`, maar de catch-all-regel zorgt dat een NL-order zónder specifieke
regel nu **HST** krijgt (`bron='regel'`) i.p.v. `bron='geen'`. Resultaat:

- **Afhalen** (`orders.afhalen=TRUE`) → géén vervoerder (ongewijzigd, bewust).
- **Binnen HST-bereik (NL), geen specifieke regel** → HST via de catch-all.
- **Buiten HST-bereik (BE/DE/…)** → nog steeds `bron='geen'` → wordt nu een
  **expliciete, zichtbare vlag "handmatig vervoerder kiezen"** (zie pijler A),
  niet langer een stille "Geen regel". Géén automatische verkeerde HST-toewijzing.

Zo respecteren we "de regels van de logistieke partijen": HST's bereik is data
(`landen`), geen aanname. Een tweede vervoerder krijgt later eigen regels +
desgewenst de `is_default`-vlag.

**Niet wijzigen:** de plpgsql-resolver zelf hoeft geen nieuwe trede (de catch-all
doet het werk via de bestaande regel-evaluator). Dit houdt een al complexe functie
ongemoeid.

## Pre-flight validator (aanpak A — gedeelde seam)

Nieuwe module `supabase/functions/_shared/vervoerder-eisen.ts`, gespiegeld als
frontend-helper (patroon = `_shared/debiteur-matcher.ts` ↔ `product-matcher.ts`).

```ts
interface VerzendContext {
  vervoerder_code: string
  afl_land: string
  afl_telefoon: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
}
interface Probleem { code: string; veld: string; melding: string }
function valideerVoorVervoerder(ctx: VerzendContext): { ok: boolean; problemen: Probleem[] }
```

**HST-regelset v1** (uitbreidbaar — "start met de kritieke eisen"):

- `TELEFOON_ONTBREEKT` — telefoonnummer aanwezig en 10–15 cijfers.
- `ADRES_ONSPLITSBAAR` — `splitAdres()` levert een straat + huisnummer op.
- `ADRESVELD_LEEG` — postcode, plaats en naam niet leeg.
- `LAND_BUITEN_BEREIK` — land binnen HST-bereik (NL).

**Drie aanroep-punten, één uitkomst:**

1. **Pick & Ship + order-detail** → vlag/tooltip "⚠ Eerst aanvullen: telefoonnummer".
2. **`hst-send` edge function** → laatste poort: faalt de check, dan **niet POSTen**;
   rij direct op `Fout` met `error_msg = "Pre-flight: telefoonnummer ontbreekt"`.
   Bespaart een kansloze HST-call én geeft een nette reden.
3. *(Later, optioneel)* order-import.

De validator is puur (geen DB/secrets), dus triviaal unit-testbaar.

## `hst-send` hardening (zelfde slice)

- **Bugfix `extractErrorMsg`** (`hst-client.ts`): ook HST's veld **`ErrorMessage`**
  (PascalCase) lezen. Nu valt een echte fout terug op kaal "HTTP 400" omdat alleen
  `message/error/errorMessage` worden gecheckt. Klein, hoge waarde.
- **Telefoonnummer in payload** (`payload-builder.ts`): `PhoneNumber` vullen uit
  `zending.afl_telefoon` i.p.v. hardcoded `''`.
- **Reaper voor vastgelopen `Bezig`**: aan het begin van elke `hst-send`-run eerst
  rijen met `status='Bezig' AND updated_at < now() - interval '10 min'` terugzetten
  naar `Wachtrij` (zelfhelend, géén extra cron). Voorkomt dat een crash mid-claim
  een rij voorgoed laat hangen. Implementatie als RPC `herstel_vastgelopen_hst()`
  zodat het ook handmatig aanroepbaar is.

## Pijler A — monitoring & cron-health

- **View `hst_verzend_monitor`** (aggregaat, geen state): tellingen van vandaag per
  status (`verstuurd`, `fout`, `wachtrij`, `bezig`), plus **`oudste_wachtrij_minuten`**
  en **`oudste_bezig_minuten`**. Die laatste twee zijn het cron-health-signaal:
  loopt de oudste-wachtrij boven een drempel (bv. 5 min) → cron staat stil → rood.
  Tegengif voor de "EDI poll silent failure"-klasse (transus-poll logt API-fouten
  niet in de DB; hier moet de wachtrij-leeftijd dat zichtbaar maken).
- **Teller `orders_zonder_vervoerder`** (view of RPC): niet-afhalen-orders met ≥1
  regel `bron='geen'` (buiten HST-bereik → handmatig nodig). Voedt de "handmatig
  kiezen"-vlag en -teller.
- **Monitoring-overzichtspagina** onder Logistiek (`/logistiek/hst-monitor`):
  vandaag-cijfers, lijst recente `Fout`-zendingen met de échte `error_msg` +
  retry-knop, wachtrij-gezondheid. Hergebruikt `vervoerder_stats` waar mogelijk.
- **Proactief badge/banner**: rode badge op de Logistiek-nav + banner bovenaan
  Pick & Ship / Logistiek bij `fout > 0` of `cron stil`, exact het patroon van de
  EDI-module (`te-koppelen-banner.tsx` + `useTeKoppelenEdiCount`). Eén
  bron-van-waarheid voor de telling (helper `countHstAandacht()`).

## Diepe audit (bestaand, ongewijzigd)

`externe_payloads` (mig 325, `richting='out'`, `kanaal='hst'`) blijft de
append-only volledige request/response-historie per poging. De monitoring leest
samenvattend uit `hst_transportorders`; voor forensiek blijft `externe_payloads`
het diepe spoor. Geen wijziging nodig.

## Tests

- `vervoerder-eisen.test.ts` — alle validator-regels (telefoon-lengte, adres-split,
  lege velden, land buiten bereik), happy + faal.
- `payload-builder.test.ts` (uitbreiding) — `PhoneNumber` gevuld uit `afl_telefoon`.
- `hst-client`-test — `ErrorMessage`-parsing levert de HST-melding (niet "HTTP 400").
- Ladder-test — catch-all-default geeft HST binnen NL; `bron='geen'` buiten NL;
  afhalen blijft géén vervoerder.

## Documentatie & werkwijze

- **ADR** voor "altijd-een-vervoerder + default-carrier-vlag" (raakt ADR-0008-ladder).
- `changelog.md`, `architectuur.md`, `database-schema.md` (nieuwe kolommen/views),
  `data-woordenboek.md` waar nodig.
- **CLAUDE.md** bedrijfsregel toevoegen: default-vervoerder + pre-flight + monitoring.
- Branch: `feat/hst-observability-vervoerder-default` (eigen worktree).

## Bewust buiten scope (YAGNI)

- Echte **afleverstatus-polling** bij HST (onderweg/afgeleverd).
- **E-mail/push-alerts** (in-app volstaat nu).
- Per-stuk **pakket-afmetingen/gewicht** naar HST (blijft default-maten).
- Pre-flight-uitbreiding voor toekomstige vervoerders (komt met die vervoerder mee).

## Verticale slices (volgorde voor implementatieplan)

1. **Bugfix + telefoon** — `ErrorMessage`-parsing, `zendingen.afl_telefoon` +
   snapshot-vulling, `PhoneNumber` in payload. (Direct waarde, dekt het 400-incident.)
2. **Pre-flight validator-seam** — gedeelde module + tests + poort in `hst-send`.
3. **Pijler B** — `is_default`-vlag, catch-all HST-regel, "handmatig kiezen"-vlag
   in Pick & Ship.
4. **Reaper** — `herstel_vastgelopen_hst()` + aanroep boven in `hst-send`.
5. **Monitoring** — `hst_verzend_monitor`-view, overzichtspagina, badge/banner.
6. **Docs + ADR + CLAUDE.md.**
