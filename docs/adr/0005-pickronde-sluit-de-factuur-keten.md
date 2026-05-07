---
status: accepted
date: 2026-05-07
---

# Pickronde sluit de factuur-keten — `voltooi_pickronde` flipt `orders.status='Verzonden'` bij laatste open zending

## Context

ADR-0003 introduceerde de Pickronde als domeinconcept en koppelde de zending-status-flow aan het fysieke pickmoment: klik "Verzendset" → `Picken`, klik "Voltooi pickronde" → `Klaar voor verzending` (HST-/EDI-trigger vuurt). Daarmee was het *zending*-pad sluitend.

Maar de *order*-status volgde niet mee. Twee constraint-checks tijdens de architectuur-grilling van 2026-05-07 maakten duidelijk:

1. **Geen enkele code zet `orders.status='Verzonden'`.** Niet in een trigger, niet in een RPC, niet in de frontend (`grep` op alle migraties + `frontend/src/`). Mig 145 en 153 zetten alleen `Wacht op inkoop`, `Wacht op voorraad` en `Nieuw`.
2. **De factuur-trigger (mig 118) wacht op precies die overgang.** `trg_enqueue_factuur` reageert alleen op transitie naar `'Verzonden'`. Resultaat: de factuur-queue is in de huidige codebase een dode lijn; de auto-factuur-keten is technisch volledig gebouwd (queue + edge function + PDF + email + EDI-INVOIC) maar wordt nooit getriggerd.

Methodiek-formulering van de gebruiker: *"Op het moment dat de order is verzameld, gestickerd en klaarligt, wordt de order bevestigd in het systeem door de orderpicker en daarmee op verzonden gezet. De klant ontvangt dan automatisch de factuur + pakbon."* — een directe keten van fysieke pick-bevestiging naar factuur, die de huidige codebase niet sluit.

ADR-0003 voorzag dit zelf onder "Overwogen alternatieven, kandidaat #3": _"De order-status `'Klaar voor verzending'` afschaffen ten gunste van afgeleide pickronde-status — zinvol maar uit scope: raakt zes RPCs die deze status als sentinel filteren. Aparte ADR + migratiepad in toekomst."_ Dit is dat moment.

## Beslissing

