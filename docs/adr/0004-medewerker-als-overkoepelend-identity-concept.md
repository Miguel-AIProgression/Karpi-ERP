---
status: accepted
date: 2026-05-07
---

# Medewerker als overkoepelend identity-concept; vertegenwoordigers worden rol-tag

## Context

De methodiek-vraag van Miguel ("op het moment dat je stickers uitdraait moet je de persoon — picker — kiezen die deze order gaat pakken") legde een gat bloot in de Magazijn-Module: er bestond geen tabel of seam voor "wie pickt deze zending?". `start_pickronde` (mig 211) en `voltooi_pickronde` (mig 211) accepteerden geen actor, en `zending_colli.gepickt_at` was een audit-timestamp zonder actor — een audit-trail die niet auditeerde.

Tegelijkertijd bestond `vertegenwoordigers` al als volwaardig domeinconcept: een eigen tabel met `code` (3-4 letter PK), `naam`, contact-info, een werkdagen-satelliet (mig 195), klant-koppeling (`klanten.vertegenwoordiger_code`) en order-snapshot (`orders.vertegenwoordiger_code`). Een tweede parallelle "pickers"-tabel zou een dubbel registratiekanaal voor mensen-binnen-Karpi creëren, en bij volgende rollen (magazijnchef voor de Pick-problemen-werklijst van ADR-0003, inkopers, etc.) explosief groeien.

De methodiek-vraag dwong dus een fundamentelere keuze af dan alleen "voeg `picker_id` toe": **wat is in dit ERP een persoon?**

## Beslissing

Introduceer **Medewerker** als overkoepelend identity-concept. Eén tabel `medewerkers`, één rij per persoon, multi-rol via een `rollen medewerker_rol[]`-array.

```sql
CREATE TYPE medewerker_rol AS ENUM ('vertegenwoordiger', 'picker');

CREATE TABLE medewerkers (
  id        BIGSERIAL PRIMARY KEY,
  naam      TEXT NOT NULL,
  code      TEXT UNIQUE,                                -- alleen vertegenwoordigers
  email     TEXT,
  telefoon  TEXT,
  actief    BOOLEAN NOT NULL DEFAULT TRUE,
  rollen    medewerker_rol[] NOT NULL DEFAULT '{}'
);
```

### Migratie van bestaande `vertegenwoordigers`

- **Hernoem** `vertegenwoordigers` → `medewerkers`. Voeg `id BIGSERIAL`, `rollen` en evt. ontbrekende kolommen toe; zet `rollen={'vertegenwoordiger'}` als default voor bestaande rijen.
- **`code`-kolom blijft ongemoeid.** Pickers krijgen NULL — `code` is een rol-specifiek attribuut van vertegenwoordigers (gebruikt in `klanten.vertegenwoordiger_code`, `orders.vertegenwoordiger_code`).
- **FK's hoeven niet hernoemd**: `klanten.vertegenwoordiger_code` blijft FK op `medewerkers.code`. De kolomnaam beschrijft de *rol-relatie*, niet de tabelnaam — semantisch klopt dit.
- **`vertegenwoordiger_werkdagen` (mig 195)** blijft als rol-specifieke satelliet, FK naar `medewerkers.id`. Andere rollen kunnen op termijn eigen satellieten krijgen zonder de hoofdtabel te raken.

### Geen Supabase-Auth-koppeling

Pickers en kantoor-medewerkers werken op shared devices. Een individuele login-flow op de magazijnvloer is operationeel zwaar (badge-scan, PIN, logout-vergeet-bug). Dropdown-self-select is goed genoeg voor V1 audit-trail. RLS-filters op `auth.uid()` zijn dus niet beschikbaar voor de Picker-flow — dat accepteren we omdat het magazijn een gedeelde fysieke werkplek is, niet een per-user beveiligde context.

### UI-organisatie

Een nieuwe `/instellingen/medewerkers`-pagina met sub-tabs *Vertegenwoordigers* en *Pickers*. Filtering gebeurt op `'vertegenwoordiger' = ANY(rollen)` resp. `'picker' = ANY(rollen)`. Toekomstige rollen krijgen automatisch een tab.

## Overwogen alternatieven

- **Aparte `pickers`-tabel naast `vertegenwoordigers`** — afgewezen na grilling. Iemand met dubbele rol moet twee keer ingevoerd; bij elke nieuwe rol (magazijnchef, inkoper) explodeert het aantal mensen-tabellen; het Medewerker-concept is daarmee impliciet en verspreid.
- **Iedere medewerker een Supabase auth-account** — afgewezen. Geen operationeel pad voor shared-device login op het magazijn binnen V1. Toekomst staat open: medewerkers kunnen optioneel een `auth_user_id` krijgen wanneer zelf-login zinvol wordt (bijv. kantoorgebruikers). Tabel-structuur staat dat al toe — kolom kan later toegevoegd zonder breuk.
- **Polymorfe tabel `actoren` met `actor_type` ('medewerker' | 'auth_user')** — afgewezen als overengineering voor V1. Eén concept (Medewerker) is genoeg.
- **`rollen`-koppeltabel `medewerker_rollen (medewerker_id, rol)`** — afgewezen. Genormaliseerd maar zonder leverage in V1: er zijn geen rol-instantie-attributen die per rol verschillen (vertegenwoordiger-werkdagen zit al in een eigen satelliet-tabel). Een TEXT/enum-array op de hoofdrij houdt queries plat.

## Consequenties

- **Migratie (volgnr 216 — collisions met WIP-mig 214 normaliseer_land en WIP-mig 215 preview_vervoerder_voor_order vermeden):**
  1. Maak enum `medewerker_rol`.
  2. Hernoem tabel `vertegenwoordigers` → `medewerkers`; voeg `id BIGSERIAL`, `rollen` toe.
  3. Backfill `rollen={'vertegenwoordiger'}` voor alle bestaande rijen.
  4. Werk `vertegenwoordiger_werkdagen.medewerker_id` bij (was waarschijnlijk al gekoppeld op `code` of nieuwe FK toevoegen).
  5. Update views/RPCs die `vertegenwoordigers` als bron noemden — meeste blijven werken via `medewerkers WHERE 'vertegenwoordiger' = ANY(rollen)`.
- **Frontend:** route `/vertegenwoordigers` blijft als alias of redirect naar `/instellingen/medewerkers?tab=vertegenwoordigers`. Bestaande detail-pagina + werkdagen-tab blijven hergebruikt — alleen de overzicht-pagina wordt onder de medewerkers-tab geplaatst.
- **Tests:** RPC-contract-tests rond Pickronde (volgt in ADR-0005) krijgen een `picker_id`-parameter en kunnen audit-writes valideren. Vertegenwoordiger-omzet-queries blijven onaangetast.
- **Toekomst:** rollen `magazijnchef` (voor Pick-problemen-werklijst, ADR-0003), `inkoper` (voor inkooporders), etc. zijn additieve enum-uitbreidingen — geen nieuwe tabellen.
- **Domeinwoordenboek:** termen *Medewerker*, *Rol (medewerker)*, *Picker* toegevoegd; *Vertegenwoordiger* gewijzigd naar rol-definitie. Sectie "Medewerkers & Rollen" geïntroduceerd.
