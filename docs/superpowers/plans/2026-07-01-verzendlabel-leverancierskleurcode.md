# Leveranciers-kleurcode op verzendlabel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Op het verzendlabel (sticker) naast de interne Karpi-kleurcode ook de kleurcode van de leverancier tonen ("13 – G305"), maar uitsluitend voor de productsoorten waar die code daadwerkelijk in de data zit — niet voor de overige ~99% van de producten.

**Architecture:** Eén nieuwe pure tekst-parse-functie `leverancierskleurcodeUitVervolg` naast de bestaande `kwaliteitNaamUitVervolg` in de gedeelde module `supabase/functions/_shared/kwaliteit-naam.ts` (ADR-0033 — één bron voor label/pakbon/factuur). Geen DB-migratie, geen nieuwe kolom, geen query-uitbreiding: de functie parst tekst uit `producten.vervolgomschrijving`, een veld dat de labelcode al ontvangt. De frontend-functie `vasteMaatRegels()` in `frontend/src/modules/logistiek/lib/shipping-label-data.ts` roept de nieuwe functie aan en voegt de code — als hij bestaat — toe achter het kleurnummer. Omdat alle drie labelvarianten (compact/staand/DPD) sinds de "Verzendlabel één deep module"-refactor dezelfde `ShippingLabel`-component + `labelProductRegels()` delen, raakt deze ene wijziging automatisch alle drie.

**Tech Stack:** TypeScript (Deno edge functions + Vite/React frontend), Vitest (frontend tests), Deno.test (shared-module tests).

---

## Achtergrond (al onderzocht — niet opnieuw uitzoeken)

**Aanleiding:** mail vanuit Pick & Ship (Logistics/Karpi, 2026-07-01): bij Sofia 80x150 toont het systeem bij "kleur" alleen "13", terwijl de fysieke rol van de leverancier gestickerd is met "G305". Gewenst: op de sticker beide tonen, bv. "13 – G305". De gebruiker: "Dit geldt eigenlijk voor alle karpetten met een andere kleurcode in het systeem" — vandaar eerst een data-onderzoek vóór de bouw.

**Data-onderzoek (read-only Python-script tegen de live Supabase-tabel `producten`, service-role key uit `import/.env`, 21.801 vaste/staaltje-producten met `vervolgomschrijving` gescand, uitgevoerd 2026-07-01):**

- `producten.vervolgomschrijving` volgt meestal het patroon `"{KWALITEITNAAM} Kleur {kleurnummer} CA: {maat} cm"` (bv. `"GALAXY Kleur 10 CA: 200x290 cm"`).
- Bij **18 kwaliteit_code's / 280 producten** staat er i.p.v. `"Kleur {nr}"` een extra leverancierscode TUSSEN de kwaliteitsnaam en de `"CA:"`-marker, in het exacte patroon `"{3-6 cijfers}-{2-6 alfanumeriek}"`, bv. `"SOFIA 3726-G305 CA: 080x150 cm"`. Betrokken kwaliteit_code's (prefix erbij): ANNY(33024), ARIA(7147), CABA(5367), DIAN(5949), DREM(18043/18126), FAYN(7128), ITEA(42003), JEAS(19066/19358), LINE(5366), MAND(3726), MARG(8581), MELW(2144), OKSI(38005/38007), OPHE(7573), ROMY(2144), SOFI(3726), WASI(3726), WELL(6436).
- Binnen zo'n kwaliteit is de PREFIX (vóór de streep) vaak een leveranciers-/collectiereferentie, de SUFFIX (ná de streep, bv. `"G305"`) varieert per `kleur_code` en is 1-op-1 daarmee — dat suffix-deel is de "andere kleurcode" die getoond moet worden. De gebruiker wil expliciet `"13 – G305"`, NIET `"13 – 3726-G305"`.
- Andere "extra tekst"-varianten op dezelfde positie zijn GEEN kleurcode en mogen dit gedrag niet triggeren: losse dessin-/patroonnummers (`"ROMANCE 1200 Kleur 41 CA:068x220 cm"` — hier staat "1200" vóór een aparte "Kleur 41" die apart als marker matcht), parse-artefacten als `"Kl.63"` (bevat toevallig een cijfer waardoor de bestaande naam-parser er al op breekt, maar is inhoudelijk identiek aan `kleur_code` — geen nieuwe info), en vrije ruis als `"23 CA.130X190 CM BAND 1111"`. Het betrouwbare onderscheid is het regex-patroon `^\d{3,6}-[0-9A-Za-z]{2,6}$` toegepast op de VOLLEDIGE extra-tekst (één aaneengesloten token, geen andere ruis ernaast) — dat matchte in de data alle 280 echte gevallen en NUL van de ruis-gevallen.

