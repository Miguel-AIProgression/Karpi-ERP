# Organische Vormen Maatwerk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uitbreiden van de op-maat-flow zodat de gebruiker bij maatwerk-tapijt een vorm (Rechthoek + 6 aparte vormen: Organic, Organic Gespiegeld, Pebble, Ellips, Ovaal, Afgeronde Hoeken) kan kiezen, met per vorm passende vaste maten of (waar toegestaan) afwijkende maten, en een correcte prijs- en snij-margeberekening conform de Karpi-prijslijst (m²-prijs × oppervlak + €75 vorm-toeslag voor de 6 aparte vormen). Ronde tapijten (incl. "Cloud" Ø200/Ø250) worden buiten dit plan geleverd als losse voorraadproducten — de bestaande `rond`-vorm blijft in de DB voor backwards compatibility maar krijgt geen toeslag en geen chips.

**Architecture:** Vormen blijven datagedreven via tabel `maatwerk_vormen`; uitbreiding gebeurt via INSERT van 4 nieuwe vorm-rijen + 1 nieuwe (smalle) tabel `maatwerk_vorm_maten` voor de per-vorm vaste maat-suggesties. Frontend voegt grafische vorm-keuze + chip-selectie toe aan [`vorm-afmeting-selector.tsx`](../../../frontend/src/components/orders/vorm-afmeting-selector.tsx). Beach Life-exclusie wordt gehandhaafd door een `kwaliteiten.alleen_recht_maatwerk` flag die de UI toepast op de vormen-lijst.

**Tech Stack:** Supabase (Postgres) migraties, React/TS + TanStack Query, Tailwind, bestaande utility-helpers in `frontend/src/lib/utils/maatwerk-prijs.ts` en `frontend/src/lib/utils/snij-marges.ts`.

---

## ⚠️ OPEN VRAGEN

> **Migratie-nummering:** in de current branch is `178_order_documenten.sql` al bezet. Plan-migraties zijn daarom **179–183** (was 178–182).

### ✅ Beantwoord (2026-05-01)

1. **Vorm-toeslag €75:** alleen voor de **6 aparte vormen uit de afbeelding** — Organic, Organic Gespiegeld, Pebble, Ellips, Ovaal, Afgeronde Hoeken. **Rond + Cloud krijgen GEEN toeslag** (ronde tapijten worden geleverd via voorraadproducten zoals 771110031, niet via deze maatwerk-vorm-flow).

8. **Rond vs. Cloud:** Cloud verdwijnt uit het plan (geen DB-rij in `maatwerk_vormen`, geen chips, geen iconen). Bestaande `rond` blijft in `maatwerk_vormen` met `toeslag=0`, `kan_afwijkende_maten=true` (= bestaand gedrag). Geen wijzigingen aan rond.

### ❓ Nog te beantwoorden (defaults gelden bij geen reactie)

2. **Beach Life-uitsluiting:** kwaliteit-code is `BEAC` — moet ook variant `BEAB` (BREDA) uitgesloten worden, of alleen `BEAC`? *(Aanname: alleen `BEAC`.)*

3. ~~Cloud-diameters~~ → vervallen (Cloud niet in plan).

4. **Afwijkende maten — toegestaan voor:** alleen Ovaal en Afgeronde Hoeken (zoals afbeelding suggereert). Of ook Organic-varianten? *(Aanname: alleen Ovaal + Afgeronde Hoeken hebben "afwijkende maten" toegestaan; Organic/Pebble/Ellips/Organic Gespiegeld vereisen één van de 4 vaste maten.)*

5. **Snij-marge nieuwe vormen:** alle 6 nieuwe vormen +5cm marge zoals huidige rond/ovaal? *(Aanname: ja, +5cm.)*

6. **Levertijd 6 weken:** vast voor alle 6 vormen, configureerbaar via `app_config.order_config.inkoop_buffer_weken_vormwerk = 6`? *(Aanname: ja.)*

7. **Bestaande voorraadproducten "ORGANISCH" (artikelnr 771110031–034):** ongewijzigd, geen link met maatwerk-vorm-flow? *(Aanname: ja.)*

---

## File Structure

**Database — Nieuwe migraties (179–183, want 178 is al `178_order_documenten.sql`):**
- `supabase/migrations/179_maatwerk_vormen_uitbreiding.sql` — INSERT 4 nieuwe vormen (pebble, ellips, organic_gespiegeld-rename, afgeronde_hoeken), UPDATE toeslagen bestaande organische naar €75, ADD kolom `kan_afwijkende_maten BOOLEAN`.
- `supabase/migrations/180_maatwerk_vorm_maten.sql` — CREATE TABLE `maatwerk_vorm_maten` met seed-rows voor de 6 lengte_breedte vormen.
- `supabase/migrations/181_snij_marge_vormen_uitbreiding.sql` — UPDATE `stuk_snij_marge_cm()` om alle 6 nieuwe vorm-codes op +5cm te zetten.
- `supabase/migrations/182_beach_life_kwaliteit_flag.sql` — ADD `kwaliteiten.alleen_recht_maatwerk BOOLEAN DEFAULT false`, UPDATE BEAC → true.
- `supabase/migrations/183_app_config_vormwerk_levertijd.sql` — UPDATE `app_config.order_config` JSONB met `inkoop_buffer_weken_vormwerk = 6`.

**Frontend — Wijzigen:**
- `frontend/src/lib/supabase/queries/op-maat.ts` (regels 5–32) — type `MaatwerkVormRow` aanvullen met `kan_afwijkende_maten`; nieuwe queries `fetchVormMaten(vormCode)`, `fetchKwaliteitMaatwerkBeperking(kwaliteitCode)`.
- `frontend/src/lib/utils/snij-marges.ts` (regels 1–28) — `RONDE_VORMEN` set uitbreiden met alle nieuwe vorm-codes.
- `frontend/src/lib/utils/maatwerk-prijs.ts` (regels 5–18) — ongewijzigd; bestaande `vorm === 'rond'`-check voor diameter² blijft geldig (alle nieuwe vormen zijn `lengte_breedte`).
- `frontend/src/components/orders/vorm-afmeting-selector.tsx` — uitbreiding met:
  - vorm-tile grid (icoontjes/SVG-thumbnails) i.p.v. dropdown.
  - vaste-maat-chips per vorm.
  - "Afwijkende maten" toggle (alleen zichtbaar als `vorm.kan_afwijkende_maten === true`).
  - Beach Life-flag: filtert vormen-lijst tot alleen rechthoek.
- `frontend/src/components/orders/op-maat-selector.tsx` (regels 142–149) — extra query voor `kwaliteit.alleen_recht_maatwerk`; doorgeven aan `VormAfmetingSelector`.

**Frontend — Nieuw:**
- `frontend/src/components/orders/vorm-tegel.tsx` — herbruikbare visuele tegel per vorm (SVG icoontje + naam).
- `frontend/src/lib/icons/vormen/` — SVG paths voor de 8 vormen (rechthoek, rond, ovaal, organic, organic-gespiegeld, pebble, ellips, afgeronde-hoeken).

**Documentatie — Bijwerken:**
- `docs/database-schema.md` — toevoegen `maatwerk_vorm_maten`, `kwaliteiten.alleen_recht_maatwerk`, vernieuwde `maatwerk_vormen` met `kan_afwijkende_maten`.
- `docs/data-woordenboek.md` — termen "vorm-toeslag", "afwijkende maten", "alleen recht maatwerk".
- `docs/changelog.md` — entry "2026-05-01 — Organische vormen voor maatwerk".
- `CLAUDE.md` — bedrijfsregel "Vorm-maatwerk" toevoegen.

