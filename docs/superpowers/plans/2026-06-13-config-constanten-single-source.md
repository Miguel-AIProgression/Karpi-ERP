# Plan — Config-constanten naar single source (tech-debt categorie C)

**Datum:** 2026-06-13
**Branch:** `fix/config-constanten-single-source` (één gezamenlijke branch voor alle drie de fixes)
**Scope:** problemen 5 (Karpi-GLN), 6 (dropship-prijs), 7 (normalizeCountry) uit de tech-debt-audit "Constanten die los van hun DB-/config-bron leven".
**Buiten scope:** probleem 8 (BTW-21-fallback) — geverifieerd ruis: alle treffers staan in dode/vervangen migraties, de enige live RPC `genereer_factuur_voor_bundel` (mig 371) gebruikt al `effectief_btw_pct()`. Migratiebestanden zijn immutable history. Géén actie.

## Doel
Eén bron van waarheid per constante:
- GLN → `app_config.bedrijfsgegevens.gln_eigen`
- Dropship-prijzen → `producten.verkoopprijs`
- Landcode-normalisatie → één gedeelde seam, gespiegeld op de SQL-bron `normaliseer_land` (mig 214)

## Volgorde
Fase 1 (normalizeCountry) eerst — hoogste correctheids-risico. Daarna 2 (Rhenus-GLN, klein) en 3 (dropship-prijs). Alles op dezelfde branch, één merge.

---

## Fase 1 — `normalizeCountry` consolideren (probleem 7) 🔴

### Probleem
Vijf forward-normalisatoren (landnaam → ISO-2) die divergeren. De ergste: `factuur-verzenden/index.ts:813` (EDI INVOIC) kent alleen NL+DE en valt terug op `slice(0,2)` → **Oostenrijk→`OO`, Zwitserland→`ZW`, Spanje→`SP`, Polen→`PO`, Engeland→`EN`** op de elektronische factuur. Twee factuur-EDI-paden (index.ts én factuur-mapper.ts) normaliseren verschillend. De SQL-functie `normaliseer_land` (mig 214) is de meest complete (16 landen, diakriet-strip, ISO2-passthrough) = de gouden bron.

### Aanpak
De seam `supabase/functions/_shared/adres-split.ts` (al ADR-0033, `splitAdres`/`normalizeCountry`, gebruikt door HST/Verhoek/Rhenus) wordt dé enige TS-bron. We breiden zijn `normalizeCountry` uit tot de volledige `normaliseer_land`-lijst en hangen de drie edge-duplicaten eraan. De frontend-variant schakelt om via cross-root shim met behoud van zijn `null`-contract. De SQL-functie blijft bestaan; SQL↔TS-sync borgen we met een golden-file-contracttest (patroon `bundel-sleutel.golden.json`).

### Stappen
1. **Seam uitbreiden** — `_shared/adres-split.ts:46` `normalizeCountry`:
   - Voeg alle mappings uit mig 214 toe: NL, BE (+BELGIQUE), DE (+DEUTSCHLAND), FR (+FRANCE), LU (+LUXEMBOURG), AT (+AUSTRIA, OSTERREICH), CH (+SCHWEIZ), IT (+ITALIA), ES (+ESPANA), PL (+POLSKA), CZ, DK (+DANMARK), SE (+SVERIGE), NO (+NORGE), GB (+ENGELAND, UNITED KINGDOM), IE. Plus Engelstalige NL/DE varianten (NETHERLANDS, HOLLAND, GERMANY).
   - Diakriet-strip vooraf (NFD, zoals frontend `landNaarIso2`), zodat BELGIË/OOSTENRIJK zonder accent-varianten werken.
   - ISO-2-passthrough behouden. Fallback = uppercased input (huidig seam-contract, lenient).
