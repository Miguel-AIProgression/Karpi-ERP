# BTW verlegd voor intracommunautaire klanten (Duitsland e.a.)

**Datum:** 2026-06-11
**Aanleiding:** mail Marjon te Kortschot (Sales Support, 2026-06-11): "De duitse klanten moeten geen BTW berekent krijgen. Deze staan nu ook allemaal op 21%."
**Status:** ontwerp goedgekeurd door Miguel (scope, BTW-nummer-omgang en PDF-vermelding expliciet afgestemd).

## Probleem

Elke debiteur heeft `debiteuren.btw_percentage` (NUMERIC, default 21.00) en sinds mig 164 een vlag `debiteuren.btw_verlegd_intracom` (BOOLEAN). De vlag staat correct op TRUE bij alle Duitse debiteuren (556 totaal, 134 actief) én bij andere EU-klanten (o.a. 67 actieve Belgische). Maar de facturatie-keten kijkt alléén naar `btw_percentage`, dat bij **iedereen** op 21 staat:

- `genereer_factuur_voor_bundel` (mig 341) — **de enige live factuur-RPC**: `genereer_factuur` (mig 227) en `genereer_factuur_voor_week` (mig 232) zijn door **mig 240 gedropt**; `factuur-verzenden` heeft nog legacy-fallback-paden naar die gedropte functies, maar die kunnen alleen falen en blijven buiten scope.
- `stuur-orderbevestiging` edge function (`Number(deb?.btw_percentage ?? 21)`) — voedt zowel de HTML-mail als de PDF-bijlage (`_shared/orderbevestiging-pdf.ts`).
- `factuur-pdf` edge function (real-time preview/download van een factuur) rendert `facturen.btw_percentage` via dezelfde `_shared/factuur-pdf.ts`.

De EDI-INVOIC-mapper (`_shared/transus-formats/factuur-mapper.ts`) en de orderbev-XML-download kijken wél al naar de verlegd-vlag en sturen 0%. Er is dus een bestaande inconsistentie: EDI-factuur zegt 0%, de opgeslagen factuur + PDF zeggen 21%.

**Schade tot nu toe: geen.** Er staan 3 facturen in productie, geen enkele aan een verlegd-debiteur met BTW > 0.

## Besluiten (afgestemd 2026-06-11)

1. **Scope: alle EU-verlegd-klanten**, niet alleen Duitsland. `btw_verlegd_intracom` wordt de bron van waarheid: verlegd → 0% BTW, anders `btw_percentage`. Dit maakt het hele systeem consistent met wat EDI al doet.
2. **Ontbrekend BTW-nummer blokkeert niet.** 17 actieve Duitse klanten hebben geen `btw_nummer`. Verlegd-vlag bepaalt het tarief; het ontbrekende nummer wordt gesignaleerd (waarschuwing op klant-detail + eenmalig lijstje voor Marjon), geen blokkade in het orderproces.
3. **Factuur-PDF toont de wettelijke vermelding "BTW verlegd"** + het BTW-nummer van de afnemer, in plaats van een 0%-BTW-regel.

Afgewezen alternatieven: (A) alleen `btw_percentage` op 0 zetten per data-update — laat twee bronnen van waarheid uiteenlopen, nieuwe Duitse klanten vallen terug op default 21, en de PDF-vermelding kan er niet mee; (C) automatische land→verlegd-afleiding bij debiteur-aanmaak — YAGNI, de UI-toggle volstaat, kan later alsnog.

## Ontwerp

### 1. Centrale regel: effectief BTW-percentage

Eén regel, op twee plekken gespiegeld (seam-patroon zoals `_shared/debiteur-matcher.ts`):

- **SQL-helper** `effectief_btw_pct(p_verlegd BOOLEAN, p_btw_percentage NUMERIC) RETURNS NUMERIC` — `CASE WHEN p_verlegd THEN 0 ELSE COALESCE(p_btw_percentage, 21.00) END`. IMMUTABLE, één migratie.
- **TS-helper** in `supabase/functions/_shared/btw.ts`: `effectiefBtwPct(deb: {btw_verlegd_intracom?: boolean|null, btw_percentage?: number|null}): number` + `isBtwVerlegd(deb): boolean`. In de frontend volstaat de vlag zelf (de klant-facturering-tab toont "effectief 0%" puur o.b.v. `btw_verlegd_intracom`); pas een frontend-kopie maken als meerdere componenten de regel nodig krijgen.

`debiteuren.btw_percentage` blijft bestaan als NL-tarief en blijft bij iedereen op 21 — **geen data-update nodig**, de verlegd-vlag staat al goed.

### 2. Snapshot op factuur

