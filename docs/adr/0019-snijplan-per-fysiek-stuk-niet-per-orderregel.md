---
status: accepted
date: 2026-05-13
---

# Snijplan-rij = 1 fysiek maatwerk-stuk, niet 1 orderregel

## Context

Sinds de allereerste maatwerk-flow (mig 110) maakt de trigger `auto_maak_snijplan()` op AFTER INSERT van `order_regels` **exact één** rij in `snijplannen` aan, ongeacht `order_regels.orderaantal`. De fout zat onopgemerkt zolang álle maatwerk-bestellingen in de praktijk `orderaantal = 1` hadden — wat tot nu toe vrijwel altijd het geval was.

ORD-2026-2067 brak de aanname: 1 maatwerk-regel BILA 14 met `orderaantal = 5`, `maatwerk_breedte_cm = 200`, `maatwerk_lengte_cm = 230`. De seed-trigger maakte 1 snijplan-rij (200×230) i.p.v. 5. De optimalisatie plaatste dat ene stuk op rol I3900BIL14I; de andere 4 stuks bestonden simpelweg niet in `snijplannen`. Snijder ziet 1 stuk in de modal en sluit de rol af terwijl er nog 4 te snijden zijn elders — die nooit ontstaan.

## Beslissing

**Eén snijplan-rij representeert exact één fysiek te snijden stuk.** Voor een maatwerk-orderregel met `orderaantal = N` worden bij INSERT N snijplan-rijen aangemaakt, allemaal met identieke maten/koppeling aan dezelfde `order_regel_id`, ieder met een eigen `snijplan_nr` (sticker).

Dit volgt het feitelijke domein:
- **Snijder** — krijgt N concrete stukken te snijden, eventueel verspreid over meerdere rollen, ieder met eigen sticker (rolnummer, plek, oriëntatie).
- **Confectie** — bewerkt elk stuk afzonderlijk (boorden, kettelen, anti-slip).
- **Stickers** — uniek per fysiek stuk (al `1 sticker = 1 snijplan_nr` in [`RolUitvoerModal`](../../frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) → `/snijplanning/${snijplan_id}/stickers`).
- **Pick & Ship** — aggregeert pas weer op orderregel-niveau (`orderaantal` als `aantal_colli`); dat blijft ongewijzigd.

## Alternatieven afgewogen

**Optie B — `snijplannen.aantal`-kolom (default 1).** Eén snijplan-rij draagt N stuks. UI en optimalisatie moeten dan overal "aantal-aware" worden: reststuk-berekening per stuk, plaatsing op meerdere rollen modelleren in één rij, stickers N maal renderen vanuit één rij. Doorbreekt het `snijplan_nr = sticker = stuk`-contract dat al door [`stickers`](../../frontend/src/pages/snijplanning/stickers-bulk.tsx) wordt gebruikt. **Afgewezen** — meer code, slechter mentaal model.

**Optie C — UI splitst orderregel met aantal>1 bij opslaan in N regels van 1.** Geen DB-trigger-wijziging maar `aantal_regels`, `aantal_colli`, facturatie en pickbaarheidsbadges expanderen mee — een 5× tapijt wordt vanaf factuur tot pakbon vijf losse regels. Operator-/klant-impact groot. **Afgewezen** — symmetrie verloren met vaste-maten-pad waar `orderaantal=5` óók 1 regel blijft.

**Optie A — N snijplan-rijen per maatwerk-regel.** Geen impact op verkoop/facturatie/pickbaarheid. Snijplan-pijplijn werkt al per rij. Enkele single-row-aannames (`LIMIT 1`) elimineren bij de update-trigger. **Gekozen.**

## Implementatie

### Trigger-rewrites

`auto_maak_snijplan()` (mig 110 → 274):

```sql
v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);
FOR i IN 1..v_aantal LOOP
  INSERT INTO snijplannen (snijplan_nr, order_regel_id, lengte_cm, breedte_cm, status, opmerkingen)
  VALUES (volgend_nummer('SNIJ'), NEW.id, ..., 'Auto-aangemaakt (' || i || '/' || v_aantal || ')');
END LOOP;
```

`volgend_nummer('SNIJ')` moet **per loop-iteratie** aangeroepen worden zodat elke rij een uniek nummer krijgt — dat is waarom hier `FOR` i.p.v. `INSERT … SELECT … generate_series` wordt gebruikt.

`auto_sync_snijplan_maten()` (mig 110 → 274):
- Sync álle snijplannen van de regel — niet `LIMIT 1`.
- Veiligheidsslot blijft per snijplan: rijen met `rol_id IS NOT NULL` of status voorbij `Snijden` skippen (geen massa-update over een lopende productie).
- INSERT-fallback (snijplan ontbreekt op UPDATE) expandeert óók naar `orderaantal`.

### Backfill (eenmalig, in dezelfde migratie)

Voor bestaande maatwerk-orderregels in **non-eindstatus** orders waar `COUNT(snijplannen) < orderaantal`: vul de ontbrekende rijen aan als `'Wacht'` met dezelfde maten. Rij-1 blijft staan inclusief huidige rol-allocatie/status; de aangevulde rijen komen in de pool en worden door de eerstvolgende optimalisatie-run op rollen geplaatst.

Eindstatus-orders (`Verzonden`, `Geannuleerd`) worden niet aangeraakt — het stuk is alsnog gemaakt of de order is dood.

### Bekende beperking

`orderaantal` is **niet** opgenomen in de UPDATE-trigger-kolommen — een latere mutatie van `orderaantal` (5 → 7 of 5 → 3) genereert dus geen extra snijplannen en verwijdert er ook geen. In V1 geaccepteerd; orderaantal-mutaties zijn zeldzaam en moeten via een release-en-hersnijden-flow lopen (zelfde patroon als maatwerk-maten op rol/status voorbij `Snijden`).

## Gevolgen

- Snij-modal toont vanaf nu N stuks per maatwerk-regel met orderaantal=N. Operator ziet onmiddellijk hoeveel er totaal nog gesneden moet worden.
- Geen verzonnen verschuiving in factuur/pakbon/pickbaarheid — die blijven op orderregel-aggregatie.
- ORD-2026-2067 krijgt na migratie 4 extra snijplannen in `Wacht`-status; optimalisatie-run plaatst ze op andere rollen.

## Referenties

- Trigger-origineel: [`110_snijplan_maten_sync.sql`](../../supabase/migrations/110_snijplan_maten_sync.sql)
- Fix: [`274_snijplan_per_fysiek_stuk.sql`](../../supabase/migrations/274_snijplan_per_fysiek_stuk.sql)
- Diagnose-script: [`scripts/diagnose-ord-2026-2067.sql`](../../scripts/diagnose-ord-2026-2067.sql)
- Reproductie: ORD-2026-2067 / rol I3900BIL14I / 2026-05-13
