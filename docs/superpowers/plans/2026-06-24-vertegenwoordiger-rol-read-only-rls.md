# Plan: externe vertegenwoordiger-rol (read-only, eigen klanten via RLS) + taal

**Datum:** 2026-06-24
**Aanleiding:** WhatsApp Piet-Hein — login voor vertegenwoordiger Guido Boecker (Duitser). Wil read-only inzicht, bij voorkeur alleen eigen klanten, en de UI in het Duits.
**Status:** plan — nog niet gebouwd.

## Beslissingen (vastgelegd met Miguel, 24-06)

1. **Taal = browser-vertaling.** Geen code. Geen app-i18n in deze ronde.
2. **Rol-scope = read-only + alleen eigen klanten, afgedwongen via RLS.** Niet frontend-only; niet "ziet alle klanten".

## Uitgangssituatie (wat al ligt)

- `medewerkers`-tabel met `code` (TEXT UNIQUE) + `rollen medewerker_rol[]` incl. `'vertegenwoordiger'` (mig 216).
- `debiteuren.vertegenw_code` (FK → `medewerkers.code`, **NOT NULL**) — elke klant heeft een rep.
- `orders.vertegenw_code` (FK → `medewerkers.code`, **NULLABLE** — webshop/Floorpassion = NULL).
- Menugroep **"Commercieel"** in `NAV_GROUPS` (`frontend/src/lib/utils/constants.ts`).
- Klantdocumenten (orderbevestiging + factuur) zijn al 4-talig via `fact_land` → Guido's Duitse klanten krijgen nu al Duitse PDF's.
- Gebruikersbeheer via edge function `gebruikers-beheer` (service-role, kan `app_metadata` zetten).
- RBAC-patroon bestaat alleen voor bug-beheer: `is_bug_beheerder()` SQL-functie leest het JWT-emailclaim (mig 342) + frontend-spiegel `frontend/src/lib/bug/beheerder.ts`.

## Wat ontbreekt

- `useAuth()` geeft geen rol; sidebar/routes tonen alles aan iedereen.
- Geen auth↔medewerker-koppeling (een login weet niet "ik ben rep 19").
- RLS staat overal op `authenticated = true` (behalve `bug_meldingen`) → DB filtert nu niets per gebruiker.

---

## Deel A — Taal (geen code)

Guido zet in Chrome/Edge eenmalig "Vertaal naar Duits" aan (de browser onthoudt dit per site). Klaar. Opwaarderen naar een echte `react-i18next`-toggle op alleen de rep-schermen kan later zonder iets terug te draaien — buiten scope nu.

## Deel B — Vertegenwoordiger-rol

### Kerninzicht

De frontend praat via de anon-key met de DB. Eén set **RLS-policies** op `orders` + `debiteuren` (+ `order_regels`, `facturen`) filtert daardoor **automatisch elke query op elke pagina** — niet "per pagina instellen" (Piet-Heins zorg). RLS is hier de luie én de veilige optie.

**Filtersleutel = de klant, niet de order.** `debiteuren.vertegenw_code` is NOT NULL; `orders.vertegenw_code` kan NULL zijn. Filter orders dus via hun debiteur. Dat matcht "zijn gekoppelde klanten" en sluit NULL-orders vanzelf uit.

### Stap 1 — Account krijgt een rol

- `supabase/functions/gebruikers-beheer/index.ts`: bij uitnodigen/aanmaken optioneel
  `app_metadata: { rol: 'vertegenwoordiger_extern', vertegenw_code: '<code>' }` meegeven.
  **`app_metadata`, niet `user_metadata`** — alleen service-role kan dat zetten, dus de rep kan zijn eigen rol/scope niet ophogen.
- `frontend/src/lib/supabase/queries/gebruikers.ts`: nieuwe params doorgeven.
- Gebruikersbeheer-UI (onder Systeem): rol-keuze + dropdown met `medewerkers` waar `'vertegenwoordiger' = ANY(rollen)`.

### Stap 2 — Frontend beperkt zich (read-only UX)

- `frontend/src/hooks/use-auth.ts`: `rol` + `vertegenwCode` uit `session.user.app_metadata` exposen.
- `frontend/src/lib/utils/constants.ts` + `frontend/src/components/layout/sidebar.tsx`: bij `vertegenwoordiger_extern` alleen **Dashboard + Orders + Klanten + Facturatie** tonen (Prijslijsten, Vertegenwoordigers-beheer, Samples bewust eruit).
- `frontend/src/router.tsx`: kleine `RoleGuard` die niet-toegestane paden terugstuurt naar `/orders`.
- Schrijf-affordances verbergen op de rep-pagina's:
  - `frontend/src/pages/orders/orders-overview.tsx` — knop "Nieuwe order".
  - order-detail — bewerk-/verwijder-/statusknoppen.
  - `frontend/src/pages/klanten/klant-detail.tsx` — directe mutatie-controls (gratis verzending, verzendkosten, etc.).

### Stap 3 — DB dwingt het af (één migratie — de echte beveiliging)