`voltooi_pickronde(p_zending_id, p_picker_id)` wordt het sluitstuk van de factuur-keten. Naast de bestaande verantwoordelijkheden (colli's op `gepickt`, zending naar `Klaar voor verzending`) krijgt de RPC één extra verantwoordelijkheid: **als dit de laatste open zending van de order is, flip ook `orders.status='Verzonden'`**.

### Algoritme aan einde van `voltooi_pickronde`

```sql
-- ... bestaande logica: pick_uitkomst='gepickt', zending → 'Klaar voor verzending'

-- Nieuw sluitstuk:
IF NOT EXISTS (
  SELECT 1 FROM zendingen
  WHERE order_id = (SELECT order_id FROM zendingen WHERE id = p_zending_id)
    AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Geannuleerd')
) THEN
  UPDATE orders
  SET status = 'Verzonden'
  WHERE id = (SELECT order_id FROM zendingen WHERE id = p_zending_id)
    AND status NOT IN ('Verzonden', 'Geannuleerd');
  -- trg_enqueue_factuur (mig 118) vuurt automatisch via NEW.status-overgang
END IF;
```

### Multi-zending bij `lever_modus='deelleveringen'`

Bij deelleveringen bestaat één order uit meerdere zendingen op verschillende dagen. De keuze: **pas bij de laatste pickronde** flipt `orders.status='Verzonden'`. Tussenliggende pickrondes laten de order op zijn huidige status (`Wacht op voorraad` / `Wacht op inkoop` / etc.). Eén factuur per order, niet per zending.

Trade-off geaccepteerd: bij volledig deelleveringen-traject zal de eerste klant-zending fysiek aankomen voordat de factuur de deur uit gaat. Voor Karpi V1 is dat acceptabel — er is geen sterke vraag naar per-zending-facturatie in de huidige klantenportefeuille. Bij toekomstige vraag kan `debiteuren.factuurvoorkeur='per_zending'` (mig 118 al voorzien) een aparte trigger op zending-status krijgen, zonder ADR-0005 te raken.

### Status `Klaar voor verzending` op order-niveau

ADR-0003 noemde dit als kandidaat-#3 (afschaffen). **Niet in dit ADR.** Reden: de status wordt door zes RPCs als sentinel gefilterd (mig 145/153/185/186/188/192). Vervangen door een afgeleide pickronde-status raakt al die plekken. ADR-0005 lost het methodiek-gat op zonder die scope te openen — `Klaar voor verzending` blijft een legitieme order-status voor "in pickronde maar nog niet alles voltooid". Refactor-kandidaat blijft op de backlog.

### Idempotentie en race-conditions

- `voltooi_pickronde` is al idempotent gemaakt in mig 211 voor de zending. Het nieuwe order-status-block voegt een `WHERE status NOT IN ('Verzonden', 'Geannuleerd')`-guard toe — twee keer voltooien levert dus geen dubbele factuur op.
- Trigger `trg_enqueue_factuur` (mig 118) is zelf idempotent op `(order_id, factuurvoorkeur)` via een uniek queue-record.

### `orders.verzonden_at` voor audit

Voeg `orders.verzonden_at TIMESTAMPTZ` toe (mag NULL voor historische orders). Wordt door `voltooi_pickronde` gezet als sluitstuk op `now()`. Ondersteunt rapportage ("doorlooptijd order → verzending") zonder de status-overgang als enige bron-van-waarheid te laten.

## Overwogen alternatieven

- **Aparte trigger op `zendingen.status`-overgang naar `Klaar voor verzending` die orders-status flipt** — afgewezen omdat de logica "laatste open zending?" dan in een trigger moet, los van de RPC. Locality is slechter: pickronde-voltooi en order-Verzonden raken aparte contexten met een onzichtbare causale link. Eén RPC die beide doet is leesbaarder en testbaar als één contract.
- **Status `'Verzonden'` afgeleid via view i.p.v. opgeslagen** — verleidelijk (geen schrijf-trigger nodig), maar dan kan de factuur-trigger niet meer op een transitie reageren (views vuren geen triggers). Backwards-compat met mig 118 sneuvelt.
- **Auto-Verzonden bij HST-/EDI-callback "vervoerder heeft opgehaald"** — afgewezen voor V1. Methodiek zegt "klaarligt = bevestigd = verzonden", niet "opgehaald = verzonden". Bij toekomstige integratie (vervoerder bevestigt fysieke pickup) kan een tweede status `Onderweg` worden gevuld door de callback — orthogonaal aan dit ADR.
- **Per-zending factureren bij deelleveringen** — geparkeerd. `debiteuren.factuurvoorkeur='per_zending'` bestaat al in mig 118 maar wordt nu door geen flow geactiveerd. Een vervolg-ADR kan de zending-status `Klaar voor verzending` als alternatieve trigger toevoegen wanneer een klant er expliciet om vraagt.

## Consequenties

- **Migratie (volgnr 217, na ADR-0004's 216):**
  - Voeg `orders.verzonden_at TIMESTAMPTZ` toe.
  - Update `voltooi_pickronde` met de hierboven beschreven sluitstuk-logica.
  - Update `start_pickronde` en `voltooi_pickronde` met `picker_id BIGINT` parameter (FK → `medewerkers.id`); voeg `zendingen.picker_id` en `zending_colli.gepickt_door_id` toe.
- **Frontend:**
  - [`zending-printset.tsx`](frontend/src/modules/logistiek/pages/zending-printset.tsx): voeg picker-dropdown toe vóór "Voltooi pickronde"-knop. Geforceerd vereist veld.
  - [`verzendset-button.tsx`](frontend/src/modules/logistiek/components/verzendset-button.tsx): picker-dropdown of latere keuze (UX-keuze, niet ADR-niveau).
  - Order-detail toont `orders.verzonden_at` + factuurnummer als de keten gevuurd heeft. Maakt de causaliteit voor de gebruiker zichtbaar.
- **Tests:** contract-test op `voltooi_pickronde` valideert (a) zending-status, (b) order-status alleen bij laatste open zending, (c) factuur-queue-rij verschijnt, (d) twee keer voltooien = idempotent. Verving end-to-end klik-tests.
- **Module-eigenaarschap:** ongewijzigd t.o.v. ADR-0003 — Magazijn-Module bezit Pickronde-RPCs; Logistiek-Module bezit `zendingen`-tabel; Facturatie blijft een aparte concern (kandidaat #3 uit de architectuur-review). De order-status-flip leeft op de seam tussen Magazijn (initiator) en Orders-Module (eigenaar van `orders.status`) — acceptabel omdat het een atomaire RPC-actie is, geen cross-module orchestratie.
- **Domeinwoordenboek:** termen *Pickronde* uitgebreid met factuur-sluitstuk-verwijzing.
