# Colli-gewicht-fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `zending_colli.gewicht_kg` (en de onderliggende gewicht-caches) correct vullen, zodat de Rhenus/Verhoek-preflight (`gewicht_kg > 0` verplicht) zendingen niet meer categorisch blokkeert en de vervoerder-selectie-regels (DE ≤30 kg) op echte gewichten evalueren.

**Architecture:** Drie lagen in één migratie (repo-nr **383**; draait in de live DB als 382 — zelfde offset als mig 379-382, zie hernummer-notitie in die headers): (1) **resolver-verdieping** — `bereken_orderregel_gewicht_kg` rekent voor vaste producten voortaan live via het vorm-aware `bereken_product_gewicht_kg` i.p.v. de (vervuilde) cache te kopiëren, en `genereer_zending_colli` krijgt een gewicht-ladder met `NULLIF(0)`; (2) **self-healing cache** — een BEFORE-trigger op `producten` dwingt af dat `gewicht_kg` voor vast/staaltje mét complete data altijd de gederiveerde waarde is, wat álle historische en toekomstige vervuilingsroutes categorisch afsluit (zelfde "data, geen code"-filosofie als ADR-0018); (3) **eenmalige backfill** van `producten`, open `order_regels` en niet-verzonden `zending_colli`. Plus import-hygiëne (prijslijst-auto-create schrijft geen prijslijst-"Gewicht"-kolom meer naar `producten.gewicht_kg`) en een verificatie-script dat als failing test fungeert.

**Tech Stack:** PostgreSQL/plpgsql (Supabase-migratie), Python 3 + supabase-py (verificatie-script), geen frontend-wijzigingen, geen edge-function-wijzigingen.

---

## Diagnose (12-06-2026, productie-data — context voor de uitvoerder)

Het handoff-document zei "gewicht moet gevuld worden bij colli-generatie". Onderzoek wees uit dat het probleem dieper zit — `genereer_zending_colli` (mig 209/213) doet al `COALESCE(order_regels.gewicht_kg, producten.gewicht_kg)`, maar **beide bronnen zijn rot**:

1. **`producten.gewicht_kg` bevat voor ~26% van de meetbare vaste producten de density (kg/m²) i.p.v. het stukgewicht.** Steekproef 1000 producten (vast, maat gevuld): 575 correct, **206 exact `gewicht_kg == kwaliteiten.gewicht_per_m2_kg`** (rechthoek) + 16 (rond), 152 zonder density/maat. Voorbeeld: artikel `548120001` (200×290 cm) heeft `gewicht_kg = 2.5` (= density), werkelijk 14.5 kg. Het live `bereken_product_gewicht_kg('345110003')` geeft wél correct 8.12 — alleen de cache is rot.
2. **Oorzaak-mechanisme:** de oorspronkelijke import schreef de Excel-kolom "Gewicht" (= kg/m²) naar `producten.gewicht_kg`. Mig 185 §4 backfillde correct, maar dekte alleen producten die *toen al* maat+density hadden. Latere maat-parsing (mig 188 RND/ovaal, mig 359) en latere density-vulling herrekenden níét: de mig 188 §6 "self-update" (`UPDATE kwaliteiten SET gewicht_per_m2_kg = gewicht_per_m2_kg`) was een **stille no-op** — de trigger heeft `WHEN (OLD IS DISTINCT FROM NEW)` en een self-assignment is niet distinct. Er bestaat bovendien géén trigger die herrekent wanneer `lengte_cm`/`breedte_cm`/`kwaliteit_code` op het prodúct wijzigen — alleen de kwaliteit-kant cascadeert.
3. **`order_regels.gewicht_kg`:** 1997 van 2195 NULL, 34 exact 0. De `COALESCE` in `genereer_zending_colli` behandelt 0 niet als ontbrekend → colli krijgen 0.00 (3 van de 4 bestaande colli-rijen in prod, ids 63/64/65).
4. **Zelfde rotte bronnen voeden de vervoerder-selectie:** `evalueer_orderregel_attributes` (mig 219) doet `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)` — de Rhenus-selectie-regel "DE ≤30 kg" evalueert dus tegen density-waarden (3.62 i.p.v. 29.54 kg).

**Bewust NIET in scope:** `zendingen.totaal_gewicht_kg`-backfill (Rhenus/Verhoek sommeren uit colli; het HST-fallback-pad gebruikt het alleen bij 0 colli, wat sinds mig 248 niet voorkomt — nieuwe zendingen krijgen na de order_regels-backfill vanzelf correcte totalen), de numerieke-entityIdentification-vlag (apart handoff-item 2) en het canary-draaiboek (handoff-item 3).

---

## File-structuur

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `supabase/migrations/383_colli_gewicht_fix.sql` | Create | Resolver-verdieping, self-healing trigger, gewicht-ladder, backfills, verifier-rapport |
| `import/check_gewicht_integriteit.py` | Create | Read-only verificatie (failing test vóór apply, groen ná apply); herbruikbaar als periodieke check |
| `import/prijslijst_import.py` | Modify (regel ~284, ~339) | Auto-create schrijft geen prijslijst-"Gewicht" meer naar `gewicht_kg` |
| `docs/database-schema.md` | Modify | `producten.gewicht_kg`-comment, nieuwe trigger, resolver-comments, `zending_colli.gewicht_kg` |
| `docs/changelog.md` | Modify | Entry 2026-06-12 |
| `CLAUDE.md` | Modify | Bedrijfsregel-bullet gewicht-keten |

---

### Task 1: Branch + worktree

**Files:** geen (git-setup)

Werkafspraak: substantieel werk meteen in eigen worktree (memory `feedback_worktree_vanaf_start`). De Rhenus-worktree `C:\Users\migue\Documents\Karpi-ERP-rhenus` is vrijgegeven door het handoff-doc en mag hergebruikt worden. **Let op (memory):** `import/.env` en Excel-bronnen ontbreken in een worktree — het verificatie-script (Task 2) draait daarom vanuit de hóófd-tree, of kopieer `import/.env` éénmalig naar de worktree.