Patroon spiegelt `is_bug_beheerder()` (mig 342).

- Helpers:
  - `is_externe_vertegenwoordiger()` → `(auth.jwt() -> 'app_metadata' ->> 'rol') = 'vertegenwoordiger_extern'`.
  - `huidige_vertegenw_code()` → `(auth.jwt() -> 'app_metadata' ->> 'vertegenw_code')`.
- RLS-policies op `orders`, `order_regels`, `debiteuren`, `facturen` (+ `factuur_regels`):
  - **SELECT:** filter alléén als `is_externe_vertegenwoordiger()`; anders `USING (true)` → normale gebruikers ongemoeid.
    - `debiteuren`: `vertegenw_code = huidige_vertegenw_code()`.
    - `orders`: bestaat een debiteur met `debiteur_nr = orders.debiteur_nr AND vertegenw_code = huidige_vertegenw_code()`.
    - `order_regels` / `facturen` / `factuur_regels`: via EXISTS op de bijbehorende order/debiteur.
  - **INSERT/UPDATE/DELETE:** geblokkeerd voor de rol (`WITH CHECK (NOT is_externe_vertegenwoordiger())`). Vangt directe tabel-writes (zoals `klant-detail`).
- Views `security_invoker = true`: `orders_list` + de facturen-view (anders draaien views als owner en omzeilen ze RLS). Snijplanning/Pick&Ship zitten niet in het rep-menu → in v1 niet nodig.

### Bekende grens (bewuste shortcut)

`SECURITY DEFINER`-schrijf-RPC's (`create_order_with_lines`, `update_order_with_lines`, …) omzeilen RLS. De rep heeft er geen UI voor en het dreigingsmodel is een niet-technische externe verkoper, niet een aanvaller. **Upgrade-pad:** één `is_externe_vertegenwoordiger()`-guard vooraan in die RPC's zodra een echte adversaire dreiging ontstaat.

## Indirecte koppelingen — Piet-Heins edge case ("dat soort dingen")

Zorg (PH 24-06): een inkooporder die de order van rep A bedient, bedient óók orders van klanten van een andere rep. Ziet rep A dan andermans data?

**Principe:** de rep bereikt alleen Orders/Klanten/Facturatie. Alles wat over klanten heen loopt (inkoop, productie) zit in modules die níét in zijn menu/routes staan. RLS dekt de bereikbare tabellen; de rest is simpelweg onbereikbaar. Cruciaal verschil met frontend-only filtering: dáár zou zo'n indirecte join wél lekken.

Per koppeling:
- **Inkooporder / IO-claim** — dít is de énige plek waar één object echt klanten van meerdere reps deelt. Mitigatie: rep heeft géén Inkoop-tab. Op zijn eigen order-detail ziet hij alleen de afgeleide claim van zíjn order ("gedekt door inkoop, ETA X"); `fetchClaimsVoorOrder` is order-gescoped en somt nooit de andere orders op die op dezelfde IO zitten. → **Nooit** een IO-detail of "wie zit nog op deze IO"-view aan de rep tonen.
- **Bundel-zending (mig 222)** — bundelt alleen binnen dezelfde debiteur → per rep, geen cross-rep-lek.
- **Verzamelfactuur (wekelijks, mig 231-232)** — één factuur per (debiteur, week) → per rep.
- **Snijplan / productie** — niet in rep-menu; order-detail toont alleen het eigen stuk.
- **Prijslijsten** — uit het menu (gedeeld over klanten).

Conclusie: alle indirecte koppelingen behalve de IO zijn per-debiteur en dus per-rep gescoped. De IO is afgevangen doordat de rep de inkoop-laag niet bereikt en zijn order-detail alleen order-gescopede claim-data toont.

## Bouwvolgorde

1. Stap 1 (account-rol) — klein.
2. Stap 3 (RLS-migratie) — het fundament; ~halve dag.
3. Stap 2 (UI: menu + knoppen verbergen) — ~dag.

Branch: `feat/vertegenwoordiger-rol`.

## Definition of done

- Testaccount met `rol=vertegenwoordiger_extern`, `vertegenw_code=<X>`:
  - ziet in sidebar alleen Dashboard/Orders/Klanten/Facturatie;
  - ziet in orderlijst, klantlijst en facturatie **uitsluitend** klanten met `vertegenw_code = X` (geverifieerd in DB, niet alleen UI);
  - kan nergens opslaan/aanmaken/verwijderen — knoppen weg én een directe `update` op `debiteuren` faalt op RLS;
  - directe API-call naar een order van een ándere rep geeft geen rijen terug.
  - **IO-edge case (PH):** een rep-order met een IO-claim die óók een andere debiteur bedient, toont op order-detail geen spoor van die andere order/debiteur.
- Normale gebruiker (geen rol-claim): gedrag volledig ongewijzigd.
- Docs bijwerken: `docs/database-schema.md` (RLS-policies), `docs/architectuur.md` (RBAC-patroon), `docs/changelog.md`.
