# Ontwerp: Colli-bundeling bij Rhenus

**Datum:** 2026-06-17
**Branch:** `feat/rhenus-colli-bundel`
**Status:** Goedgekeurd ontwerp — klaar voor implementatieplan

> ⚠️ **Niet te verwarren** met de bestaande **zending-bundeling** (meerdere orders → 1 zending, mig 222) of de **bundel-sleutel** (4D-groepering, mig 228-230). Dit is **colli-bundeling**: binnen één zending meerdere fysieke colli samenvoegen onder één nieuwe SSCC, uitsluitend voor Rhenus.

---

## 1. Aanleiding & doel

Bij Rhenus is het soms voordelig om meerdere tapijten fysiek samen te pakken (bv. 4 van de 7 tapijten in één zak) en die zak onder **één nieuwe verzendsticker** aan te bieden. Rhenus rekent dan voor de zak **1 collo** i.p.v. 4 → goedkoper. De medewerker wil dit **handmatig** kunnen doen, **na** het picken en **vóór** de aanmelding bij de vervoerder.

De onderliggende (gebundelde) stickers zijn al geprint en blijven fysiek op de tapijten in de zak zitten; ze worden bij de vervoerder **niet** aangemeld (genegeerd). Alleen de nieuwe bundel-SSCC + de niet-gebundelde colli gaan mee in de Rhenus-XML.

**Scope:** uitsluitend Rhenus (`rhenus_sftp`). HST, Verhoek en alle andere vervoerders blijven volledig ongewijzigd.

---

## 2. De flow

Vandaag (alle vervoerders): pickronde voltooien → zending `'Klaar voor verzending'` → trigger `trg_zending_klaar_voor_verzending` meldt de vervoerder **direct automatisch** aan → cron verstuurt binnen ~1 min → zending `'Onderweg'`. De colli + SSCC's worden al bij pickronde-**start** aangemaakt (`genereer_zending_colli`), en de individuele stickers worden dan geprint.

**Nieuw, alleen voor Rhenus-zendingen met ≥2 colli:**

1. Pickronde voltooien (zoals nu, ook in bulk) → zending `'Klaar voor verzending'`.
2. **Aanmelding wordt vastgehouden** — niet automatisch verstuurd.
3. Medewerker verzamelt fysiek alles, opent **zending-detail**.
4. In de **colli-bundel-sectie**: vinkt een subset colli aan → **"Bundelen"** (gewicht/maten voorgevuld, bij te stellen) → krijgt 1 nieuwe SSCC → **"Print bundelsticker"** (1 label) → plakt op de zak.
5. Klikt **"Aanmelden bij Rhenus"** → nú pas gaat de zending de wachtrij in → cron verstuurt.

**Belangrijke hold-regel (aangescherpt na review):** de aanmelding wordt **alleen** vastgehouden als:

```
hold  ⟺  vervoerder.handmatig_aanmelden = TRUE   AND   aantal_colli ≥ 2
```

Een Rhenus-zending met **precies 1 colli gaat altijd automatisch door** (zoals vandaag) — daar valt niets te bundelen, dus geen extra handmatige stap. De colli bestaan al op het moment van `'Klaar voor verzending'` (aangemaakt bij pickronde-start), dus de telling is betrouwbaar.

Gevolg: de bundel-sectie + de knop "Aanmelden bij Rhenus" verschijnen **alleen** bij vastgehouden multi-colli Rhenus-zendingen. Eén extra klik per zending, maar uitsluitend waar bundelen überhaupt kan.

---

## 3. Datamodel — bundel = extra `zending_colli`-rij (zelf-referentie)

Een bundel is **nog een rij** in [`zending_colli`](../../../supabase/migrations/209_zending_colli_sscc.sql), met een eigen SSCC. Twee nieuwe kolommen:

| Kolom | Type | Betekenis |
|---|---|---|
| `bundel_colli_id` | `BIGINT REFERENCES zending_colli(id) ON DELETE CASCADE` | De **kind-colli** wijzen naar hun bundel-rij. `NULL` = niet gebundeld (= zelf een normale colli of een bundel-rij). |
| `is_bundel` | `BOOLEAN NOT NULL DEFAULT FALSE` | Markeert de bundel-rij zelf. |

