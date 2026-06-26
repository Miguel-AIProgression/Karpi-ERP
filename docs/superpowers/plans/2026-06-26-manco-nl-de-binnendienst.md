# Manco-afhandeling: NL/DE-splitsing + binnendienst-correctie (update op mig 465-branch)

> **Status:** plan. Bouwt voort op de bestaande branch `worktree-niet-gevonden-backorder`
> (mig 465 Pick-backorder) en het oorspronkelijke plan
> [`2026-06-22-niet-gevonden-backorder.md`](2026-06-22-niet-gevonden-backorder.md).
> Dit document beschrijft alleen de **delta's** uit de gemaakte productbeslissingen
> (26-06) + de verplichte **rebase** op het huidige `main`.

## Aanleiding (gebruikersbeslissingen 26-06)

Een colli die tijdens een pickronde niet gevonden wordt blokkeert nu de hele zending
(foto: 6 vastgelopen zendingen). De branch lost het blokkeren al op, maar drie
beslissingen ontbreken nog en één bestaande aanname is bijgesteld:

1. **Pakbon toont het manco** — regel blijft zichtbaar met *besteld N / geleverd 0*
   (i.p.v. de regel volledig uit de zending te verwijderen).
2. **Voorraad blijft gereserveerd bij niet-gevonden** (bijgestelde keuze): de telling
   wordt **niet** automatisch afgeboekt. De claim blijft staan zodat de eenheid niet
   vrijvalt en niet opnieuw verkocht kan worden. De binnendienst onderzoekt later of
   het stuk er echt niet is of elders ligt, en corrigeert dan pas.
3. **NL vs DE splitsing in de resolutie:**
   - **NL** → blijft als backorder op de huidige order; komt automatisch terug in
     Pick & Ship zodra er weer voorraad is.
   - **DE** → naar de commerciële binnendienst; die maakt een nieuwe order of beslist
     "niet verzenden". Komt nooit automatisch terug op deze order.
4. **Beide** → de order toont permanent (historisch) dat hij een mankement had.

## Mentaal model: bevriezen → onderzoeken → resolven

```
niet-gevonden (voltooi_pickronde)         BEVRIEZEN (land-agnostisch)
   ├─ claim blijft actief (gereserveerd) ─ voorraad valt niet vrij, geen herverkoop
   ├─ gate pick_backorder_sinds gezet ──── uit Pick & Ship (geen 2e picker)
   ├─ order-marker manco_sinds (permanent)
   ├─ regel blijft op de zending als MANCO (aantal verlaagd) → pakbon geleverd 0
   └─ rest verzonden + gefactureerd → order 'Deels verzonden'
                    │
                    ▼
Manco-werklijst (orders-overzicht tab, toont land per rij)
   binnendienst onderzoekt fysiek + beslist:
   ├─ A) Weer beschikbaar  → terug naar Pick & Ship   (gate weg, claim intact) [NL+DE]
   └─ B) Niet leverbaar uit voorraad → voorraad-correctie (telling −manco, claim vrij)
         ├─ NL → houd regel open als backorder → auto terug bij nieuwe voorraad
         └─ DE → sluit regel af (annuleren / "nieuwe order gemaakt", met reden)
```

**Kern-elegantie:** niet-gevonden is een *niet-destructieve bevriezing* (precies wat de
branch al doet: gate zetten, claim ongemoeid). Alle correctie — de enige plek die
`producten.voorraad` raakt — gebeurt bewust bij de binnendienst-resolutie, met audit.
NL/DE verschilt **alleen in de resolutie**, niet in de bevriezing; de RPC leidt het
land af, de binnendienst hoeft de regel niet te kennen.

---

## Verplichte rebase op `main` (vóór alle feature-werk)

De branch is gesneden op mig 453 en is 37 commits achter. `git merge` is uitgesloten:

- **Nummer-collisie:** branch-bestand `465_pick_backorder.sql` botst met het **live**
  `465_vormtoeslag_pseudo_product.sql`. → hernummeren naar het eerstvolgende vrije
  nummer (verifieer vlak vóór toepassen; repo staat op 484, live ~496 — vermoedelijk
  497+; zie collisie-memory).
