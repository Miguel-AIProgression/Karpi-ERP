---
status: accepted
date: 2026-05-07
---

# Pickronde als deepening van de Magazijn-Module — zending start in 'Picken', niet 'Klaar voor verzending'

## Context

Sinds migratie 169 heeft de `zending_status`-enum vijf operationele waardes: `Gepland`, `Picken`, `Ingepakt`, `Klaar voor verzending`, `Onderweg`, `Afgeleverd`. In de praktijk werden `Gepland`, `Picken` en `Ingepakt` echter nooit gebruikt: alle paden die een zending creëerden (`create_zending_voor_order` in mig 172, geüpdatet in 176/177/186/206) zetten direct status `Klaar voor verzending`. Dat triggerde de bestaande HST-/EDI-dispatch-trigger (`trg_zending_klaar_voor_verzending`, mig 172) onmiddellijk.

Gevolg: zodra een operator op de pick-card op "Verzendset" klikte (om stickers + pakbon te printen om mee te lopen door het magazijn), werd de zending in één klik:

1. aangemaakt
2. op status `Klaar voor verzending` gezet
3. naar de HST-API gequeued

— terwijl het tapijt fysiek nog op de plank lag. De Zendingen-overzichtspagina toonde dus zendingen die in werkelijkheid nog niet gepickt waren. Gebruiker zag dit en signaleerde: _"Pas wanneer het gepickt is en dat afgerond is, is het klaar voor zending."_

Het domein heeft dus een fysieke gebeurtenis — "de pick is afgerond" — die nergens in code wordt vastgelegd. Gevolgen-tot-nu-toe:

- De `Picken`/`Ingepakt`-enum-waardes waren dood.
- De `create_zending_voor_order`-RPC bundelde drie verschillende beslissingen achter één naam: idempotente find, header+lines-insert, status-commit naar dispatch.
- De HST-dispatch-trigger was correct gemodelleerd (vuurt op `Klaar voor verzending`) maar werd verkeerd geactiveerd doordat callers die status premature toekenden.
- Geen audit-trail voor "wat ging er bij het picken mis" — operator kon niet markeren dat een tapijt niet vindbaar was.

## Beslissing

Introduceer **Pickronde** als domeinconcept in de **Magazijn-Module**, met een 1-op-1-relatie tot een `zendingen`-rij. Geen eigen tabel — de Pickronde is de vertegenwoordiging van de fysieke bezigheid; haar staat leeft in (a) `zendingen.status` en (b) per-colli pick-uitkomsten op `zending_colli`.

### Status-flow

| Was | Wordt |
|---|---|
| Klik "Verzendset" → zending direct in `Klaar voor verzending` → HST-trigger vuurt | Klik "Verzendset" → zending in `Picken` → HST-trigger vuurt **niet** → operator gaat fysiek picken |
| Geen handmatig voltooi-moment | Klik "Voltooi pickronde" op printset-pagina → zending naar `Klaar voor verzending` → HST-trigger vuurt **nu pas** |

De bestaande trigger `trg_zending_klaar_voor_verzending` blijft ongemoeid — hij vuurt nog steeds op precies één status-overgang, alleen op het juiste fysieke moment.

### Per-colli pick-uitkomst

`zending_colli` (mig 209) krijgt drie kolommen:

- `pick_uitkomst` enum (`open` | `gepickt` | `niet_gevonden`), default `open`
- `pick_opmerking` TEXT (operator-notitie bij niet-gevonden)
- `gepickt_at` TIMESTAMPTZ

Default-flow voor de operator is **vinkjes-omgekeerd**: bij "Voltooi pickronde" zet de RPC alle `open`-colli's stilzwijgend op `gepickt`. Operator hoeft alleen actie te ondernemen voor uitzonderingen ("deze kon ik niet vinden") — niet 8 vinkjes te zetten voor een normale 8-colli zending. Dit sluit aan bij de werkelijke werkstroom: tapijten verzamelen → stickers plakken → klikken op voltooid.

### Niet-gevonden — twee paden, operator beslist per geval

Markeert operator een colli als `niet_gevonden`, dan dialog:

- **Blokkeer & escaleer** — colli's `pick_uitkomst='niet_gevonden'`, zending blijft `Picken`. Verschijnt op nieuwe Pick-problemen-werklijst voor de magazijnchef. Chef kan: voorraad-correctie, andere rol selecteren, uitwisselbaar product activeren, terug naar inkoop. Na fix kan operator opnieuw "Voltooi pickronde" klikken.
- **Splits zending** — colli wordt losgekoppeld van de zending, de orderregel blijft open in de order, een latere Pickronde pakt 'm op. Alleen toegestaan wanneer `orders.lever_modus = 'deelleveringen'`. Bij `in_een_keer` is alleen Blokkeer & escaleer mogelijk.

### Module-eigenaarschap

Volgt ADR-0002:

- **Magazijn-Module** owns de Pickronde-bezigheid: het concept, de hooks (`useVoltooiPickronde`, `useMarkeerColliNietGevonden`), de Pick-problemen-werklijst, en de validatie-logica achter de RPCs.
- **Logistiek-Module** owns de `zendingen`-tabel zelf, de printset-pagina, de vervoerder-dispatch. De printset-pagina blijft op `/logistiek/:zending_nr/printset` en consumeert de magazijn-hooks als slot — zelfde slot-pattern als VervoerderTag op OrderPickCard, maar omgekeerd (logistiek-pagina toont magazijn-actie).

### RPC-contract (smal, drie functies)