**Tests:**
- Geen aparte test-runner in dit project (geen vitest/jest config aanwezig in frontend). Verificatie gebeurt via:
  - Postgres-migratie in lokale Supabase (`supabase db reset` of `supabase db push`) → handmatig SELECT-checks.
  - Frontend manual test in dev-server (`pnpm dev` of `npm run dev` in `frontend/`) per task.
  - Per Task: expliciete handmatige verificatiestappen met SQL-queries en UI-doorlopen.

---

## Task 1: Database — Schema-uitbreidingen voor vormen

**Files:**
- Create: `supabase/migrations/179_maatwerk_vormen_uitbreiding.sql`
- Create: `supabase/migrations/180_maatwerk_vorm_maten.sql`
- Create: `supabase/migrations/182_beach_life_kwaliteit_flag.sql`

**Reden voor opsplitsen:** elke migratie mag stand-alone gerund kunnen worden en betreft één concept (vormen / maten-tabel / kwaliteit-flag). 181 (snij-marges) en 183 (app_config) volgen later in eigen taken.

- [ ] **Stap 1.1: Migratie 179 schrijven**

```sql
-- supabase/migrations/179_maatwerk_vormen_uitbreiding.sql
-- Voegt 3 nieuwe vormen toe (pebble, ellips, afgeronde_hoeken) en verhoogt
-- toeslag op de bestaande organische + ovaal naar €75 conform Karpi-prijslijst
-- 2026-05-01 (zes "aparte vormen"). Rond krijgt GEEN toeslag — ronde tapijten
-- worden via voorraadproducten verkocht (bv. artikelnr 771110031). Cloud wordt
-- om dezelfde reden NIET als maatwerk-vorm gemodelleerd.

-- 1. Kolom voor "kan deze vorm afwijkende maten hebben?"
ALTER TABLE maatwerk_vormen
  ADD COLUMN IF NOT EXISTS kan_afwijkende_maten BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN maatwerk_vormen.kan_afwijkende_maten IS
  'Of de gebruiker een eigen lengte/breedte/diameter mag invullen die niet in maatwerk_vorm_maten staat. '
  'True voor: rechthoek, rond, ovaal, afgeronde_hoeken. False voor de overige (alleen vaste maten).';

-- 2. Update bestaande organische toeslagen 20€ → 75€
UPDATE maatwerk_vormen SET toeslag = 75 WHERE code IN ('organisch_a','organisch_b_sp');

-- 3. Update kan_afwijkende_maten op bestaande
-- 'rond' blijft vrij invoerbaar (= bestaand gedrag).
UPDATE maatwerk_vormen SET kan_afwijkende_maten = true  WHERE code IN ('rechthoek','rond','ovaal');
UPDATE maatwerk_vormen SET kan_afwijkende_maten = false WHERE code IN ('organisch_a','organisch_b_sp');

-- 4. Hernoem display-namen om aan te sluiten op prijslijst
UPDATE maatwerk_vormen SET naam = 'Organic'             WHERE code = 'organisch_a';
UPDATE maatwerk_vormen SET naam = 'Organic Gespiegeld'  WHERE code = 'organisch_b_sp';

-- 5. Insert 3 nieuwe vormen (Cloud is bewust weggelaten — zie comment bovenaan)
INSERT INTO maatwerk_vormen (code, naam, afmeting_type, toeslag, kan_afwijkende_maten, actief, volgorde)
VALUES
  ('pebble',           'Pebble',            'lengte_breedte', 75, false, true, 60),
  ('ellips',           'Ellips',            'lengte_breedte', 75, false, true, 65),
  ('afgeronde_hoeken', 'Afgeronde Hoeken',  'lengte_breedte', 75, true,  true, 70)
ON CONFLICT (code) DO UPDATE
  SET naam = EXCLUDED.naam,
      afmeting_type = EXCLUDED.afmeting_type,
      toeslag = EXCLUDED.toeslag,
      kan_afwijkende_maten = EXCLUDED.kan_afwijkende_maten,
      actief = EXCLUDED.actief,
      volgorde = EXCLUDED.volgorde;

-- 6. Ovaal krijgt €75 toeslag (was 0); rond blijft op 0.
UPDATE maatwerk_vormen SET toeslag = 75 WHERE code = 'ovaal';
UPDATE maatwerk_vormen SET toeslag = 0  WHERE code = 'rond';
```

- [ ] **Stap 1.2: Migratie 180 schrijven (vorm-maten tabel)**

```sql
-- supabase/migrations/180_maatwerk_vorm_maten.sql
-- Vaste maat-suggesties per vorm. Per vorm 1-N rijen die als chips in de UI verschijnen.
-- Alleen lengte_breedte vormen krijgen seeds; rond/rechthoek blijven vrij invoerbaar.

CREATE TABLE IF NOT EXISTS maatwerk_vorm_maten (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vorm_code TEXT NOT NULL REFERENCES maatwerk_vormen(code) ON DELETE CASCADE,
  lengte_cm INTEGER,
  breedte_cm INTEGER,
  diameter_cm INTEGER,
  volgorde INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT maatwerk_vorm_maten_dimensies_check CHECK (
    -- Precies één: óf (lengte+breedte) óf (diameter). Geen ovale-diameter
    -- combinatie; als ovaal ooit twee diameters nodig heeft gebruiken we
    -- gewoon lengte/breedte met afmeting_type='lengte_breedte'.
    (lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL AND diameter_cm IS NULL) OR
    (lengte_cm IS NULL AND breedte_cm IS NULL AND diameter_cm IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS maatwerk_vorm_maten_vorm_idx ON maatwerk_vorm_maten(vorm_code, volgorde);

-- UNIQUE constraint voor idempotente seeds (ON CONFLICT DO NOTHING heeft een
-- unique key nodig). NULLs tellen niet mee in PG-uniqueness, dus we gebruiken
-- COALESCE op de drie dimensie-kolommen.
CREATE UNIQUE INDEX IF NOT EXISTS maatwerk_vorm_maten_uniek_idx
  ON maatwerk_vorm_maten (
    vorm_code,
    COALESCE(lengte_cm, 0),
    COALESCE(breedte_cm, 0),
    COALESCE(diameter_cm, 0)
  );

ALTER TABLE maatwerk_vorm_maten ENABLE ROW LEVEL SECURITY;
CREATE POLICY maatwerk_vorm_maten_all ON maatwerk_vorm_maten FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE maatwerk_vorm_maten IS
  'Vaste maat-suggesties per vorm. UI toont deze als chips. Voor vormen met '
  'kan_afwijkende_maten=true mag de gebruiker er ook eigen waarden naast invullen.';

-- Standaard-set: 160x230, 200x290, 240x340, 300x400 voor alle 6 aparte vormen.
-- Rechthoek/rond blijven vrij invoerbaar (geen chips).
WITH lb_vormen AS (
  SELECT code FROM maatwerk_vormen
  WHERE code IN ('ovaal','organisch_a','organisch_b_sp','pebble','ellips','afgeronde_hoeken')
),
maten(lengte, breedte, volgorde) AS (
  VALUES (230, 160, 1), (290, 200, 2), (340, 240, 3), (400, 300, 4)
)
INSERT INTO maatwerk_vorm_maten (vorm_code, lengte_cm, breedte_cm, volgorde)
SELECT v.code, m.lengte, m.breedte, m.volgorde
FROM lb_vormen v CROSS JOIN maten m
ON CONFLICT DO NOTHING;

-- Geen diameter-seeds: cloud/rond worden niet via deze flow geleverd.
```