**Codebase-bevindingen:**

- De parse-logica leeft in `supabase/functions/_shared/kwaliteit-naam.ts`, functie `kwaliteitNaamUitVervolg(vervolg)`: loopt tokens, stopt bij het EERSTE token met een cijfer OF een marker-token (regex `^(kleur|farbe|kl\.?|ca[:.]?)$`, case-insensitive). Voor `"SOFIA 3726-G305 CA: 080x150 cm"` levert dit alleen `"SOFIA"` — het token `"3726-G305"` wordt volledig weggegooid.
- Frontend-consument: `frontend/src/modules/logistiek/lib/shipping-label-data.ts`, functie `vasteMaatRegels(regel)` (regel 92-109). Bouwt de GROTE labelregel als `[kwaliteit, kleur ? '(' + kleur + ')' : '', maat, vorm].filter(Boolean).join(' ')` → nu bv. `"SOFIA (13) 080x150 cm"`. Dit ÉÉN format wordt sinds de "Verzendlabel één deep module"-refactor gedeeld door alle drie labelvarianten (compact/staand/DPD via component `ShippingLabel`) — één fix hier raakt alle drie. `product.vervolgomschrijving` wordt al opgehaald (geen query-uitbreiding nodig).
- **Bewust NIET aanpassen:** de pakbon-PDF (`supabase/functions/_shared/pakbon/`) toont de kleurcode al correct — die leest de rauwe `omschrijving_snapshot`/`producten.omschrijving`, waar `"3726-G305"` al letterlijk in staat (geverifieerd op live `zending_colli`-rijen, 2026-07-01). De factuur-titel (`supabase/functions/_shared/facturatie/factuur-product-titel.ts`, functie `factuurProductTitel`) toont sowieso geen kleurcode (alleen `"kwaliteit - maat"`) — geen onderdeel van deze klacht.
- Test-conventie: `supabase/functions/_shared/kwaliteit-naam.test.ts` (Deno.test) en `frontend/src/modules/logistiek/lib/shipping-label-data.test.ts` (Vitest) spiegelen elkaar. Beide hebben al een tabel-gebaseerd testblok voor `kwaliteitNaamUitVervolg` met (invoer, verwacht)-paren, inclusief het bestaande geval `"MANDA 3726-1V48 CA: 240x330 cm"` → `"MANDA"` (bevestigt dat het huidige, onvolledige gedrag al gedekt is).
- `deno test supabase/functions/_shared/kwaliteit-naam.test.ts` is geverifieerd te werken vanaf de repo-root (2026-07-01, 2 tests groen).

---

### Task 1: Branch + worktree aanmaken

**Files:** geen bestandswijzigingen, alleen git-setup.

- [ ] **Step 1: Nieuwe branch + worktree aanmaken**

Dit is substantieel genoeg werk (nieuwe gedeelde helper + integratie + tests in 2 runtimes) voor een eigen branch (projectconventie, CLAUDE.md). Maak een aparte worktree zodat dit niet de gedeelde hoofd-working-tree (met veel andere lopende wijzigingen) raakt:

```bash
git worktree add .worktrees/label-leverancierskleurcode -b feat/label-leverancierskleurcode
cd .worktrees/label-leverancierskleurcode
```

Verwacht: nieuwe map `.worktrees/label-leverancierskleurcode` met een checkout van de nieuwe branch `feat/label-leverancierskleurcode`, gebaseerd op de huidige branch. Voer alle volgende stappen in deze worktree-map uit.

- [ ] **Step 2: Bevestig dat je in de juiste worktree/branch zit**

```bash
git branch --show-current
```

Verwacht: `feat/label-leverancierskleurcode`

---

### Task 2: Gedeelde helper `leverancierskleurcodeUitVervolg`

**Files:**
- Modify: `supabase/functions/_shared/kwaliteit-naam.ts`
- Test: `supabase/functions/_shared/kwaliteit-naam.test.ts`

- [ ] **Step 1: Voeg de failing tests toe aan `supabase/functions/_shared/kwaliteit-naam.test.ts`**

Huidige inhoud van dit bestand (27 regels) blijft staan; wijzig de importregel en voeg twee nieuwe `Deno.test`-blokken toe aan het eind:

Wijzig regel 5 van:
```ts
import { kwaliteitNaamUitVervolg } from './kwaliteit-naam.ts'
```
naar:
```ts
import { kwaliteitNaamUitVervolg, leverancierskleurcodeUitVervolg } from './kwaliteit-naam.ts'
```

Voeg dit toe aan het eind van het bestand (ná de bestaande twee `Deno.test`-blokken):

