# Inkoop-reserveringen V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bij order-aanmaak vaste-maat-producten reserveren op openstaande inkooporderregels wanneer de voorraad ontoereikend is, met klantkeuze "deelleveren / in 1×" en een berekende verwachte leverweek per orderregel. Maatwerk krijgt alleen een levertijd-indicator.

**Architecture:** Eén nieuwe tabel `order_reserveringen` als bron-van-waarheid, met rijen voor zowel voorraadclaims als IO-claims. De bestaande `producten.gereserveerd` wordt afgeleid van die tabel; `producten.vrije_voorraad`-formule wordt vereenvoudigd (geen `+ besteld_inkoop` meer). Allocatie loopt via één idempotente RPC `herallocateer_orderregel` die bij orderregel-mutatie en bij IO-statuswissel wordt aangeroepen. UI is hoofdzakelijk inline op bestaande schermen plus één compact dialog bij order-opslaan.

**Tech Stack:** PostgreSQL (migraties, triggers, RPC's), TypeScript Supabase queries, React + TanStack Query + shadcn/ui.

---

## Context & Ontwerpkeuzes

Dit plan is het resultaat van /grill-me op 2026-04-29 — alle keuzes hieronder zijn met de gebruiker doorgewerkt.

**V1-scope: alleen vaste maten.**
Maatwerk-producten worden uit specifieke rollen gesneden via `snijplannen` en raken een ander spoor (m², uitwisselbaarheid, rolafmetingen). Inkoopreservering voor maatwerk staat in V2. Voor maatwerk leveren we in V1 alleen een **levertijd-indicator** op de orderregel (eerstvolgende inkoop-leverweek + 2 weken).

**Datamodel: harde koppeling, één tabel.**
- Tabel `order_reserveringen(order_regel_id, bron, inkooporder_regel_id, aantal, claim_volgorde, status)`.
- `bron='voorraad'` → claim op fysieke voorraad. `bron='inkooporder_regel'` → claim op openstaande IO-regel.
- Eén tabel ipv twee houdt herallocatie-logica simpel: één plek voor release/realloceer-acties.

**Splitsing per order, niet per regel.**
De keuze "deel leveren wat nu kan / wachten tot alles binnen is" geldt voor de hele order. Default uit `debiteuren.deelleveringen_toegestaan`, per order overrulebaar in een dialog bij opslaan. Wordt opgeslagen als `orders.lever_modus TEXT CHECK ('deelleveringen', 'in_een_keer')`.

**Allocatie automatisch, oudste IO eerst, claim-volgorde-prio.**
Bij orderregel-INSERT/UPDATE alloceert de trigger automatisch tegen voorraad-eerst, daarna openstaande IO-regels op `verwacht_datum ASC`. Geen handmatige IO-keuze in V1. Wie eerst claimt, krijgt eerst — geen automatische herallocatie als een nieuwere order met urgenter afleverdatum binnenkomt. Spoed-overrides zijn V2.

**Claims alleen op IO-status `Besteld` of `Deels ontvangen`.**
`Concept` is een werkdocument voor de inkoper en mag geen klantbelofte dragen. `Geannuleerd` triggert release.

**Levertijd in ISO-week.**
`ISO-week(verwacht_datum) + buffer` waarbij buffer = 1 week voor vast / 2 weken voor maatwerk. Buffers staan in `app_config.order_config`. Bij split-claim:
- Bij `lever_modus='deelleveringen'`: per claim een eigen leverweek → meerdere zendingen.
- Bij `lever_modus='in_een_keer'`: max-week wint → één zending op de laatste week.

**Semantiekwijziging `producten.vrije_voorraad`.**
Nieuwe formule: `voorraad − gereserveerd − backorder`. Geen `+ besteld_inkoop` meer (mengde toekomst en heden). `producten.gereserveerd` wordt voortaan: som van `aantal` over `order_reserveringen` waar `bron='voorraad'`. Dit is een **breaking change** voor `producten_overzicht` en alle frontend-plekken die `vrije_voorraad` lezen.

**Order-status `Wacht op inkoop`.**
Nieuwe enum-waarde naast bestaande `Wacht op voorraad`. Een order krijgt deze status zodra ≥1 orderregel een actieve `bron='inkooporder_regel'`-claim heeft.

**Levenscyclus:**
- Orderregel-mutatie → trigger roept `herallocateer_orderregel(p_order_regel_id)`.
- IO-status `Geannuleerd` → release alle claims op die IO; getroffen orderregels worden opnieuw gealloceerd (kunnen "Wacht op nieuwe inkoop" worden).
- IO `verwacht_datum` wijziging → claims blijven; levertijd wordt live afgeleid via view, geen extra actie.
- `boek_voorraad_ontvangst` → claims op die IO worden in claim-volgorde geconsumeerd: voorraad +N, claims gemarkeerd `status='geleverd'`, `producten.gereserveerd` herberekend (nu telt het claim-rijen mee als voorraad-claims, want deze klanten staan op voorraad).

**Buiten V1 (V2-backlog):**
- Maatwerk echte claim op IO-rol (V1 alleen indicator)
- Handmatige IO-keuze door gebruiker (override)
- Klantnotificatie bij IO-vertraging
- Spoed-prio (claim "stelen" mogelijk maken)
- Reservering op `bron='inkooporder_regel'` voor `eenheid='m'` rolproducten als hele rol (vandaag al gedeeltelijk dekkend via `besteld_inkoop`-aggregaat)

---

## File Structure

### Database migraties
- `supabase/migrations/144_order_reserveringen_basis.sql` — nieuwe enum-waarde `Wacht op inkoop`, tabel `order_reserveringen`, kolom `orders.lever_modus`, app_config-keys
- `supabase/migrations/145_order_reserveringen_rpcs.sql` — RPC's `herallocateer_orderregel`, `release_claims_voor_io_regel`, helper `iso_week_plus`
- `supabase/migrations/146_order_reserveringen_triggers.sql` — triggers op `order_regels` (mutatie), `orders` (status), `order_reserveringen` (synchroniseer `producten.gereserveerd`)
- `supabase/migrations/147_inkoop_status_release_trigger.sql` — trigger op `inkooporders` (`Geannuleerd` → release)
- `supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql` — `boek_voorraad_ontvangst` aanpassen: bij ontvangst claims consumeren in claim-volgorde
- `supabase/migrations/149_vrije_voorraad_semantiek.sql` — `producten_overzicht` view + `herbereken_product_reservering` functie aanpassen aan nieuwe formule
- `supabase/migrations/150_order_reserveringen_views.sql` — views `order_regel_levertijd`, `inkooporder_regel_claim_zicht`

### Backfill-script (eenmalig na migraties)
- `supabase/migrations/151_backfill_order_reserveringen.sql` — vult `order_reserveringen` voor bestaande open orders met huidige `te_leveren` als `bron='voorraad'`-claim. Idempotent.

### Frontend — queries & hooks
- **Modify** `frontend/src/lib/supabase/queries/orders.ts` — nieuwe types `OrderRegelLevertijd`, `OrderClaim`; selecteer kolom `lever_modus`
- **Modify** `frontend/src/lib/supabase/queries/order-mutations.ts` — type `OrderFormData` krijgt `lever_modus`; in `createOrder`/`updateOrder` doorgeven
- Create: `frontend/src/lib/supabase/queries/reserveringen.ts` — fetch claims per order/per IO/per artikel, fetch levertijd-preview voor een product+aantal
- **Modify** `frontend/src/lib/supabase/queries/inkooporders.ts` — type `InkooporderRegel` krijgt `aantal_geclaimd`; selectie uitbreiden
- **Modify** `frontend/src/lib/supabase/queries/producten.ts` — `fetchReserveringenVoorProduct` uitbreiden met `bron` + `verwacht_leverweek`
- **Modify** `frontend/src/lib/supabase/queries/op-maat.ts` — fetch `verwachte_leverweek_maatwerk(kwaliteit, kleur)` (afgeleid van `besteld_per_kwaliteit_kleur` + buffer)
- Create: `frontend/src/hooks/use-reserveringen.ts` — TanStack hooks

### Frontend — componenten & pagina's
- Create: `frontend/src/components/orders/levertijd-badge.tsx` — badge-variant (Voorraad / Wk N / Wacht op inkoop)
- Create: `frontend/src/components/orders/regel-claim-detail.tsx` — tooltip/popover met claim-uitsplitsing
- Create: `frontend/src/components/orders/lever-modus-dialog.tsx` — modal bij opslaan order met tekorten
- Create: `frontend/src/components/orders/maatwerk-levertijd-hint.tsx` — inline hint op maatwerk-orderregel
- Create: `frontend/src/components/inkooporders/io-regel-claims-popover.tsx` — popover op IO-regel met geclaimde orders
- **Modify** `frontend/src/components/orders/order-form.tsx` — bij submit: open `lever-modus-dialog` als ≥1 regel tekort heeft
- **Modify** `frontend/src/components/orders/order-line-editor.tsx` — `levertijd-badge` per regel
- **Modify** `frontend/src/pages/orders/order-detail.tsx` — kolom `Levertijd` op orderregels-tabel
- **Modify** `frontend/src/pages/inkooporders/inkooporder-detail.tsx` — kolom `Geclaimd N/M` op IO-regel-tabel + popover
- **Modify** `frontend/src/pages/producten/product-detail.tsx` — bestaande reserveringen-sectie: kolommen `Bron` + `Lever wk`

### Docs
- **Modify** `docs/database-schema.md` — nieuwe tabel `order_reserveringen`, nieuwe enum-waarde, gewijzigde formule `vrije_voorraad`, nieuwe RPC's en views
- **Modify** `docs/architectuur.md` — sectie "Inkoop-reserveringen" toevoegen
- **Modify** `docs/data-woordenboek.md` — termen `claim`, `lever_modus`, `verwachte leverweek`
- **Modify** `docs/changelog.md` — entry 2026-04-29
- **Modify** `CLAUDE.md` — bedrijfsregels: aanvullen wat er gebeurt bij order-mutatie/-annulering met claims

---

## Testing Strategy

Karpi-conventie: geen aparte test-suite. Validatie gebeurt via:

1. **DB-migraties**: per migratie (a) toepassen via Supabase SQL-editor, (b) smoke-SQL (zie per task), (c) handmatig RPC-aanroep met testorder.
2. **Idempotentie**: migraties moeten herhaalbaar veilig zijn — gebruik `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
3. **Frontend**: per task `npm run build` voor type-check, daarna handmatige browser-check op de relevante pagina(s) (zie CLAUDE.md "voor UI-taken: daadwerkelijk testen in browser").
4. **Smoke-scenario na alles klaar** (Task 22): één testorder met tekort over twee IO's; doorloop: aanmaken → modal → claim verifiëren → IO-detail bekijken → ontvangst boeken → verifiëren dat order naar `Wacht op picken` schuift.

---

## Task 1: Migratie 144 — schema basis (tabel + enum + kolom + config)

**Files:**
- Create: `supabase/migrations/144_order_reserveringen_basis.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 144: order_reserveringen schema basis
--
-- Doel: harde koppeling orderregel ↔ voorraad/inkooporder-regel.
-- Eén tabel, één enum-waarde, één kolom op orders, twee config-keys.
--
-- Idempotent: alle creates met IF NOT EXISTS / DO-block.

-- ============================================================================
-- Nieuwe enum-waarde: Wacht op inkoop
-- ============================================================================
DO $$ BEGIN
  ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Wacht op inkoop' AFTER 'Wacht op voorraad';
EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================================
-- TABEL order_reserveringen
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_reserveringen (
  id BIGSERIAL PRIMARY KEY,
  order_regel_id BIGINT NOT NULL REFERENCES order_regels(id) ON DELETE CASCADE,
  bron TEXT NOT NULL CHECK (bron IN ('voorraad', 'inkooporder_regel')),
  inkooporder_regel_id BIGINT REFERENCES inkooporder_regels(id) ON DELETE RESTRICT,
  aantal INTEGER NOT NULL CHECK (aantal > 0),
  claim_volgorde TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'geleverd', 'released')),
  geleverd_op TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (bron = 'voorraad' AND inkooporder_regel_id IS NULL)
    OR (bron = 'inkooporder_regel' AND inkooporder_regel_id IS NOT NULL)
  )
);