- [ ] **Stap 1.3: Migratie 182 schrijven (Beach Life-flag)**

```sql
-- supabase/migrations/182_beach_life_kwaliteit_flag.sql
-- Beach Life kan alleen in recht maatwerk geproduceerd worden — bij vorm-keuze
-- moet de UI alle niet-rechthoek vormen filteren.

ALTER TABLE kwaliteiten
  ADD COLUMN IF NOT EXISTS alleen_recht_maatwerk BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN kwaliteiten.alleen_recht_maatwerk IS
  'Als true: in op-maat-flow alleen vorm=rechthoek toegestaan. UI verbergt overige '
  'vormen voor deze kwaliteit. Bedoeld voor o.a. BEAC (Beach Life).';

UPDATE kwaliteiten SET alleen_recht_maatwerk = true WHERE code = 'BEAC';
```

- [ ] **Stap 1.4: Lokaal toepassen**

Run (in projectroot):
```powershell
supabase db push
```
Of als geen lokale Supabase: open Supabase studio → SQL editor → plak migraties één voor één → run.

Expected: geen errors, drie nieuwe migratiebestanden zichtbaar in `supabase/migrations/`.

- [ ] **Stap 1.5: Verificatie via SQL**

```sql
-- 1. Vormen-tabel bevat 8 actieve rijen
SELECT code, naam, afmeting_type, toeslag, kan_afwijkende_maten, volgorde
FROM maatwerk_vormen WHERE actief = true ORDER BY volgorde;
-- Verwachting:
-- rechthoek(0, true), rond(0, true), ovaal(75, true),
-- organisch_a/Organic(75, false), organisch_b_sp/Organic Gespiegeld(75, false),
-- pebble(75, false), ellips(75, false), afgeronde_hoeken(75, true)

-- 2. Maten per vorm
SELECT vorm_code, lengte_cm, breedte_cm, diameter_cm, volgorde
FROM maatwerk_vorm_maten ORDER BY vorm_code, volgorde;
-- Verwachting: 4 maten × 6 lb-vormen (ovaal, organisch_a, organisch_b_sp,
-- pebble, ellips, afgeronde_hoeken) = 24 rijen. Geen diameter-rijen.

-- 3. BEAC-flag staat
SELECT code, omschrijving, alleen_recht_maatwerk FROM kwaliteiten WHERE code = 'BEAC';
-- Verwachting: alleen_recht_maatwerk = true
```

- [ ] **Stap 1.6: Commit**

```powershell
git add supabase/migrations/179_maatwerk_vormen_uitbreiding.sql `
        supabase/migrations/180_maatwerk_vorm_maten.sql `
        supabase/migrations/182_beach_life_kwaliteit_flag.sql
git commit -m "feat(maatwerk): 6 nieuwe vormen + vorm-maten + Beach Life-flag"
```

---

## Task 2: Database — Snij-marge en levertijd voor vormen

**Files:**
- Create: `supabase/migrations/181_snij_marge_vormen_uitbreiding.sql`
- Create: `supabase/migrations/183_app_config_vormwerk_levertijd.sql`

- [ ] **Stap 2.1: Migratie 181 (snij-marge) schrijven**

```sql
-- supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
-- Breidt de set "vormen die +5cm snij-marge krijgen" uit met de 4 nieuwe codes.
-- Cloud is GEEN maatwerk-vorm in dit plan — niet opgenomen. Houd synchroon met
-- _shared/snij-marges.ts en frontend/src/lib/utils/snij-marges.ts (Task 4).

CREATE OR REPLACE FUNCTION stuk_snij_marge_cm(
  afwerking TEXT,
  vorm      TEXT
) RETURNS INTEGER
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO' THEN 6 ELSE 0 END,
    CASE WHEN lower(COALESCE(vorm, '')) IN (
      'rond', 'ovaal',
      'organisch_a', 'organisch_b_sp',
      'pebble', 'ellips', 'afgeronde_hoeken'
    ) THEN 5 ELSE 0 END
  );
$$;

COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT) IS
  'Extra cm op elke dimensie bij snijden. ZO-afwerking: +6cm. '
  'Alle vormen behalve "rechthoek": +5cm voor handmatig uitzagen. '
  'Bij combi wint de grootste marge (niet cumulatief). '
  'Houd synchroon met snij-marges.ts in edge function en frontend.';
```

- [ ] **Stap 2.2: Migratie 183 (levertijd) schrijven**

```sql
-- supabase/migrations/183_app_config_vormwerk_levertijd.sql
-- Voegt configurabele levertijd-buffer voor vorm-maatwerk toe (default 6 weken).

UPDATE app_config
SET waarde = COALESCE(waarde, '{}'::jsonb)
           || jsonb_build_object('inkoop_buffer_weken_vormwerk', 6)
WHERE sleutel = 'order_config';

-- Sanity-check: als rij niet bestaat, maak hem aan met alleen deze key.
INSERT INTO app_config (sleutel, waarde)
SELECT 'order_config', jsonb_build_object('inkoop_buffer_weken_vormwerk', 6)
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE sleutel = 'order_config');
```

- [ ] **Stap 2.3: Verificatie**

```sql
-- 1. Controle dat snij-marge nieuwe vormen mee neemt
SELECT vorm,
       stuk_snij_marge_cm(NULL, vorm) AS marge_zonder_zo,
       stuk_snij_marge_cm('ZO',  vorm) AS marge_met_zo
FROM unnest(ARRAY['rechthoek','rond','ovaal','organisch_a','organisch_b_sp','pebble','ellips','afgeronde_hoeken']) AS vorm;
-- Verwachting:
-- rechthoek: 0 / 6
-- alle overigen (rond + 6 aparte vormen): 5 / 6 (ZO wint bij combi)

-- 2. app_config heeft de nieuwe key
SELECT waarde->'inkoop_buffer_weken_vormwerk' FROM app_config WHERE sleutel='order_config';
-- Verwachting: 6
```

- [ ] **Stap 2.4: Commit**

```powershell
git add supabase/migrations/181_snij_marge_vormen_uitbreiding.sql `
        supabase/migrations/183_app_config_vormwerk_levertijd.sql
