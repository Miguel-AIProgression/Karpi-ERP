# Spec 10 — Confectie-planning

Status: **Draft** · 2026-04-13 · Auteur: Miguel

## Doel
Naast de bestaande Confectielijst een **planning / agenda-weergave** voor confectie-orders, analoog aan de snijplanning. Planner ziet per afwerkingstype wanneer welk stuk geconfectioneerd wordt, inclusief geschatte eindtijd en of het op tijd voor de leverdatum klaar is.

## Context
- `confectie_orders` bevat stukken met `type_bewerking` (breedband, smalband, feston, smalfeston, locken, volume afwerking, stickeren) — gevuld door [`052_confectie_doorstroom_na_snijden.sql`](../supabase/migrations/052_confectie_doorstroom_na_snijden.sql) op basis van `order_regels.maatwerk_afwerking`.
- Snijplanning gebruikt al een werkagenda-berekening in [bereken-agenda.ts](../frontend/src/lib/utils/bereken-agenda.ts) + [werktijden-config.tsx](../frontend/src/components/snijplanning/werktijden-config.tsx). Dat werkschema (werkdagen, start/eind, pauze) wordt **gedeeld** met confectie — zelfde ploeg, zelfde uren.

## Kern-aannames
1. **Eén station per afwerkingstype**, dus afwerkingen kunnen **parallel** lopen (breedband + feston tegelijk), maar **binnen één type serieel** (niet twee stuks breedband tegelijk).
2. Planning-eenheid is **strekkende meter**. Rechthoek: `MAX(lengte, breedte) / 100`. Rond/ovaal: **omtrek** = `π × MAX(lengte, breedte) / 100` (feston/locken lopen langs de rand).
3. Tijd per stuk = `strekkende_meter × minuten_per_meter[type] + wisseltijd[type]`. Wisseltijd staat voor het pakken/wegleggen van het volgende tapijt.
4. `type_bewerking = 'stickeren'` (ON/ZO) is **geen confectiewerk** — blijft wel zichtbaar in de lijst maar krijgt geen planning-slot.
5. Volgorde binnen een station = **leverdatum oplopend**, tiebreak op `confectie_nr`.
6. Werkschema (dagen/tijden/pauze) is **globaal**, gedeeld met snijplanning via localStorage key `karpi.werkagenda.werktijden` (we hernoemen `karpi.snijagenda.werktijden` → generiek; met fallback migratie).

## Database wijzigingen (migratie 053)

### Nieuwe tabel `confectie_werktijden`
| Kolom | Type | Toelichting |
|-------|------|-------------|
| type_bewerking | TEXT PK | 'breedband', 'smalband', 'feston', 'smalfeston', 'locken', 'volume afwerking', 'stickeren' |
| minuten_per_meter | NUMERIC(6,2) NOT NULL | Bijv. 2.5 |
| wisseltijd_minuten | INTEGER NOT NULL DEFAULT 5 | Pakken + wegleggen volgend stuk |
| actief | BOOLEAN NOT NULL DEFAULT true | False = type wordt niet gepland (bv. stickeren) |
| bijgewerkt_op | TIMESTAMPTZ DEFAULT NOW() | |

Seed-rijen met redelijke defaults (aanpasbaar via UI):
- breedband: 3 min/m, wissel 5 min
- smalband: 2 min/m, wissel 5 min
- feston: 6 min/m, wissel 5 min
- smalfeston: 5 min/m, wissel 5 min
- locken: 1 min/m, wissel 3 min
- volume afwerking: 4 min/m, wissel 5 min
- stickeren: 0 min/m, wissel 0 min, `actief=false`

RLS: lezen voor alle auth users, schrijven voor planners (zelfde pattern als andere config-tabellen).