- [ ] **Step 1: Worktree omhangen naar nieuwe branch**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus
git fetch origin; git status --porcelain
# Verwacht: leeg (schoon). Zo niet: stoppen en melden.
git checkout main; git pull --ff-only; git checkout -b fix/colli-gewicht
```

Verwacht: `Switched to a new branch 'fix/colli-gewicht'`.

- [ ] **Step 2: .env beschikbaar maken voor het verificatie-script**

```powershell
Copy-Item "C:\Users\migue\Documents\Karpi ERP\import\.env" "C:\Users\migue\Documents\Karpi-ERP-rhenus\import\.env"
```

Verwacht: bestand bestaat (staat in .gitignore, wordt niet gecommit — verifieer met `git status --porcelain`, moet leeg blijven).

---

### Task 2: Verificatie-script (de "failing test")

**Files:**
- Create: `import/check_gewicht_integriteit.py`

Read-only script in de stijl van `check_voorraad_diff.py` (zelfde `config.py`-import). Het rapporteert de vervuiling en exit-code 1 bij fouten — vóór de migratie rood, ná de migratie groen. Drie checks: (A) producten met complete data waar `gewicht_kg` ≠ vorm-aware berekening, (B) open orderregels met NULL/0-gewicht terwijl het product berekend kan worden, (C) niet-verzonden colli met NULL/0-gewicht.

- [ ] **Step 1: Script schrijven**

```python
"""
Gewicht-integriteit-check (read-only)
=====================================
Controleert de gewicht-keten die de Rhenus/Verhoek-preflight voedt:

  A. producten (vast/staaltje, maat+density compleet):
     gewicht_kg moet de vorm-aware berekening zijn
       rechthoek: lengte*breedte/10000 * density
       rond:      pi*(lengte/200)^2  * density
     Bekende vervuiling: gewicht_kg == density (kg/m2 i.p.v. stukgewicht).
  B. order_regels van open orders: gewicht_kg NULL/0 terwijl het
     product een berekenbaar gewicht heeft.
  C. zending_colli van niet-verzonden zendingen: gewicht_kg NULL/0.

Gebruik:  python check_gewicht_integriteit.py
Exit 0 = schoon, exit 1 = fouten gevonden (failing-test-semantiek).
"""
import math
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

PAGE = 1000


def fetch_all(bouw_query):
    """Haal alles gepagineerd op. bouw_query() levert een verse query-builder
    (PostgREST cap't op 1000 rijen — zelfde valkuil als het Pick & Ship
    max-rows-incident van 11-06)."""
    rows, off = [], 0
    while True:
        batch = bouw_query().range(off, off + PAGE - 1).execute().data
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        off += PAGE


def verwacht_gewicht(p, density):
    if p["vorm"] == "rond":
        return round(math.pi * (p["lengte_cm"] / 200) ** 2 * float(density), 2)
    return round(p["lengte_cm"] * p["breedte_cm"] / 10000 * float(density), 2)


def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    fouten = 0

    # --- densities ---
    kw = {r["code"]: r["gewicht_per_m2_kg"]
          for r in fetch_all(lambda: sb.table("kwaliteiten")
                             .select("code, gewicht_per_m2_kg"))}

    # --- A: producten-cache ---
    producten = fetch_all(lambda: sb.table("producten")
        .select("artikelnr, vorm, lengte_cm, breedte_cm, gewicht_kg, kwaliteit_code")
        .in_("product_type", ["vast", "staaltje"])
        .not_.is_("lengte_cm", "null")
        .not_.is_("breedte_cm", "null"))
    dens_fout, ander_fout, voorbeelden = 0, 0, []
    for p in producten:
        d = kw.get(p["kwaliteit_code"])
        if not d or float(d) <= 0:
            continue
        g = p["gewicht_kg"]
        verw = verwacht_gewicht(p, d)
        if g is None or abs(float(g) - verw) >= 0.05:
            if g is not None and abs(float(g) - float(d)) < 0.005:
                dens_fout += 1
            else:
                ander_fout += 1
            if len(voorbeelden) < 10:
                voorbeelden.append((p["artikelnr"], p["vorm"],
                                    p["lengte_cm"], p["breedte_cm"], g, verw, d))
    print(f"[A] producten compleet: {len(producten)} | "
          f"density-als-gewicht: {dens_fout} | anders fout: {ander_fout}")
    for v in voorbeelden:
        print(f"    {v[0]} {v[1]} {v[2]}x{v[3]}: cache={v[4]} verwacht={v[5]} density={v[6]}")
    fouten += dens_fout + ander_fout

    # --- B: open orderregels ---
    open_orders = fetch_all(lambda: sb.table("orders").select("id")
        .not_.in_("status", ["Verzonden", "Geannuleerd"]))
    open_ids = {o["id"] for o in open_orders}
    regels = fetch_all(lambda: sb.table("order_regels")
        .select("id, order_id, artikelnr, is_maatwerk, gewicht_kg")
        .not_.is_("artikelnr", "null"))
    regel_fout = sum(
        1 for r in regels
        if r["order_id"] in open_ids
        and (r["gewicht_kg"] is None or float(r["gewicht_kg"]) == 0))
    print(f"[B] open orderregels met artikelnr en gewicht NULL/0: {regel_fout}"
          f" (informatief — ladder rekent live; alleen tellen, geen exit-fout)")

    # --- C: colli ---
    actieve_zendingen = fetch_all(lambda: sb.table("zendingen").select("id")
        .not_.in_("status", ["Onderweg", "Afgeleverd"]))
    z_ids = {z["id"] for z in actieve_zendingen}
    colli = fetch_all(lambda: sb.table("zending_colli")
        .select("id, zending_id, gewicht_kg"))
    colli_fout = [c for c in colli
                  if c["zending_id"] in z_ids
                  and (c["gewicht_kg"] is None or float(c["gewicht_kg"]) == 0)]
    print(f"[C] niet-verzonden colli met gewicht NULL/0: {len(colli_fout)} "
          f"{[c['id'] for c in colli_fout[:20]]}")
    fouten += len(colli_fout)

    print(f"\nTotaal fouten (A+C): {fouten}")
    sys.exit(1 if fouten > 0 else 0)