```ts

Deno.test('leverancierskleurcodeUitVervolg: streepje-patroon → code na de streep', () => {
  // Echte gevallen uit de productdata (2026-07-01, mail Pick & Ship).
  assertEquals(leverancierskleurcodeUitVervolg('SOFIA 3726-G305 CA: 080x150 cm'), 'G305')
  assertEquals(leverancierskleurcodeUitVervolg('MANDA 3726-1V48 CA: 240x330 cm'), '1V48')
  assertEquals(leverancierskleurcodeUitVervolg('CABANA 5367-6Y09 CA: 160x230 cm'), '6Y09')
})

Deno.test('leverancierskleurcodeUitVervolg: geen streepje-patroon → null', () => {
  // Normale "Kleur N" — geen extra tekst tussen naam en marker.
  assertEquals(leverancierskleurcodeUitVervolg('GALAXY Kleur 21 CA: 60x90 cm'), null)
  // "Kl.NN"-parse-artefact: bevat toevallig een cijfer maar geen streepje —
  // inhoudelijk identiek aan kleur_code, dus geen nieuwe info.
  assertEquals(leverancierskleurcodeUitVervolg('SILVER SPRING Kl.24 CA: 200x290 cm'), null)
  // Los dessin-/patroonnummer zonder streepje.
  assertEquals(leverancierskleurcodeUitVervolg('ROMANCE 1200 Kleur 41 CA:068x220 cm'), null)
  // Los kleurnummer zonder streepje.
  assertEquals(leverancierskleurcodeUitVervolg('GALAXY 10 CA: 240x340 cm ORGANIC'), null)
  // Geen marker-token gevonden → geen betrouwbare grens.
  assertEquals(leverancierskleurcodeUitVervolg('PATS23XX060090'), null)
  assertEquals(leverancierskleurcodeUitVervolg(''), null)
  assertEquals(leverancierskleurcodeUitVervolg(null), null)
  assertEquals(leverancierskleurcodeUitVervolg(undefined), null)
})
```

- [ ] **Step 2: Run de tests en verifieer dat ze falen**

Run: `deno test supabase/functions/_shared/kwaliteit-naam.test.ts`
Expected: FAIL — `leverancierskleurcodeUitVervolg` bestaat niet (`does not provide an export named 'leverancierskleurcodeUitVervolg'` of vergelijkbare module-fout).

- [ ] **Step 3: Implementeer `leverancierskleurcodeUitVervolg` in `supabase/functions/_shared/kwaliteit-naam.ts`**

Vervang de volledige inhoud van dit bestand (huidig 32 regels) door:

```ts
// Kwaliteitsnaam + leveranciers-kleurcode uit `producten.vervolgomschrijving` —
// gedeelde pure helpers (ADR-0033). Eén bron voor het verzendlabel (frontend
// shipping-label-data.ts, besluit 2026-06-18) én de factuur-PDF (kwaliteitnaam
// − afmeting op de regel).
//
// Géén DB/netwerk — puur tekst-parsing, los te unit-testen.

// Tokens die het einde van de kwaliteitsnaam markeren in vervolgomschrijving:
// "Kleur"/"Farbe"/"Kl."/"CA:" (NL + DE varianten uit de oude-systeem-import).
const KWALITEIT_MARKER = /^(kleur|farbe|kl\.?|ca[:.]?)$/i

// Sommige leveranciers stickeren hun rollen met een EIGEN kleurcode die niet
// overeenkomt met Karpi's interne kleur_code (mail Pick & Ship 2026-07-01:
// Sofia 80x150 toont intern "13", de fysieke rol draagt sticker "G305"). Die
// code staat dan als extra token TUSSEN de kwaliteitsnaam en de marker:
// "SOFIA 3726-G305 CA: 080x150 cm" — "3726" is een leveranciers-/collectie-
// referentie, "G305" (ná de streep) is de kleurcode die op de sticker moet.
// Patroon geverifieerd tegen alle 21.801 vaste/staaltje-producten (2026-07-01):
// matcht exact de 280 producten (18 kwaliteiten) met een echte alternatieve
// kleurcode, en NUL van de overige "extra tekst"-varianten (losse dessin-
// nummers als "1200", parse-artefacten als "Kl.63", vrije ruis).
const LEVERANCIERS_KLEURCODE = /^\d{3,6}-([0-9A-Za-z]{2,6})$/

interface VervolgSegmenten {
  /** Kwaliteitsnaam (leidende woorden tot het eerste cijfer/marker-token). */
  naam: string | null
  /**
   * Ruwe tekst tussen het einde van de naam en het marker-token, of `null`
   * als die er niet is óf er geen marker-token gevonden werd (geen
   * betrouwbare grens → geen extra info tonen).
   */
  extra: string | null
}

/**
 * Splitst vervolgomschrijving in kwaliteitsnaam + eventuele extra tekst vóór
 * de "Kleur"/"Farbe"/"Kl."/"CA:"-marker. Interne tokenizer, gedeeld door
 * `kwaliteitNaamUitVervolg` en `leverancierskleurcodeUitVervolg` zodat beide
 * exact dezelfde grens hanteren.
 */
function segmenteerVervolg(vervolg: string | null | undefined): VervolgSegmenten {
  if (!vervolg) return { naam: null, extra: null }
  const tokens = vervolg.replace(/\s+/g, ' ').trim().split(' ')

  const naamWoorden: string[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (/\d/.test(token) || KWALITEIT_MARKER.test(token)) break
    naamWoorden.push(token)
    i++
  }
  const naam = naamWoorden.join(' ').trim() || null

  const extraWoorden: string[] = []
  let j = i
  while (j < tokens.length && !KWALITEIT_MARKER.test(tokens[j])) {
    extraWoorden.push(tokens[j])
    j++
  }
  // Alleen als er ECHT een marker-token ná de extra-tekst gevonden is, is de
  // grens betrouwbaar — anders (bv. een kale artikelcode zonder "CA:") geen
  // extra info retourneren.
  const markerGevonden = j < tokens.length
  const extra = markerGevonden ? extraWoorden.join(' ').trim() || null : null

  return { naam, extra }
}

/**
 * Haal de kwaliteitsnaam uit `producten.vervolgomschrijving`.
 *
 * Het oude systeem schreef die als "{KWALITEITNAAM} Kleur {nr} CA: {maat} cm"
 * (varianten: "Farbe"/"Kl."/los kleurnummer/artikelcode). De naam = de leidende
 * woorden tot het EERSTE token dat een cijfer bevat of een kleur-/CA-marker is.
 * Geverifieerd op 18.181 vaste producten: 0 lekken een code/cijfer, 23 leveren
 * geen naam (vallen terug op het oude labelgedrag).
 *
 * Bron-keuze (2026-06-18): `kwaliteiten.omschrijving` was de logische plek maar
 * staat in de hele DB leeg (997/997 NULL); `vervolgomschrijving` is gevuld voor
 * 99,9% van de vaste producten.
 */
export function kwaliteitNaamUitVervolg(vervolg: string | null | undefined): string | null {
  return segmenteerVervolg(vervolg).naam
}

/**
 * Haal de leveranciers-kleurcode uit `producten.vervolgomschrijving`, of
 * `null` als die er niet is (de overgrote meerderheid van de producten).
 *
 * Herkenning (2026-07-01, mail Pick & Ship): de extra tekst tussen naam en
 * marker moet EXACT het patroon "{3-6 cijfers}-{2-6 alfanumeriek}" volgen (bv.
 * "3726-G305") — dat sluit dessin-nummers ("1200"), "Kl.NN"-parse-artefacten
 * en vrije ruis uit (matchen dit patroon niet, of bevatten spaties). Retourneert
 * alleen het deel NÁ de streep ("G305"), niet de leveranciers-/collectie-
 * referentie ervoor — dát is de code die op de sticker hoort.
 */
export function leverancierskleurcodeUitVervolg(vervolg: string | null | undefined): string | null {
  const { extra } = segmenteerVervolg(vervolg)
  if (!extra) return null
  const match = LEVERANCIERS_KLEURCODE.exec(extra)
  return match ? match[1] : null
}
```

- [ ] **Step 4: Run de tests en verifieer dat ze slagen**