git commit -m "feat(maatwerk): snij-marge en levertijd-buffer voor alle vormen"
```

---

## Task 3: Backend (edge functions) — gedeelde snij-marge sync

**Files:**
- Modify: `supabase/functions/_shared/snij-marges.ts`

- [ ] **Stap 3.1: Lees huidige inhoud**

Open [`supabase/functions/_shared/snij-marges.ts`](../../../supabase/functions/_shared/snij-marges.ts) en bekijk de huidige `RONDE_VORMEN` set.

- [ ] **Stap 3.2: Set uitbreiden**

Vervang de `RONDE_VORMEN` constant zo dat hij identieke waarden bevat als migratie 181:

```ts
const NIET_RECHTHOEKIGE_VORMEN = new Set([
  'rond', 'ovaal',
  'organisch_a', 'organisch_b_sp',
  'pebble', 'ellips', 'afgeronde_hoeken',
])
```

Hernoem ook de helper-functie van `RONDE_VORMEN`/`isRondeVorm` waar logischer naar `NIET_RECHTHOEKIGE_VORMEN`/`isVormMetMarge` (of behoud beide naamgeving als breaking change vermijden gewenst is — zie comment).

- [ ] **Stap 3.3: Eventueel afhankelijke edge functions verifiëren**

PowerShell heeft geen `grep` — gebruik de Grep-tool of `Select-String`:
```powershell
Get-ChildItem -Path supabase\functions -Recurse -Include *.ts `
  | Select-String -Pattern "RONDE_VORMEN|isRondeVorm"
```
Pas alle imports aan (of houd backwards-compatible aliases). Bestaande Deno-test
[`supabase/functions/_shared/snij-marges.test.ts`](../../../supabase/functions/_shared/snij-marges.test.ts)
gebruikt alleen `snijMargeCm` (de export naam blijft) — die test moet
ongewijzigd blijven slagen. Voeg WEL nieuwe test-cases toe voor de uitgebreide
vorm-set (zie stap 3.5).

- [ ] **Stap 3.4: Edge functions opnieuw deployen (indien actief)**

```powershell
supabase functions deploy --no-verify-jwt
```
(Alleen indien de relevante functies live in productie draaien — bevestig met Miguel.)

- [ ] **Stap 3.5: Test-cases uitbreiden in `snij-marges.test.ts`**

Voeg toe aan [`supabase/functions/_shared/snij-marges.test.ts`](../../../supabase/functions/_shared/snij-marges.test.ts):

```ts
Deno.test('organische vormen → +5 cm', () => {
  assertEquals(snijMargeCm(null, 'organisch_a'), 5)
  assertEquals(snijMargeCm(null, 'organisch_b_sp'), 5)
  assertEquals(snijMargeCm(null, 'pebble'), 5)
  assertEquals(snijMargeCm(null, 'ellips'), 5)
  assertEquals(snijMargeCm(null, 'afgeronde_hoeken'), 5)
})

Deno.test('rechthoek blijft 0', () => {
  assertEquals(snijMargeCm(null, 'rechthoek'), 0)
})

Deno.test('cloud wordt niet als vorm-marge behandeld (niet in plan)', () => {
  assertEquals(snijMargeCm(null, 'cloud'), 0)
})
```

Run:
```powershell
deno test supabase/functions/_shared/snij-marges.test.ts
```
Expected: alle tests slagen.

- [ ] **Stap 3.6: Commit**

```powershell
git add supabase/functions/_shared/snij-marges.ts `
        supabase/functions/_shared/snij-marges.test.ts
git commit -m "chore(edge): snij-marge ondersteunt alle vorm-codes + tests"
```

---

## Task 4: Frontend — snij-marges.ts en maatwerk-prijs.ts uitbreiden

**Files:**
- Modify: `frontend/src/lib/utils/snij-marges.ts`
- Modify: `frontend/src/lib/utils/maatwerk-prijs.ts`

- [ ] **Stap 4.1: snij-marges.ts uitbreiden**

Vervang regel 8 (`const RONDE_VORMEN = new Set(['rond', 'ovaal'])`) met de uitgebreide set, identiek aan migratie 181:

```ts
// Houd synchroon met supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
// en supabase/functions/_shared/snij-marges.ts
const NIET_RECHTHOEKIGE_VORMEN = new Set([
  'rond', 'ovaal',
  'organisch_a', 'organisch_b_sp',
  'pebble', 'ellips', 'afgeronde_hoeken',
])
```

Pas `snijMargeCm()` en `isRondeVorm()` aan om deze nieuwe set te gebruiken. Hernoem `isRondeVorm` naar `isNietRechthoekigeVorm` en vervang alle aanroepende plekken.

Run om callers te vinden (PowerShell-equivalent van grep):
```powershell
Get-ChildItem -Path frontend\src -Recurse -Include *.ts,*.tsx `
  | Select-String -Pattern "isRondeVorm|RONDE_VORMEN"
```

Of gebruik de Grep-tool met pattern `isRondeVorm|RONDE_VORMEN` op `frontend/src/`.

- [ ] **Stap 4.2: maatwerk-prijs.ts ongewijzigd laten**

`berekenPrijsOppervlakM2()` (regel 5–18) hanteert nu al `vorm === 'rond'` voor diameter² en lengte×breedte voor de rest. Geen wijziging nodig: alle 6 nieuwe vormen zijn `lengte_breedte` (uit migratie 179), dus de bestaande lengte×breedte-tak werkt al. Cloud zit niet in het plan.

Verifieer wel met een snelle inspectie van het bestand dat er geen achterhaalde verwijzingen naar 'cloud' staan; commit niets als je niets wijzigt.

- [ ] **Stap 4.3: Manuele verificatie in browser-console**

Geen unit-test framework aanwezig. Dev-server starten:
```powershell
cd frontend
npm run dev
```

Open de op-maat-flow in een order, kies kwaliteit + kleur. Het bestaande pad mag niet regresseren — verifieer:
1. Vorm "Rechthoek" met L=200 B=300 → oppervlak = 6,00 m².
2. Vorm "Rond" met diameter=200 → oppervlak = 4,00 m².
3. Geen TypeScript-fouten in `npm run build`.

- [ ] **Stap 4.4: Commit**

```powershell
git add frontend/src/lib/utils/snij-marges.ts frontend/src/lib/utils/maatwerk-prijs.ts
git commit -m "feat(frontend): snij-marges en oppervlak-formule voor alle vormen"
```

---

## Task 5: Frontend — Queries voor vorm-maten en kwaliteit-beperking

**Files:**
- Modify: `frontend/src/lib/supabase/queries/op-maat.ts`

- [ ] **Stap 5.1: Type `MaatwerkVormRow` uitbreiden**

Voeg veld toe aan interface (regel 5–13):

```ts
export interface MaatwerkVormRow {
  id: number
  code: string
  naam: string
  afmeting_type: 'lengte_breedte' | 'diameter'
  toeslag: number
  kan_afwijkende_maten: boolean   // ← nieuw
  actief: boolean
  volgorde: number
}
```

- [ ] **Stap 5.2: Nieuwe interface en query voor vorm-maten**

Voeg toe (na `fetchAlleVormen`):

```ts
export interface MaatwerkVormMaat {
  id: number
  vorm_code: string
  lengte_cm: number | null
  breedte_cm: number | null
  diameter_cm: number | null
  volgorde: number
}

export async function fetchVormMaten(vormCode: string): Promise<MaatwerkVormMaat[]> {
  const { data, error } = await supabase
    .from('maatwerk_vorm_maten')
    .select('*')
    .eq('vorm_code', vormCode)
    .order('volgorde')
  if (error) throw error
  return data ?? []
}
```

- [ ] **Stap 5.3: Query voor kwaliteit-beperking**

Voeg toe (logische plek: na `fetchKwaliteiten`):

```ts
export async function fetchKwaliteitAlleenRechtMaatwerk(kwaliteitCode: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('alleen_recht_maatwerk')
    .eq('code', kwaliteitCode)
    .maybeSingle()
  if (error) throw error
  return data?.alleen_recht_maatwerk ?? false
}
```

- [ ] **Stap 5.4: TypeScript build-check**

```powershell
cd frontend
npm run build
```
Expected: geen TS-errors. Als de build de DB-types valideert via supabase-types: regenereer types met `supabase gen types typescript --linked > frontend/src/lib/supabase/types.ts` (of bestaand commando — controleer `package.json`).