- **RPC's zijn onder de branch verschoven.** Mig 465 herschrijft `voltooi_pickronde`
  + `orderregel_pickbaarheid` o.b.v. **mig 413**, maar `main` heeft die sindsdien
  herzien in mig **466** (start_pickronden pickbaarheid-guard), **473–479** (deelzending:
  'Gepland'-zending vóór starten, `pick_ship_zichtbaar` actieve-zending, is_locked/
  is_pickbaar-guards). De 465-SQL moet opnieuw afgeleid worden uit de **huidige live
  bodies**, niet uit 413.
- **Frontend-bestanden** die de branch raakt (`colli-pick-vinkjes`,
  `voltooi-pickronde-knop`, `pickronde.ts`, `pick-overview`/startbaarheid) zijn op main
  óók verbouwd door 473–479.

**Aanpak:** `git rebase main` in de worktree; per conflict de mig-465-intentie opnieuw
aanbrengen op de main-versie. Daarna pas de delta-features hieronder. `voltooi_pickronde`
moet na rebase de **deelzending-aware** main-versie zijn + de niet-gevonden-aftakking.

---

## Slice 1 — Pakbon toont het manco (geleverd 0)

**Doel:** de niet-gevonden regel blijft op de pakbon met *besteld N / geleverd 0* +
zichtbaar label "MANCO". Geldt voor de geprinte pakbon én de server-PDF (factuurbijlage)
— die delen één aggregatie (`bouwPakbonRegels` in `_shared/pakbon/aggregatie.ts`).

**Wijziging in `voltooi_pickronde` (de niet-gevonden-loop):** verwijder de
`zending_regels`-regel **niet**; verlaag alleen `aantal` met het manco-aantal en zet een
manco-marker. De **colli** wordt wel verwijderd (er wordt niets fysiek verzonden van dat
stuk), dus colli-telling/labels/carrier-payload blijven correct.

- Migratie: `ALTER TABLE zending_regels ADD COLUMN IF NOT EXISTS manco_aantal INT NOT NULL DEFAULT 0;`
  - Bij niet-gevonden: `aantal = aantal - 1`, `manco_aantal = manco_aantal + 1`
    (regel blijft bestaan, ook als `aantal` 0 wordt — dus de `DELETE ... WHERE aantal=0`
    uit mig 465 vervalt voor manco-regels).
- `_shared/pakbon/aggregatie.ts` (`bouwPakbonRegels`): `geleverd = zending_regel.aantal`
  (ladder ongewijzigd; 0 is een geldige waarde — `0 ?? x` levert 0). `besteld` blijft
  `order_regels.orderaantal`. Nieuw `PakbonRegel.isManco = manco_aantal > 0` →
  presentatie. **`besteld = aantal + manco_aantal` blijft consistent met orderaantal.**
- `_shared/pakbon/pakbon-pdf.ts` + `frontend/.../pakbon-document.tsx`: toon bij
  `isManco` een "MANCO"-badge/regel; `geleverd` toont al `0`. Karakterisatietest
  `pakbon-document.test.tsx` uitbreiden met een manco-scenario (besteld 1, geleverd 0).

**Ponytail-default (geen extra vraag):** géén aparte "manco_reden" op de pakbon — het
manco-aantal + label volstaat; de reden leeft op de orderregel/audit.

> **Let op admin-pseudo-trigger (mig 434):** `trg_zending_regels_skip_admin_pseudo` weert
> pseudo-regels uit `zending_regels`. De manco-regel is een echte (niet-pseudo) regel —
> ongemoeid. Verifieer dat een `aantal=0`-niet-pseudo-regel nergens later gefilterd
> wordt op `aantal > 0` (carrier-colli leest colli, niet zending_regels-aantal; check
> `genereer_zending_colli` draait alleen bij start, niet bij voltooi).

---

## Slice 2 — Bevriezing bij niet-gevonden (claim blijft staan)

De branch zet bij niet-gevonden alleen de gate + splitst de zending; de
`order_reserveringen`-claim wordt **niet** geraakt. Dat is precies de gewenste
bevriezing — **bevestigen en behouden**, niet wijzigen. Toevoegen:

