# Rhenus GS1 TransportInstruction — legacy-voorbeelden

`RHE260521001-excerpt.xml` is een representatief excerpt uit het laatste
legacy-bestand (`RHE260521001.xml`, oud systeem, 21-05-2026) dat Karpi via het
oude kanaal bij Rhenus aanleverde. Het volledige bestand bevatte ~35
`transportInstruction`-blokken (één per zending, gebatcht per dag); dit excerpt
bewaart de drie vormen die er structureel toe doen:

1. **`9453355`** — palletzending (2× `PLTS`, met `width`-dimensie). Sinds mig 489
   reproduceert onze builder dit: een colli-bundel met `pallet_type='PLTS'` (volle
   pallet, footprint 80×120) of `'HPLT'` (halve pallet, 80×60) → `packageTypeCode` +
   `<depth>`+`<width>`. HPLT-footprint 80×60 is een aanname (half-EU-pallet) — nog te
   bevestigen door Rhenus.
2. **`0454510`** — rollenzending (5× `RLEN`, alleen `depth`-dimensie;
   `lineItemNumber` herhaalt per orderregel).
3. **`0455395`** — ⚠️ het **foutgeval** uit de Rhenus-mail van 12-06-2026:
   `totalPackageQuantity=0` en géén `transportInstructionShipmentItem`-segment.
   Rhenus' mapping verplicht ≥1 item-segment → bericht viel bij hen in error
   (handmatig hersteld aan hun kant). Onze builder weigert dit categorisch:
   zie `valideerRhenusColli` + de 0-colli-test in
   `supabase/functions/rhenus-send/xml-builder.test.ts`.

Let op verder:
- `<sscc>` is **20 cijfers**: AI(00)-prefix + 18-cijferige SSCC, exact zoals
  de barcode op ons label.
- `Weight` per item en `totalGrossWeight` zijn **kg met decimalen**
  (`.68`, `145.44`) — geen decagram (dat is Verhoek).
- `plannedDelivery`/`plannedCollection` dragen een datum met trailing `T`
  (`2026-05-21T`) — legacy-eigenaardigheid die we 1-op-1 volgen.
- Receiver-adres is één regel (`streetAddressOne` = straat+nummer) — geen
  adres-splitsing.

Plan: `docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md`