Nieuwe kolom `facturen.btw_verlegd BOOLEAN NOT NULL DEFAULT FALSE`. De RPC vult die uit `debiteuren.btw_verlegd_intracom` op factuur-aanmaak-moment (zelfde snapshot-principe als `facturen.btw_nummer`, mig 125). De PDF weet daardoor achteraf dat 0% "verlegd" betekent.

### 3. Factuur-RPC

Alleen `genereer_factuur_voor_bundel` aanpassen (laatste definitie: mig 341; de andere RPC's bestaan sinds mig 240 niet meer):
- `v_btw_pct := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);`
- `INSERT INTO facturen (..., btw_verlegd)` meenemen.
- Verder ongewijzigd: `btw_bedrag = ROUND(subtotaal × pct / 100, 2)` werkt vanzelf (0%→€0), no-op-guards en korting-/verzendkosten-logica blijven intact.

### 4. Factuur-PDF (`_shared/factuur-pdf.ts`)

`FactuurHeader` krijgt `btw_verlegd?: boolean` en `btw_nummer_afnemer?: string | null`. In `drawBtwBlok` (regel ~436): bij `btw_verlegd` géén BTW-%/BTWbedrag-waarden maar de regel **"BTW verlegd — btw-nr afnemer: {btw_nummer_afnemer}"** (bij ontbrekend nummer alleen "BTW verlegd"). Totaal = subtotaal. Beide callers vullen de nieuwe velden uit de factuur-rij: `factuur-verzenden` (stap "Bouw PDF") én de `factuur-pdf` preview-function.

### 5. Orderbevestiging-email + -PDF (`stuur-orderbevestiging`, `_shared/orderbevestiging-pdf.ts`)

Gebruikt de TS-helper i.p.v. `deb?.btw_percentage ?? 21` (debiteuren-select uitbreiden met `btw_verlegd_intracom`). Bij verlegd tonen zowel de HTML-mail als de PDF-bijlage "BTW verlegd" in plaats van een 21%-regel — nieuwe `btwVerlegd`-sleutel in het 4-talige `VERTALINGEN`-object (nl/de/fr/en; de: "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)").

### 6. Klant-detail UI (`klant-facturering-tab.tsx`)

- Toggle **"BTW verlegd (intracommunautair)"** toevoegen (patcht `btw_verlegd_intracom`).
- Bij verlegd: tonen dat het effectieve tarief 0% is (BTW%-veld blijft bewerkbaar als NL-tarief maar is dan niet van toepassing).
- Bestaande waarschuwing uitbreiden: ook waarschuwen bij `btw_verlegd_intracom = TRUE` zonder `btw_nummer`.

### 7. EDI-consistentie

`factuur-mapper.ts` en `download-orderbev-xml.ts` lezen de vlag al live van de debiteur — gedrag blijft gelijk en wordt in deze slice **niet** aangeraakt. Follow-up (backlog): factuur-mapper laten lezen van het nieuwe `facturen.btw_verlegd`-snapshot i.p.v. live debiteur-data, zodat PDF en INVOIC ook bij latere vlag-wijziging hetzelfde zeggen.

### 8. Signalering ontbrekende BTW-nummers

Eenmalig overzicht (query-output, geen UI-pagina) van actieve verlegd-debiteuren zonder `btw_nummer` voor Marjon: 17 Duitse + 1 Belgische + 1 Deense (peildatum 2026-06-11, exacte lijst bij implementatie genereren).

## Wat bewust NIET verandert

- Bestaande facturen (3 stuks, geen één fout) en bestaande orders: geen reparatie.
- `debiteuren.btw_percentage`-waarden: blijven 21, ook bij Duitse klanten.
- Geen automatische land→verlegd-afleiding bij nieuwe debiteuren.
- Geen blokkade op ontbrekend BTW-nummer.
- Order-form/order-detail: orders rekenen ex-BTW, daar verandert niets.

## Testen

- Unit-tests voor TS-helper (`effectiefBtwPct`/`isBtwVerlegd`): verlegd→0, niet-verlegd→percentage, NULL-percentage→21.
- RPC-verificatie (handmatig of script): factuur genereren voor (a) NL-debiteur → 21% + `btw_verlegd=false`, (b) Duitse verlegd-debiteur → 0%, `btw_bedrag=0`, `btw_verlegd=true`.
- PDF-snapshot: verlegd-factuur toont "BTW verlegd"-vermelding, geen BTW-regel; NL-factuur ongewijzigd.

## Documentatie bij oplevering

`database-schema.md` (kolom `facturen.btw_verlegd`, helper), `changelog.md`, bedrijfsregel-bullet in `CLAUDE.md` (BTW verlegd intracommunautair), evt. `data-woordenboek.md` ("BTW verlegd").