### View `confectie_planning_overzicht`
Query die per rij het volgende oplevert voor de frontend:
- `confectie_id`, `confectie_nr`, `scancode`, `status`
- `type_bewerking`
- `order_regel_id`, `order_nr`, `klant_naam`, `afleverdatum`
- `kwaliteit_code`, `kleur_code`
- `lengte_cm`, `breedte_cm`, `vorm`, `strekkende_meter_cm` (= GREATEST(lengte,breedte))
- Alleen rijen met `status IN ('Wacht op materiaal', 'In confectie')` — 'Gereed' en 'Ingepakt' worden niet gepland.

## Frontend wijzigingen

### Gedeelde utilities — refactor eerst
- Hernoem `karpi.snijagenda.werktijden` localStorage key → `karpi.werkagenda.werktijden`, met backwards-compat read van de oude key.
- Verplaats `useWerktijden`/`WerktijdenConfig` naar [`frontend/src/components/werkagenda/werktijden-config.tsx`](../frontend/src/components/werkagenda/) (nieuw), hergebruikt door snij & confectie.
- `bereken-agenda.ts` krijgt een generieke `berekenLanes(items, werktijden, resolveDuur)` die per "lane-key" een tijdlijn bouwt. Snijplanning gebruikt rolId als lane-key (1 lane); confectie gebruikt `type_bewerking` als lane-key.

### Nieuwe module `frontend/src/pages/confectie/confectie-planning.tsx`
- Route: `/confectie/planning` (naast bestaande `/confectie` overview).
- Tabs of toggle bovenaan: **Lijst** (huidig) · **Planning** (nieuw).
- Planning view:
  - `WerktijdenConfig` bovenaan (gedeeld).
  - `ConfectieTijdenConfig` accordion (nieuw): tabel met alle `type_bewerking` rijen, inline bewerkbaar `minuten_per_meter` + `wisseltijd_minuten`.
  - Per actief type één **lane/kolom**: kop met type-naam + aantal stuks + totale duur. Onder elkaar de blokken met klant/order/maat/leverdatum, rood gemarkeerd als eind > leverdatum.
  - Stukken met inactief type (stickeren) worden onderaan gegroepeerd als "Geen confectie — alleen stickeren".

### Componenten
- [`frontend/src/components/confectie/confectie-tijden-config.tsx`](../frontend/src/components/confectie/) — tabel met tijden per type.
- [`frontend/src/components/confectie/lane-kolom.tsx`](../frontend/src/components/confectie/) — één tijdlijn-kolom per type.
- [`frontend/src/components/confectie/confectie-blok-card.tsx`](../frontend/src/components/confectie/) — individueel gepland stuk.

### Queries
- `frontend/src/lib/supabase/queries/confectie-planning.ts`
  - `fetchConfectiePlanning()` → view `confectie_planning_overzicht`
  - `fetchConfectieWerktijden()` / `updateConfectieWerktijd(type, velden)`
- `frontend/src/hooks/use-confectie-planning.ts` — TanStack Query hook.

## Scope buiten deze spec
- Daadwerkelijk starten/voltooien via scan is al in place (`scanstation`). Planning is louter een plannings-/zichtlaag.
- Capaciteit per station (meerdere machines per type) — voorlopig 1 station per type.
- Drag-and-drop herordening — V1 is automatische volgorde op leverdatum.
- Gantt-achtige cross-day visualisatie — V1 toont per lane gewoon sequentieel met start/eind-tijd per blok.

## Oplevering volgorde
1. Migratie 053 (tabel + seed + view + RLS) + `docs/database-schema.md` updaten.
2. Refactor werktijden + `bereken-agenda` naar generieke lanes-vorm; snijplanning blijft werken.
3. Confectie-planning pagina + componenten + queries.
4. `docs/changelog.md` + `docs/architectuur.md` updaten.

## Beslissingen
- Ronde/ovale stukken → **omtrek** (`π × langste zijde`) als strekkende meter.
- Werkschema is **globaal** gedeeld met snijplanning (één localStorage key).