if __name__ == "__main__":
    main()
```

Supabase-py-syntax-naslag: `.not_.is_("col", "null")` / `.not_.in_("col", [...])` zijn de negatie-vormen; `fetch_all` krijgt een lambda die een vérse builder oplevert per pagina (een builder is niet herbruikbaar na `.range()`).

- [ ] **Step 2: Script draaien — verwacht ROOD**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus\import
python check_gewicht_integriteit.py
```

(`config.py` en de in Task 1 gekopieerde `.env` staan in dezelfde map — Python resolved imports relatief aan de scriptlocatie.)

Verwacht (orde van grootte, op basis van de steekproef van 12-06): `[A] ... density-als-gewicht: honderden ... [C] ... 3 [63, 64, 65]`, exit-code 1. **Noteer de exacte aantallen** — die zijn de baseline voor de na-meting in Task 6.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus
git add import/check_gewicht_integriteit.py
git commit -m "test(gewicht): integriteit-check producten-cache + orderregels + colli (rood voor mig 383)"
```

---

### Task 3: Migratie 383 — resolver-verdieping, self-healing cache, gewicht-ladder, backfill

**Files:**
- Create: `supabase/migrations/383_colli_gewicht_fix.sql`

Volgorde in het bestand is betekenisvol: eerst functies (§1-§4), dan trigger (§2), dan backfills (§5) — de backfill-UPDATE op `producten` vuurt de bestaande AFTER-trigger `trg_product_gewicht_recalc` (mig 185, `WHEN OLD IS DISTINCT FROM NEW`) en cascadeert zo gratis naar open vaste orderregels; de expliciete regel-backfills in §5 zijn defense-in-depth voor de orders die de cascade uitsluit (`Klaar voor verzending`).

- [ ] **Step 1: Migratiebestand schrijven**

```sql
-- Migratie 383: colli-gewicht-fix — resolver-verdieping + self-healing cache + backfill
-- (in de live DB draait dit als 382 — zelfde repo/DB-offset als mig 379-382,
--  zie de hernummer-notitie in die headers)
--
-- Aanleiding (Rhenus/Verhoek-cutover, handoff 12-06): de SFTP-preflights
-- verplichten gewicht_kg > 0 per colli, maar zending_colli.gewicht_kg stond
-- vrijwel overal op 0. Diagnose wees dieper: ~26% van de vaste producten met
-- complete maat+density heeft de DENSITY (kg/m²) in producten.gewicht_kg
-- staan i.p.v. het stukgewicht (bv. 548120001, 200×290: cache 2.5, echt 14.5).
-- Oorzaak: de oorspronkelijke import schreef de Excel-kolom "Gewicht" (kg/m²)
-- naar gewicht_kg; mig 185 §4 backfillde alleen wat tóén compleet was; de
-- mig 188 §6 "self-update" (SET gewicht_per_m2_kg = gewicht_per_m2_kg) was
-- een stille NO-OP (trigger-WHEN: OLD IS DISTINCT FROM NEW — self-assignment
-- is niet distinct); en er bestond géén herreken-trigger aan de productKANT
-- (maat/kwaliteit later gevuld → cache nooit herrekend).
--
-- Drie lagen:
--   §1  bereken_orderregel_gewicht_kg rekent vast-producten voortaan LIVE
--       via bereken_product_gewicht_kg (vorm-aware) i.p.v. cache-copy.
--   §2  Self-healing BEFORE-trigger op producten: voor vast/staaltje met
--       complete data is gewicht_kg ALTIJD de gederiveerde waarde — sluit
--       alle vervuilingsroutes (imports, UI, scripts) categorisch af.
--       Handmatige gewichtscorrectie hoort op kwaliteiten.gewicht_per_m2_kg.
--   §3  genereer_zending_colli: gewicht-ladder met NULLIF(0) — regel-cache
--       (kan handmatig gecorrigeerd zijn) → live resolver → product-cache.
--   §4  evalueer_orderregel_attributes: NULLIF(0)-defensie (zelfde rotte
--       bronnen voedden de vervoerder-selectie, o.a. Rhenus "DE ≤30 kg").
--   §5  Backfill: producten (vorm-aware) → AFTER-trigger cascadeert naar
--       open vaste orderregels; expliciete backfill voor maatwerk-regels en
--       KvV-orders; zending_colli van niet-verzonden zendingen.
--
-- Idempotent: CREATE OR REPLACE + herhaalbare set-based UPDATEs.

-- ============================================================================
-- §1. bereken_orderregel_gewicht_kg — vast-pad via live resolver
-- ============================================================================
CREATE OR REPLACE FUNCTION bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
  v_is_maatwerk        BOOLEAN;
  v_maatwerk_opp       NUMERIC;
  v_maatwerk_kwaliteit TEXT;
  v_artikelnr          TEXT;
  v_density            NUMERIC;
  v_gewicht            NUMERIC;