Run: `deno test supabase/functions/_shared/kwaliteit-naam.test.ts`
Expected: PASS — 4 tests groen (de 2 bestaande + de 2 nieuwe).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/kwaliteit-naam.ts supabase/functions/_shared/kwaliteit-naam.test.ts
git commit -m "feat(label): leverancierskleurcode parsen uit vervolgomschrijving"
```

---

### Task 3: Integratie in het verzendlabel

**Files:**
- Modify: `frontend/src/modules/logistiek/lib/shipping-label-data.ts`
- Test: `frontend/src/modules/logistiek/lib/shipping-label-data.test.ts`

- [ ] **Step 1: Voeg de failing tests toe aan `shipping-label-data.test.ts`**

Wijzig het importblok bovenaan (regel 2-7) van:
```ts
import {
  labelProductRegels,
  kwaliteitNaamUitVervolg,
  klantNaamWijktAf,
  vormUitOmschrijving,
} from './shipping-label-data'
```
naar:
```ts
import {
  labelProductRegels,
  kwaliteitNaamUitVervolg,
  leverancierskleurcodeUitVervolg,
  klantNaamWijktAf,
  vormUitOmschrijving,
} from './shipping-label-data'
```

Voeg in het bestaande blok `describe('labelProductRegels — vaste maat', ...)` een nieuwe test toe, direct ná de test `'laat het kleurnummer weg als kleur_code ontbreekt'` (rond regel 88):

```ts
  it('toont de leverancierskleurcode achter het kleurnummer als vervolgomschrijving die bevat (Sofia)', () => {
    const regel = maakRegel(
      maakOrderRegel({
        producten: {
          ...product,
          vervolgomschrijving: 'SOFIA 3726-G305 CA: 080x150 cm',
          kleur_code: '13',
          karpi_code: 'SOFI13XX080150',
          lengte_cm: 80,
          breedte_cm: 150,
        },
      }),
    )
    expect(labelProductRegels(regel).groot).toBe('SOFIA (13 – G305) 080x150 cm')
  })
```

Voeg daarna een nieuw, los `describe`-blok toe vlak vóór `describe('klantNaamWijktAf — pakbon "Uw naam"-zichtbaarheid', ...)` (rond regel 250-251), dat de pure functie tabel-gewijs test (spiegelt het bestaande `kwaliteitNaamUitVervolg`-blok):

```ts
describe('leverancierskleurcodeUitVervolg — leveranciers-kleurcode uit vervolgomschrijving', () => {
  // Echte gevallen uit de productdata (2026-07-01, mail Pick & Ship).
  const gevallen: Array<[string | null, string | null]> = [
    ['SOFIA 3726-G305 CA: 080x150 cm', 'G305'],
    ['MANDA 3726-1V48 CA: 240x330 cm', '1V48'],
    ['CABANA 5367-6Y09 CA: 160x230 cm', '6Y09'],
    ['GALAXY Kleur 10 CA: 200x290 cm', null], // normale "Kleur N", geen extra tekst
    ['SILVER SPRING Kl.24 CA: 200x290 cm', null], // "Kl.NN"-parse-artefact, geen streepje
    ['ROMANCE 1200 Kleur 41 CA:068x220 cm', null], // los dessin-nummer, geen streepje
    ['GALAXY 10 CA: 240x340 cm ORGANIC', null], // los kleurnummer, geen streepje
    [null, null],
    ['', null],
  ]
  for (const [invoer, verwacht] of gevallen) {
    it(`"${invoer}" -> ${verwacht === null ? 'null' : `"${verwacht}"`}`, () => {
      expect(leverancierskleurcodeUitVervolg(invoer)).toBe(verwacht)
    })
  }
})

```

- [ ] **Step 2: Run de tests en verifieer dat ze falen**

Run (vanaf `frontend/`): `npx vitest run src/modules/logistiek/lib/shipping-label-data.test.ts`

Als `vitest` niet gevonden wordt ("'vitest' is not recognized"), zijn de dependencies niet (volledig) geïnstalleerd in deze worktree — draai eerst `npm install` in `frontend/` en probeer opnieuw.

Expected: FAIL — `leverancierskleurcodeUitVervolg` is geen export van `./shipping-label-data` (TypeScript/module-fout), en de nieuwe `it(...)`-test voor Sofia faalt met de oude waarde `'SOFIA (13) 080x150 cm'` i.p.v. de verwachte `'SOFIA (13 – G305) 080x150 cm'`.

- [ ] **Step 3: Werk de re-export bij in `shipping-label-data.ts`**

Wijzig regel 5-9 van:
```ts
// kwaliteitNaamUitVervolg leeft sinds 2026-06-18 in _shared/ (ADR-0033): één
// bron voor het label én de factuur-PDF. Cross-root re-export houdt de bestaande
// import `from './shipping-label-data'` (o.a. de test) ongewijzigd.
import { kwaliteitNaamUitVervolg } from '../../../../../supabase/functions/_shared/kwaliteit-naam'
export { kwaliteitNaamUitVervolg } from '../../../../../supabase/functions/_shared/kwaliteit-naam'
```
naar:
```ts
// kwaliteitNaamUitVervolg/leverancierskleurcodeUitVervolg leven sinds
// 2026-06-18 (resp. 2026-07-01) in _shared/ (ADR-0033): één bron voor het
// label én de factuur-PDF. Cross-root re-export houdt de bestaande import
// `from './shipping-label-data'` (o.a. de test) ongewijzigd.
import {
  kwaliteitNaamUitVervolg,
  leverancierskleurcodeUitVervolg,
} from '../../../../../supabase/functions/_shared/kwaliteit-naam'
export {
  kwaliteitNaamUitVervolg,
  leverancierskleurcodeUitVervolg,
} from '../../../../../supabase/functions/_shared/kwaliteit-naam'
```

- [ ] **Step 4: Werk `vasteMaatRegels()` bij**

Vervang de functie (huidig regel 79-109, inclusief de JSDoc erboven) van:
```ts
/**
 * Vaste-maat-formaat, of `null` als het niet van toepassing is — dan valt de
 * caller terug op het oude gedrag.
 *
 * Grote regel (besluit 2026-06-18, verzoek Thom): kwaliteitsnaam, kleurnummer
 * tussen haakjes, maat en — als de uitvoering afwijkt — de vorm. Voorbeeld:
 * "GALAXY (10) 200x290 cm Organisch". Ronde karpetten tonen de diameter:
 * "PLUSH (11) Ø120 cm Rond". Zo ziet de picker kleur én uitvoering. Kleine
 * regel = de Karpi-code.
 *
 * Kleurnummer en vorm zijn beide optioneel: ontbreekt het kleurnummer of is de
 * uitvoering gewoon rechthoekig (geen vorm-token), dan valt dat deel weg.
 */