-- Eén actieve voorraadclaim per orderregel, eén per (orderregel, IO-regel) combi
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reserveringen_voorraad_uniek
  ON order_reserveringen(order_regel_id)
  WHERE bron = 'voorraad' AND status = 'actief';

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reserveringen_io_uniek
  ON order_reserveringen(order_regel_id, inkooporder_regel_id)
  WHERE bron = 'inkooporder_regel' AND status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_orderregel
  ON order_reserveringen(order_regel_id) WHERE status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_io_regel
  ON order_reserveringen(inkooporder_regel_id) WHERE status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_claim_volgorde
  ON order_reserveringen(inkooporder_regel_id, claim_volgorde) WHERE status = 'actief';

CREATE TRIGGER trg_order_reserveringen_updated_at
  BEFORE UPDATE ON order_reserveringen
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE order_reserveringen IS
  'Harde koppeling orderregel ↔ voorraad/inkooporder-regel. '
  'bron=voorraad: directe voorraad-claim, één rij per orderregel. '
  'bron=inkooporder_regel: claim op openstaande IO-regel, kan over meerdere IOs splitsen. '
  'Migratie 144 (2026-04-29).';

-- ============================================================================
-- KOLOM orders.lever_modus
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lever_modus TEXT
    CHECK (lever_modus IN ('deelleveringen', 'in_een_keer'));

COMMENT ON COLUMN orders.lever_modus IS
  'Per-order keuze hoe om te gaan met tekort: deelleveringen = stuur wat klaar is + zendingen voor later, '
  'in_een_keer = wacht tot alles binnen is en lever in 1 zending. '
  'Default bij INSERT: debiteuren.deelleveringen_toegestaan. NULL voor orders zonder tekort. Migratie 144.';

-- ============================================================================
-- app_config buffer-keys
-- ============================================================================
INSERT INTO app_config (sleutel, waarde) VALUES
  ('order_config', jsonb_build_object(
    'standaard_maat_werkdagen', 5,
    'maatwerk_weken', 4,
    'inkoop_buffer_weken_vast', 1,
    'inkoop_buffer_weken_maatwerk', 2
  ))
ON CONFLICT (sleutel) DO UPDATE SET
  waarde = app_config.waarde
    || jsonb_build_object('inkoop_buffer_weken_vast', 1)
    || jsonb_build_object('inkoop_buffer_weken_maatwerk', 2);
```

- [ ] **Step 2: Pas migratie toe**

Voer de migratie via Supabase SQL-editor uit (project Karpi). Zie [reference_karpi_supabase_mcp.md](C:/Users/migue/.claude/projects/c--Users-migue-Documents-Karpi-ERP/memory/reference_karpi_supabase_mcp.md) — MCP heeft géén toegang tot Karpi.

- [ ] **Step 3: Smoke-validatie**

```sql
-- enum-waarde aanwezig
SELECT unnest(enum_range(NULL::order_status));
-- verwacht: bevat 'Wacht op inkoop'

-- tabel + indexen
SELECT table_name FROM information_schema.tables WHERE table_name='order_reserveringen';
SELECT indexname FROM pg_indexes WHERE tablename='order_reserveringen';

-- kolom
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='orders' AND column_name='lever_modus';

-- config
SELECT waarde FROM app_config WHERE sleutel='order_config';
-- verwacht: bevat inkoop_buffer_weken_vast: 1, inkoop_buffer_weken_maatwerk: 2
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/144_order_reserveringen_basis.sql
git commit -m "feat(inkoop-reservering): migratie 144 — schema basis (tabel, enum, lever_modus, config)"
```

---

## Task 2: Migratie 145 — RPC's voor allocatie en levertijd

**Files:**
- Create: `supabase/migrations/145_order_reserveringen_rpcs.sql`

Bevat de centrale `herallocateer_orderregel`-RPC die idempotent claims voor een orderregel her-alloceert, en helpers `release_claims_voor_io_regel` en `iso_week_plus`.

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 145: RPC's voor inkoop-reserveringen
--
-- Centrale seam: herallocateer_orderregel(p_order_regel_id)
-- Idempotent. Roept zichzelf aan vanuit triggers en handmatig.
--
-- Strategie:
--   1. Sluit out: maatwerk-regels (is_maatwerk=true) en regels zonder artikelnr
--   2. Bepaal benodigd_aantal = te_leveren
--   3. Release alle bestaande actieve claims voor deze regel
--   4. Alloceer voorraad eerst (min van benodigd, beschikbaar=voorraad - andere voorraadclaims)
--   5. Resterend: alloceer over openstaande IO-regels (artikelnr-match, eenheid='stuks',
--      io.status IN ('Besteld','Deels ontvangen')) op verwacht_datum ASC
--   6. Update orders.status (Wacht op inkoop / Wacht op voorraad / Nieuw)

CREATE OR REPLACE FUNCTION iso_week_plus(p_datum DATE, p_weken INTEGER)
RETURNS TEXT AS $$
DECLARE
  v_doel DATE := p_datum + (p_weken * 7);
BEGIN
  RETURN to_char(v_doel, 'IYYY-"W"IW');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION iso_week_plus IS
  'Returnt ISO-week-string (YYYY-Www) van p_datum + p_weken. NULL-safe.';

-- ============================================================================
-- Helper: voorraad beschikbaar voor allocatie aan deze orderregel
-- ============================================================================
CREATE OR REPLACE FUNCTION voorraad_beschikbaar_voor_artikel(p_artikelnr TEXT, p_excl_order_regel_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_voorraad INTEGER;
  v_voorraad_geclaimd INTEGER;
BEGIN
  SELECT COALESCE(voorraad, 0) - COALESCE(backorder, 0)
  INTO v_voorraad
  FROM producten WHERE artikelnr = p_artikelnr;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_voorraad_geclaimd
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  WHERE oreg.artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND r.order_regel_id <> p_excl_order_regel_id;

  RETURN GREATEST(0, COALESCE(v_voorraad,0) - v_voorraad_geclaimd);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Helper: ruimte beschikbaar op een IO-regel (te_leveren_m − reeds geclaimd)
--    Alleen voor eenheid='stuks' (V1-scope).
-- ============================================================================
CREATE OR REPLACE FUNCTION io_regel_ruimte(p_io_regel_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_te_leveren NUMERIC;
  v_eenheid TEXT;
  v_geclaimd INTEGER;
BEGIN
  SELECT te_leveren_m, eenheid INTO v_te_leveren, v_eenheid
  FROM inkooporder_regels WHERE id = p_io_regel_id;

  IF v_eenheid IS DISTINCT FROM 'stuks' THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(aantal), 0) INTO v_geclaimd
  FROM order_reserveringen
  WHERE inkooporder_regel_id = p_io_regel_id
    AND bron = 'inkooporder_regel'
    AND status = 'actief';

  RETURN GREATEST(0, FLOOR(COALESCE(v_te_leveren,0))::INTEGER - v_geclaimd);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Centrale RPC: herallocateer_orderregel
-- ============================================================================
CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_artikelnr TEXT;
  v_te_leveren INTEGER;
  v_is_maatwerk BOOLEAN;
  v_order_id BIGINT;
  v_order_status order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad INTEGER;
  v_resterend INTEGER;
  v_io RECORD;
  v_io_ruimte INTEGER;
  v_alloc INTEGER;
  v_heeft_io_claim BOOLEAN := false;
BEGIN
  -- Lees orderregel
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_artikelnr IS NULL OR v_is_maatwerk = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    -- Maatwerk of zonder artikelnr: release alle claims, doe verder niets
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Lees order-status; alloceer alleen voor open orders
  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Lock orderregel-claims atomair
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id AND status = 'actief'
   FOR UPDATE;

  -- Release alle bestaande actieve claims (we beginnen schoon)
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id AND status = 'actief';

  -- 1) Voorraad-claim
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_te_leveren, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad);
  END IF;

  v_resterend := v_te_leveren - v_op_voorraad;

  -- 2) IO-claims op oudste verwacht_datum eerst
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id, io.verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr
         AND ir.eenheid = 'stuks'
         AND io.status IN ('Besteld', 'Deels ontvangen')
       ORDER BY io.verwacht_datum NULLS LAST, ir.id ASC
    LOOP
      EXIT WHEN v_resterend <= 0;
      v_io_ruimte := io_regel_ruimte(v_io.id);
      v_alloc := LEAST(v_resterend, v_io_ruimte);
      IF v_alloc > 0 THEN
        INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal)
        VALUES (p_order_regel_id, 'inkooporder_regel', v_io.id, v_alloc);
        v_resterend := v_resterend - v_alloc;
        v_heeft_io_claim := true;
      END IF;
    END LOOP;
  END IF;

  -- v_resterend > 0 betekent: tekort niet volledig gedekt → "Wacht op nieuwe inkoop"
  -- Geen extra rij; herwaardeer_order_status leest dat aan rest-saldo af.

  PERFORM herwaardeer_order_status(v_order_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herallocateer_orderregel IS
  'Idempotent: release alle actieve claims voor orderregel + alloceer opnieuw '
  '(voorraad-eerst, dan oudste IO). Sluit maatwerk-regels uit. Migratie 145.';

-- ============================================================================
-- Helper: orderstatus na claim-wissel herwaarderen
-- ============================================================================
CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_huidige order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort BOOLEAN;
BEGIN
  SELECT status INTO v_huidige FROM orders WHERE id = p_order_id;

  -- Eindstatussen niet aanraken
  IF v_huidige IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending',
                   'In productie', 'In snijplan', 'Deels gereed') THEN
    RETURN;
  END IF;

  -- Heeft de order ≥1 actieve IO-claim?
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- Heeft de order regels met onvoldoende dekking (rest-saldo > 0)?
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND oreg.is_maatwerk = false
      AND oreg.artikelnr IS NOT NULL
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  IF v_heeft_io_claim THEN
    UPDATE orders SET status = 'Wacht op inkoop' WHERE id = p_order_id AND status <> 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    UPDATE orders SET status = 'Wacht op voorraad' WHERE id = p_order_id AND status <> 'Wacht op voorraad';
  ELSE
    -- Volledig gedekt op voorraad → 'Nieuw' tenzij al een verdere status
    UPDATE orders SET status = 'Nieuw'
     WHERE id = p_order_id AND status IN ('Wacht op inkoop', 'Wacht op voorraad');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Helper: release alle claims voor een IO-regel (annulering / vertraging)
-- ============================================================================
CREATE OR REPLACE FUNCTION release_claims_voor_io_regel(p_io_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_orderregel_id BIGINT;
BEGIN
  FOR v_orderregel_id IN
    SELECT DISTINCT order_regel_id FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
  LOOP
    PERFORM herallocateer_orderregel(v_orderregel_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION release_claims_voor_io_regel IS
  'Bij IO-regel annulering of -wijziging: alle orderregels met claim op deze IO '
  'worden opnieuw gealloceerd (kunnen "Wacht op nieuwe inkoop" worden). Migratie 145.';
```