BEGIN
  SELECT ore.is_maatwerk, ore.maatwerk_oppervlak_m2,
         ore.maatwerk_kwaliteit_code, ore.artikelnr
    INTO v_is_maatwerk, v_maatwerk_opp, v_maatwerk_kwaliteit, v_artikelnr
  FROM order_regels ore
  WHERE ore.id = p_order_regel_id;

  IF v_is_maatwerk = true AND v_maatwerk_opp IS NOT NULL
     AND v_maatwerk_kwaliteit IS NOT NULL THEN
    SELECT gewicht_per_m2_kg INTO v_density
      FROM kwaliteiten WHERE code = v_maatwerk_kwaliteit;
    IF v_density IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN ROUND(v_maatwerk_opp * v_density, 2);
  END IF;

  IF v_artikelnr IS NOT NULL THEN
    -- Mig 383: LIVE berekening (vorm-aware, mig 188/192) i.p.v. copy van de
    -- producten.gewicht_kg-cache — de cache bleek vervuilbaar (density-bug).
    -- bereken_product_gewicht_kg valt zelf al terug op legacy-gewicht als
    -- maat/density ontbreken. NULLIF: 0 is geen gewicht.
    SELECT bg.gewicht_kg INTO v_gewicht
      FROM bereken_product_gewicht_kg(v_artikelnr) bg;
    RETURN NULLIF(v_gewicht, 0);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_orderregel_gewicht_kg IS
  'Gewicht-resolver — gewicht (kg/stuk) voor een orderregel. Maatwerk: '
  'oppervlak × kwaliteit-density. Vast: sinds mig 383 LIVE via '
  'bereken_product_gewicht_kg (vorm-aware) i.p.v. cache-copy. '
  'Service-items zonder artikelnr → NULL. Mig 185/383.';

-- ============================================================================
-- §2. Self-healing cache: BEFORE-trigger op producten
-- ============================================================================
-- Voor vast/staaltje met maat + kwaliteit-density is gewicht_kg een
-- AFGEDWONGEN gederiveerde cache: elke INSERT/UPDATE die de bron-kolommen
-- (of gewicht_kg zelf) raakt, herleidt de waarde. Een import of UI-edit kan
-- de cache dus niet meer vervuilen. Bij incomplete data blijft de bestaande
-- waarde staan (legacy-fallback, gewicht_uit_kwaliteit=false).
CREATE OR REPLACE FUNCTION producten_gewicht_derive()
RETURNS TRIGGER AS $$
DECLARE
  v_density NUMERIC;
BEGIN
  -- NULL-veilig: NOT IN evalueert bij NULL naar NULL (valt dóór) — een
  -- type-loos product mag nooit stil een gederiveerd gewicht krijgen.
  IF NEW.product_type IS NULL OR NEW.product_type NOT IN ('vast', 'staaltje') THEN
    RETURN NEW;
  END IF;
  IF NEW.lengte_cm IS NULL OR NEW.breedte_cm IS NULL
     OR NEW.kwaliteit_code IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT gewicht_per_m2_kg INTO v_density
    FROM kwaliteiten WHERE code = NEW.kwaliteit_code;
  IF v_density IS NULL OR v_density <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.vorm = 'rond' THEN
    NEW.gewicht_kg := ROUND(PI()::NUMERIC * POWER(NEW.lengte_cm::NUMERIC / 200.0, 2) * v_density, 2);
  ELSE
    NEW.gewicht_kg := ROUND((NEW.lengte_cm::NUMERIC * NEW.breedte_cm::NUMERIC / 10000.0) * v_density, 2);
  END IF;
  NEW.gewicht_uit_kwaliteit := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producten_gewicht_derive ON producten;
CREATE TRIGGER trg_producten_gewicht_derive
  BEFORE INSERT OR UPDATE OF gewicht_kg, lengte_cm, breedte_cm, kwaliteit_code, vorm, product_type
  ON producten
  FOR EACH ROW
  EXECUTE FUNCTION producten_gewicht_derive();

COMMENT ON TRIGGER trg_producten_gewicht_derive ON producten IS
  'Mig 383: self-healing gederiveerde cache. Voor vast/staaltje met complete '
  'data (maat + kwaliteit-density) wordt gewicht_kg ALTIJD herleid — een '
  'handmatige/import-waarde wordt bewust overschreven. Gewicht corrigeren = '
  'kwaliteiten.gewicht_per_m2_kg aanpassen (cascadeert via mig 185/188-trigger). '
  'Let op: UPDATE OF vuurt op kolom-in-SET-lijst, niet op waarde-verandering — '
  'precies waardoor de mig 188 §6 self-update-backfill destijds een no-op was '
  '(die zat achter een WHEN OLD IS DISTINCT FROM NEW).';

-- ============================================================================
-- §3. genereer_zending_colli — gewicht-ladder (body verder = mig 213)
-- ============================================================================
CREATE OR REPLACE FUNCTION genereer_zending_colli(p_zending_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_aantal_aangemaakt INTEGER := 0;
  v_volgnr            INTEGER := 0;
  r                   RECORD;
  i                   INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  -- Skip als al colli's bestaan
  IF EXISTS (SELECT 1 FROM zending_colli WHERE zending_id = p_zending_id) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT
      zr.id              AS zending_regel_id,
      zr.order_regel_id,
      zr.artikelnr,
      zr.rol_id,
      zr.aantal,
      ore.is_maatwerk,
      ore.maatwerk_lengte_cm::INTEGER  AS maatwerk_lengte_cm,
      ore.maatwerk_breedte_cm::INTEGER AS maatwerk_breedte_cm,
      ore.maatwerk_afwerking,
      p.omschrijving      AS product_naam,
      p.lengte_cm         AS prod_lengte_cm,
      p.breedte_cm        AS prod_breedte_cm,
      p.gewicht_kg        AS prod_gewicht_kg,
      ore.gewicht_kg      AS regel_gewicht_kg,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
      k.omschrijving      AS kwaliteit_naam
    FROM zending_regels zr
    LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
    LEFT JOIN producten p     ON p.artikelnr = zr.artikelnr
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, aantal
      ) VALUES (
        p_zending_id,
        v_volgnr,
        r.order_regel_id,
        r.rol_id,
        genereer_sscc(),
        -- Mig 383 gewicht-ladder: regel-cache (respecteert eventuele
        -- handmatige correctie; 0 = ontbreekt) → live resolver (vorm-aware,
        -- ook maatwerk) → product-cache als laatste vangnet.
        COALESCE(
          NULLIF(r.regel_gewicht_kg, 0),
          bereken_orderregel_gewicht_kg(r.order_regel_id),
          NULLIF(r.prod_gewicht_kg, 0)
        ),
        compose_colli_omschrijving(
          r.is_maatwerk, r.kwaliteit_code, r.kwaliteit_naam,
          r.maatwerk_lengte_cm, r.maatwerk_breedte_cm, r.maatwerk_afwerking,
          r.product_naam, r.prod_lengte_cm, r.prod_breedte_cm
        ),
        1
      );
      v_aantal_aangemaakt := v_aantal_aangemaakt + 1;
    END LOOP;
  END LOOP;

  UPDATE zendingen SET aantal_colli = v_aantal_aangemaakt WHERE id = p_zending_id;

  RETURN v_aantal_aangemaakt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION genereer_zending_colli(BIGINT) TO authenticated;

