# Ontwerp — Klant-PO parsen en order automatisch uitvullen

**Datum:** 2026-05-15
**Status:** Goedgekeurd (brainstorm)
**Scope:** V1 — order-aanmaakpagina

## Probleem

Op de order-aanmaakpagina (`OrderCreatePage`) kan de gebruiker al documenten (klant-PO,
inkoopbon) bufferen vóór opslaan via `DocumentenBuffer`. Het handmatig overtypen van die
PO naar order-velden + regels kost veel tijd. Doel: één klik op een gebufferd PDF parseert
het document en vult de order-form zoveel mogelijk vooraf in — **alleen velden waarvan we
zeker zijn**, zodat het puur tijd bespaart zonder ruis van onzekere gokjes.

## Onderzochte voorbeelden

Vier reële klant-PO's met totaal verschillende lay-outs (Gero Meubelen BE, Zitmaxx,
Room108, De Groot Wonen). Bevindingen:

| Aspect | Conclusie |
|---|---|
| Klant-zijde ID | **Nooit bruikbaar.** "Klantnummer 280822" / "Leverancier nr 42185" verwijzen naar Kárpi in het systeem van de klant, niet naar onze `debiteur_nr`. |
| Debiteur identificeerbaar via | Bedrijfsnaam + e-maildomein (`geromeubelen.be`, `zitmaxx.nl`, `room108-amsterdam.nl`, `degrootwonen.nl`) + BTW-nr (BE/NL). |
| Klant-referentie | Altijd aanwezig: "Onze ref", "Ordernumber", "Inkooporder + Commissie". Commissienaam is voor sommige klanten verplicht te vermelden → samenvoegen in `klant_referentie`. |
| Leverdatum | Soms expliciete leverweek ("Leverweek verwacht: 29-2026"), vaak "ASAP"/"SUPER SPOED"/"zo spoedig mogelijk". |
| Regel-aanduiding | Zelden Karpi-artikelnr. Meestal kwaliteitnaam (PLUSH/Luxury/Cavaro/Vernon) + kleur (nummer of "Iron Grey 15") + maat (160×230 … 240×340) + soms vorm. |

**Sleutelvondst:** de DB heeft de tabellen om dit deterministisch op te lossen:
`debiteuren.btw_nummer` + e-mailkolommen; `klanteigen_namen` (reverse-lookup op
`benaming`, debiteur-/inkoopgroep-scoped) + exacte `kwaliteiten.omschrijving` mappen
klant-kwaliteitnamen → `kwaliteit_code`; `klant_artikelnummers` mapt klantcodes →
`artikelnr`; `producten`
(`karpi_code`, `kwaliteit_code`, `kleur_code`, `lengte_cm`, `breedte_cm`, `vorm`) levert
de catalogusmatch.

## Gekozen aanpak — Hybride (C)

LLM voor vormvrije extractie van **ruwe tekst** (sterk in wisselende lay-outs);
deterministische match-laag in Postgres voor de koppeling (verklaarbare, regelbare
zekerheidsgrens i.p.v. door het model verzonnen). Afgewezen: B (deterministische parser
per klant-template) — breekt bij elke lay-outwijziging, te veel onderhoud bij wisselende
formats. A (puur LLM incl. matching) — zekerheidsgrens niet beheersbaar in een prompt.

## Architectuur & flow

```
[OrderCreatePage] → DocumentenBuffer (bestaat)
   └─ nieuw: knop "📄 Order uitvullen" per buffered PDF
        │  POST { pdf-base64, bestandsnaam }
        ▼
[edge function: parse-klant-po]   (verify_jwt=false, sb_publishable-patroon)
   1. PDF → Claude API (vision+tekst) → ruwe JSON (vormvrij, geen koppeling)
   2. Deterministische match-laag via Postgres-RPC's
   3. Return: voorgestelde order-velden + per veld match_zekerheid
        ▼
[OrderForm] ← vult ALLEEN velden met zekerheid 'zeker' voor; rest leeg.
              Niets wordt opgeslagen; gebruiker reviewt en slaat zelf op.
              PDF blijft als document aan de order hangen (bestaande flow).
```

Parsing draait **server-side** in een edge function — de Anthropic API-key mag nooit in
de frontend. Volgt het bestaande edge-function + `sb_publishable`-key + `verify_jwt=false`
patroon (zie memory `project_supabase_publishable_key`).

## Extractie-laag (LLM)

Eén Claude API-call per PDF (alleen op expliciete klik — kostencontrole bij gebruiker).
Claude doet **uitsluitend vormvrije extractie**, geen koppeling/giswerk. Strak JSON-schema:

```jsonc
{
  "afzender": { "naam", "email", "btw_nummer", "kvk", "adres" },
  "klant_referentie": "ordernr, evt. + commissienaam",
  "leverdatum_tekst": "29-2026" | "ASAP" | "zo spoedig mogelijk" | null,
  "spoed": true | false,                 // "SUPER SPOED", "Urgent / Spoed"
  "afleveradres": { "naam", "adres", "postcode", "plaats", "land" },
  "factuuradres": { ... } | null,
  "regels": [{
    "aantal", "ruwe_omschrijving",
    "kwaliteit_tekst", "kleur_tekst",
    "lengte_cm", "breedte_cm", "vorm_tekst",
    "klant_artikelnr", "prijs", "korting_pct"
  }]
}
```