- [ ] **Stap 5.5: Commit**

```powershell
git add frontend/src/lib/supabase/queries/op-maat.ts
git commit -m "feat(queries): vorm-maten en kwaliteit-beperking queries"
```

---

## Task 6: Frontend — VormTegel-component (visuele tegel per vorm)

**Files:**
- Create: `frontend/src/components/orders/vorm-tegel.tsx`
- Create (optioneel): `frontend/src/lib/icons/vormen/index.ts`

- [ ] **Stap 6.1: SVG-icoontjes voorbereiden**

Maak een eenvoudige inline-SVG-mapping per vorm. Geen externe icon-library; wij tekenen de vorm-omtrek zelf.

Maak `frontend/src/lib/icons/vormen/index.ts`:

```tsx
import type { ReactNode } from 'react'

export const VORM_ICONS: Record<string, ReactNode> = {
  rechthoek: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><rect x="10" y="10" width="60" height="40" fill="currentColor" rx="2"/></svg>
  ),
  rond: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><circle cx="40" cy="30" r="22" fill="currentColor"/></svg>
  ),
  ovaal: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><ellipse cx="40" cy="30" rx="30" ry="18" fill="currentColor"/></svg>
  ),
  organisch_a: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M15 20 Q5 35 20 50 Q40 60 60 50 Q75 35 65 20 Q55 5 35 8 Q20 12 15 20 Z" fill="currentColor"/></svg>
  ),
  organisch_b_sp: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M65 20 Q75 35 60 50 Q40 60 20 50 Q5 35 15 20 Q25 5 45 8 Q60 12 65 20 Z" fill="currentColor"/></svg>
  ),
  pebble: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><path d="M20 15 Q5 30 15 48 Q35 58 60 48 Q72 38 65 22 Q50 8 30 12 Q22 13 20 15 Z" fill="currentColor"/></svg>
  ),
  ellips: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><ellipse cx="40" cy="30" rx="32" ry="14" fill="currentColor"/></svg>
  ),
  afgeronde_hoeken: (
    <svg viewBox="0 0 80 60" className="w-full h-full"><rect x="10" y="10" width="60" height="40" rx="14" fill="currentColor"/></svg>
  ),
}
```

- [ ] **Stap 6.2: Tegel-component schrijven**

Maak `frontend/src/components/orders/vorm-tegel.tsx`:

```tsx
import type { MaatwerkVormRow } from '@/lib/supabase/queries/op-maat'
import { VORM_ICONS } from '@/lib/icons/vormen'
import { formatCurrency } from '@/lib/utils/formatters'

interface VormTegelProps {
  vorm: MaatwerkVormRow
  selected: boolean
  onClick: () => void
}

export function VormTegel({ vorm, selected, onClick }: VormTegelProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'flex flex-col items-center gap-1.5 p-3 rounded-[var(--radius-sm)] border text-center transition-colors',
        selected
          ? 'border-purple-500 bg-purple-50 text-purple-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
      ].join(' ')}
    >
      <div className="w-12 h-9 text-current">
        {VORM_ICONS[vorm.code] ?? VORM_ICONS.rechthoek}
      </div>
      <div className="text-xs font-medium">{vorm.naam}</div>
      {vorm.toeslag > 0 && (
        <div className="text-[10px] text-slate-500">+{formatCurrency(vorm.toeslag)}</div>
      )}
    </button>
  )
}
```

- [ ] **Stap 6.3: Manueel renderen**

Tijdelijk in `vorm-afmeting-selector.tsx` 1 tegel renderen om te valideren dat het component compileert. Verwijder daarna deze tijdelijke render.

- [ ] **Stap 6.4: Commit**

```powershell
git add frontend/src/components/orders/vorm-tegel.tsx frontend/src/lib/icons/vormen/index.ts
git commit -m "feat(ui): VormTegel component voor visuele vorm-keuze"
```

---

## Task 7: Frontend — VormAfmetingSelector uitbreiden met tegel-grid en chip-maten

**Files:**
- Modify: `frontend/src/components/orders/vorm-afmeting-selector.tsx`

- [ ] **Stap 7.1: Props uitbreiden**

Voeg props toe aan `VormAfmetingSelectorProps`:

```ts
interface VormAfmetingSelectorProps {
  vormen: MaatwerkVormRow[]
  afwerkingen: AfwerkingTypeRow[]
  standaardAfwerking: string | null
  standaardBandKleur: string | null
  maxBreedteCm: number | null
  alleenRechtMaatwerk: boolean   // ← nieuw (Beach Life e.d.)
  onChange: (data: VormAfmetingData) => void
}
```

- [ ] **Stap 7.2: Vormen-lijst filteren bij Beach Life**

Bovenaan de component:

```ts
const beschikbareVormen = useMemo(
  () => alleenRechtMaatwerk ? vormen.filter((v) => v.code === 'rechthoek') : vormen,
  [vormen, alleenRechtMaatwerk],
)
```

Gebruik `beschikbareVormen` waar voorheen `vormen` werd gebruikt. Toon eventueel een hint:

```tsx
{alleenRechtMaatwerk && (
  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] p-2">
    Deze kwaliteit kan alleen in recht maatwerk geproduceerd worden.
  </p>
)}
```

- [ ] **Stap 7.3: Dropdown vervangen door tegel-grid**

Verwijder de `<select>` met vorm-options (regels 88–110). Plaats:

```tsx
<div>
  <label className="block text-sm font-medium text-slate-700 mb-2">Vorm</label>
  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
    {beschikbareVormen.map((v) => (
      <VormTegel
        key={v.code}
        vorm={v}
        selected={data.vormCode === v.code}
        onClick={() => {
          const newIsDiameter = v.afmeting_type === 'diameter'
          update({
            vormCode: v.code,
            lengteCm: newIsDiameter ? undefined : data.lengteCm,
            breedteCm: newIsDiameter ? undefined : data.breedteCm,
            diameterCm: newIsDiameter ? data.diameterCm : undefined,
          })
        }}
      />
    ))}
  </div>
</div>
```

Import `VormTegel` van `./vorm-tegel`.

- [ ] **Stap 7.4: Maat-chips renderen op basis van geselecteerde vorm**

Voeg query toe (in component-body, met `useQuery`):

```ts
const { data: vormMaten = [] } = useQuery({
  queryKey: ['vorm-maten', data.vormCode],
  queryFn: () => fetchVormMaten(data.vormCode),
  enabled: !!data.vormCode,
})
```

Render onder het vorm-grid en boven de bestaande dimensie-inputs:

```tsx
{vormMaten.length > 0 && (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-2">Maat</label>
    <div className="flex flex-wrap gap-2">
      {vormMaten.map((m) => {
        const label = m.diameter_cm
          ? `Ø ${m.diameter_cm} cm`
          : `${m.lengte_cm} × ${m.breedte_cm} cm`
        const isActive = m.diameter_cm
          ? data.diameterCm === m.diameter_cm
          : data.lengteCm === m.lengte_cm && data.breedteCm === m.breedte_cm
        return (
          <button
            type="button"
            key={m.id}
            onClick={() => update(m.diameter_cm
              ? { diameterCm: m.diameter_cm, lengteCm: undefined, breedteCm: undefined }
              : { lengteCm: m.lengte_cm!, breedteCm: m.breedte_cm!, diameterCm: undefined })}
            className={[
              'px-3 py-1.5 text-xs rounded-full border transition-colors',
              isActive
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300',
            ].join(' ')}
          >
            {label}
          </button>
        )
      })}
    </div>
  </div>
)}
```