COMMENT ON FUNCTION genereer_zending_colli(BIGINT) IS
  'Mig 383: gewicht-ladder NULLIF(regel,0) → bereken_orderregel_gewicht_kg '
  '(live, vorm-aware) → NULLIF(product-cache,0). Verder identiek aan mig 213: '
  'maakt zending_colli-rijen (1 colli per stuk), idempotent, SSCC + '
  'omschrijving-snapshot per colli.';

-- ============================================================================
-- §4. evalueer_orderregel_attributes — NULLIF(0)-defensie
-- ============================================================================
CREATE OR REPLACE FUNCTION evalueer_orderregel_attributes(p_orderregel_id BIGINT)
RETURNS TABLE (
  afl_land           TEXT,
  kleinste_zijde_cm  INTEGER,
  totaal_gewicht_kg  NUMERIC,
  debiteur_nr        INTEGER,
  inkoopgroep_code   TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.afl_land,
    LEAST(
      COALESCE(ore.maatwerk_lengte_cm,  p.lengte_cm),
      COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
    )::INTEGER AS kleinste_zijde_cm,
    -- Mig 383: NULLIF(0) — een 0-gewicht-cache mag de ladder niet
    -- kortsluiten (34 orderregels stonden op exact 0).
    (COALESCE(NULLIF(ore.gewicht_kg, 0), NULLIF(p.gewicht_kg, 0), 0)
       * GREATEST(COALESCE(ore.orderaantal, 0), 0))::NUMERIC AS totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM order_regels ore
  JOIN orders o          ON o.id = ore.order_id
  LEFT JOIN producten p  ON p.artikelnr = ore.artikelnr
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE ore.id = p_orderregel_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION evalueer_orderregel_attributes(BIGINT) TO authenticated;

COMMENT ON FUNCTION evalueer_orderregel_attributes(BIGINT) IS
  'Mig 219 + 383: per-orderregel attributen voor regel-evaluator. Sinds 383 '
  'met NULLIF(0) op beide gewicht-bronnen (0-cache mocht de COALESCE niet '
  'kortsluiten).';

-- ============================================================================
-- §5. Backfills
-- ============================================================================
-- 5a. producten: vorm-aware herberekening (zoals mig 185 §4 + mig 188-formule).
--     De AFTER-trigger trg_product_gewicht_recalc (mig 185, WHEN OLD IS
--     DISTINCT FROM NEW) cascadeert gewijzigde waarden automatisch naar open
--     vaste orderregels (orders niet in Verzonden/Geannuleerd/KvV).
--     De BEFORE-trigger uit §2 herleidt dezelfde waarde — consistent.
UPDATE producten p
SET
  gewicht_kg = CASE p.vorm
    WHEN 'rond' THEN ROUND(PI()::NUMERIC * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * q.gewicht_per_m2_kg, 2)
    ELSE             ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * q.gewicht_per_m2_kg, 2)
  END,
  gewicht_uit_kwaliteit = true
FROM kwaliteiten q
WHERE q.code = p.kwaliteit_code
  AND p.product_type IN ('vast', 'staaltje')
  AND p.lengte_cm IS NOT NULL
  AND p.breedte_cm IS NOT NULL
  AND q.gewicht_per_m2_kg IS NOT NULL
  AND q.gewicht_per_m2_kg > 0;

-- 5b. Open VASTE orderregels expliciet (defense-in-depth: de 5a-cascade
--     slaat 'Klaar voor verzending' over; die zendingen zijn nog niet weg
--     en hun colli-generatie/heraanmaak moet op het juiste gewicht kunnen
--     leunen).
UPDATE order_regels ore
SET gewicht_kg = p.gewicht_kg
FROM orders o, producten p
WHERE o.id = ore.order_id
  AND p.artikelnr = ore.artikelnr
  AND ore.is_maatwerk = false
  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND p.gewicht_kg IS NOT NULL
  AND p.gewicht_kg > 0
  AND ore.gewicht_kg IS DISTINCT FROM p.gewicht_kg;

-- 5c. Open MAATWERK-orderregels: oppervlak × density.
UPDATE order_regels ore
SET gewicht_kg = ROUND(ore.maatwerk_oppervlak_m2 * q.gewicht_per_m2_kg, 2)
FROM orders o, kwaliteiten q
WHERE o.id = ore.order_id
  AND q.code = ore.maatwerk_kwaliteit_code
  AND ore.is_maatwerk = true
  AND ore.maatwerk_oppervlak_m2 IS NOT NULL
  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND q.gewicht_per_m2_kg IS NOT NULL
  AND q.gewicht_per_m2_kg > 0
  AND ore.gewicht_kg IS DISTINCT FROM ROUND(ore.maatwerk_oppervlak_m2 * q.gewicht_per_m2_kg, 2);