- [ ] **Step 2: Pas migratie toe en valideer**

```sql
-- functies bestaan
SELECT proname FROM pg_proc WHERE proname IN
 ('iso_week_plus','voorraad_beschikbaar_voor_artikel','io_regel_ruimte',
  'herallocateer_orderregel','herwaardeer_order_status','release_claims_voor_io_regel');

-- iso_week_plus
SELECT iso_week_plus('2026-05-04', 1);
-- verwacht: 2026-W19 (week 19; 2026-05-04 is W19, +1 = W20 → afhankelijk van platform)
-- Acceptatie: niet-NULL string van vorm YYYY-Www

-- handmatige test van herallocateer_orderregel doe je in Task 5 na triggers
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/145_order_reserveringen_rpcs.sql
git commit -m "feat(inkoop-reservering): migratie 145 — RPC's herallocateer_orderregel + helpers"
```

---

## Task 3: Migratie 146 — triggers op order_regels en orders

**Files:**
- Create: `supabase/migrations/146_order_reserveringen_triggers.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 146: triggers — order_regels mutatie, orders status, claim-tabel sync
--
-- Drie trigger-velden:
--   A. order_regels INSERT/UPDATE/DELETE → herallocateer
--   B. orders UPDATE status → herwaardeer
--   C. order_reserveringen INSERT/UPDATE/DELETE → herbereken_product_reservering
--
-- Bestaande migratie-020 triggers (update_reservering_bij_*) worden vervangen
-- door C, want bron-van-waarheid wordt nu order_reserveringen ipv te_leveren.

-- ============================================================================
-- A. Trigger op order_regels: bij INSERT/UPDATE → herallocateer
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_orderregel_herallocateer()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Alle claims worden vanzelf cascade-deleted door FK ON DELETE CASCADE.
    -- Producten.gereserveerd resync gebeurt via trigger C.
    RETURN OLD;
  END IF;

  -- Trigger op zowel artikelnr- als te_leveren-wijziging
  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);

    -- Als artikelnr is gewijzigd: óók voor het oude artikelnr de
    -- producten.gereserveerd opnieuw afleiden (trigger C doet dat zelf bij UPDATE)
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_orderregel ON order_regels;  -- migratie-020 trigger
DROP TRIGGER IF EXISTS trg_orderregel_herallocateer ON order_regels;
CREATE TRIGGER trg_orderregel_herallocateer
  AFTER INSERT OR UPDATE OR DELETE ON order_regels
  FOR EACH ROW EXECUTE FUNCTION trg_orderregel_herallocateer();

-- ============================================================================
-- B. Trigger op orders: bij statuswissel → her-alloceer per regel
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_order_status_herallocateer()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  -- Alleen reageren als status van/naar Geannuleerd/Verzonden gaat
  IF (OLD.status NOT IN ('Geannuleerd','Verzonden') AND NEW.status IN ('Geannuleerd','Verzonden')) OR
     (OLD.status IN ('Geannuleerd','Verzonden') AND NEW.status NOT IN ('Geannuleerd','Verzonden')) THEN
    FOR v_regel_id IN
      SELECT id FROM order_regels WHERE order_id = NEW.id
    LOOP
      PERFORM herallocateer_orderregel(v_regel_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_order_status ON orders;  -- migratie-020 trigger
DROP TRIGGER IF EXISTS trg_order_status_herallocateer ON orders;
CREATE TRIGGER trg_order_status_herallocateer
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_order_status_herallocateer();

-- ============================================================================
-- C. Trigger op order_reserveringen: synchroniseer producten.gereserveerd
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_reservering_sync_producten()
RETURNS TRIGGER AS $$
DECLARE
  v_artikelnr TEXT;
BEGIN
  -- Pak het artikelnr uit de orderregel
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT artikelnr INTO v_artikelnr FROM order_regels WHERE id = NEW.order_regel_id;
    IF v_artikelnr IS NOT NULL THEN
      PERFORM herbereken_product_reservering(v_artikelnr);
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT artikelnr INTO v_artikelnr FROM order_regels WHERE id = OLD.order_regel_id;
    IF v_artikelnr IS NOT NULL AND
       (TG_OP = 'DELETE' OR NEW.order_regel_id IS DISTINCT FROM OLD.order_regel_id) THEN
      PERFORM herbereken_product_reservering(v_artikelnr);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_sync_producten ON order_reserveringen;
CREATE TRIGGER trg_reservering_sync_producten
  AFTER INSERT OR UPDATE OR DELETE ON order_reserveringen
  FOR EACH ROW EXECUTE FUNCTION trg_reservering_sync_producten();
```

- [ ] **Step 2: Pas toe en valideer triggers staan**

```sql
SELECT trigger_name, event_object_table, action_timing FROM information_schema.triggers
WHERE trigger_name IN ('trg_orderregel_herallocateer','trg_order_status_herallocateer','trg_reservering_sync_producten');
-- verwacht: 3 rijen
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/146_order_reserveringen_triggers.sql
git commit -m "feat(inkoop-reservering): migratie 146 — triggers (regel mutatie, status, claim-sync)"
```

---

## Task 4: Migratie 147 — IO-status release-trigger

**Files:**
- Create: `supabase/migrations/147_inkoop_status_release_trigger.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 147: trigger op inkooporders bij Geannuleerd
--
-- Bij IO-status → 'Geannuleerd': release_claims_voor_io_regel voor elke regel
-- van die IO. Bij verwacht_datum-wijziging: niets (levertijd is afgeleid via view).

CREATE OR REPLACE FUNCTION trg_inkooporder_status_release()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.status = 'Geannuleerd' AND OLD.status <> 'Geannuleerd' THEN
    FOR v_regel_id IN
      SELECT id FROM inkooporder_regels WHERE inkooporder_id = NEW.id
    LOOP
      PERFORM release_claims_voor_io_regel(v_regel_id);
    END LOOP;
  END IF;

  -- Status terug van Concept → Besteld? Mogelijke claims worden later weer
  -- aangemaakt zodra een orderregel-mutatie de allocator weer triggert.
  -- Géén proactieve her-allocatie hier (te veel werk; we accepteren dat orders
  -- die al "Wacht op nieuwe inkoop" zijn pas opnieuw alloceren als ze worden bewerkt).

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inkooporder_status_release ON inkooporders;
CREATE TRIGGER trg_inkooporder_status_release
  AFTER UPDATE ON inkooporders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_inkooporder_status_release();
```