- [ ] **Stap 7.5: "Afwijkende maten"-toggle voor toegestane vormen**

State voor toggle:
```ts
const [afwijkendeMaten, setAfwijkendeMaten] = useState(false)
const selectedVormRow = beschikbareVormen.find((v) => v.code === data.vormCode)
const kanAfwijkend = selectedVormRow?.kan_afwijkende_maten ?? true   // rechthoek default
```

Render onder maat-chips (alleen als `kanAfwijkend`):

```tsx
{kanAfwijkend && vormMaten.length > 0 && (
  <button
    type="button"
    onClick={() => setAfwijkendeMaten((p) => !p)}
    className="text-xs text-purple-700 underline mt-1"
  >
    {afwijkendeMaten ? '← terug naar standaardmaten' : 'Afwijkende maat invoeren →'}
  </button>
)}
```

Toon de bestaande lengte/breedte/diameter `<input>` velden alleen als `(afwijkendeMaten || vormMaten.length === 0)`.

Voor vormen met `kan_afwijkende_maten=false` (organisch_a, organisch_b_sp, pebble, ellips): chips zijn de enige optie — geen input-velden.

- [ ] **Stap 7.6: `op-maat-selector.tsx` aanpassen om `alleenRechtMaatwerk` door te geven**

In [`op-maat-selector.tsx`](../../../frontend/src/components/orders/op-maat-selector.tsx) na `state.kwaliteitCode` is gezet:

```ts
const { data: alleenRechtMaatwerk = false } = useQuery({
  queryKey: ['kwaliteit-alleen-recht', state.kwaliteitCode],
  queryFn: () => fetchKwaliteitAlleenRechtMaatwerk(state.kwaliteitCode),
  enabled: !!state.kwaliteitCode,
})
```

Geef door aan `<VormAfmetingSelector ... alleenRechtMaatwerk={alleenRechtMaatwerk} />`.

Bij switch naar BEAC moet `state.vormCode` resetten zodat de child opnieuw kan initialiseren. Voeg in de reducer `KWALITEIT_KLEUR_SELECTED` action toe:

```ts
// Default naar 'rechthoek' zodat omschrijving (regel 200) en handleAdd niet
// kapot gaan als gebruiker direct submit zonder vorm te kiezen. De child
// VormAfmetingSelector synct dit alsnog naar de eerste beschikbare vorm via
// useEffect indien die niet 'rechthoek' is.
vormCode: 'rechthoek',
```

In `vorm-afmeting-selector.tsx` regel 48–52 staat al een `useEffect` die de eerste beschikbare vorm zet als `vormCode` leeg is. Pas die voorwaarde aan zodat hij óók triggert als `vormCode` niet in `beschikbareVormen` voorkomt (relevant voor BEAC: vormCode='rechthoek' moet behouden blijven, alle andere worden alsnog naar 'rechthoek' geforceerd).

- [ ] **Stap 7.7: Manuele test (browser)**

Start dev-server:
```powershell
cd frontend; npm run dev
```

Doorloop scenarios:
1. **Rechthoek (default):** kies kwaliteit CISC + kleur 11, vorm Rechthoek. Geen chips zichtbaar (lege `vormMaten`). Lengte/breedte input verschijnen. Vul 200×300 → totaal = 6m² × m²-prijs + 0 toeslag.
2. **Organic:** kies vorm Organic. Vier chips zichtbaar (160×230, 200×290, 240×340, 300×400). Geen "afwijkende"-knop. Klik chip 200×290 → totaal = 5,8m² × m²-prijs + €75.
3. **Rond:** kies vorm Rond. Geen chips (rond heeft geen seed). Diameter-input zichtbaar. Vul 200 → oppervlak = 4m², toeslag = €0.
4. **Ovaal:** chips zichtbaar, "Afwijkende maat invoeren →" knop zichtbaar. Klik knop, vul 250×180 → werkt. Toeslag = €75.
5. **Beach Life (BEAC):** kies BEAC + kleur. Alleen tegel "Rechthoek" zichtbaar + waarschuwingsbox.
6. **Vorm wisselen behoudt afmeting waar mogelijk:** Rechthoek 200×300 → wissel naar Organic → 200×300 chip is niet aanwezig → reset naar geen-maat. Acceptabel.

- [ ] **Stap 7.8: Visuele check vs. mockup**

Vergelijk met de tweede screenshot uit de prijslijst — controleer dat de 6 aparte vormen (Organic, Organic Gespiegeld, Pebble, Ellips, Ovaal, Afgeronde Hoeken) plus standaard rechthoek/rond er met juiste verhoudingen uitzien. Pas SVG-paths aan indien afwijkend.

- [ ] **Stap 7.9: Commit**

```powershell
git add frontend/src/components/orders/vorm-afmeting-selector.tsx `
        frontend/src/components/orders/op-maat-selector.tsx
git commit -m "feat(ui): vorm-tegels, maat-chips en BEAC-uitsluiting in op-maat-flow"
```

---

## Task 8: Frontend — Levertijd-hint koppelen aan vormwerk-buffer

**Files:**
- Modify: `frontend/src/lib/supabase/queries/op-maat.ts` (functie `fetchMaatwerkLevertijdHint`)
- Modify: `frontend/src/components/orders/op-maat-selector.tsx`

- [ ] **Stap 8.1: `fetchMaatwerkLevertijdHint` aanpassen**

Op regel 411 staat:
```ts
const buffer = (cfg?.waarde as { inkoop_buffer_weken_maatwerk?: number } | null)?.inkoop_buffer_weken_maatwerk ?? 2
```

Pas signature aan om vorm mee te geven:

```ts
export async function fetchMaatwerkLevertijdHint(
  kwaliteitCode: string,
  kleurCode: string,
  vormCode: string | null,   // ← nieuw
): Promise<MaatwerkLevertijdHint | null> {
  // ...
  const cfgWaarde = cfg?.waarde as { inkoop_buffer_weken_maatwerk?: number; inkoop_buffer_weken_vormwerk?: number } | null
  const isVormwerk = !!vormCode && vormCode !== 'rechthoek'
  const buffer = isVormwerk
    ? (cfgWaarde?.inkoop_buffer_weken_vormwerk ?? 6)
    : (cfgWaarde?.inkoop_buffer_weken_maatwerk ?? 2)
  // ... rest blijft gelijk
}
```

- [ ] **Stap 8.2: `op-maat-selector.tsx` — query-aanroep aanpassen**

In de `<MaatwerkLevertijdHint kwaliteitCode={...} kleurCode={...} />` aanroep — die component zal de query intern doen. Bekijk [`MaatwerkLevertijdHint`](../../../frontend/src/components/orders/maatwerk-levertijd-hint.tsx) en geef `vormCode` als nieuwe prop door, dan in de query-aanroep gebruiken.

- [ ] **Stap 8.3: Manuele verificatie**

In dev-server: kies kwaliteit + kleur die geen voorraad heeft maar wel een openstaande inkooporder met `verwacht_datum` over 4 weken. Kies vorm Organic. Verwacht: hint toont week (4+6) = +10 weken. Wissel naar Rechthoek: +6 weken.

- [ ] **Stap 8.4: Commit**

```powershell
git add frontend/src/lib/supabase/queries/op-maat.ts `
        frontend/src/components/orders/op-maat-selector.tsx `
        frontend/src/components/orders/maatwerk-levertijd-hint.tsx