-- 5d. Bestaande colli van niet-verzonden zendingen: via de (verdiepte)
--     resolver. Verzonden/afgeleverde zendingen bewust ongemoeid — dat is
--     historie zoals die de deur uit ging.
UPDATE zending_colli zc
SET gewicht_kg = COALESCE(bereken_orderregel_gewicht_kg(zc.order_regel_id), zc.gewicht_kg)
FROM zendingen z
WHERE z.id = zc.zending_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND (zc.gewicht_kg IS NULL OR zc.gewicht_kg = 0);

-- ============================================================================
-- §6. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_dens_rest INTEGER;
  v_colli_leeg INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dens_rest
  FROM producten p
  JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.product_type IN ('vast', 'staaltje')
    AND p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL
    AND q.gewicht_per_m2_kg > 0
    AND p.gewicht_kg = q.gewicht_per_m2_kg
    AND ABS(p.gewicht_kg - CASE p.vorm
          WHEN 'rond' THEN ROUND(PI()::NUMERIC * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * q.gewicht_per_m2_kg, 2)
          ELSE             ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * q.gewicht_per_m2_kg, 2)
        END) >= 0.05;

  SELECT COUNT(*) INTO v_colli_leeg
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND (zc.gewicht_kg IS NULL OR zc.gewicht_kg = 0);

  RAISE NOTICE 'Mig 383 verifier: density-als-gewicht resterend: % (verwacht 0)', v_dens_rest;
  RAISE NOTICE 'Mig 383 verifier: niet-verzonden colli zonder gewicht: % (verwacht 0, of colli van regels zonder berekenbaar gewicht)', v_colli_leeg;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Syntax-sanity (geen lokale DB — droge checks)**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus
# Geen lokale Postgres in dit project; check op de bekende valkuilen:
Select-String -Path supabase\migrations\383_colli_gewicht_fix.sql -Pattern '\\b' -SimpleMatch
```

Verwacht: geen hits (memory `reference_postgres_woordgrens_regex`: `\b` is backspace in Postgres-regex — komt in deze migratie nergens voor; check is een vangnet). Lees de migratie nog één keer integraal na op kolomnamen tegen `docs/database-schema.md` (de mig 209→213-geschiedenis laat zien dat ongeteste kolomnamen hier de klassieke fout zijn).

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/383_colli_gewicht_fix.sql
git commit -m "fix(logistiek): colli-gewicht-keten — live resolver, self-healing producten-cache, backfill (mig 383)"
```

---

### Task 4: Import-hygiëne — prijslijst-auto-create schrijft geen "Gewicht"-kolom meer

**Files:**
- Modify: `import/prijslijst_import.py` (regels ~280-285 en ~335-340)

De prijslijst-Excel-kolom F "Gewicht" is dezelfde dubbelzinnige bron als de oorspronkelijke vervuiling (kg/m² vs. kg/stuk). Auto-created producten hebben geen maat/kwaliteit, dus de §2-trigger kan ze niet corrigeren én `bereken_product_gewicht_kg` valt voor zulke producten terug op dit legacy-veld — een verkeerde waarde stroomt dan tóch een colli in. Een eerlijke NULL (preflight blokkeert → operator vult het product aan) is beter dan een fout getal. De genummerde `import_prijslijst02XX.py`-scripts zijn historische one-offs — niet aanpassen.

- [ ] **Step 1: Beide auto-create-plekken aanpassen**

In `import/prijslijst_import.py`, de dict rond regel 280-285:

```python
                        all_missing_products[row["artikelnr"]] = {
                            "omschrijving": row["omschrijving"],
                            "omschrijving_2": row["omschrijving_2"],
                            "verkoopprijs": row["prijs"],
                            # Mig 383: prijslijst-kolom F "Gewicht" is kg/m² (density),
                            # geen stukgewicht — niet meer naar producten.gewicht_kg
                            # schrijven. Eerlijke NULL; resolver/trigger vullen zodra
                            # maat + kwaliteit bekend zijn.
                            "gewicht_kg": None,
                        }
```

En de product-dict rond regel 335-340:

```python
            new_products.append({
                "artikelnr": artikelnr,
                "omschrijving": info["omschrijving"] or "Onbekend product",
                "verkoopprijs": info["verkoopprijs"],
                "gewicht_kg": None,  # zie comment hierboven (mig 383)
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": ptype,
```

(Gebruik de Edit-tool — memory `reference_ps51_utf8_mojibake`: geen PowerShell-`-replace` op deze bestanden.)

- [ ] **Step 2: Commit**

```powershell
git add import/prijslijst_import.py
git commit -m "fix(import): prijslijst-auto-create schrijft density-kolom niet meer naar producten.gewicht_kg"
```

---

### Task 5: Levende documentatie

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: database-schema.md bijwerken**

Vier plekken:

1. **`producten.gewicht_kg`-rij** (regel ~245): vervang de bestaande celtekst door:

```markdown
| gewicht_kg | NUMERIC(8,2) | **Sinds mig 185 gederiveerde cache; sinds mig 383 AFGEDWONGEN** via BEFORE-trigger `trg_producten_gewicht_derive`: voor `product_type IN ('vast','staaltje')` met maat + kwaliteit-density wordt elke INSERT/UPDATE herleid (vorm-aware: `rond` → `π × (lengte_cm/200)² × density`, anders `(lengte×breedte/10000) × density`) — handmatige waarden worden bewust overschreven; gewicht corrigeren = `kwaliteiten.gewicht_per_m2_kg` aanpassen. Voor 'rol'/'overig' of incomplete data blijft de handmatige/legacy-waarde staan. **Let op (historische bug, gefixt in mig 383):** ~26% van de cache bevatte de density (kg/m²) i.p.v. het stukgewicht. |
```