- [ ] **Step 2: Pas toe en valideer**

```sql
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'trg_inkooporder_status_release';
-- verwacht: 1 rij
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/147_inkoop_status_release_trigger.sql
git commit -m "feat(inkoop-reservering): migratie 147 — IO-status release-trigger"
```

---

## Task 5: Smoketest RPC-allocatie

**Files:** geen wijzigingen — handmatige validatie via SQL.

- [ ] **Step 1: Maak een testorder via SQL**

```sql
-- Vereiste: bestaande klant + product met voorraad < orderaantal en
-- ≥1 openstaande inkooporder-regel (status='Besteld', eenheid='stuks').
-- Pas debiteur_nr en artikelnr aan.

-- 1) Pas voorraad zo dat tekort ontstaat
UPDATE producten SET voorraad = 4 WHERE artikelnr = '<ARTIKELNR>';

-- 2) Maak order met regel 10 stuks
INSERT INTO orders (debiteur_nr, orderdatum, status)
VALUES (<DEBITEUR_NR>, CURRENT_DATE, 'Nieuw')
RETURNING id;

INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving, orderaantal, te_leveren)
VALUES (<NIEUWE_ORDER_ID>, 1, '<ARTIKELNR>', 'Smoketest', 10, 10);
```

- [ ] **Step 2: Verifieer claims**

```sql
SELECT bron, inkooporder_regel_id, aantal, status
FROM order_reserveringen
WHERE order_regel_id = (
  SELECT id FROM order_regels WHERE order_id = <NIEUWE_ORDER_ID>
);
-- verwacht: 1 voorraad-rij van 4 + 1 of meer io-rij(en) tot totaal 10
```

- [ ] **Step 3: Verifieer order-status en producten.gereserveerd**

```sql
SELECT id, status FROM orders WHERE id = <NIEUWE_ORDER_ID>;
-- verwacht: 'Wacht op inkoop'

SELECT artikelnr, voorraad, gereserveerd, vrije_voorraad
FROM producten WHERE artikelnr = '<ARTIKELNR>';
-- nu nog vrije_voorraad-formule oud → wordt bij Task 7 aangepast.
-- gereserveerd telt nu nog te_leveren (oude trigger weg, nieuwe trigger telt rijen).
-- Verifieer dat gereserveerd = som van order_reserveringen.aantal waar bron='voorraad'.
```

- [ ] **Step 4: Verifieer mutatie**

```sql
-- Verklein orderregel naar 6 stuks → IO-claim moet kleiner / kunnen wegvallen
UPDATE order_regels SET te_leveren = 6
 WHERE order_id = <NIEUWE_ORDER_ID> AND regelnummer = 1;

SELECT bron, inkooporder_regel_id, aantal, status
FROM order_reserveringen WHERE order_regel_id = (
  SELECT id FROM order_regels WHERE order_id = <NIEUWE_ORDER_ID>
)
ORDER BY status, claim_volgorde;
-- verwacht: nieuwe actieve rijen totaal 6 (4 voorraad + 2 IO),
-- oude rijen op status='released'
```

- [ ] **Step 5: Cleanup test-order**

```sql
DELETE FROM orders WHERE id = <NIEUWE_ORDER_ID>;
-- ON DELETE CASCADE verwijdert order_regels + order_reserveringen.
-- Laat producten.voorraad ongewijzigd of zet terug.
```

- [ ] **Step 6: Commit (alleen als er fixes nodig waren in de RPC's)**

Als de smoketest goed liep: geen commit. Als er issues waren: fix migratie 145/146 en commit met `fix(inkoop-reservering): smoketest-bevindingen`.

---

## Task 6: Migratie 148 — boek_voorraad_ontvangst consumeert claims

**Files:**
- Create: `supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql`

- [ ] **Step 1: Inspect huidige boek_voorraad_ontvangst**

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'boek_voorraad_ontvangst';
```

Lees de huidige body. We moeten hem zo herschrijven dat hij claims op de IO-regel consumeert. Volledige nieuwe body opnemen in de migratie (geen patch).

- [ ] **Step 2: Schrijf migratie**

```sql
-- Migratie 148: boek_voorraad_ontvangst consumeert claims
--
-- Bestaande gedrag: producten.voorraad += p_aantal, regel.geleverd_m += p_aantal,
-- IO-status update.
-- Nieuw: na voorraad-bump, claims op deze IO-regel in claim_volgorde-volgorde
-- consumeren tot p_aantal op is. Geconsumeerde claim → status='geleverd' en
-- nieuwe voorraad-claim aanmaken voor dezelfde orderregel met dat aantal.
-- Producten.gereserveerd resync gebeurt via trigger C (migratie 146).

CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT
)
RETURNS VOID AS $$
DECLARE
  v_io_id BIGINT;
  v_artikelnr TEXT;
  v_eenheid TEXT;
  v_te_leveren NUMERIC;
  v_resterend INTEGER := p_aantal;
  v_claim RECORD;
  v_consume INTEGER;
BEGIN
  IF p_aantal <= 0 THEN
    RAISE EXCEPTION 'p_aantal moet > 0 zijn';
  END IF;

  -- Lees regel + lock
  SELECT inkooporder_id, artikelnr, eenheid, te_leveren_m
    INTO v_io_id, v_artikelnr, v_eenheid, v_te_leveren
  FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;

  IF v_eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'boek_voorraad_ontvangst alleen voor eenheid=stuks';
  END IF;

  IF v_artikelnr IS NULL THEN
    RAISE EXCEPTION 'IO-regel zonder artikelnr — kan niet boeken';
  END IF;

  -- Verhoog voorraad
  UPDATE producten SET voorraad = COALESCE(voorraad, 0) + p_aantal
   WHERE artikelnr = v_artikelnr;

  -- Update IO-regel
  UPDATE inkooporder_regels
     SET geleverd_m = COALESCE(geleverd_m, 0) + p_aantal,
         te_leveren_m = GREATEST(0, COALESCE(besteld_m,0) - (COALESCE(geleverd_m,0) + p_aantal))
   WHERE id = p_regel_id;

  -- Consumeer claims in claim_volgorde
  FOR v_claim IN
    SELECT id, order_regel_id, aantal
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
     ORDER BY claim_volgorde ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_resterend <= 0;
    v_consume := LEAST(v_claim.aantal, v_resterend);

    IF v_consume = v_claim.aantal THEN
      -- Hele claim afgehandeld
      UPDATE order_reserveringen
         SET status = 'geleverd',
             geleverd_op = now(),
             updated_at = now()
       WHERE id = v_claim.id;
    ELSE
      -- Gedeeltelijk: splits — verklein huidige IO-claim, voeg restant toe als nieuwe
      UPDATE order_reserveringen
         SET aantal = aantal - v_consume, updated_at = now()
       WHERE id = v_claim.id;
    END IF;

    -- Maak voorraad-claim aan voor het geleverde deel
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
    VALUES (v_claim.order_regel_id, 'voorraad', v_consume)
    ON CONFLICT (order_regel_id) WHERE bron = 'voorraad' AND status = 'actief'
      DO UPDATE SET aantal = order_reserveringen.aantal + EXCLUDED.aantal,
                    updated_at = now();

    v_resterend := v_resterend - v_consume;

    -- Order-status van de bijbehorende order opnieuw waarderen
    PERFORM herwaardeer_order_status((SELECT order_id FROM order_regels WHERE id = v_claim.order_regel_id));
  END LOOP;

  -- IO-status update: Deels ontvangen / Ontvangen
  UPDATE inkooporders
     SET status = CASE
       WHEN NOT EXISTS (SELECT 1 FROM inkooporder_regels WHERE inkooporder_id = v_io_id AND te_leveren_m > 0)
         THEN 'Ontvangen'
       ELSE 'Deels ontvangen'
     END
   WHERE id = v_io_id AND status IN ('Besteld','Deels ontvangen');

  -- Audit-mutatie
  INSERT INTO voorraad_mutaties (rol_id, type, lengte_cm, referentie_id, referentie_type, notitie, aangemaakt_door)
  VALUES (NULL, 'inkoop', p_aantal, p_regel_id, 'inkooporder_regel',
          'Voorraad-ontvangst (' || p_aantal || ' stuks)', p_medewerker);
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2b: Edge case — `voorraad_mutaties.rol_id NOT NULL`?**

```sql
SELECT is_nullable FROM information_schema.columns
WHERE table_name='voorraad_mutaties' AND column_name='rol_id';
```

Als `is_nullable='NO'`: laat de INSERT in `voorraad_mutaties` weg (vaste-maatproducten hebben geen rol_id) of alter de kolom naar nullable in deze migratie. Document beslissing in een COMMENT.

- [ ] **Step 3: Pas toe en smoketest**