git commit -m "feat(maatwerk): vorm-specifieke levertijd-hint (6 weken voor vormwerk)"
```

---

## Task 9: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/data-woordenboek.md`
- Modify: `docs/changelog.md`
- Modify: `CLAUDE.md`

- [ ] **Stap 9.1: `database-schema.md` — `maatwerk_vormen` aanvullen**

In de bestaande `### maatwerk_vormen`-sectie (regel 747+):
- Voeg rij toe: `kan_afwijkende_maten | BOOLEAN | True voor rechthoek/rond/ovaal/afgeronde_hoeken`.
- Update beschrijving van `code`-rij: lijst met 8 codes (`rechthoek, rond, ovaal, organisch_a, organisch_b_sp, pebble, ellips, afgeronde_hoeken`).

- [ ] **Stap 9.2: Nieuwe sectie `### maatwerk_vorm_maten`**

```markdown
### maatwerk_vorm_maten
Vaste maat-suggesties per vorm voor de op-maat-flow (UI rendert deze als chips).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGINT PK | Auto-increment |
| vorm_code | TEXT FK → maatwerk_vormen | Naar welke vorm de maat hoort |
| lengte_cm | INTEGER | Voor afmeting_type='lengte_breedte'; NULL anders |
| breedte_cm | INTEGER | Idem |
| diameter_cm | INTEGER | Voor afmeting_type='diameter'; NULL anders |
| volgorde | INTEGER | Sorteervolgorde van chips |
| CHECK: precies één van (lengte+breedte) of diameter is gevuld | | |
```

- [ ] **Stap 9.3: `kwaliteiten` rij toevoegen**

Zoek `### kwaliteiten` in `database-schema.md` en voeg toe:
- `alleen_recht_maatwerk | BOOLEAN | True voor BEAC: in op-maat alleen vorm rechthoek toegestaan`.

- [ ] **Stap 9.4: `data-woordenboek.md`**

Voeg toe in juiste sectie:
- **Vorm-toeslag:** Vaste meerprijs (€75 ex. btw) bovenop m²×m²-prijs voor productie van een vloerkleed in één van de 6 aparte vormen uit de prijslijst: Organic, Organic Gespiegeld, Pebble, Ellips, Ovaal, Afgeronde Hoeken. Voor recht maatwerk (rechthoek) en `rond` geen toeslag — ronde tapijten worden geleverd via voorraadproducten.
- **Afwijkende maten:** Maatwerk-keuze waarbij de gebruiker eigen lengte/breedte/diameter invoert i.p.v. één van de vaste maten kiest. Alleen toegestaan voor vormen met `maatwerk_vormen.kan_afwijkende_maten = true` (rechthoek, rond, ovaal, afgeronde hoeken).
- **Recht maatwerk:** Maatwerk-tapijt zonder vorm-bewerking (alleen rechthoekig snijden). Verplicht voor BEAC (Beach Life) — die kwaliteit kan technisch geen organische vorm aan.

- [ ] **Stap 9.5: `changelog.md` — nieuwe entry vooraan**

```markdown
## 2026-05-01 — Organische vormen voor maatwerk

- Drie nieuwe vormen `pebble`, `ellips`, `afgeronde_hoeken` in tabel `maatwerk_vormen` (Cloud is bewust weggelaten — ronde tapijten worden via voorraadproducten verkocht, zoals 771110031).
- Bestaande `organisch_a` / `organisch_b_sp` hernoemd naar "Organic" / "Organic Gespiegeld" en toeslag verhoogd 20€ → 75€. `ovaal` toeslag 0€ → 75€.
- `rond` blijft op toeslag 0€ (eigen voorraadproducten, niet via vorm-maatwerk-flow).
- Nieuwe tabel `maatwerk_vorm_maten` met vaste maat-suggesties (160×230, 200×290, 240×340, 300×400) voor de 6 lengte_breedte vormen.
- Nieuwe kolom `maatwerk_vormen.kan_afwijkende_maten` (true voor rechthoek/rond/ovaal/afgeronde_hoeken).
- Nieuwe kolom `kwaliteiten.alleen_recht_maatwerk` (true voor BEAC) — UI verbergt vormen voor deze kwaliteiten.
- Snij-marge functie `stuk_snij_marge_cm()` uitgebreid: alle niet-rechthoekige vormen (rond, ovaal, organisch_a, organisch_b_sp, pebble, ellips, afgeronde_hoeken) krijgen +5cm.
- `app_config.order_config.inkoop_buffer_weken_vormwerk = 6`: levertijd-buffer voor vorm-maatwerk.
- Frontend: `VormAfmetingSelector` vervangen dropdown door tegelgrid + maat-chips + "afwijkende maten" toggle.
- Migraties: 179, 180, 181, 182, 183.
```

- [ ] **Stap 9.6: `CLAUDE.md` — bedrijfsregel toevoegen**

Voeg na de bestaande `Bedrijfsregels` lijst toe:

```markdown
- **Vorm-maatwerk (mig 179–183):** maatwerk-orderregels kennen een vorm (rechthoek, rond, ovaal, organic, organic gespiegeld, pebble, ellips, afgeronde hoeken). Zes "aparte vormen" (Organic, Organic Gespiegeld, Pebble, Ellips, Ovaal, Afgeronde Hoeken) kosten €75 ex. btw vorm-toeslag bovenop m²×m²-prijs; rechthoek en rond hebben geen toeslag (ronde tapijten worden via voorraadproducten verkocht). Levertijd-buffer voor vormwerk is 6 weken (`app_config.order_config.inkoop_buffer_weken_vormwerk`). Beach Life (`BEAC`) kan alleen in recht maatwerk geproduceerd worden — overige kwaliteiten met `kwaliteiten.alleen_recht_maatwerk=true` ook. Vaste maat-suggesties staan in `maatwerk_vorm_maten`; alleen vormen met `maatwerk_vormen.kan_afwijkende_maten=true` accepteren input buiten die lijst. Snij-marge `stuk_snij_marge_cm()` voegt +5cm toe voor alle niet-rechthoekige vormen.
```

- [ ] **Stap 9.7: Commit**

```powershell
git add docs/database-schema.md docs/data-woordenboek.md docs/changelog.md CLAUDE.md
git commit -m "docs: organische vormen maatwerk — schema, woordenboek, changelog, CLAUDE.md"
```

---

## Task 10: End-to-end-test scenario doorlopen

**Files:** geen — alleen runtime-verificatie.

- [ ] **Stap 10.1: Order met Cisco 11 in Organic 200×290**

Volg de exacte rekenvoorbeeld uit de prijslijst-afbeelding. Maak een test-order:

1. Open een nieuwe order voor een willekeurige debiteur.
2. Kies kwaliteit "CISC", kleur "11" (verwachte m²-prijs: €51).
3. Kies vorm "Organic".
4. Kies chip 200×290.
5. **Verwacht:** prijs = 5,8 m² × €51 + €75 = €295,80 + €75 = **€370,80**.

Als de werkelijk getoonde prijs afwijkt: debug. m²-prijs uit `maatwerk_m2_prijzen` voor (CISC, 11) controleren met:
```sql
SELECT verkoopprijs_m2 FROM maatwerk_m2_prijzen WHERE kwaliteit_code='CISC' AND kleur_code IN ('11','11.0');
```