function vasteMaatRegels(regel: ZendingPrintRegel | null): LabelProductRegels | null {
  const orderRegel = regel?.order_regels
  if (!orderRegel || orderRegel.is_maatwerk) return null
  const product = orderRegel.producten
  if (!product) return null
  const kwaliteit = kwaliteitNaamUitVervolg(product.vervolgomschrijving)
  const lengte = product.lengte_cm
  if (!kwaliteit || !lengte) return null
  const kleur = (product.kleur_code ?? '').trim()
  const vorm = vormUitOmschrijving(product.vervolgomschrijving ?? product.omschrijving)
  const maat = maatWeergave(lengte, product.breedte_cm, vorm)
  if (!maat) return null
  const klein = (product.karpi_code ?? regel?.artikelnr ?? '').trim() || null
  const groot = [kwaliteit, kleur ? `(${kleur})` : '', maat, vorm ?? '']
    .filter(Boolean)
    .join(' ')
  return { groot, klein }
}
```
naar:
```ts
/**
 * Vaste-maat-formaat, of `null` als het niet van toepassing is — dan valt de
 * caller terug op het oude gedrag.
 *
 * Grote regel (besluit 2026-06-18, verzoek Thom): kwaliteitsnaam, kleurnummer
 * tussen haakjes, maat en — als de uitvoering afwijkt — de vorm. Voorbeeld:
 * "GALAXY (10) 200x290 cm Organisch". Ronde karpetten tonen de diameter:
 * "PLUSH (11) Ø120 cm Rond". Zo ziet de picker kleur én uitvoering. Kleine
 * regel = de Karpi-code.
 *
 * Kleurnummer en vorm zijn beide optioneel: ontbreekt het kleurnummer of is de
 * uitvoering gewoon rechthoekig (geen vorm-token), dan valt dat deel weg.
 *
 * Leveranciers-kleurcode (2026-07-01, mail Pick & Ship): bij 18 kwaliteiten
 * (bv. Sofia) draagt de fysieke rol een sticker van de leverancier met een
 * eigen kleurcode die afwijkt van Karpi's interne kleurnummer — Sofia kleur
 * "13" is bij de leverancier "G305". Die code zit verstopt in
 * `vervolgomschrijving` (`leverancierskleurcodeUitVervolg`) en wordt, als hij
 * bestaat, achter het kleurnummer getoond: "SOFIA (13 – G305) 080x150 cm". De
 * overige ~99% van de producten (geen match) blijft ongewijzigd.
 */