- Order-marker `orders.manco_sinds TIMESTAMPTZ` (eenmalig gezet, nooit gewist) in de
  niet-gevonden-loop van `voltooi_pickronde`:
  `UPDATE orders SET manco_sinds = COALESCE(manco_sinds, now()) WHERE id = <order van de regel>`.
- `order_events`-audit `'manco_gedetecteerd'` (status_na = huidige status, metadata met
  order_regel_id + reden uit `pick_opmerking`) — patroon mig 326/396.

**Geen voorraadmutatie hier.** Dit is het hele punt van de bijgestelde keuze: vrije
voorraad blijft verlaagd (claim staat), dus de eenheid kan niet opnieuw verkocht worden.

---

## Slice 3 — Manco-werklijst + binnendienst-resolutie (NL/DE)

Hergebruikt de branch-tab (`backorder-tab.tsx`) en de seam `pick-backorder.ts`; hernoemd
naar "Manco" en uitgebreid met land + de twee resolutie-acties.

**Land-afleiding (RPC-zijde, SQL):** `normaliseer_land(COALESCE(NULLIF(TRIM(o.afl_land),''),
d.land))` → `'NL'` vs `'DE'` (bron `normaliseer_land`, mig 214/454; spiegelt
`bepaal_btw_regeling`, mig 455). De werklijst toont per rij het land + landspecifieke
knoppen.

**Resolutie-RPC's** (vervangen/uitbreiden van de branch-RPC's):

1. `manco_terug_naar_pickship(p_order_regel_id)` *(= branch `backorder_opnieuw_versturen`)*
   — actie **A**. Wist `pick_backorder_sinds`. Claim staat nog → regel direct pickbaar →
   terug in Pick & Ship. Audit `order_events 'manco_terug_naar_pickship'`. [NL+DE]

2. `manco_niet_leverbaar(p_order_regel_id, p_corrigeer_voorraad BOOLEAN, p_reden TEXT)`
   — actie **B**. Doet de **voorraad-correctie** (de enige plek die de telling raakt):
   - `p_corrigeer_voorraad = TRUE` (echt weg): release de claim **en**
     `UPDATE producten SET voorraad = voorraad - <manco> WHERE artikelnr = …`
     gevolgd door `herbereken_product_reservering(artikelnr)`. **Netto vrije_voorraad
     ongewijzigd** (claim vrij +manco, voorraad −manco) → de fantoom-eenheid kan niet
     herverkocht worden. Audit `order_events 'manco_voorraad_gecorrigeerd'`
     (metadata: artikelnr, aantal).
   - `p_corrigeer_voorraad = FALSE` (product is er, alleen niet voor deze order): alleen
     claim vrij, telling ongemoeid (herverkoopbaar).
   - Daarna **land-afhankelijk**:
     - **NL:** wis `pick_backorder_sinds`, **laat `te_leveren` staan** → regel is een
       normale backorder; `herallocateer_orderregel` → 'wacht op voorraad/inkoop' →
       komt vanzelf terug in Pick & Ship zodra nieuwe voorraad binnenkomt (bestaande
       keten `boek_voorraad_ontvangst` → claim → `orderregel_pickbaarheid`).
     - **DE:** zet `pick_backorder_geannuleerd_op`, `te_leveren = 0` *(= branch
       `annuleer_pick_backorder`)*; reden `'niet_verzenden'` of `'nieuwe_order_gemaakt'`
       (vrije keuze binnendienst, alleen audit-verschil — de nieuwe order maakt
       binnendienst zelf via normale order-aanmaak). Order-status-afleiding identiek aan
       de branch (Verzonden als rest verzonden, anders Geannuleerd).

**Frontend werklijst (`backorder-tab.tsx` → manco-tab):**
- toont per rij: order, klant, **land-badge (NL/DE)**, regel, reden/opmerking.
- knoppen: **"Weer beschikbaar"** (A) en **"Niet leverbaar"** (B). B opent een mini-dialog:
  checkbox *"Ligt fysiek niet meer in het magazijn (corrigeer voorraad)"* (→
  `p_corrigeer_voorraad`) en — alleen bij DE — een reden-keuze (niet verzenden / nieuwe
  order gemaakt). NL heeft geen reden-keuze (blijft op backorder).