Prompt-caching op het vaste schema/instructie-prefix zodat herhaalde calls goedkoper zijn.
Gebruik het nieuwste Claude-model met vision (PDF-input).

## Deterministische match-laag

Elke voorgestelde waarde krijgt label `zeker` of `onzeker`. **Alleen `zeker` wordt
voorgevuld in de order-form.**

- **Debiteur** — `zeker` enkel bij precies 1 hit, in volgorde:
  1. genormaliseerd `btw_nummer` (strip spaties/punten, uppercase),
  2. exact e-maildomein tegen `email_factuur` / `email_overig` / `email_2`,
  3. exacte genormaliseerde `naam` (uppercase, whitespace-genormaliseerd).
  0 of >1 hits → `onzeker` → debiteur leeg, gebruiker kiest. Bij gekozen debiteur vult
  bestaande order-form-logica prijslijst/korting/adres al.
- **Klant-referentie** — altijd vrij tekstveld → altijd voorvullen (ordernr, evt.
  "+ Commissie X").
- **Leverweek/-datum** — patroon `WW-JJJJ` of `JJJJ-WW` → `week` + afgeleide
  `afleverdatum` (`zeker`). "ASAP"/"spoed"/"zo spoedig mogelijk" → géén datum; wel
  spoed-signaal.
- **Afleveradres/factuuradres** — vrij tekst → altijd als concept voorvullen
  (`afl_*` / `fact_*`); gebruiker verifieert.
- **Per regel:**
  1. `klant_artikelnr` aanwezig → `klant_artikelnummers` (gescoped op gematchte
     debiteur) → `artikelnr` = `zeker`.
  2. Anders: `kwaliteit_tekst` → reverse-lookup op `klanteigen_namen.benaming`
     (debiteur- óf inkoopgroep-scoped) óf exacte `kwaliteiten.omschrijving`
     → `kwaliteit_code`. Kleurcode = numeriek deel uit
     `kleur_tekst` (bv. "Iron Grey 15" → `15`, "linnen grey 13" → `13`).
  3. Met `(kwaliteit_code, kleur_code, lengte_cm, breedte_cm)`:
     - bestaat catalogus-`producten`-rij → `artikelnr` = `zeker`;
     - bestaat niet maar kwaliteit is maatwerk-bekend → vul **maatwerk-regel**
       (kwaliteit, kleur, l×b, vorm, aantal) = `zeker` op die specs.
  4. Kwaliteit niet te resolven → regel-`artikelnr` leeg; `aantal` +
     `ruwe_omschrijving` + maten wél als concept ingevuld (scheelt typen),
     gemarkeerd als "niet-gematcht".
- **Spoed** — zet de bestaande spoed-toggle voor (geen automatische spoedregel-injectie);
  toon zichtbare hint. Volgt bestaande `SPOED_PRODUCT_ID`-flow.
- **Inkooporganisatie-hint** (bv. Gero "Betalingsvoorwaarde: VME") — alleen informatief
  tonen, niet hard zetten (komt van de debiteur).

## UX

Knop per gebufferd PDF in `DocumentenBuffer`: "📄 Order uitvullen". Na parsen een korte
samenvatting bovenaan de order-form, bv.: *"Uit GW1_6092093.pdf: debiteur Gero ✓, 2 regels
(1 gematcht, 1 maatwerk-concept), leverweek onbekend."* — transparant over wat wél/niet is
overgenomen. Geen automatische opslag; gebruiker reviewt en slaat op zoals nu. PDF blijft
via de bestaande flow aan de order gekoppeld.

## Foutafhandeling

- Mislukte parse / Claude-fout / time-out → nette niet-blokkerende melding; order-form
  blijft leeg; PDF blijft in buffer.
- Geen debiteur-match → form blijft op debiteur-selectie staan; regels worden alsnog als
  concept voorgesteld waar mogelijk (kwaliteit-resolutie zonder debiteur-scope = `onzeker`,
  dus geen artikelnr-voorvulling, maar wel maten/aantal/omschrijving als concept).

## Kosten & security

- 1 Claude API-call per expliciete klik (niet automatisch bij upload).
- PDF gaat alleen naar Anthropic via de edge function; geen key in frontend;
  `verify_jwt=false` + publishable-key zoals andere Karpi-edge-functions.

## Scope-grens (YAGNI, V1)

- Geen auto-aanmaken van orders — altijd menselijke review + opslag.
- Geen overlap met EDI/Transus-spoor (apart project).
- Geen multi-PO-batch: 1 PDF → 1 order-uitvulling.
- Geen leerfeedback-loop / per-klant template-cache in V1.

## Testing

- Vier fixture-PDF's (deze voorbeelden) als regressiebasis.
- Match-laag (RPC's) puur op SQL getest met seed-data (Gero/Zitmaxx/Room108/De Groot in
  `debiteuren` + relevante `klanteigen_namen` / `klant_artikelnummers`) — deterministisch,
  geen LLM nodig.
- Extractie-laag: unit-test met gemockte Claude-respons (schema-validatie + mapping).
- End-to-end edge-function-test met gemockte Anthropic-call.

## Documentatie bij te werken na implementatie

`docs/changelog.md`, `docs/architectuur.md` (nieuwe edge function + flow),
`docs/database-schema.md` (nieuwe RPC's), eventueel een ADR voor de
"alleen-zeker-voorvullen" zekerheidsregel.