De **bundel-rij** krijgt:
- `is_bundel = TRUE`, `bundel_colli_id = NULL`
- eigen `sscc = genereer_sscc()`
- `gewicht_kg = Σ(kinderen.gewicht_kg)` (overschrijfbaar)
- `lengte_cm = MAX(kinderen.lengte_cm)`, `breedte_cm = MAX(kinderen.breedte_cm)` (overschrijfbaar)
- `order_regel_id = NULL`, `rol_id = NULL` (synthetisch, niet aan één orderregel gekoppeld)
- `klant_omschrijving_snapshot = 'BUNDEL — N colli'`, `omschrijving_snapshot = NULL`
- `colli_nr` = volgend vrij nummer binnen de zending
- `aantal = 1` (CHECK-constraint blijft gelden)

**Het overal-geldende predicaat:** *"negeer rijen waar `bundel_colli_id IS NOT NULL`"* (de kinderen). De effectieve colli van een zending = `WHERE bundel_colli_id IS NULL` → dat zijn de niet-gebundelde colli + de bundel-rijen zelf.

### Waarom deze aanpak (afgewogen alternatief)

- **Gekozen — extra `zending_colli`-rij + zelf-FK:** hergebruikt álle bestaande machinerie ongewijzigd (SSCC-generator, labelrendering, Rhenus-XML-bouwer, colli-seam, pakbon). Het enige nieuwe is één filter-predicaat op de plekken die colli lezen. Minimaal nieuw oppervlak.
- **Verworpen — aparte `zending_bundels`-tabel (bundel → N colli M2M):** explicieter, maar forceert nieuwe joins in label-expansie, `fetch-zending-colli` én de XML-bouwer. Meer oppervlak, meer drift-risico (de klasse waar het HST-overlossing-incident van 12-06-2026 uit voortkwam).

---

## 4. Hold-mechaniek — data-driven, niet hardcoded

Nieuwe kolom `vervoerders.handmatig_aanmelden BOOLEAN NOT NULL DEFAULT FALSE`, op `TRUE` voor `rhenus_sftp`.

[`enqueue_zending_naar_vervoerder`](../../../supabase/migrations/172_zending_trigger.sql) krijgt een parameter `p_handmatig BOOLEAN DEFAULT FALSE`:

- **Auto-trigger** (`fn_zending_klaar_voor_verzending`) roept aan met `p_handmatig = FALSE`. Logica:
  ```
  IF vervoerder.handmatig_aanmelden AND aantal_colli ≥ 2 AND NOT p_handmatig THEN
      RETURN 'held_handmatig';   -- géén enqueue, zending blijft 'Klaar voor verzending'
  END IF;
  -- anders: bestaande dispatch-logica (case op vervoerder_code, mig 380/375)
  ```
- **Knop "Aanmelden bij Rhenus"** roept aan met `p_handmatig = TRUE` → de guard wordt overgeslagen → normale enqueue (`enqueue_rhenus_transportorder`).

Zo blijven HST/Verhoek/NL volautomatisch (vlag = FALSE), en is "vasthouden" een **data-vlag** i.p.v. een hardcoded `'rhenus_sftp'`-string in SQL — consistent met ADR-0030/0034 (capability/keuze data-driven). Een toekomstige vervoerder die ook handmatige vrijgave wil = `UPDATE vervoerders SET handmatig_aanmelden = TRUE`, geen code-edit.

> De auto-trigger vuurt op de statusovergang naar `'Klaar voor verzending'`, en bundeling is een **latere** handmatige actie op zending-detail (die de zending-status niet wijzigt). Op het moment van de telling bestaat er dus nog geen enkele bundel: de guard telt simpelweg het fysieke aantal colli van de zending (`COUNT(*) FROM zending_colli WHERE zending_id = X`, of `zendingen.aantal_colli`). De trigger vuurt daarna niet opnieuw — vrijgeven loopt via een directe `p_handmatig => TRUE`-aanroep, niet via een statuswijziging.

---

## 5. Nieuwe RPC's

### `maak_colli_bundel(p_zending_id BIGINT, p_colli_ids BIGINT[], p_gewicht_kg NUMERIC, p_lengte_cm INTEGER, p_breedte_cm INTEGER) RETURNS BIGINT`
Maakt de bundel-rij (eigen SSCC) en zet `bundel_colli_id` op de aangevinkte kind-colli. Retourneert het id van de bundel-rij.

**Guards (RAISE EXCEPTION):**
- zending bestaat en heeft `vervoerder_code` met `handmatig_aanmelden = TRUE` (= Rhenus);
- zending-status = `'Klaar voor verzending'` (niet al `'Onderweg'`/verzonden);
- `array_length(p_colli_ids) ≥ 2`;
- alle `p_colli_ids` horen bij `p_zending_id`, zijn géén bundel-rij en hebben nog géén `bundel_colli_id` (niet al in een andere bundel);
- gewicht/lengte > 0 (Rhenus-preflight-eis) — bij `NULL`-parameters val terug op `Σ`/`MAX` van de kinderen.