2. **`zending_colli.gewicht_kg`-rij** (regel ~699): vervang door:

```markdown
| gewicht_kg | NUMERIC | Per-colli gewicht. Sinds mig 383 gevuld via ladder `NULLIF(order_regels.gewicht_kg,0)` → `bereken_orderregel_gewicht_kg` (live, vorm-aware) → `NULLIF(producten.gewicht_kg,0)`. Verplicht > 0 voor de Rhenus/Verhoek-preflight. Handmatig overschrijfbaar in latere UI. |
```

3. **Functie-tabel, `bereken_orderregel_gewicht_kg`-rij** (regel ~1461): vervang "Vast: copy van `producten.gewicht_kg`" door "Vast: sinds mig 383 live via `bereken_product_gewicht_kg` (vorm-aware) i.p.v. cache-copy; 0 → NULL".

4. **Trigger-sectie**: voeg naast `trg_product_gewicht_recalc` (regel ~1464) een rij toe:

```markdown
| `producten_gewicht_derive()` | BEFORE-trigger op `producten` (INSERT + UPDATE OF gewicht_kg/lengte_cm/breedte_cm/kwaliteit_code/vorm/product_type). Self-healing gederiveerde gewicht-cache voor vast/staaltje met complete data. Mig 383. |
```

- [ ] **Step 2: changelog.md — entry toevoegen** (bovenaan, datum 2026-06-12, na de Rhenus-entries van die dag)

```markdown
## 2026-06-12 — Colli-gewicht-fix: resolver-verdieping + self-healing producten-cache (mig 383)

**Aanleiding:** de Rhenus/Verhoek-SFTP-preflights verplichten `gewicht_kg > 0` per colli, maar `zending_colli.gewicht_kg` stond op 0 (3 van 4 prod-rijen). Diagnose: ~26% van de vaste producten met complete maat+density had de **density (kg/m²) als stukgewicht** in de `producten.gewicht_kg`-cache (bv. 548120001, 200×290 cm: cache 2,5 kg, werkelijk 14,5 kg). Oorzaak-keten: oorspronkelijke import schreef de Excel-kolom "Gewicht" (kg/m²) naar `gewicht_kg`; mig 185-backfill dekte alleen wat toen compleet was; de mig 188 §6 self-update-backfill was een stille no-op (`SET x = x` passeert de `WHEN OLD IS DISTINCT FROM NEW`-trigger niet); en er bestond geen herreken-trigger aan de product-kant. Dezelfde rotte bronnen voedden ook de vervoerder-selectie (`evalueer_orderregel_attributes`, o.a. de Rhenus-regel "DE ≤30 kg").

**Fix (mig 383):** (1) `bereken_orderregel_gewicht_kg` rekent vast-producten live via `bereken_product_gewicht_kg` (vorm-aware) i.p.v. cache-copy; (2) BEFORE-trigger `trg_producten_gewicht_derive` maakt de cache self-healing — vervuiling door imports/UI is categorisch onmogelijk geworden; (3) `genereer_zending_colli` gewicht-ladder met `NULLIF(0)`; (4) `evalueer_orderregel_attributes` NULLIF(0)-defensie; (5) backfill producten (vorm-aware) + open orderregels (vast én maatwerk) + niet-verzonden colli. Import-hygiëne: `prijslijst_import.py` schrijft kolom F niet meer naar `gewicht_kg` bij auto-create. Verificatie: `import/check_gewicht_integriteit.py` (read-only, exit 1 bij fouten — herbruikbaar als periodieke check).
```

- [ ] **Step 3: CLAUDE.md — bedrijfsregel-bullet toevoegen** (in de Bedrijfsregels-sectie, na de Rhenus-bullet)

```markdown
- **Gewicht-keten (mig 184/185/188/383):** bron-van-waarheid is `kwaliteiten.gewicht_per_m2_kg`; `producten.gewicht_kg` is een **afgedwongen** gederiveerde cache (BEFORE-trigger `trg_producten_gewicht_derive`, mig 383 — vast/staaltje met maat+density wordt bij elke INSERT/UPDATE herleid, vorm-aware; handmatig gewicht zetten kan dus niet, corrigeer de density). `bereken_orderregel_gewicht_kg` rekent vast-producten live (niet cache-copy); `genereer_zending_colli` vult colli-gewicht via ladder `NULLIF(regel,0) → resolver → NULLIF(product,0)` — verplicht > 0 voor de Rhenus/Verhoek-preflight. Historische valkuil: de density (kg/m²) stond als stukgewicht in de cache (~26%, import-artefact + mig 188 §6 no-op-backfill: `SET x=x` vuurt een `WHEN OLD IS DISTINCT FROM NEW`-trigger niet). Check: `import/check_gewicht_integriteit.py`.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/database-schema.md docs/changelog.md CLAUDE.md
git commit -m "docs: gewicht-keten — afgedwongen cache, colli-ladder, mig 383"
```

---

### Task 6: Apply + verificatie (samen met Miguel)

**Files:** geen (operationeel draaiboek)

Migraties applyt Miguel zelf in de Supabase SQL-editor (agent heeft geen DB-schrijfrechten; MCP heeft geen toegang — memory `reference_karpi_supabase_mcp`).

- [ ] **Step 0: Live-drift-check (advies finale review).** Mig 383 vervangt complete function-bodies op basis van de repo-stand; een eventuele live-only SQL-editor-hotfix in die functies zou stilletjes teruggedraaid worden. Vóór apply in de SQL-editor draaien en de output vergelijken met de repo-versies (mig 213 resp. 219):

```sql
SELECT pg_get_functiondef('genereer_zending_colli(bigint)'::regprocedure);
SELECT pg_get_functiondef('evalueer_orderregel_attributes(bigint)'::regprocedure);
```