2. **Golden fixtures** — `_shared/__tests__/golden/normaliseer-land.golden.json` (of naast bestaande golden-map): inputlijst (alle 16 landen × NL/EN/lokale spelling + ISO2-input + onbekend) → verwachte ISO2.
3. **Contracttest TS** — breid `_shared/adres-split.test.ts` uit: toets `normalizeCountry` tegen de golden fixtures (dekt nu alleen NL/DE).
4. **Contracttest SQL** — nieuwe migratie `387_assert_normaliseer_land_contract.sql`: `assert_normaliseer_land_contract()` die dezelfde golden-inputs door `normaliseer_land` haalt en vergelijkt (mirror van `assert_bundel_sleutel_contract`). Laat falen als SQL en golden divergeren.
5. **Edge-duplicaten verwijderen + omhangen:**
   - `factuur-verzenden/index.ts:813` — def verwijderen; import uit `../_shared/adres-split.ts`. **Let op de `fallback`-parameter:** B had `normalizeCountry(value, fallback)`. Houd de fallback-keuze bij de 4 call-sites (744/760/773/791): `normalizeCountry(value || fallback)`.
   - `_shared/transus-formats/factuur-mapper.ts:163` — `normaliseerLand` def verwijderen; import uit seam (relatief pad). Call-sites 137/156.
   - `_shared/factuur-pdf.ts:194` — `naarLandCode` def verwijderen; import uit seam. Call-site 361 (Karpi's eigen adres, altijd NL — cosmetisch maar consistent).
6. **Frontend omschakelen** — `frontend/src/lib/utils/land-vlag.ts:45` `landNaarIso2`: herimplementeren als dunne wrapper bovenop de seam via cross-root re-export-shim (ADR-0033, zoals `@/lib/orders/vervoerder-eisen`). **Behoud het `null`-contract** (vlag-emoji-logica heeft `null` bij onbekend nodig): wrapper geeft `null` als seam de input ongewijzigd teruggeeft.
7. **Verificatie:** `npm run typecheck` (frontend), Deno-tests (`adres-split.test.ts`), mig 388 contract groen. Handmatig: factuur-EDI voor een AT/CH/ES-debiteur produceert nu correcte ISO2.

### Niet doen
- Reverse display-maps (`iso2NaarNaam`, `LAND_NAMEN` in pakbon, `formatLand` in XLS) — ander concern (code→naam), laten staan.
- SQL `normaliseer_land` zelf herschrijven — alleen de golden-sync toevoegen.

---

## Fase 2 — Rhenus-GLN uit config (probleem 5) 🟠

### Probleem
`rhenus-send/xml-builder.ts:174` gebruikt de hardcoded module-constante `KARPI_GLN` voor de SBDH `<sh:InstanceIdentifier>` (afzender-GLN), terwijl álle andere outbound-kanalen `app_config.bedrijfsgegevens.gln_eigen ?? fallback` lezen. GLN-wijziging zou stil een verkeerde afzender op alle Rhenus-vrachtbrieven zetten.

### Aanpak
De orchestrator `rhenus-send/index.ts:155-156` haalt `app_config.bedrijfsgegevens` al op en geeft `bedrijfRow.waarde` als `bedrijf` door aan `bouwRhenusXml` (`:224`). Alleen `gln_eigen` ontbreekt in het type. Mechanisch kleine fix, geen orchestrator-fetch-wijziging.

### Stappen
1. **Type uitbreiden** — `rhenus-send/types.ts:23-31` `BedrijfInput`: voeg `gln_eigen?: string` toe.
2. **Builder-fix** — `rhenus-send/xml-builder.ts:174`: `bedrijf.gln_eigen ?? KARPI_GLN` (constante blijft als fallback, conform referentiepatroon van `bouw-verzendbericht-edi`).
3. **Proef-XML** — `rhenus-send/genereer-proef-xml.ts:64-67` roept de builder aan met dezelfde shape; controleer dat ook die een `gln_eigen` kan doorgeven (of via fallback groen blijft).
4. **Test** — `xml-builder.test.ts:83` asserteert de GLN; fixture (`:13`) heeft `bedrijf` zonder `gln_eigen` → blijft groen via fallback. Voeg één test toe die `gln_eigen` doorgeeft en assert dat die in de SBDH landt.
5. **Deploy** — `supabase functions deploy rhenus-send --project-ref wqzeevfobwauxkalagtn` (handmatig, conform reference-memory).

### Optioneel (alleen als tijd over) — gedeelde GLN-helper
4 outbound-paden herhalen de literal `'8715954999998'` als fallback. Optioneel: pure `_shared/bedrijfsgegevens.ts` met `effectiefGlnEigen(bedrijf?: {gln_eigen?: string}): string`, geconsumeerd door bouw-verzendbericht-edi / bouw-factuur-edi / factuur-verzenden / rhenus. **Lage DRY-winst** (kanalen halen bedrijfsgegevens toch al op) → alleen als de fase verder snel klaar is, anders overslaan. Frontend `KARPI_GLN_DEFAULT`-constanten zijn parser-validatie-defaults → niet aanraken.

### Buiten scope
GS1-prefix `8715954` in mig 209 (`genereer_sscc`) = ander concept (SSCC-barcode, niet locatie-GLN). Niet koppelen aan `gln_eigen`.

---

## Fase 3 — Dropship-prijs uit DB (probleem 6) 🟡

### Probleem
`DROPSHIP_KLEIN_PRIJS=35.00` / `DROPSHIP_GROOT_PRIJS=47.50` in `frontend/src/lib/constants/dropshipment.ts` staan dubbel naast `producten.verkoopprijs` (geseed mig 353/363). Bij order-opslag schrijft `order-mutations.ts:214` de TS-prijs verbatim (`r.prijs ?? null`) — de DB-prijs komt nergens in beeld. Mig 363 corrigeerde de DB; de TS-constant moest handmatig mee. Divergentie-risico is reëel en al één keer gebeurd.

### Aanpak
Lees beide prijzen uit `producten.verkoopprijs`. Behoud de `*_ID`-constanten (legitieme identifiers, zoals `SHIPPING_PRODUCT_ID`). **Gekozen: optie B (dedicated hook)** — lichter dan de resolver async maken, en het pad blijft puur-functie-vriendelijk via prefetch.

### Stappen
1. **Query + hook** — nieuwe query in `frontend/src/lib/supabase/queries/`: `fetchDropshipPrijzen()` → `producten` op `artikelnr IN ('DROPSHIP-KLEIN','DROPSHIP-GROOT')` → `{ klein: number, groot: number }`. Hook `useDropshipPrijzen()` (React Query, ruime `staleTime` — prijzen wijzigen zelden; invalidatie niet kritiek).
2. **Constanten opschonen** — `dropshipment.ts`: verwijder `DROPSHIP_KLEIN_PRIJS` / `DROPSHIP_GROOT_PRIJS`. Behoud `DROPSHIP_KLEIN_ID` / `DROPSHIP_GROOT_ID` / `DropshipmentKeuze`.
3. **Logica injecteren** — `dropshipment-regel.ts:78` `applyDropshipmentLogic`: prijs als parameter binnenkrijgen i.p.v. uit constante lezen. Signatuur: `applyDropshipmentLogic(regels, keuze, prijzen)`. Blijft synchroon/puur (prefetch via hook).
4. **Order-form** — `order-form.tsx:206` `handleDropshipChange`: lees `prijzen` uit `useDropshipPrijzen()` en geef door aan `applyDropshipmentLogic`. Loading-state afhandelen (knop disabled / hint tot prijzen geladen).
5. **Selector** — `dropshipment-selector.tsx:12-13,47`: prijs-badges (`formatCurrency(opt.prijs)`) voeden uit de hook i.p.v. constante.
6. **Fallback/guard** — bij query-fail of `verkoopprijs IS NULL`: niet stil €0/`null` opslaan. Loading-state in selector; weiger opslaan met heldere melding. Overweeg een laatste hardcoded fallback áchter een waarschuwing (eenmalig, niet de primaire bron).
7. **Factuur-consistentie bevestigen** — `genereer_factuur_voor_bundel` gebruikt de opgeslagen `order_regels.prijs` (snapshot). Reeds opgeslagen orders blijven dus ongewijzigd; alleen nieuwe orders pikken de nieuwe DB-prijs op — gewenst gedrag, expliciet verifiëren.
8. **Test** — `dropshipment-regel.test.ts` (indien aanwezig) bijwerken voor de nieuwe signatuur. `npm run typecheck`.

### Raakt bestaand spoor
`docs/superpowers/plans/2026-06-12-dropship-detectie-data-driven.md` behandelt de detectie-kant (`is_dropship`). Dit prijs-werk is de logische vervolgstap op hetzelfde ADR-0018-spoor — daar refereren.

---

## Merge & verificatie (alle fasen)
1. `npm run typecheck` (frontend) groen — let op PD-branch-precedent (typecheck vóór merge).
2. Deno-tests: `adres-split.test.ts`, `xml-builder.test.ts` (rhenus).
3. Mig 387 contract-assert groen op de DB (handmatig toepassen — geen `db push`).
4. Edge-functions deployen: `rhenus-send`, `factuur-verzenden` (+ eventueel bouw-factuur-edi als die de seam importeert).
5. Merge conform git-workflow: branch → `git push origin fix/config-constanten-single-source:main` (niet via lokale main-ref; merge-race-precedent).
6. Docs bijwerken: `changelog.md` + korte noot in CLAUDE.md bij de relevante secties (landcode-seam, dropship, GLN). Probleem 8 als "ruis/opgelost" noteren.

## Open vragen / risico's
- **Fase 1 `null`-contract frontend:** `landNaarIso2` moet `null` blijven geven bij onbekend (vlag-logica). De lenient seam geeft uppercased input terug — de wrapper moet dat naar `null` mappen. Verificatie met een onbekend-land-test.
- **Fase 3 async-timing:** `applyDropshipmentLogic` blijft puur dankzij prefetch. Als de hook nog niet geladen is bij keuze, moet de UI dat afvangen (niet met stale/0-prijs opslaan).
- **Fase 1 dubbele factuur-EDI-paden:** controleer welk pad (index.ts vs factuur-mapper.ts) live is voor welke partner — beide moeten na consolidatie identiek normaliseren.