Maak een smoketest-order zoals in Task 5; doe `SELECT boek_voorraad_ontvangst(<io_regel_id>, 6, 'test')`. Verifieer dat:
- `producten.voorraad` is gestegen
- `order_reserveringen` heeft `bron='inkooporder_regel'` rij op `geleverd` gezet en nieuwe `bron='voorraad'`-rij voor dezelfde orderregel
- `orders.status` schuift van `Wacht op inkoop` naar `Wacht op voorraad` of `Nieuw`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql
git commit -m "feat(inkoop-reservering): migratie 148 — boek_voorraad_ontvangst consumeert claims"
```

---

## Task 7: Migratie 149 — vrije_voorraad semantiek + producten_overzicht

**Files:**
- Create: `supabase/migrations/149_vrije_voorraad_semantiek.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 149: vrije_voorraad-formule + producten_overzicht
--
-- Wijziging: vrije_voorraad = voorraad − gereserveerd − backorder
-- (geen + besteld_inkoop meer; toekomstige inkoop is ZICHTBAAR via besteld_inkoop
-- en via order_reserveringen, maar telt niet meer mee in de "vandaag-leverbaar"-formule.)
--
-- gereserveerd-bron wordt nu: SUM(order_reserveringen.aantal) waar bron='voorraad'.
-- Dat is consistent met migratie 146 trigger C (die elk claim-rij wisselt).

CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
  v_gereserveerd INTEGER;
BEGIN
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_gereserveerd
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  JOIN orders o ON o.id = oreg.order_id
  WHERE oreg.artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND o.status NOT IN ('Verzonden', 'Geannuleerd');

  UPDATE producten
  SET gereserveerd = v_gereserveerd,
      vrije_voorraad = COALESCE(voorraad, 0) - v_gereserveerd - COALESCE(backorder, 0)
  WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herbereken_product_reservering IS
  'Migratie 149: gereserveerd = SUM order_reserveringen waar bron=voorraad. '
  'vrije_voorraad = voorraad − gereserveerd − backorder (geen + besteld_inkoop).';

-- ============================================================================
-- producten_overzicht view: gewoon p.vrije_voorraad — kolom is correct gevuld
-- ============================================================================
-- (geen view-aanpassing nodig; migratie 029 gebruikte al p.vrije_voorraad direct.)

-- ============================================================================
-- Backfill: alle producten éénmaal recompute
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT artikelnr FROM producten LOOP
    PERFORM herbereken_product_reservering(r.artikelnr);
  END LOOP;
END $$;
```

- [ ] **Step 2: Pas toe en valideer**

```sql
-- Voor een product met bekende voorraad: controleer formule
SELECT artikelnr, voorraad, gereserveerd, backorder, besteld_inkoop, vrije_voorraad
FROM producten
WHERE artikelnr IN (SELECT DISTINCT artikelnr FROM order_regels WHERE artikelnr IS NOT NULL LIMIT 5);
-- verwacht: vrije_voorraad = voorraad - gereserveerd - backorder
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/149_vrije_voorraad_semantiek.sql
git commit -m "feat(inkoop-reservering): migratie 149 — vrije_voorraad-formule + recompute"
```

---

## Task 8: Migratie 150 — views voor levertijd en IO-claim-zicht

**Files:**
- Create: `supabase/migrations/150_order_reserveringen_views.sql`

Twee views die het frontend-werk eenvoudiger maken:

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 150: views order_regel_levertijd, inkooporder_regel_claim_zicht

-- ============================================================================
-- View: order_regel_levertijd
--   Per orderregel: levertijd-status (voorraad / op_inkoop / wacht_op_nieuwe_inkoop)
--   en de leverweek waarop de regel volledig leverbaar is.
-- ============================================================================
CREATE OR REPLACE VIEW order_regel_levertijd AS
WITH config AS (
  SELECT (waarde->>'inkoop_buffer_weken_vast')::INTEGER AS buffer_vast
  FROM app_config WHERE sleutel = 'order_config'
),
claim_per_regel AS (
  SELECT
    r.order_regel_id,
    SUM(CASE WHEN r.bron='voorraad'        THEN r.aantal ELSE 0 END) AS aantal_voorraad,
    SUM(CASE WHEN r.bron='inkooporder_regel' THEN r.aantal ELSE 0 END) AS aantal_io,
    MAX(io.verwacht_datum) FILTER (WHERE r.bron='inkooporder_regel') AS laatste_io_datum,
    MIN(io.verwacht_datum) FILTER (WHERE r.bron='inkooporder_regel') AS eerste_io_datum
  FROM order_reserveringen r
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io        ON io.id = ir.inkooporder_id
  WHERE r.status = 'actief'
  GROUP BY r.order_regel_id
)
SELECT
  oreg.id AS order_regel_id,
  oreg.order_id,
  oreg.te_leveren,
  o.lever_modus,
  COALESCE(c.aantal_voorraad, 0) AS aantal_voorraad,
  COALESCE(c.aantal_io, 0)       AS aantal_io,
  GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad,0) - COALESCE(c.aantal_io,0)) AS aantal_tekort,
  c.eerste_io_datum,
  c.laatste_io_datum,
  -- leverweek per modus
  CASE
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad,0) - COALESCE(c.aantal_io,0)) > 0
      THEN NULL  -- onbekend (wacht op nieuwe inkoop)
    WHEN COALESCE(c.aantal_io,0) = 0
      THEN 'voorraad'
    WHEN o.lever_modus = 'in_een_keer'
      THEN iso_week_plus(c.laatste_io_datum, (SELECT buffer_vast FROM config))
    ELSE
      iso_week_plus(c.eerste_io_datum, (SELECT buffer_vast FROM config))  -- deelleveringen → eerste week
  END AS verwachte_leverweek,
  CASE
    WHEN oreg.is_maatwerk THEN 'maatwerk'
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad,0) - COALESCE(c.aantal_io,0)) > 0 THEN 'wacht_op_nieuwe_inkoop'
    WHEN COALESCE(c.aantal_io,0) > 0 THEN 'op_inkoop'
    ELSE 'voorraad'
  END AS levertijd_status
FROM order_regels oreg
JOIN orders o ON o.id = oreg.order_id
LEFT JOIN claim_per_regel c ON c.order_regel_id = oreg.id;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen en berekende ISO-leverweek. '
  'levertijd_status: voorraad | op_inkoop | wacht_op_nieuwe_inkoop | maatwerk. Migratie 150.';

-- ============================================================================
-- View: inkooporder_regel_claim_zicht
--   Per IO-regel: hoeveel stuks zijn geclaimd, hoeveel nog vrij,
--   plus aggregatie van order/klant-info voor drilldown.
-- ============================================================================
CREATE OR REPLACE VIEW inkooporder_regel_claim_zicht AS
SELECT
  ir.id AS inkooporder_regel_id,
  ir.inkooporder_id,
  ir.artikelnr,
  ir.te_leveren_m,
  ir.eenheid,
  COALESCE(SUM(r.aantal) FILTER (WHERE r.status='actief'), 0) AS aantal_geclaimd,
  GREATEST(0, FLOOR(COALESCE(ir.te_leveren_m,0))::INTEGER
              - COALESCE(SUM(r.aantal) FILTER (WHERE r.status='actief'),0)) AS aantal_vrij,
  COUNT(DISTINCT r.order_regel_id) FILTER (WHERE r.status='actief') AS aantal_orderregels
FROM inkooporder_regels ir
LEFT JOIN order_reserveringen r
       ON r.inkooporder_regel_id = ir.id AND r.bron = 'inkooporder_regel'
GROUP BY ir.id;

COMMENT ON VIEW inkooporder_regel_claim_zicht IS
  'Per IO-regel: aantal_geclaimd / aantal_vrij + aantal orderregels dat erop wacht. Migratie 150.';
```

- [ ] **Step 2: Pas toe en valideer**

```sql
-- View bestaat
SELECT viewname FROM pg_views WHERE viewname IN ('order_regel_levertijd','inkooporder_regel_claim_zicht');

-- spot-check
SELECT * FROM order_regel_levertijd LIMIT 5;
SELECT * FROM inkooporder_regel_claim_zicht LIMIT 5;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/150_order_reserveringen_views.sql
git commit -m "feat(inkoop-reservering): migratie 150 — views levertijd + IO-claim-zicht"
```

---

## Task 9: Migratie 151 — backfill bestaande open orders

**Files:**
- Create: `supabase/migrations/151_backfill_order_reserveringen.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 151: backfill order_reserveringen voor bestaande open orders
--
-- Voor elke order_regel met artikelnr, niet-maatwerk, te_leveren > 0,
-- en order.status NOT IN ('Verzonden','Geannuleerd'):
-- roep herallocateer_orderregel(id) aan zodat claims netjes worden ingericht.
-- Idempotent: herallocateer_orderregel doet release + nieuw alloceren.

DO $$
DECLARE
  v_id BIGINT;
  v_count INTEGER := 0;
BEGIN
  FOR v_id IN
    SELECT oreg.id
    FROM order_regels oreg
    JOIN orders o ON o.id = oreg.order_id
    WHERE oreg.artikelnr IS NOT NULL
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND COALESCE(oreg.te_leveren, 0) > 0
      AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  LOOP
    PERFORM herallocateer_orderregel(v_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % orderregels gealloceerd', v_count;
END $$;
```

- [ ] **Step 2: Pas toe en valideer telling**

```sql
SELECT
  (SELECT COUNT(*) FROM order_reserveringen WHERE bron='voorraad' AND status='actief')   AS voorraad_claims,
  (SELECT COUNT(*) FROM order_reserveringen WHERE bron='inkooporder_regel' AND status='actief') AS io_claims,
  (SELECT COUNT(DISTINCT order_id) FROM order_regels oreg
     JOIN orders o ON o.id = oreg.order_id
     WHERE oreg.artikelnr IS NOT NULL AND COALESCE(oreg.is_maatwerk,false)=false
       AND o.status='Wacht op inkoop')                                                   AS orders_wacht_op_inkoop;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/151_backfill_order_reserveringen.sql
git commit -m "feat(inkoop-reservering): migratie 151 — backfill bestaande open orders"
```

---

## Task 10: Frontend — types en queries