- de seam `pick-backorder.ts` (`isPickBackorder`/`filterPickBackorder`) blijft de bron
  voor "open manco" (gate gezet, niet geannuleerd) — ongewijzigd.

---

## Slice 4 — Permanente order-marker "had een mankement"

Status-overstijgende tab + banner, exact het bestaande patroon (EDI "Te bevestigen",
"Levertijd gewijzigd"):

- Migratie: `orders.manco_sinds` (al in Slice 2) toevoegen aan view `orders_list`
  (laatst gewijzigd in mig 396 — uitbreiden op dezelfde plek).
- Seam `frontend/src/lib/orders/manco-marker.ts`: `isMancoMarker(order)` =
  `manco_sinds != null` (**geen** status-exclusie → ook na Verzonden zichtbaar) +
  `filterMancoMarker(query)` = `.not('manco_sinds','is',null)`.
- `status-tabs.tsx`: tab "Had mankement". `fetchOrders` + `fetchStatusCounts`
  (orders.ts): filter-branch + parallelle teller — spiegelt `filterDebiteurTeBevestigen`.
- `OrderRow` + order-detail-banner `manco-marker-banner.tsx` (amber, "Deze order had een
  mankement, sinds …"). Permanent; geen wis-actie.

> Eén gedeelde tab voor NL+DE (land blijft per rij zichtbaar via de bestaande
> klant/land-kolom). Geen aparte NL/DE-tabs — minder ruis.

---

## Slice 5 — Frontend pick-flow (rebase-opvolg)

Grotendeels al in de branch; na de rebase verifiëren tegen main's deelzending-UI:
- `colli-pick-vinkjes.tsx`: "Niet gevonden"-toggle + "Toch gevonden"-herstel
  (`herstel_colli_pick`) — branch-versie behouden, conflicten met main oplossen.
- `voltooi-pickronde-knop.tsx`: niet meer disablen bij niet-gevonden.
- `pick-problemen-banner.tsx`: verwijst naar de Manco-tab.
- Verifieer dat een gegate manco-regel niet door `start_pickronden` (mig 477/479
  is_locked/is_pickbaar-guards) opgepakt wordt — gate sluit 'm uit
  `orderregel_pickbaarheid`, dus dat klopt by-construction; vastleggen met een testcase.

---

## Docs + tests

- `CONTEXT.md`/`CLAUDE.md`/`changelog.md`/`order-lifecycle.md`/`database-schema.md`:
  de branch-doc-commits opnieuw afstemmen op het bijgestelde model (bevriezen i.p.v.
  afboeken; NL/DE-resolutie; voorraad-correctie bij binnendienst; manco op pakbon;
  permanente marker).
- Vangnet: `pick-backorder.test.ts` (branch) + nieuw `manco-marker.test.ts` +
  pakbon-manco-scenario in `pakbon-document.test.tsx`. SQL-rooktest in een
  rolled-back transactie: niet-gevonden → claim blijft, gate gezet, marker gezet,
  rest 'Deels verzonden', pakbon geleverd 0; daarna A (terug) en B-NL/B-DE.

## Deploy-volgorde

Migratie(s) vóór de frontend (view + RPC's + nieuwe kolommen live). Geen edge functions
behalve herdeploy van de pakbon-delende functies (factuur-verzenden draagt de
server-PDF-pakbon) na de `_shared/pakbon/`-wijziging.

## Open micro-beslissingen (defaults gekozen, wijzig op commando)

- **Voorraad-correctie-checkbox default UIT** bij actie B (operator vinkt bewust "ligt
  fysiek niet meer in magazijn" aan). Reden: niet elke "niet leverbaar" is een
  telfout — soms ligt het stuk er wel maar vervalt de order.
- **DE "nieuwe order gemaakt"** = puur audit-reden; het systeem kloont géén order
  (gekozen: werklijst + afsluiten). Binnendienst maakt de nieuwe order handmatig.
- **Voorraadbron:** correctie op `producten.voorraad` (de manco-producten zijn vaste
  maten; voorraad = `producten.voorraad`, niet `SUM(rollen)`). Voor een onverhoopt
  rol-artikel als manco: correctie via `rol_mutaties`/`rol_handmatig_bewerken` i.p.v.
  `producten.voorraad` — buiten scope tot het zich voordoet.