- [ ] **Stap 10.2: Order opslaan en opnieuw openen**

Sla de order op. Open opnieuw. Verwacht: regel toont:
- Omschrijving: "Cisco 11 - Op maat Organic" (of vergelijkbaar).
- maatwerk_vorm = organisch_a (in DB).
- maatwerk_vorm_toeslag = 75.
- maatwerk_oppervlak_m2 = 5.8.
- Bedrag = €370,80.

SQL-check:
```sql
SELECT regel_volgorde, omschrijving, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
       maatwerk_oppervlak_m2, maatwerk_m2_prijs, maatwerk_vorm_toeslag, bedrag
FROM order_regels WHERE order_nummer = '<test-order>';
```

- [ ] **Stap 10.3: Snijplanning-zichtbaarheid + snij-marge verificatie**

Confectie-planning (`/snijplanning` of `/confectie`) toont de regel met de juiste vorm-naam. Snij-marge wordt toegepast: bekijk `snijplanning_overzicht` view voor de regel:
```sql
SELECT order_regel_id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, maatwerk_afwerking,
       stuk_snij_marge_cm(maatwerk_afwerking, maatwerk_vorm) AS marge
FROM snijplanning_overzicht WHERE order_regel_id = <id>;
-- Verwachting voor Organic 200×290: maatwerk_vorm='organisch_a', marge=5.
-- Tekort-analyse rekent dus met 295×205 als minimaal-vereiste rolmaat.
```

**Rond-vorm verificatie (regressie-check):** maak een tweede testorder met vorm `Rond` Ø200. In `op-maat-selector.tsx` regel 211–213 wordt voor diameter-vormen `maatwerk_lengte_cm = state.diameterCm` en `maatwerk_breedte_cm = state.diameterCm` gevuld (omsluitend vierkant). Dit moet ongewijzigd blijven werken:
```sql
SELECT maatwerk_vorm, maatwerk_diameter_cm, maatwerk_lengte_cm, maatwerk_breedte_cm,
       maatwerk_oppervlak_m2, maatwerk_vorm_toeslag
FROM order_regels WHERE id = <rond-test-id>;
-- Verwachting: vorm='rond', diameter=200, lengte=200, breedte=200, oppervlak=4.0,
-- toeslag=0 (rond zit niet in de €75-set).
```

- [ ] **Stap 10.4: Beach Life-blokkade**

Maak een nieuwe order. Kies kwaliteit BEAC. Verwacht: alleen tegel "Rechthoek" zichtbaar + waarschuwingsbox "Deze kwaliteit kan alleen in recht maatwerk geproduceerd worden."

- [ ] **Stap 10.5: Levertijd-hint**

Test scenario uit Task 8.3 — verwacht 6 weken bonus voor vormwerk.

- [ ] **Stap 10.6: Bevindingen documenteren**

Schrijf eventuele afwijkingen op (sub-bullets onder Task 10 of in een `docs/superpowers/notes/2026-05-01-vormen-test-bevindingen.md`).

- [ ] **Stap 10.7: Geen commit nodig — test-only.** Sla over naar Task 11.

---

## Task 11: Optioneel — Admin-pagina voor vormen-beheer

**Status:** OPTIONEEL — alleen indien Miguel direct admin-UI wil. Anders skip; vorm-beheer via Supabase Studio is voorlopig voldoende.

**Files:**
- Inspect: `frontend/src/components/admin/` (zoek bestaande maatwerk-admin pagina).
- Modify: bestaande maatwerk-vormen admin component, of skip.

- [ ] **Stap 11.1: Bestaande admin-pagina vinden**

```powershell
Get-ChildItem -Path frontend\src -Recurse -Include *.ts,*.tsx `
  | Select-String -Pattern "maatwerk_vormen|fetchAlleVormen" -List
```
Of gebruik de Grep-tool met pattern `maatwerk_vormen|fetchAlleVormen` op `frontend/src/`.

- [ ] **Stap 11.2: Indien aanwezig: tabel uitbreiden met `kan_afwijkende_maten`-toggle en CRUD voor `maatwerk_vorm_maten`.**

Implementatiedetail: standaard CRUD-grid pattern volgen dat al elders in admin gebruikt wordt.

- [ ] **Stap 11.3: Commit (indien iets gewijzigd)**

```powershell
git add frontend/src/components/admin/...
git commit -m "feat(admin): vormen-beheer met kan_afwijkende_maten en vorm-maten"
```

---

## Task 12: Memory bijwerken

- [ ] **Stap 12.1: Memory-entry over vorm-maatwerk**

Schrijf naar `C:\Users\migue\.claude\projects\c--Users-migue-Documents-Karpi-ERP\memory\project_vorm_maatwerk.md`:

```markdown
---
name: Vorm-maatwerk module
description: Maatwerk-orderregels kennen sinds mig 179-183 een vorm-keuze met €75 toeslag voor de 6 aparte vormen uit de prijslijst
type: project
---

Vorm-keuze in op-maat-flow:
- 8 vormen: rechthoek (0€), rond (0€), ovaal/organic/organic gespiegeld/pebble/ellips/afgeronde hoeken (75€).
- Cloud bewust niet als maatwerk-vorm — ronde tapijten worden via voorraadproducten verkocht (bv. artikelnr 771110031 ORGANISCH).
- Vaste maten in tabel `maatwerk_vorm_maten`. Alleen rechthoek/rond/ovaal/afgeronde_hoeken hebben `kan_afwijkende_maten=true`.
- BEAC (Beach Life): `kwaliteiten.alleen_recht_maatwerk=true` → UI verbergt overige vormen.
- Snij-marge: alle niet-rechthoek vormen krijgen +5cm via `stuk_snij_marge_cm()`.
- Levertijd-buffer voor vormwerk: 6 weken via `app_config.order_config.inkoop_buffer_weken_vormwerk`.

**Why:** prijslijst-afbeelding 2026-05-01 stelde €75 vorm-toeslag en 6-weken levertijd vast voor de 6 vormen. Beach Life kan technisch geen organische vorm aan. Ronde maten worden niet als maatwerk maar als voorraadproduct verkocht.

**How to apply:** wijzigingen aan vormen/toeslagen via `maatwerk_vormen` tabel. Nieuwe vorm = ook entry in `maatwerk_vorm_maten`, snij-marge in mig + frontend `snij-marges.ts` + edge `_shared/snij-marges.ts` synchroon houden.
```

- [ ] **Stap 12.2: `MEMORY.md` index bijwerken**

Voeg regel toe:
```markdown
- [Vorm-maatwerk](project_vorm_maatwerk.md) — vorm-keuze + €75 toeslag voor 6 aparte vormen in op-maat (mig 179-183)
```

- [ ] **Stap 12.3: Geen git-commit (memory is buiten repo).**

---

## Eindcheck

- [ ] Alle 12 tasks doorlopen (1–10 verplicht, 11 optioneel, 12 memory).
- [ ] `git log --oneline` toont 7-8 nieuwe commits.
- [ ] Migraties 179, 180, 181, 182, 183 succesvol toegepast.
- [ ] Test-scenario uit Task 10 levert €370,80 op voor Cisco 11 + Organic 200×290.
- [ ] Documenten `database-schema.md`, `data-woordenboek.md`, `changelog.md`, `CLAUDE.md` zijn bijgewerkt.