**Files:**
- Create: `frontend/src/lib/supabase/queries/reserveringen.ts`
- Modify: `frontend/src/lib/supabase/queries/orders.ts`
- Modify: `frontend/src/lib/supabase/queries/inkooporders.ts`
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts`

- [ ] **Step 1: `reserveringen.ts` — fetch claims & levertijd**

```ts
import { supabase } from '../client'

export type LevertijdStatus = 'voorraad' | 'op_inkoop' | 'wacht_op_nieuwe_inkoop' | 'maatwerk'

export interface OrderRegelLevertijd {
  order_regel_id: number
  order_id: number
  te_leveren: number
  lever_modus: 'deelleveringen' | 'in_een_keer' | null
  aantal_voorraad: number
  aantal_io: number
  aantal_tekort: number
  eerste_io_datum: string | null
  laatste_io_datum: string | null
  verwachte_leverweek: string | null
  levertijd_status: LevertijdStatus
}

export interface OrderClaim {
  id: number
  order_regel_id: number
  bron: 'voorraad' | 'inkooporder_regel'
  inkooporder_regel_id: number | null
  inkooporder_nr: string | null
  verwacht_datum: string | null
  aantal: number
  status: 'actief' | 'geleverd' | 'released'
  claim_volgorde: string
}

export async function fetchLevertijdVoorOrder(orderId: number): Promise<OrderRegelLevertijd[]> {
  const { data, error } = await supabase
    .from('order_regel_levertijd')
    .select('*')
    .eq('order_id', orderId)
  if (error) throw error
  return (data ?? []) as OrderRegelLevertijd[]
}

export async function fetchClaimsVoorOrderRegel(orderRegelId: number): Promise<OrderClaim[]> {
  const { data, error } = await supabase
    .from('order_reserveringen')
    .select(`
      id, order_regel_id, bron, inkooporder_regel_id, aantal, status, claim_volgorde,
      inkooporder_regels:inkooporder_regel_id (
        inkooporders:inkooporder_id ( inkooporder_nr, verwacht_datum )
      )
    `)
    .eq('order_regel_id', orderRegelId)
    .eq('status', 'actief')
    .order('bron')
    .order('claim_volgorde')
  if (error) throw error
  return ((data ?? []) as any[]).map(row => ({
    id: row.id,
    order_regel_id: row.order_regel_id,
    bron: row.bron,
    inkooporder_regel_id: row.inkooporder_regel_id,
    inkooporder_nr: row.inkooporder_regels?.inkooporders?.inkooporder_nr ?? null,
    verwacht_datum: row.inkooporder_regels?.inkooporders?.verwacht_datum ?? null,
    aantal: row.aantal,
    status: row.status,
    claim_volgorde: row.claim_volgorde,
  }))
}