Bij `NULL`-parameters: `gewicht_kg = Σ`, `lengte_cm`/`breedte_cm = MAX` van de kinderen (server-side default; de UI vult ze al voor).

### `verwijder_colli_bundel(p_bundel_colli_id BIGINT) RETURNS VOID`
Ontbundelt: zet `bundel_colli_id = NULL` op de kinderen en verwijdert de bundel-rij. Guard: zending nog niet `'Onderweg'`/verzonden (anders is de bundel al aangemeld).

### Aanmelden (hergebruik)
Geen nieuwe RPC: de knop roept `enqueue_zending_naar_vervoerder(p_zending_id, p_handmatig => TRUE)` aan via een frontend-hook. (Eventueel een dunne wrapper `meld_zending_handmatig_aan(p_zending_id)` voor leesbaarheid/grant — implementatiekeuze in het plan.)

Alle RPC's: `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`, `NOTIFY pgrst`.

---

## 6. Carrier-XML & colli-seam (één filter-plek)

- **Colli-seam** [`fetch-zending-colli.ts`](../../../supabase/functions/_shared/vervoerders/fetch-zending-colli.ts): voeg `bundel_colli_id`/`is_bundel` toe aan de select en filter `bundel_colli_id IS NULL`. Eén plek → Rhenus krijgt de niet-gebundelde colli + de bundel-rijen; HST/Verhoek erven dit gratis maar zien nooit bundels (geen `handmatig_aanmelden`, dus nooit gebundeld).
- Gevolg in de **Rhenus-XML** ([`xml-builder.ts`](../../../supabase/functions/rhenus-send/xml-builder.ts)): bij 7 colli → 4 gebundeld → `colli.length = 4` (3 individueel + 1 bundel) → `totalPackageQuantity = 4`, `totalGrossWeight = Σ alle gewichten` (ongewijzigd, fysiek totaal blijft gelijk). De bundel-rij is gewoon één item met de bundel-SSCC, `Weight = Σ kinderen`, `depth = MAX lengte`. Geen wijziging aan de XML-bouwer zelf nodig — de filter in de seam regelt alles.
- **`valideerRhenusColli`** ziet ook alleen de effectieve colli; de bundel-rij voldoet aan de preflight (sscc + gewicht + lengte > 0).

---

## 7. Label-expansie & bundelsticker printen

- **`bouwVerzenddocument`** [`printset.ts`](../../../frontend/src/modules/logistiek/lib/printset.ts): de printset-query haalt `bundel_colli_id`/`is_bundel` erbij; `colliRijen` filtert `bundel_colli_id IS NULL`. Zo tonen de labels de niet-gebundelde colli + de bundel-rijen (3 + 1 = 4), niet de kinderen.
- **De bundel-rij rendert via het bestaande label-component** ([`shipping-label.tsx`](../../../frontend/src/modules/logistiek/components/shipping-label.tsx)) — geverifieerd: `productNamen`/`productMaat` accepteren `regel = null` en lezen de snapshot. `klant_omschrijving_snapshot = 'BUNDEL — N colli'` verschijnt als de prominente regel; `labelBarcode(sscc)` levert de barcode; adres + order-ref staan al op het label. De labelvariant (compact/staand) is data-driven per vervoerder, dus geen nieuwe component.
- **Bundelsticker printen = 1 label.** Nieuwe knop "Print bundelsticker" opent de single-zending printset met een filter op alleen de bundel-rij(en) van die zending (bv. query-param `?colli=<bundel_colli_id>` of `?alleenBundels=1`). De eerder geprinte individuele stickers worden **niet** opnieuw geprint.
- **Pakbon: ongewijzigd.** `pakbonRegels` wordt opgebouwd uit `zending_regels` (per orderregel), niet uit colli — colli-bundeling raakt de pakbon dus niet.
- Cosmetisch detail: "X VAN Y" op de bundelsticker toont de effectieve telling; de reeds geprinte individuele stickers (met de oude "x van 7") blijven fysiek op de tapijten in de zak en worden genegeerd. Geen herprint.

---

## 8. UI — sectie op zending-detail

Op [`zending-detail.tsx`](../../../frontend/src/modules/logistiek/pages/zending-detail.tsx), **alleen zichtbaar** bij `vervoerder_code = 'rhenus_sftp'` (resp. `handmatig_aanmelden`) **én** status = `'Klaar voor verzending'` **én** ≥2 colli:

- **Colli-lijst met checkboxes** — alle colli van de zending; bestaande bundels apart getoond met hun kinderen eronder.
- **"Bundelen"** (enabled bij ≥2 aangevinkt) → dialog met voorgevuld gewicht (`Σ`) + lengte/breedte (`MAX`), bij te stellen → bevestigen → `maak_colli_bundel`.
- Per bundel: **"Print bundelsticker"** en **"Ontbundelen"** (`verwijder_colli_bundel`).
- **"Aanmelden bij Rhenus"** = de uiteindelijke vrijgave (`enqueue_zending_naar_vervoerder(..., p_handmatig => TRUE)`). Na klik: zending gaat naar de Rhenus-wachtrij → cron → `'Onderweg'`.
- **Zichtbaar "wacht op vrijgave"-signaal** zodat een vastgehouden zending niet vergeten wordt: een statuschip op zending-detail + een tellertje op de Rhenus-verzendmonitor (`rhenus_verzend_monitor` / een aparte view "Rhenus wacht op vrijgave" = niet-verzonden Rhenus-zendingen op `'Klaar voor verzending'` met ≥2 colli en zonder `rhenus_transportorders`-rij).

---

## 9. Wat bewust NIET verandert

- **HST, Verhoek, NL-vervoerders:** ongewijzigd, blijven volautomatisch aanmelden (vlag = FALSE).
- **Pakbon, factuur, gewicht-keten, SSCC-generator, labelbarcode-seam:** ongewijzigd — de bundel hergebruikt ze.
- **`genereer_zending_colli`:** ongewijzigd — bundeling is een aparte, latere RPC-actie.
- **Bestaande individuele stickers:** blijven fysiek op de niet-gebundelde tapijten; geen herprint.

---

## 10. Testen (vangnet)

- **SQL:** `maak_colli_bundel`/`verwijder_colli_bundel` guards (status, ≥2 colli, dubbele bundeling, vreemde zending, niet-Rhenus). Hold-guard in `enqueue_zending_naar_vervoerder`: ≥2-colli Rhenus blijft op `'Klaar voor verzending'`; `p_handmatig=TRUE` enqueuet wél; 1-colli Rhenus enqueuet automatisch.
- **Edge:** `fetch-zending-colli` filtert kinderen, telt effectief; Rhenus `xml-builder.test.ts` — bundel als 1 item, `totalPackageQuantity`/`totalGrossWeight` kloppen.
- **Frontend:** `printset.test.ts` — bundel filtert kinderen, effectieve telling; bundel-rij rendert met snapshot-tekst + barcode.

---

## 11. Verticale slices (volgorde voor het plan)

1. **DB-fundament:** kolommen (`zending_colli.bundel_colli_id`/`is_bundel`, `vervoerders.handmatig_aanmelden`) + `maak_colli_bundel`/`verwijder_colli_bundel` + hold-guard in `enqueue_zending_naar_vervoerder`. Migratie(s).
2. **Carrier-zijde:** colli-seam-filter + Rhenus XML-verificatie + tests. (Bundel telt als 1 collo richting Rhenus.)
3. **Label-zijde:** printset-query + `bouwVerzenddocument`-filter + bundelsticker-print-pad + tests.
4. **UI:** colli-bundel-sectie op zending-detail (lijst + bundelen + print + ontbundelen + aanmelden) + "wacht op vrijgave"-signaal.
5. **Docs:** CLAUDE.md-bullet (colli-bundeling, "niet te verwarren"-scheiding), changelog, order-lifecycle indien geraakt.

---

## 12. Aandachtspunten / open bij implementatie

- **Migratienummer:** bepaal het nummer vlak vóór merge opnieuw t.o.v. `origin/main` (parallelle sessies claimen nummers — zie de migratie-collisie-historie).
- **Worktree mist `.env`/`node_modules`:** voor frontend-typecheck/tests in deze worktree eerst `npm install` (of node_modules linken) regelen; edge-tests draaien via Deno.
- **`aantal_colli`-sync:** beslis of `zendingen.aantal_colli` na bundeling de effectieve telling moet tonen (display) of de fysieke. De Rhenus-XML gebruikt sowieso de effectieve `colli.length` uit de seam.
- **Bundelsticker-print-filter:** exacte query-param/route-vorm kiezen in het plan (filter op de single-zending printset vs. een dunne aparte print-actie).