```
start_pickronde(p_order_id BIGINT) RETURNS BIGINT
  -- Vervangt de oude semantiek van create_zending_voor_order.
  -- Maakt zending aan in status 'Picken', genereert colli's, returnt zending_id.
  -- Idempotent: bestaande open zending voor de order wordt hergebruikt.

markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_modus TEXT,            -- 'blokkeer' | 'splits'
  p_opmerking TEXT
) RETURNS VOID
  -- 'splits' guard: alleen toegestaan bij lever_modus='deelleveringen'.

voltooi_pickronde(p_zending_id BIGINT) RETURNS BIGINT
  -- Guard: zending.status = 'Picken'.
  -- Zet alle pick_uitkomst='open' op 'gepickt' + gepickt_at=now().
  -- Guard: geen 'niet_gevonden' meer open (anders foutmelding 'pick-problemen openstaand').
  -- Flipt zending.status -> 'Klaar voor verzending'. Trigger vuurt automatisch.
```

`create_zending_voor_order` blijft bestaan als alias voor `start_pickronde` voor backwards-compat met de "Zending aanmaken"-knop op order-detail (component `<ZendingAanmakenKnop>`). In een latere migratie kan die knop direct `start_pickronde` aanroepen en de alias verdwijnen.

### Zendingen-overzicht filter-default

Pagina [`zendingen-overzicht.tsx`](../../frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx) filtert default op `status >= 'Klaar voor verzending'`. Een aparte filter-pil "Picken" wordt toegevoegd voor wie de lopende pickrondes wil zien (magazijnchef-blik). Hiermee verdwijnen de twee zendingen die op de huidige screenshot vóór pick-afronding zichtbaar waren.

## Overwogen alternatieven

- **Eigen tabel `pickrondes`** — afgewezen omdat de Pickronde 1-op-1 met `zendingen` blijft en alle data al in `zendingen` + `zending_colli` past. Een aparte tabel zou alleen een dubbel ID introduceren zonder leverage. _Deletion-test_: als ik de tabel weghaal, verdwijnt geen complexiteit; `zending_status` + `zending_colli.pick_uitkomst` dekken alles.
- **Auto-derive Pickronde-voltooiing uit pickbaarheid + scan-events** — afgewezen voor V1 omdat het de fysieke "moment van afronden" diffus maakt en geen escalatie-pad biedt voor niet-gevonden tapijten. Kan later als optie naast de handmatige knop worden toegevoegd zonder schema-wijziging — `voltooi_pickronde` is dan extra triggerbaar vanuit een scan-event-handler.
- **De order-status `'Klaar voor verzending'` afschaffen ten gunste van afgeleide pickronde-status** — zinvol maar uit scope: raakt zes RPCs (mig 145/153/185/186/188/192) die deze status als sentinel filteren. Kandidaat #3 uit de architectuur-review; aparte ADR + migratiepad in toekomst.
- **Pickronde-pagina apart op `/magazijn/pickronde/:zending_nr`** — afgewezen omdat de bestaande printset-pagina al alle benodigde context toont (pakbon + stickers + zending-detail). Een tweede pagina ernaast zou contextswitch betekenen voor de operator. De printset-pagina krijgt een vinkjes-blok + voltooi-knop ingebed; de pick-actie-hooks komen uit magazijn-Module via barrel-export.
- **Annuleer-knop voor lopende Pickronde** — niet in V1. Architectuur staat het toe (status-overgangen `Picken → Gepland` zijn niet hardcoded geblokkeerd), maar geen UI tot er een concreet use-case opduikt. Open in de levende docs.

## Consequenties

- Migratie 211 (volgnummer): voegt enum `pick_uitkomst`, drie kolommen op `zending_colli`, drie nieuwe RPC's. Past `create_zending_voor_order` aan zodat de status-default `Picken` wordt; oude callers blijven werken via alias.
- Frontend-mutaties:
  - [`verzendset-button.tsx`](../../frontend/src/modules/logistiek/components/verzendset-button.tsx): label/tooltip-tekst aanpassen ("Start pickronde" ipv "Verzendset"? — UX-keuze, niet ADR-niveau).
  - [`zending-printset.tsx`](../../frontend/src/modules/logistiek/pages/zending-printset.tsx): vinkjes-blok + voltooi-knop toevoegen; consumeert `useVoltooiPickronde` en `useMarkeerColliNietGevonden` uit `@/modules/magazijn`.
  - [`zendingen-overzicht.tsx`](../../frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx): default-filter op `status >= 'Klaar voor verzending'`, extra "Picken"-pil.
  - Nieuwe magazijn-pagina `/magazijn/pick-problemen` voor blokkeer & escaleer-werklijst.
  - Hooks `useVoltooiPickronde`, `useMarkeerColliNietGevonden`, `usePickProblemen` in `modules/magazijn/hooks/`.
- Test-surface verbetert: drie RPCs zijn los DB-contract-testbaar (status-overgangen, guards, niet-gevonden-pad, splits-guard). Geen end-to-end-knop-test meer nodig om HST-dispatch-timing te valideren.
- ADR-0002 blijft volledig overeind — dit is een _verdieping_ van de magazijn-Module (nieuwe verantwoordelijkheid: pick-bezigheid-lifecycle), geen herverdeling. Logistiek-Module verandert niet van scope, alleen van timing.
- `data-woordenboek.md`: termen Pickronde, Pick-uitkomst, Niet-gevonden-flow toegevoegd. Verzendset-definitie verwijst naar deze ADR.
