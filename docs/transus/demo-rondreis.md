# Demo-rondreis EDI/Transus — bestand-only test

> Doel: valideren of onze fixed-width parser/builder geaccepteerd wordt door
> Transus' Custom ERP-validator, zónder dat we live ClientID/Key + cron nodig hebben.

## Voorbereiding (eenmalig)

- Migraties 156 + 157 zijn gerund ✓
- Edge function `transus-poll` is gedeployed (`wqzeevfobwauxkalagtn`) ✓
- ⚠️ Secrets `TRANSUS_CLIENT_ID` + `TRANSUS_CLIENT_KEY` hoeven **nog niet** gezet
  — de edge function blijft inactief tot dit testtraject geslaagd is.

## Stap 1 — Demo-bericht aanmaken in onze ERP

1. Open `https://<onze-ERP-domein>/edi/berichten`
2. Klik rechtsboven op **"Demo-bericht"**
3. Kies template:
   - **BDSK (slank)** — 1 regel, alleen GLN's + GTIN + aantal. Goed om met BDSK's
     specifieke schema-validator te testen.
   - **Ostermann (rijk)** — 3 regels met artikelcodes. Test rijke veldenset.
4. Karpi-GLN: laat staan op `8715954999998` (default uit `app_config.bedrijfsgegevens.gln_eigen`)
5. Klik **Genereer demo-bericht**.

Resultaat: 2 nieuwe rijen in `edi_berichten`:
- 1× richting `in`, type `order`, status `Verwerkt`, `is_test=true` — gefingeerde inkomende order
- 1× richting `uit`, type `orderbev`, status `Wachtrij`, `is_test=true` — automatisch gegenereerde orderbevestiging

## Stap 2 — Orderbevestiging-payload downloaden

1. Klik op de regel voor het uitgaande bericht (`Orderbevestiging` in de overzichtstabel)
2. Op detailpagina: klik rechtsboven op **Download payload**
3. Bestand `edi-orderbev-<id>.inh` wordt opgeslagen.

Verifieer in een teksteditor (bv. VS Code) dat het bestand:
- precies 463 + 281 bytes per regel heeft (CRLF-line-endings),
- start met `0` (header-recordtype),
- de tweede regel begint met `1` (article-recordtype),
- onze GLN `8715954999998` op pos 257-270 én pos 283-296 staat,
- Y-marker op pos 441 (test-vlag).

## Stap 3 — Uploaden in Transus' Testen-tab

In Transus Online:

1. Ga naar **Handelspartners** → kies de partner waarvan we de orderbevestiging-flow willen valideren (BDSK of Ostermann afhankelijk van template)
2. Klik bij proces **"Orderbevestiging versturen"** op de drie puntjes (`...`) → **Bekijken en testen**
3. Tab **Testen** → klik **Upload bestand**
4. Selecteer `edi-orderbev-<id>.inh`

Kijk wat er gebeurt:

- ✅ **Validatie geslaagd** → onze builder produceert correct fixed-width voor het
  "Orderbevestiging versturen"-proces. Klik door naar tab **Bestand** om te zien welke
  velden Transus heeft herkend (groene bullets in de Gegevens-zijbalk).
- ❌ **"Het bestand heeft niet het verwachte formaat"** → Transus' validator verwacht
  een andere kolom-positie of bytes-lengte voor orderbev. Zie *Diagnose* hieronder.
- ⚠️ **Validatie geslaagd maar veld X ontbreekt (rood bolletje)** → veld zit op een
  andere positie dan de inkomende order; we passen de builder aan.

## Stap 4 — Diagnose & iteratie

Bij een fout-melding op Transus' kant:

1. Vraag aan Maureen welke berichtspecificatie (PDF) hoort bij "Orderbevestiging versturen".
   Zie [`docs/transus/mail-aan-transus.md`](mail-aan-transus.md) — die mail vraagt al
   om die specs voor de drie uitgaande berichttypen.
2. Open de PDF; zoek naar Header- en Article-veldnamen + bytes-positie.
3. Pas [`supabase/functions/_shared/transus-formats/karpi-fixed-width.ts`](../../supabase/functions/_shared/transus-formats/karpi-fixed-width.ts)
   aan in functie `buildKarpiOrderbev`.
4. Synchroniseer de kopie in [`frontend/src/lib/edi/karpi-fixed-width.ts`](../../frontend/src/lib/edi/karpi-fixed-width.ts):
   ```bash
   cp supabase/functions/_shared/transus-formats/karpi-fixed-width.ts \
      frontend/src/lib/edi/karpi-fixed-width.ts
   ```
5. Verwijder de demo-rij in `edi_berichten` (`DELETE FROM edi_berichten WHERE is_test=true`)
   en herhaal Stap 1.

## Stap 5 — Klaar voor live-koppeling

Pas zodra de Testen-tab van Transus Online onze orderbev accepteert (✅ groen),
gaan we verder met:

- ClientID/Key bij Maureen aanvragen
- `TRANSUS_CLIENT_ID` + `TRANSUS_CLIENT_KEY` + `CRON_TOKEN` als Supabase secrets zetten
- Cron-trigger op `transus-poll` activeren (elke 60s)
- Live rondreis-test met Transus' test-handelspartner

## Demo-data opruimen

```sql
DELETE FROM edi_berichten WHERE is_test = true;
```