function vasteMaatRegels(regel: ZendingPrintRegel | null): LabelProductRegels | null {
  const orderRegel = regel?.order_regels
  if (!orderRegel || orderRegel.is_maatwerk) return null
  const product = orderRegel.producten
  if (!product) return null
  const kwaliteit = kwaliteitNaamUitVervolg(product.vervolgomschrijving)
  const lengte = product.lengte_cm
  if (!kwaliteit || !lengte) return null
  const kleur = (product.kleur_code ?? '').trim()
  const leverancierskleurcode = leverancierskleurcodeUitVervolg(product.vervolgomschrijving)
  const kleurWeergave = [kleur, leverancierskleurcode].filter(Boolean).join(' – ')
  const vorm = vormUitOmschrijving(product.vervolgomschrijving ?? product.omschrijving)
  const maat = maatWeergave(lengte, product.breedte_cm, vorm)
  if (!maat) return null
  const klein = (product.karpi_code ?? regel?.artikelnr ?? '').trim() || null
  const groot = [kwaliteit, kleurWeergave ? `(${kleurWeergave})` : '', maat, vorm ?? '']
    .filter(Boolean)
    .join(' ')
  return { groot, klein }
}
```

- [ ] **Step 5: Run de tests en verifieer dat ze slagen**

Run (vanaf `frontend/`): `npx vitest run src/modules/logistiek/lib/shipping-label-data.test.ts`
Expected: PASS — alle tests groen, inclusief de nieuwe Sofia-test en het nieuwe `leverancierskleurcodeUitVervolg`-blok.

- [ ] **Step 6: Draai het volledige testbestand van printset erbij (regressie-check)**

Run (vanaf `frontend/`): `npx vitest run src/modules/logistiek/lib/printset.test.ts`
Expected: PASS — dit bestand consumeert `labelProductRegels` indirect via `expandLabels`/`bouwVerzenddocument`; bevestigt dat de wijziging geen andere labelscenario's breekt.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/logistiek/lib/shipping-label-data.ts frontend/src/modules/logistiek/lib/shipping-label-data.test.ts
git commit -m "feat(label): toon leverancierskleurcode achter kleurnummer op verzendlabel"
```

---

### Task 4: Documentatie bijwerken

**Files:**
- Modify: `docs/changelog.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Voeg een changelog-entry toe bovenaan `docs/changelog.md`**

Voeg dit toe direct ná regel 1 (`# Changelog — RugFlow ERP`), vóór de bestaande `## 2026-06-24 — ...`-entry:

```markdown

## 2026-07-01 — Leveranciers-kleurcode op verzendlabel

**Waarom:** mail vanuit Pick & Ship — bij Sofia 80x150 toont het systeem bij
"kleur" alleen "13", terwijl de fysieke rol van de leverancier gestickerd is
met "G305". Data-onderzoek (21.801 vaste/staaltje-producten gescand) wees uit
dat dit bij 18 kwaliteiten voorkomt (280 producten): ANNY, ARIA, CABA, DIAN,
DREM, FAYN, ITEA, JEAS, LINE, MAND, MARG, MELW, OKSI, OPHE, ROMY, SOFI, WASI,
WELL.

- Nieuwe pure helper `leverancierskleurcodeUitVervolg` naast de bestaande
  `kwaliteitNaamUitVervolg` in `supabase/functions/_shared/kwaliteit-naam.ts`
  (ADR-0033) — herkent het patroon `{3-6 cijfers}-{2-6 alfanumeriek}` tussen de
  kwaliteitsnaam en de "CA:"-marker in `producten.vervolgomschrijving` (bv.
  "3726-G305" bij Sofia) en geeft alleen het deel ná de streep terug ("G305").
  Sluit dessin-/patroonnummers ("1200") en "Kl.NN"-parse-artefacten uit.
- `vasteMaatRegels()` (`frontend/src/modules/logistiek/lib/shipping-label-data.ts`)
  toont de code, indien aanwezig, achter het kleurnummer: "SOFIA (13 – G305)
  080x150 cm" i.p.v. "SOFIA (13) 080x150 cm". Raakt alle drie labelvarianten
  (compact/staand/DPD delen `ShippingLabel`/`labelProductRegels`).
- Geen DB-migratie, geen nieuwe kolom, geen query-uitbreiding — puur
  tekst-parsing op al-opgehaalde data.
- **Bewust niet aangeraakt:** de pakbon-PDF toont de code al correct (leest de
  rauwe `omschrijving_snapshot`/`producten.omschrijving`, waar "3726-G305" al
  in staat); de factuur-titel (`factuurProductTitel`) toont sowieso geen
  kleurcode.
```

- [ ] **Step 2: Voeg een nieuwe bullet toe aan `CLAUDE.md`**

Zoek in `CLAUDE.md` (sectie `## Bedrijfsregels`) naar de bullet die begint met `- **Label omsticker-code (OMB)...` en eindigt met `...toonde alleen de RACC-code.` Voeg er DIRECT NÁ deze bullet (zelfde sectie, zelfde bullet-lijst-niveau) een nieuwe bullet toe:

```markdown
- **Leveranciers-kleurcode op het verzendlabel (2026-07-01):** bij 18 kwaliteiten (ANNY, ARIA, CABA, DIAN, DREM, FAYN, ITEA, JEAS, LINE, MAND, MARG, MELW, OKSI, OPHE, ROMY, SOFI, WASI, WELL — 280 vaste/staaltje-producten, geverifieerd tegen de live productdata) draagt de fysieke rol een sticker van de leverancier met een EIGEN kleurcode die afwijkt van Karpi's interne `kleur_code` (mail Pick & Ship: Sofia 80x150 toont intern "13", de leverancier stickert "G305"). Die code zit verstopt in `producten.vervolgomschrijving` als extra token tussen de kwaliteitsnaam en de "CA:"-marker (bv. "SOFIA 3726-G305 CA: 080x150 cm") — herkenning via het exacte patroon `{3-6 cijfers}-{2-6 alfanumeriek}` (nieuwe pure helper `leverancierskleurcodeUitVervolg`, naast `kwaliteitNaamUitVervolg` in `_shared/kwaliteit-naam.ts`, ADR-0033), dat matcht alle 280 echte gevallen en nul van de ruis-varianten (losse dessin-nummers als "1200", "Kl.NN"-parse-artefacten). `vasteMaatRegels()` (shipping-label-data.ts) toont 'm, indien aanwezig, achter het kleurnummer: "SOFIA (13 – G305) 080x150 cm" — alleen het deel ná de streep, niet de leveranciers-/collectiereferentie ervoor. Raakt alle drie labelvarianten (compact/staand/DPD delen `ShippingLabel`). **Bewust niet aangeraakt:** de pakbon-PDF toont de code al correct (leest de rauwe `omschrijving_snapshot`/`producten.omschrijving` waar "3726-G305" al in staat); de factuur-titel (`factuurProductTitel`) toont sowieso geen kleurcode. Geen DB-migratie — puur tekst-parsing op al-opgehaalde data.
```

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md CLAUDE.md
git commit -m "docs: leveranciers-kleurcode op verzendlabel"
```

---

### Task 5: Eindverificatie

**Files:** geen wijzigingen — alleen verificatie.

- [ ] **Step 1: Draai de volledige gedeelde-module-testsuite**

Run (vanaf de repo-root): `deno test supabase/functions/_shared/`
Expected: PASS — alle bestaande `_shared`-tests blijven groen naast de nieuwe.

- [ ] **Step 2: Draai de volledige frontend-testsuite voor de logistiek-module**

Run (vanaf `frontend/`): `npx vitest run src/modules/logistiek`
Expected: PASS — alle tests in deze module (inclusief `shipping-label.test.tsx`, `printset.test.ts`, `pakbon-document.test.tsx`) blijven groen.

- [ ] **Step 3: Typecheck de frontend (build, niet `tsc --noEmit` — zie bekende valkuil)**

Run (vanaf `frontend/`): `npm run build`
Expected: build slaagt zonder TypeScript-fouten. (`tsc --noEmit -p .` alléén is hier NIET voldoende — dat project is solution-style en compileert niets; `npm run build` draait de echte `tsc -b`.)

- [ ] **Step 4: Handmatige review van de diff**

```bash
git diff main..feat/label-leverancierskleurcode
```

Controleer: alleen de 4 bestanden uit Taak 2-4 zijn gewijzigd (`kwaliteit-naam.ts`, `kwaliteit-naam.test.ts`, `shipping-label-data.ts`, `shipping-label-data.test.ts`, `docs/changelog.md`, `CLAUDE.md`). Geen migratie, geen query-wijziging.

- [ ] **Step 5: Meld gereed voor merge**

Volgens de projectconventie (CLAUDE.md, git-workflow) blijft dit op de eigen branch staan tot de gebruiker expliciet "merge maar" / "naar main" zegt — niet zelf mergen.

---

## Self-Review (uitgevoerd tijdens het schrijven van dit plan)

1. **Spec-dekking:** "uitzoeken bij hoeveel types dit voorkomt" → gedekt door de Achtergrond-sectie (18 kwaliteiten/280 producten, met namen). "alleen voor enkel die types bij de sticker" → gedekt door de regex-gate in `leverancierskleurcodeUitVervolg` (retourneert `null` voor de overige producten, dus `vasteMaatRegels()` valt terug op het oude gedrag). "goed geïntegreerd in bestaande sticker-modules" → gedekt: geen nieuwe component, hergebruik van de bestaande gedeelde `ShippingLabel`/`labelProductRegels`/`_shared/kwaliteit-naam.ts`-seam (ADR-0033), plus documentatie-update conform CLAUDE.md's "Levende documenten"-regel.
2. **Placeholder-scan:** geen "TBD"/"later"/losse verwijzingen naar niet-gedefinieerde functies — alle code-blokken zijn compleet en direct plakbaar.
3. **Type-consistentie:** `leverancierskleurcodeUitVervolg` heeft overal dezelfde signatuur (`(vervolg: string | null | undefined) => string | null`) en dezelfde naam in Task 2 (definitie), Task 3 (import/re-export/gebruik) en de tests.
