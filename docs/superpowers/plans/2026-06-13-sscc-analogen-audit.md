# Audit: SSCC-analogen — afgeleide colli-/zending-data uit meerdere bronnen

**Datum:** 2026-06-13
**Aanleiding:** de SSCC-fix (12-06, commit a046e88) loste één instantie op van een terugkerend patroon: dezelfde fysieke colli-eigenschap wordt op meerdere plekken onafhankelijk afgeleid uit verschillende bronnen (live join vs. snapshot vs. runtime-berekening), waardoor label, pakbon, vervoerder-payload en EDI-bericht voor hetzelfde collo uiteenlopen. Deze audit brengt álle resterende analogen in kaart vóór we de scope van een vervolgtraject vastzetten.

**Methode:** vier parallelle read-only verkenningen — (1) frontend print/document-laag, (2) de drie vervoerder-adapters, (3) uitgaande EDI-berichten, (4) de snapshot-infrastructuur op `zendingen`/`zending_colli`/`facturen`. Bevindingen hieronder zijn gefilterd: by-design-verschillen en ongeverifieerde subagent-claims staan apart van de echte divergenties.

**Het patroon (referentie — hoe de SSCC-fix het oploste):** één canonieke bron (`zending_colli.sscc`, DB-sequence), die zowel het geprinte label als de vervoerder-aanmelding lezen; client-side generatie verwijderd; `null` i.p.v. een niet-aangemelde waarde; regressietest (`printset.test.ts`). Zie CLAUDE.md-bullet "Verzendlabel-SSCC = `zending_colli.sscc`, één bron".

---

## Catalogus

### 🔴 A1 — Productomschrijving (klant-zichtbaar)

Drie geprinte/verzonden representaties van hetzelfde collo putten uit verschillende bronnen, met zelfs verschillende ontdubbel-algoritmes:

| Kanaal | Bron | Timing | Ontdubbeling |
|---|---|---|---|
| Verzendlabel (compact + tall) | live `order_regels.omschrijving` + `_2` + `producten.omschrijving` | runtime | substring-match ([shipping-label-data.ts:16-23](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts#L16-L23)) |
| Pakbon | live, zelfde velden | runtime | **géén** ([pakbon-document.tsx:20-28](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx#L20-L28)) |
| DPD-label | live, **eigen** `omschrijvingVoorRegel` | runtime | derde variant ([dpd-shipping-label.tsx:18-42](../../../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx#L18-L42)) |
| HST | snapshot `zending_colli.omschrijving_snapshot` | bevroren bij pickronde | n.v.t. ([payload-builder.ts:88](../../../supabase/functions/hst-send/payload-builder.ts#L88)) |
| Verhoek | snapshot, zelfde kolom | bevroren | n.v.t. ([xml-builder.ts:132](../../../supabase/functions/verhoek-send/xml-builder.ts#L132)) |
| Rhenus | géén item-omschrijving (`cargoTypeDescription` leeg) | — | — |

**Belangrijk substiliteit:** de snapshot (`compose_colli_omschrijving`, [mig 209:223-261](../../../supabase/migrations/209_zending_colli_sscc.sql)) bevat alléén het Karpi-product + maat ("Egyptische Wol 240x330 cm" of "MAATW. SISAL-GOLD 160x090 cm, KI21 Band:KI21"). De **klant-omschrijving** (`order_regels.omschrijving`/`_2`) die label en pakbon nu apart tonen, zit er **niet** in. Naïef "label leest de snapshot" zou dus UI-informatie laten vallen — de snapshot moet eerst verrijkt worden.

**Risico:** na een productnaamwijziging tonen label, pakbon en vrachtbrief drie verschillende teksten; label en pakbon verschillen zélfs zonder wijziging door het ontdubbel-verschil.

---

### 🔴 C — Colli-afmetingen (structureel identiek aan de SSCC-bug)

`zending_colli` heeft **geen** dimensie-kolommen (lengte/breedte/hoogte). Elke vervoerder leidt afmetingen zelf af:

| Vervoerder | Bron | Eenheid/veld |
|---|---|---|
| HST | **hardcoded** `DEFAULT_LENGTH_CM=120`, `WIDTH=80`, `HEIGHT=20` | cm ([payload-builder.ts:33-35](../../../supabase/functions/hst-send/payload-builder.ts#L33-L35)) |
| Rhenus | live join `order_regels.maatwerk_* → producten.*` | `dimension/depth` (alleen lengte) |
| Verhoek | live join idem | `Lengte`/`Breedte` + berekend `Oppervlak` |

**Risico:** HST stuurt fysiek verzonnen maten (120×80×20) voor tapijtrollen; bij latere order_regel-/product-wijziging divergeren Rhenus/Verhoek t.o.v. wat bij pickronde gold. ⚠️ `hoogte` heeft nergens in het schema een bron — alleen lengte/breedte zijn afleidbaar. **Niet in scope** van het huidige plan (besluit 2026-06-13), maar bewust gedocumenteerd als bekende open analoog.

---

### 🟡 A2 — Gewicht (data-fix elders; architectuur open)

| Vervoerder | Bron | Eenheid | NULL-gedrag |
|---|---|---|---|
| HST | per-colli `zending_colli.gewicht_kg`; **fallback** `zendingen.totaal_gewicht_kg` bij 0 colli | kg | → 1 kg default ([payload-builder.ts:93,109](../../../supabase/functions/hst-send/payload-builder.ts#L93)) |
| Rhenus | runtime `SUM(zending_colli.gewicht_kg)` | kg | → 0, preflight blokkeert ([xml-builder.ts:156](../../../supabase/functions/rhenus-send/xml-builder.ts#L156)) |
| Verhoek | per-colli `naarDecagram()` | **decagram** | → lege tag, preflight blokkeert ([xml-builder.ts:139](../../../supabase/functions/verhoek-send/xml-builder.ts#L139)) |

`zendingen.totaal_gewicht_kg` (HST-fallback) wordt **nooit** gesynct met `SUM(zending_colli.gewicht_kg)`.

**Verdeling:** de **datakwaliteit** (cache-vervuiling density-i.p.v.-stukgewicht, NULL/0-colli) wordt opgelost door [2026-06-12-colli-gewicht-fix.md](2026-06-12-colli-gewicht-fix.md) (mig 383, andere agent — loopt). De **architecturale bron-divergentie** (welke bron is canoniek over de 3 vervoerders + totaal-sync) blijft open en hoort bij dit traject — **mits gecoördineerd** met de gewicht-agent.

---

### 🟡 D — Label-datum inconsistent

Compact/tall-labels tonen `datumKort()` = **de datum waarop geprint wordt** ([shipping-label-data.ts:35-41](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts#L35-L41)); het DPD-label toont `zending.verzenddatum ?? created_at` ([dpd-shipping-label.tsx:127](../../../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx#L127)). Een herprint dagen later toont op compact/tall een andere datum dan de vervoerder kreeg.

### 🟡 E — Label-referentie inconsistent

Het DPD-label gebruikt `zending.id` als footer-referentie; compact/tall gebruiken `order.oud_order_nr ?? order.id`. Verschillende referentie-ankers voor dezelfde fysieke zending.

---

## Bewust buiten het patroon

- **F — Adres-split:** HST splitst in 4 velden (`StreetNumberAddition` ≤5 chars), Verhoek in 2, Rhenus laat het als één regel. Dit is **by-design** — elk vervoerder-format eist een andere adresstructuur; de gedeelde seam [`adres-split.ts`](../../../supabase/functions/_shared/adres-split.ts) wordt correct verschillend toegepast. Geen actie.
- **G — GTIN/EAN in uitgaande EDI:** live join `producten.ean_code` i.p.v. snapshot, maar het volledige bericht wordt eenmalig vastgelegd in `edi_berichten.payload_raw` bij generatie. Laag risico; geen actie nu.
- **ORDRSP `ArticleDescription`/prijs-velden "leeg":** een verkenning vlagde dit als kritiek, maar dit is **ongeverifieerd** en valt buiten het SSCC-patroon (gaat over EDI-orderbevestiging-volledigheid, niet over multi-bron-afleiding van colli-data). → aparte triage, niet in dit traject.

---

## Snapshot-infrastructuur — wat al canoniek is

`zending_colli` (mig 209/213): `sscc`, `gewicht_kg`, `omschrijving_snapshot`, `colli_nr`, `aantal`, pick-status — gevuld bij `genereer_zending_colli` ([mig 209:135-206](../../../supabase/migrations/209_zending_colli_sscc.sql)). `zendingen`: adres-snapshots + `afl_telefoon` (trg, mig 339), `afl_email` (trg, mig 365), `verzendweek` (trg, mig 230, immutable na bundel-lock). **Ontbrekend op `zending_colli`:** dimensie-kolommen (zie C); de omschrijving-snapshot mist de klant-omschrijving (zie A1).

---

## Scope-besluit (2026-06-13)

| Analoog | Besluit | Vervolg |
|---|---|---|
| A1 omschrijving | **In scope** — snapshot canoniek (verrijkt) | implementatieplan |
| D + E label-fixes | **In scope** — zelfde printset-laag | implementatieplan |
| A2 gewicht-architectuur | **In scope, gecoördineerd** met de gewicht-agent (alleen bron-keuze + totaal-sync, niet de data) | implementatieplan |
| C afmetingen | **Niet in scope** nu — gedocumenteerd als bekende open analoog | backlog |
| F adres-split, G GTIN | **By-design** — geen actie | — |
| ORDRSP-gaten | **Aparte triage** — buiten patroon | apart |

Implementatieplan: [2026-06-13-colli-data-single-source.md](2026-06-13-colli-data-single-source.md).