export async function fetchClaimsVoorIORegel(ioRegelId: number) {
  const { data, error } = await supabase
    .from('order_reserveringen')
    .select(`
      id, aantal, claim_volgorde,
      order_regels:order_regel_id (
        id, regelnummer, omschrijving,
        orders:order_id (id, order_nr, debiteur_nr,
          debiteuren:debiteur_nr ( naam )
        )
      )
    `)
    .eq('inkooporder_regel_id', ioRegelId)
    .eq('bron', 'inkooporder_regel')
    .eq('status', 'actief')
    .order('claim_volgorde')
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 2: Voeg `lever_modus` toe aan order-types en mutations**

In [order-mutations.ts](frontend/src/lib/supabase/queries/order-mutations.ts), `OrderFormData` uitbreiden:

```ts
export interface OrderFormData {
  // ... bestaande velden
  lever_modus?: 'deelleveringen' | 'in_een_keer'
}
```

In `createOrder`/`updateOrder`-RPC-payloads `lever_modus` doorgeven.

- [ ] **Step 3: `aantal_geclaimd` toevoegen op `InkooporderRegel`**

In [inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts):
- `InkooporderRegel`-interface krijgt `aantal_geclaimd: number`, `aantal_vrij: number`, `aantal_orderregels: number`.
- In `fetchInkooporderDetail`: join `inkooporder_regel_claim_zicht` (LEFT JOIN op `inkooporder_regel_id = id`).

- [ ] **Step 4: Type-check**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/supabase/queries/reserveringen.ts \
        frontend/src/lib/supabase/queries/orders.ts \
        frontend/src/lib/supabase/queries/order-mutations.ts \
        frontend/src/lib/supabase/queries/inkooporders.ts
git commit -m "feat(inkoop-reservering): frontend types + queries voor claims/levertijd"
```

---

## Task 11: Frontend — TanStack hooks

**Files:**
- Create: `frontend/src/hooks/use-reserveringen.ts`

- [ ] **Step 1: Schrijf hooks**

```ts
import { useQuery } from '@tanstack/react-query'
import {
  fetchLevertijdVoorOrder,
  fetchClaimsVoorOrderRegel,
  fetchClaimsVoorIORegel,
} from '@/lib/supabase/queries/reserveringen'

export function useLevertijdVoorOrder(orderId?: number) {
  return useQuery({
    queryKey: ['order-levertijd', orderId],
    queryFn: () => fetchLevertijdVoorOrder(orderId!),
    enabled: !!orderId,
  })
}

export function useClaimsVoorOrderRegel(orderRegelId?: number) {
  return useQuery({
    queryKey: ['order-regel-claims', orderRegelId],
    queryFn: () => fetchClaimsVoorOrderRegel(orderRegelId!),
    enabled: !!orderRegelId,
  })
}

export function useClaimsVoorIORegel(ioRegelId?: number) {
  return useQuery({
    queryKey: ['io-regel-claims', ioRegelId],
    queryFn: () => fetchClaimsVoorIORegel(ioRegelId!),
    enabled: !!ioRegelId,
  })
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd frontend && npm run build
git add frontend/src/hooks/use-reserveringen.ts
git commit -m "feat(inkoop-reservering): TanStack hooks"
```

---

## Task 12: Frontend — `LevertijdBadge`-component

**Files:**
- Create: `frontend/src/components/orders/levertijd-badge.tsx`

- [ ] **Step 1: Schrijf component**

```tsx
import { Badge } from '@/components/ui/badge'
import type { OrderRegelLevertijd } from '@/lib/supabase/queries/reserveringen'

const STYLE: Record<OrderRegelLevertijd['levertijd_status'], string> = {
  voorraad: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  op_inkoop: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  wacht_op_nieuwe_inkoop: 'bg-rose-100 text-rose-800 hover:bg-rose-100',
  maatwerk: 'bg-violet-100 text-violet-800 hover:bg-violet-100',
}

const LABEL: Record<OrderRegelLevertijd['levertijd_status'], (l: OrderRegelLevertijd) => string> = {
  voorraad: () => 'Voorraad',
  op_inkoop: l => l.verwachte_leverweek ?? 'Inkoop',
  wacht_op_nieuwe_inkoop: () => 'Wacht op inkoop',
  maatwerk: l => l.verwachte_leverweek ?? 'Maatwerk',
}

export function LevertijdBadge({ levertijd }: { levertijd: OrderRegelLevertijd }) {
  return (
    <Badge variant="secondary" className={STYLE[levertijd.levertijd_status]}>
      {LABEL[levertijd.levertijd_status](levertijd)}
    </Badge>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd frontend && npm run build
git add frontend/src/components/orders/levertijd-badge.tsx
git commit -m "feat(inkoop-reservering): LevertijdBadge-component"
```

---

## Task 13: Frontend — `RegelClaimDetail` popover

**Files:**
- Create: `frontend/src/components/orders/regel-claim-detail.tsx`

Toont per orderregel de claim-uitsplitsing in een popover (4 voorraad, 6 op IO-2026-0042 wk 23, …).

- [ ] **Step 1: Schrijf component**

```tsx
import { useClaimsVoorOrderRegel } from '@/hooks/use-reserveringen'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Loader2 } from 'lucide-react'

export function RegelClaimDetail({ orderRegelId, children }: {
  orderRegelId: number
  children: React.ReactNode
}) {
  const { data, isLoading } = useClaimsVoorOrderRegel(orderRegelId)
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="text-sm font-medium mb-2">Levering uit</div>
        {isLoading && <Loader2 className="animate-spin" size={14} />}
        {!isLoading && data && data.length === 0 && (
          <div className="text-sm text-slate-500">Geen claims (wacht op nieuwe inkoop)</div>
        )}
        {!isLoading && data && data.map(c => (
          <div key={c.id} className="flex justify-between text-sm py-0.5">
            <span>
              {c.bron === 'voorraad' ? 'Voorraad' : (c.inkooporder_nr ?? `IO-${c.inkooporder_regel_id}`)}
              {c.verwacht_datum && <span className="text-slate-500"> · wk {weekVan(c.verwacht_datum)}</span>}
            </span>
            <span className="font-medium">{c.aantal}×</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function weekVan(iso: string): string {
  const d = new Date(iso)
  // ISO week — kort
  const target = new Date(d)
  target.setDate(target.getDate() + 4 - (target.getDay() || 7))
  const yearStart = new Date(target.getFullYear(), 0, 1)
  return String(Math.ceil(((+target - +yearStart) / 86400000 + 1) / 7))
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/orders/regel-claim-detail.tsx
git commit -m "feat(inkoop-reservering): RegelClaimDetail popover"
```

---

## Task 14: Frontend — `LeverModusDialog` bij order-opslaan

**Files:**
- Create: `frontend/src/components/orders/lever-modus-dialog.tsx`

- [ ] **Step 1: Schrijf component**

Modal die opent bij submit van order-form als ≥1 regel tekort heeft. Bevat:
- Korte samenvatting tekorten (regelnr, artikelnr, aantal tekort)
- Twee radio-knoppen: `Deelleveringen` / `In één keer`
- Default = `klant.deelleveringen_toegestaan ? 'deelleveringen' : 'in_een_keer'`
- Bevestigknop slaat de keuze op in `order.lever_modus` en submit verder.

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useState } from 'react'

interface Tekort { regelnummer: number; artikelnr?: string; aantal: number; verwachte_leverweek: string | null }

export function LeverModusDialog({
  open, onOpenChange, tekorten, defaultModus, onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tekorten: Tekort[]
  defaultModus: 'deelleveringen' | 'in_een_keer'
  onConfirm: (modus: 'deelleveringen' | 'in_een_keer') => void
}) {
  const [modus, setModus] = useState(defaultModus)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Order heeft regels die wachten op inkoop</DialogTitle>
        </DialogHeader>
        <div className="text-sm space-y-2">
          <div>{tekorten.length} regel(s) hebben gedeeltelijk of volledig wachten op inkoop:</div>
          <ul className="border rounded p-2 bg-slate-50 text-xs space-y-1">
            {tekorten.map(t => (
              <li key={t.regelnummer}>
                Regel {t.regelnummer}: {t.aantal}× wacht
                {t.verwachte_leverweek && <> (lever {t.verwachte_leverweek})</>}
              </li>
            ))}
          </ul>
          <div className="pt-2 font-medium">Hoe leveren?</div>
          <RadioGroup value={modus} onValueChange={v => setModus(v as any)}>
            <div className="flex items-start gap-2 py-1">
              <RadioGroupItem id="deelleveringen" value="deelleveringen" />
              <Label htmlFor="deelleveringen" className="cursor-pointer">
                <div className="font-medium">Deelleveringen</div>
                <div className="text-xs text-slate-500">Stuur direct wat klaar is, rest komt later (mogelijk meerdere zendingen).</div>
              </Label>
            </div>
            <div className="flex items-start gap-2 py-1">
              <RadioGroupItem id="in_een_keer" value="in_een_keer" />
              <Label htmlFor="in_een_keer" className="cursor-pointer">
                <div className="font-medium">In één keer</div>
                <div className="text-xs text-slate-500">Wacht tot alles binnen is — één zending op de laatste leverweek.</div>
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuleren</Button>
          <Button onClick={() => { onConfirm(modus); onOpenChange(false) }}>Bevestigen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/orders/lever-modus-dialog.tsx
git commit -m "feat(inkoop-reservering): LeverModusDialog (deelleveringen vs in 1×)"
```

---

## Task 15: Frontend — `MaatwerkLevertijdHint`

**Files:**
- Create: `frontend/src/components/orders/maatwerk-levertijd-hint.tsx`
- Modify: `frontend/src/lib/supabase/queries/op-maat.ts`

- [ ] **Step 1: Helper-query in `op-maat.ts`**

```ts
export async function fetchMaatwerkLevertijdHint(kwaliteit: string, kleur: string) {
  // Eerst kijken of er beschikbare rollen zijn — als ja: geen hint nodig.
  // Hier: gebruik view besteld_per_kwaliteit_kleur (functie/view bestaat al, migratie 137).
  const { data, error } = await supabase
    .rpc('besteld_per_kwaliteit_kleur')
    .eq('kwaliteit_code', kwaliteit)
    .eq('kleur_code', kleur)
    .maybeSingle()
  if (error) throw error
  if (!data?.eerstvolgende_verwacht_datum) return null
  const { data: cfg } = await supabase
    .from('app_config').select('waarde').eq('sleutel','order_config').single()
  const buffer = (cfg?.waarde as any)?.inkoop_buffer_weken_maatwerk ?? 2
  // ISO-week + buffer berekening — gebruik server-side iso_week_plus
  const { data: wk } = await supabase.rpc('iso_week_plus', {
    p_datum: data.eerstvolgende_verwacht_datum,
    p_weken: buffer,
  })
  return { verwachte_leverweek: wk as unknown as string,
           verwacht_datum: data.eerstvolgende_verwacht_datum as string }
}
```

(Pas aan als `besteld_per_kwaliteit_kleur` als TABLE-functie aangeroepen moet worden via `.rpc().select(…)`.)

- [ ] **Step 2: Component**

```tsx
import { useQuery } from '@tanstack/react-query'
import { fetchMaatwerkLevertijdHint } from '@/lib/supabase/queries/op-maat'

export function MaatwerkLevertijdHint({ kwaliteit, kleur }: { kwaliteit?: string; kleur?: string }) {
  const { data } = useQuery({
    queryKey: ['maatwerk-levertijd', kwaliteit, kleur],
    queryFn: () => fetchMaatwerkLevertijdHint(kwaliteit!, kleur!),
    enabled: !!kwaliteit && !!kleur,
  })
  if (!data) return null
  return (
    <div className="text-xs text-slate-500 mt-1">
      Geen rol op voorraad. Eerstvolgende inkoop wk → leverbaar <span className="font-medium">{data.verwachte_leverweek}</span>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/maatwerk-levertijd-hint.tsx \
        frontend/src/lib/supabase/queries/op-maat.ts
git commit -m "feat(inkoop-reservering): MaatwerkLevertijdHint + op-maat helper-query"
```

---

## Task 16: Frontend — `IORegelClaimsPopover`

**Files:**
- Create: `frontend/src/components/inkooporders/io-regel-claims-popover.tsx`

- [ ] **Step 1: Schrijf component**

```tsx
import { useClaimsVoorIORegel } from '@/hooks/use-reserveringen'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function IORegelClaimsPopover({ ioRegelId, children }: {
  ioRegelId: number
  children: React.ReactNode
}) {
  const { data, isLoading } = useClaimsVoorIORegel(ioRegelId)
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="text-sm font-medium mb-2">Geclaimd door</div>
        {isLoading && 'Laden…'}
        {!isLoading && (!data || data.length === 0) && (
          <div className="text-sm text-slate-500">Nog geen orders op deze regel.</div>
        )}
        {data?.map((c: any) => (
          <div key={c.id} className="flex justify-between text-sm py-0.5">
            <span>
              {c.order_regels.orders.order_nr} — {c.order_regels.orders.debiteuren?.naam ?? `Klant ${c.order_regels.orders.debiteur_nr}`}
            </span>
            <span className="font-medium">{c.aantal}×</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/inkooporders/io-regel-claims-popover.tsx
git commit -m "feat(inkoop-reservering): IORegelClaimsPopover"
```

---

## Task 17: Order-form integratie (create + edit)

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx`
- Modify: `frontend/src/components/orders/order-line-editor.tsx`

- [ ] **Step 1: Inline tekort-info per regel**

In `order-line-editor.tsx`, onder elke regel met tekort: render een grijze subtekst-lijn:

```tsx
{regel.te_leveren > (regel.vrije_voorraad ?? 0) && regel.artikelnr && !regel.is_maatwerk && (
  <div className="text-xs text-slate-500 mt-1">
    {Math.min(regel.vrije_voorraad ?? 0, regel.te_leveren)}× direct,
    {' '}{Math.max(0, regel.te_leveren - (regel.vrije_voorraad ?? 0))}× wacht op inkoop
  </div>
)}
```

(Note: dit is een snelle inline indicator; de echte claim-info komt na opslaan via de levertijd-badge in order-detail.)

- [ ] **Step 2: `LeverModusDialog` integreren in submit-flow**

In `order-form.tsx`:
- Voor submit: bereken of er regels met tekort zijn (`te_leveren > vrije_voorraad`).
- Als ja: open `LeverModusDialog` ipv direct submit.
- `defaultModus = klant?.deelleveringen_toegestaan ? 'deelleveringen' : 'in_een_keer'`.
- Op confirm: zet `lever_modus` in form-state, submit door.
- Geen tekort: submit zonder dialog, `lever_modus` blijft `null`/undefined.

- [ ] **Step 3: Browser-test**

```bash
cd frontend && npm run dev
```

Test scenario:
1. Maak nieuwe order voor klant met `deelleveringen_toegestaan=true`
2. Voeg regel toe met aantal > vrije_voorraad
3. Inline tekst "X direct, Y wacht op inkoop" zichtbaar
4. Submit → dialog opent met radio op "Deelleveringen"
5. Bevestigen → order opgeslagen, `orders.lever_modus = 'deelleveringen'`
6. DB: `SELECT * FROM order_reserveringen WHERE order_regel_id = …` — claims aanwezig

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/orders/order-form.tsx \
        frontend/src/components/orders/order-line-editor.tsx
git commit -m "feat(inkoop-reservering): order-form — inline tekort + LeverModusDialog"
```

---

## Task 18: Order-detail levertijd-kolom

**Files:**
- Modify: `frontend/src/pages/orders/order-detail.tsx`

- [ ] **Step 1: Levertijd-data ophalen + kolom renderen**

In `order-detail.tsx`:
- `useLevertijdVoorOrder(orderId)` hook
- Kolom `Levertijd` toevoegen aan orderregel-tabel
- Per cel: `<RegelClaimDetail orderRegelId={r.id}><LevertijdBadge levertijd={lev[r.id]} /></RegelClaimDetail>`
- Lookup-map `lev = Object.fromEntries(data.map(l => [l.order_regel_id, l]))`

- [ ] **Step 2: Browser-test**

Open een order met tekort. Verifieer:
- Kolom Levertijd zichtbaar
- Voorraad-regels: groene `Voorraad`-badge
- IO-regels: gele `2026-W23`-badge
- Tekort-regels: rode `Wacht op inkoop`
- Klik op badge → popover met claim-uitsplitsing

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/orders/order-detail.tsx
git commit -m "feat(inkoop-reservering): order-detail — levertijd-kolom + claim-popover"
```

---

## Task 19: IO-detail geclaimd-kolom

**Files:**
- Modify: `frontend/src/pages/inkooporders/inkooporder-detail.tsx`

- [ ] **Step 1: Toon `Geclaimd N/M` per IO-regel**

Aan de regel-tabel een kolom toevoegen die `aantal_geclaimd / FLOOR(te_leveren_m)` toont, met `<IORegelClaimsPopover ioRegelId={r.id}>` als wrapper. Alleen renderen voor `eenheid='stuks'`.

- [ ] **Step 2: Browser-test**

Open een IO-detail van een IO waarvan ≥1 regel claims heeft. Verifieer kolom + popover.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/inkooporders/inkooporder-detail.tsx
git commit -m "feat(inkoop-reservering): IO-detail — geclaimd-kolom + claim-popover"
```

---

## Task 20: Product-detail uitbreiding

**Files:**
- Modify: `frontend/src/pages/producten/product-detail.tsx`
- Modify: `frontend/src/lib/supabase/queries/producten.ts`

- [ ] **Step 1: Bestaande reserveringen-query uitbreiden**

In `fetchReserveringenVoorProduct` (zie [producten.ts](frontend/src/lib/supabase/queries/producten.ts)):
- Switch naar `order_reserveringen`-tabel ipv aggregaat per orderregel
- Selecteer `bron`, en bij `bron='inkooporder_regel'`: leverweek via join

- [ ] **Step 2: Twee secties tonen op detail**

Op de productpagina sectie `Reserveringen` opsplitsen:
- "Op voorraad gereserveerd" (claims met `bron='voorraad'`)
- "Wacht op inkoop" (claims met `bron='inkooporder_regel'`, gegroepeerd per IO met leverweek)

- [ ] **Step 3: Browser-test + commit**

```bash
cd frontend && npm run build
git add frontend/src/pages/producten/product-detail.tsx \
        frontend/src/lib/supabase/queries/producten.ts
git commit -m "feat(inkoop-reservering): product-detail — claims gesplitst per bron"
```

---

## Task 21: Maatwerk-hint integratie

**Files:**
- Modify: `frontend/src/components/orders/op-maat-selector.tsx`

- [ ] **Step 1: `MaatwerkLevertijdHint` tonen onder maatwerk-velden**

Zodra kwaliteit + kleur gekozen zijn én `maatwerk_beschikbaar_m2` ontoereikend is voor de gewenste maat: render `<MaatwerkLevertijdHint kwaliteit={kw} kleur={kl} />`.

(Logica voor "ontoereikend" leunt op bestaand `maatwerk_beschikbaar_m2` in component-state. Als dat veld er niet is: trigger op afwezigheid van rollen — eenvoudige fallback.)

- [ ] **Step 2: Browser-test + commit**

Test: kies kwaliteit/kleur waar geen rol beschikbaar is maar wel openstaande inkoop. Verifieer dat hint verschijnt met verwachte leverweek.

```bash
git add frontend/src/components/orders/op-maat-selector.tsx
git commit -m "feat(inkoop-reservering): maatwerk-levertijd-hint in op-maat-selector"
```

---

## Task 22: End-to-end smoketest

**Files:** geen wijzigingen — handmatige validatie.

- [ ] **Step 1: Scenario uitvoeren**

In de DEV-omgeving:

1. Kies een artikelnr met `voorraad < 10` en ≥2 openstaande IO-regels (status `Besteld`).
2. Maak via UI een order van 10 stuks. Verifieer:
   - Inline tekort-tekst per regel
   - Submit opent `LeverModusDialog` met klant-default
   - Kies `Deelleveringen` → opslaan
3. Open order-detail. Verifieer:
   - Levertijd-kolom toont badge per regel
   - Klik popover toont splitsing (voorraad + IO)
4. Open IO-detail. Verifieer:
   - `Geclaimd N/M` op de IO-regel klopt
   - Popover toont onze test-order
5. Doe `boek_voorraad_ontvangst` voor 4 stuks via UI.
6. Open order-detail opnieuw. Verifieer:
   - Eerste IO-claim verkleind / gemarkeerd
   - Voorraad-claim opgehoogd
   - Order-status omhoog (Wacht op inkoop → Wacht op picken bij volledige levering)

- [ ] **Step 2: Annulering-scenario**

Annuleer een IO via UI (`Geannuleerd`). Verifieer:
- Claims op die IO zijn `released`
- Getroffen orders schuiven naar `Wacht op nieuwe inkoop` (orders zonder dekking) of `Wacht op inkoop` (als andere IO opvangt)

- [ ] **Step 3: Cleanup test-data**

```sql
DELETE FROM orders WHERE order_nr = '<test-order-nr>';
-- IO ongedaan maken via UPDATE inkooporders.status = 'Besteld' als dat nodig is.
```

- [ ] **Step 4: Tag-commit als alles werkt**

```bash
git commit --allow-empty -m "test(inkoop-reservering): end-to-end smoketest groen"
```

---

## Task 23: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/architectuur.md`
- Modify: `docs/data-woordenboek.md`
- Modify: `docs/changelog.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `docs/database-schema.md`**

Toevoegen:
- Tabel `order_reserveringen` (sectie naast `order_regels`)
- Kolom `orders.lever_modus`
- Enum-waarde `Wacht op inkoop`
- Functies `iso_week_plus`, `voorraad_beschikbaar_voor_artikel`, `io_regel_ruimte`, `herallocateer_orderregel`, `herwaardeer_order_status`, `release_claims_voor_io_regel`
- Views `order_regel_levertijd`, `inkooporder_regel_claim_zicht`
- Update `producten.gereserveerd`/`vrije_voorraad`-omschrijving met nieuwe formule + verwijs naar migratie 149
- Tellingen bovenaan bijwerken (37 tabellen, 14 views, …)

- [ ] **Step 2: `docs/architectuur.md`**

Nieuwe sectie "Inkoop-reserveringen" met:
- Datamodel-diagram (orderregel → claim → IO-regel)
- Allocatie-volgorde (voorraad-eerst, oudste IO daarna)
- Claim-volgorde-prio + geen herallocatie
- Levenscyclus-flow (orderregel-mutatie / IO-status / `boek_voorraad_ontvangst`)
- Maatwerk-spoor (alleen indicator)

- [ ] **Step 3: `docs/data-woordenboek.md`**

Termen: `claim`, `lever_modus`, `verwachte leverweek`, `bron-van-claim`, `IO-regel-ruimte`.

- [ ] **Step 4: `docs/changelog.md`**

```markdown
## 2026-04-29 — Inkoop-reserveringen V1

Reserveringssysteem uitgebreid met harde koppeling naar inkooporderregels voor vaste maten:

- Nieuwe tabel `order_reserveringen` (bron='voorraad' | 'inkooporder_regel')
- Order-status `Wacht op inkoop` toegevoegd
- Kolom `orders.lever_modus` (deelleveringen / in_een_keer)
- Buffer-keys in `app_config.order_config` (1 wk vast / 2 wk maatwerk)
- Wijziging `vrije_voorraad`-formule: `voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop` meer)
- Auto-allocatie via RPC `herallocateer_orderregel` (voorraad-eerst, dan oudste IO; claim-volgorde-prio)
- `boek_voorraad_ontvangst` consumeert claims bij ontvangst
- Frontend: levertijd-badge op orderregels, `LeverModusDialog` bij opslaan, `IORegelClaimsPopover` op IO-detail, maatwerk-levertijdhint op op-maat-selector
- Migraties 144–151
```

- [ ] **Step 5: `CLAUDE.md`** — bedrijfsregels uitbreiden

Onder "Bedrijfsregels":
```markdown
- **Reservering op inkoop (vaste maten):** orderregels zonder voldoende voorraad alloceren automatisch op openstaande inkooporderregels (status `Besteld`/`Deels ontvangen`) op `verwacht_datum ASC`. Claim-volgorde bepaalt prio: wie eerst claimt, wordt eerst beleverd. Geen automatische herallocatie. Bij IO-annulering schuiven claims naar volgende IO of orders gaan in `Wacht op nieuwe inkoop` (orderregel zonder dekking — order-status blijft `Wacht op inkoop` totdat een nieuwe IO de allocator opnieuw triggert via orderregel-bewerking).
- **Maatwerk levertijd-indicator:** maatwerk reserveert NIET op inkoop in V1. Op de orderregel verschijnt alleen een hint `Eerstvolgende inkoop wk + 2 weken` als er geen rol beschikbaar is.
- **lever_modus:** order-niveau keuze "deelleveringen" / "in_een_keer". Default uit `debiteuren.deelleveringen_toegestaan`. Bepaalt levertijd-berekening (eerste week resp. max-week) en aantal zendingen.
```

- [ ] **Step 6: Commit docs**

```bash
git add docs/database-schema.md docs/architectuur.md docs/data-woordenboek.md docs/changelog.md CLAUDE.md
git commit -m "docs(inkoop-reservering): bijwerken schema/architectuur/woordenboek/changelog/CLAUDE"
```

---

## Klaarcheck

Na Task 23: het feature is volledig opgeleverd. De volgende dingen zijn af:

- [x] Migraties 144–151 toegepast en gevalideerd
- [x] RPC-allocatie + triggers werkend en idempotent
- [x] `boek_voorraad_ontvangst` consumeert claims bij ontvangst
- [x] `vrije_voorraad`-formule vereenvoudigd, geen ghost-aggregatie meer
- [x] Frontend: orderregel-badge, claim-popover, modal-keuze, IO-detail-popover, productdetail uitbreiding, maatwerk-hint
- [x] End-to-end smoketest groen
- [x] Documentatie bijgewerkt

V2-backlog (uit ontwerp-keuzes hierboven):
- Maatwerk-claim op IO-rol (echte reservering)
- Handmatige IO-keuze (override auto-allocatie)
- Klantnotificatie bij IO-vertraging
- Spoed-prio (claim "stelen")
- Reservering voor `eenheid='m'`-rollen als hele rol