Wijkt een body af van de repo-versie → stoppen en de afwijking eerst in de migratie verwerken.

**Caveat bij de groen-verwachting (finale review):** check C van het verificatie-script telt élke niet-verzonden colli zonder gewicht, ook als de resolver er niets voor kán berekenen (regel zonder artikelnr/density, `order_regel_id` NULL). Een rest-aantal > 0 in C na apply is acceptabel mits per colli verklaard — de §6-NOTICE van de migratie verwoordt dat ook zo.

- [ ] **Step 1: Miguel vragen mig 383 te draaien** in de SQL-editor (volledige inhoud van `383_colli_gewicht_fix.sql`). Verwachte NOTICE-output onderaan:

```
Mig 383 verifier: density-als-gewicht resterend: 0 (verwacht 0)
Mig 383 verifier: niet-verzonden colli zonder gewicht: 0 (verwacht 0, of ...)
```

- [ ] **Step 2: Verificatie-script opnieuw draaien — verwacht GROEN**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus\import
python check_gewicht_integriteit.py
```

Verwacht: `[A] ... density-als-gewicht: 0 | anders fout: 0`, `[C] ... 0 []`, exit-code 0. Vergelijk met de baseline uit Task 2.

- [ ] **Step 3: Spot-checks via PostgREST** (service-key uit `import/.env`)

```powershell
# 1. De bekende boosdoener: 548120001 (200x290, density 2.5) moet nu 14.50 zijn
# 2. De drie 0.00-colli (63/64/65) moeten gevuld zijn
# 3. Resolver-spot-check regel 3503 moet 9.90 geven (240x330 x 1.25)
```

```bash
KEY=$(grep SERVICE import/.env | cut -d= -f2-); URL=https://wqzeevfobwauxkalagtn.supabase.co
curl -s "$URL/rest/v1/producten?artikelnr=eq.548120001&select=artikelnr,gewicht_kg,gewicht_uit_kwaliteit" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
curl -s "$URL/rest/v1/zending_colli?id=in.(63,64,65)&select=id,gewicht_kg" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
curl -s -X POST "$URL/rest/v1/rpc/bereken_orderregel_gewicht_kg" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"p_order_regel_id":3503}'
```

Verwacht: `gewicht_kg: 14.50` + `gewicht_uit_kwaliteit: true`; colli 63/64/65 elk > 0 (tenzij hun zending inmiddels Onderweg/Afgeleverd is — dan terecht onaangeroerd); resolver `9.90`.

- [ ] **Step 4: Trigger-gedrag bewijzen (self-healing)** — Miguel of via PostgREST met service-key: zet een bewust fout gewicht en controleer dat de trigger het herleidt:

```bash
curl -s -X PATCH "$URL/rest/v1/producten?artikelnr=eq.548120001" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"gewicht_kg": 1}' | head -c 300
```

Verwacht: de response toont `"gewicht_kg": 14.50` (de trigger heeft de 1 direct herleid). Dit is tegelijk de regressietest voor toekomstige import-vervuiling.

---

### Task 7: Afronden — typecheck, merge-voorbereiding

**Files:** geen

- [ ] **Step 1: Frontend-typecheck (werkafspraak vóór merge, memory `reference_pd_branches_typecheck`)** — er zijn geen TS-wijzigingen, dus dit is een formaliteit:

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus\frontend
npm run typecheck
```

Verwacht: 0 errors.

- [ ] **Step 2: Migratienummer-hercheck vlak vóór merge** (memory `reference_migratienummer_collisie_bij_merge`):

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-rhenus
git fetch origin; git ls-tree origin/main --name-only supabase/migrations/ | Select-String '^supabase/migrations/383'
```

Verwacht: leeg (geen collisie). Zo niet: hernummeren naar het eerstvolgende vrije nummer + header-notitie, zoals bij mig 379-382.

- [ ] **Step 3: Branch pushen; merge naar main pas op Miguels expliciete commando** (werkafspraak), en dan via `git push origin fix/colli-gewicht:main`-route (memory `reference_merge_race_parallelle_sessies`).

```powershell
git push -u origin fix/colli-gewicht
```

- [ ] **Step 4: Memory bijwerken** — `project_rhenus_cutover.md`: "gewicht-datagap" markeren als opgelost (mig 383) zodra Task 6 groen is; vermeld de self-healing trigger als nieuw vast gegeven.

---

## Risico's & rollback

- **De BEFORE-trigger overschrijft bewust handmatige gewichten** op vast/staaltje-producten met complete data. Dat is de spec (cache is gederiveerd sinds mig 185), maar als er ergens een legitieme handmatige uitzondering blijkt te bestaan: trigger droppen kan los (`DROP TRIGGER trg_producten_gewicht_derive ON producten`) zonder de rest van de fix te raken — de ladder + backfill blijven dan werken.
- **Backfill raakt ~3.800 producten** (26% van ~15k gevulde) → AFTER-cascade update't open orderregels → `update_order_totalen`-trigger herrekent order-totalen. Dat is veel triggerwerk in één transactie maar binnen SQL-editor-timeouts (set-based, geen per-rij RPC's). Bij twijfel: 5a in twee delen splitsen op `p.vorm`.
- **Geen gedragswijziging voor HST:** colli-gewichten worden alleen béter (HST gebruikt `c.gewicht_kg ?? DEFAULT_WEIGHT_KG`); de payload-shape wijzigt niet.
- **Rhenus-selectie-regels gaan op échte gewichten matchen** zodra `rhenus_sftp` actief wordt: producten die eerst (fout, te licht) onder de 30 kg-grens vielen kunnen nu terecht uit de Rhenus-route vallen. Dat is gewenst gedrag, maar vermeld het bij de canary (handoff-item 3).
