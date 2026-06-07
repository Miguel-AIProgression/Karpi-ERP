# EDI-leverweek als voorstel + bevestigingsstap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alleen voor EDI-orders wordt de door de partner meegestuurde leverweek een *voorstel*: de order wordt geblokkeerd voor picken/productie tot een operator de leverweek (haalbaarheid t.o.v. voorraad/inkoop) bevestigt; bevestiging is gekoppeld aan de bestaande EDI-orderbevestiging.

**Architecture:** We hergebruiken de bestaande gate `orders.edi_bevestigd_op IS NULL` (mig 158) als "leverweek nog niet bevestigd". We voegen één snapshot-kolom `orders.edi_gewenste_afleverdatum` toe (de partner-wens, audit + UI-vergelijking). `create_edi_order` blijft `afleverdatum` met de wens vullen (zodat downstream niets breekt en de allocator/mig 153 de haalbare datum vooruit kan schuiven), maar de order is geblokkeerd tot bevestiging. Blokkade zit op twee plekken: Pick & Ship (JS-filter in `fetchPickShipOrders`) en de productie-intake (`snijplanning_overzicht` view-WHERE). Operator bevestigt op order-detail via een nieuw paneel (gewenst vs. haalbaar), wat `afleverdatum` vastzet en de bestaande `bevestigOrderViaEdi`-flow aanroept. De orderbevestiging stuurt voortaan de *bevestigde* `orders.afleverdatum` i.p.v. de rauwe EDI-wens.

**Tech Stack:** Supabase (PostgreSQL, plpgsql migraties 309–310), React 19 + TypeScript + TanStack Query, Vitest voor pure helpers, TailwindCSS.

---

## Achtergrond — bevestigde feiten uit de codebase

- **EDI-parser** leest `leverdatum` (YYYYMMDD) uit fixed-width header [44,52] → `header.leverdatum` (ISO). Zie [`karpi-fixed-width.ts`](../../../supabase/functions/_shared/transus-formats/karpi-fixed-width.ts).
- **`create_edi_order`** — laatste versie [mig 166](../../../supabase/migrations/166_edi_prijzen_uit_prijslijst.sql) — zet `afleverdatum := NULLIF(v_header->>'leverdatum','')::DATE` (regel 32, 125), status `'Nieuw'`, `bron_systeem='edi'`. **Er is GEEN aparte "gewenste leverweek"-kolom**; `afleverdatum` is enige bron-van-waarheid.
- **Twee verschillende bevestig-velden — NIET verwisselen:**
  - `orders.edi_bevestigd_op TIMESTAMPTZ` (mig 158) = EDI-orderbev verstuurd. Gezet via RPC `markeer_order_edi_bevestigd(p_order_id)`. Dit is de gate die wij hergebruiken.
  - `orders.bevestigd_at TIMESTAMPTZ` (mig 304) = aparte **e-mail**-orderbevestiging (`BevestigOrderDialog` op order-header). **Raken we niet aan.**
- **EDI-orderbev-flow:** [`bevestigOrderViaEdi`](../../../frontend/src/modules/edi/lib/bevestig-helper.ts) roept `markeer_order_edi_bevestigd` aan en bouwt de orderbev-XML. `buildOrderbevInput` (regel 150–173) zet nu `leverdatum: parsedOrder.header.leverdatum` — de rauwe wens. Knop staat op EDI bericht-detail ([`bericht-detail.tsx`](../../../frontend/src/modules/edi/pages/bericht-detail.tsx), `handleBevestig`).
- **Pick & Ship-filter** is JS in [`fetchPickShipOrders`](../../../frontend/src/modules/magazijn/queries/pickbaarheid.ts) (regel 49–119); headers komen uit `fetchOpenOrderHeaders` (regel 121–168), select op `orders`.
- **Productie-intake:** maatwerkregels krijgen automatisch een snijplan (`auto_maak_snijplan`, status `'Wacht'`). De planning-pool leest via view `snijplanning_overzicht` — laatste versie [mig 290](../../../supabase/migrations/290_order_annulering_release_snijplannen.sql), met `WHERE o.status <> 'Geannuleerd'`. Dit is het minst-invasieve blokkadepunt (defense-in-depth, precedent mig 290).
- **Orders-overzicht:** tabs in [`status-tabs.tsx`](../../../frontend/src/components/orders/status-tabs.tsx) (`ALL_STATUSES`), data via [`fetchOrders`](../../../frontend/src/lib/supabase/queries/orders.ts) (leest view `orders_list`, regel 143) + counts via `fetchStatusCounts` (regel 236). `orders_list` view = [mig 259](../../../supabase/migrations/259_orders_list_bundel_kolommen.sql) (exposeert `bron_systeem`, nog NIET `edi_bevestigd_op`).
- **Order-detail:** [`order-detail.tsx`](../../../frontend/src/pages/orders/order-detail.tsx); `fetchOrderDetail` doet `from('orders').select('*')` (regel 291) → nieuwe kolommen automatisch beschikbaar, alleen TS-interface bijwerken.
- **Verzendweek-helpers** (`verzendWeekVoor`, `verzendWeekKort`, `verzendWeekIsoString`, `verzendWeekStringToDatum`) in [`verzendweek.ts`](../../../frontend/src/lib/orders/verzendweek.ts) — single source of truth voor afleverdatum→ISO-week.

## Concept-onderscheid (vermeld in docs)

- **"Te koppelen"** (bestaand, mig 306/307) = inkomend EDI-bericht zonder order (`edi_berichten.order_id IS NULL`). Banner [`EdiTeKoppelenBanner`](../../../frontend/src/modules/edi/components/te-koppelen-banner.tsx).
- **"Te bevestigen"** (NIEUW, dit plan) = EDI-order bestaat al, maar leverweek nog niet bevestigd (`orders.bron_systeem='edi' AND edi_bevestigd_op IS NULL`).

## Bestandsoverzicht

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `supabase/migrations/309_edi_gewenste_leverweek.sql` | Create | Kolom `edi_gewenste_afleverdatum`, herdefinitie `create_edi_order`, `orders_list`-uitbreiding, backfill bestaande EDI-orders |
| `supabase/migrations/310_snijplanning_overzicht_edi_gate.sql` | Create | `snijplanning_overzicht` blokkeert onbevestigde EDI-orders |
| `frontend/src/lib/orders/edi-leverweek.ts` | Create | Pure helpers: `isLeverweekTeBevestigen`, `vergelijkLeverweek` |
| `frontend/src/lib/orders/__tests__/edi-leverweek.test.ts` | Create | Unit-tests voor bovenstaande helpers |
| `frontend/src/lib/supabase/queries/orders.ts` | Modify | `OrderRow`/`OrderDetail` velden; `fetchOrders` + `fetchStatusCounts` "Te bevestigen" |
| `frontend/src/components/orders/status-tabs.tsx` | Modify | Chip "Te bevestigen" |
| `frontend/src/modules/magazijn/queries/pickbaarheid.ts` | Modify | Pick & Ship blokkeert onbevestigde EDI-orders |
| `frontend/src/modules/edi/lib/bevestig-helper.ts` | Modify | Orderbev gebruikt bevestigde `orders.afleverdatum` |
| `frontend/src/modules/edi/queries/edi.ts` | Modify | `fetchInkomendBerichtVoorOrder(orderId)` |
| `frontend/src/components/orders/edi-leverweek-bevestigen.tsx` | Create | Bevestig-paneel op order-detail |
| `frontend/src/pages/orders/order-detail.tsx` | Modify | Paneel inhaken |
| `CLAUDE.md`, `docs/changelog.md`, `docs/database-schema.md` | Modify | Bedrijfsregel + changelog + kolommen |

---

### Task 1: Migratie 309 — `edi_gewenste_afleverdatum` + `create_edi_order` + `orders_list` + backfill

**Files:**
- Create: `supabase/migrations/309_edi_gewenste_leverweek.sql`
- Reference (niet muteren): `supabase/migrations/166_edi_prijzen_uit_prijslijst.sql`, `supabase/migrations/259_orders_list_bundel_kolommen.sql`

> **Let op:** migraties worden in dit project **handmatig** toegepast in Supabase (de MCP heeft geen toegang tot het Karpi-project). Deze taak schrijft alleen het bestand; toepassen gebeurt door de gebruiker.

- [ ] **Step 1: Schrijf de migratie**

Maak `supabase/migrations/309_edi_gewenste_leverweek.sql` met exact deze inhoud:

```sql
-- Migratie 309: EDI-leverweek wordt voorstel — gewenste-datum-snapshot + gate
--
-- Probleem:
--   create_edi_order (mig 166) nam de door de partner meegestuurde leverdatum
--   1-op-1 over in orders.afleverdatum. Die week is een KLANTWENS, niet getoetst
--   op voorraad/inkoop. De order stroomde meteen door naar picken/productie.
--
-- Aanpak (alleen EDI):
--   1. Nieuwe kolom orders.edi_gewenste_afleverdatum = snapshot van de partner-wens
--      (verandert nooit; audit + UI-vergelijking "gewenst vs. haalbaar").
--   2. create_edi_order vult NAAST afleverdatum (=initieel voorstel, zodat de
--      allocator + mig 153 de haalbare datum vooruit kan schuiven) ook
--      edi_gewenste_afleverdatum. edi_bevestigd_op blijft NULL = "te bevestigen".
--   3. orders_list exposeert edi_bevestigd_op + edi_gewenste_afleverdatum zodat
--      de frontend het "Te bevestigen"-filter en de UI kan bouwen.
--   4. Backfill: bestaande EDI-orders die al in een late fase zitten of al een
--      orderbev hebben → edi_bevestigd_op = now() (niet opnieuw "te bevestigen");
--      edi_gewenste_afleverdatum = afleverdatum (best-effort snapshot).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION/VIEW.

-- ============================================================================
-- 1. Snapshot-kolom
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS edi_gewenste_afleverdatum DATE;

COMMENT ON COLUMN orders.edi_gewenste_afleverdatum IS
  'EDI-only: de door de handelspartner meegestuurde gewenste leverdatum '
  '(snapshot, verandert nooit). orders.afleverdatum mag hiervan afwijken zodra '
  'de allocator/mig 153 een haalbare datum berekent of een operator bij '
  'bevestiging corrigeert. NULL voor niet-EDI-orders. Mig 309.';

-- ============================================================================
-- 2. create_edi_order — vult edi_gewenste_afleverdatum naast afleverdatum
--    (volledige herdefinitie van mig 166; enige verschil = de extra kolom)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_edi_order(
  p_inkomend_bericht_id BIGINT,
  p_payload_parsed      JSONB,
  p_debiteur_nr         INTEGER
) RETURNS BIGINT AS $$
DECLARE
  v_header           JSONB := p_payload_parsed->'header';
  v_regels           JSONB := p_payload_parsed->'regels';
  v_ordernr          TEXT;
  v_existing_id      BIGINT;
  v_order_id         BIGINT;
  v_klantref         TEXT  := v_header->>'ordernummer';
  v_leverdatum       DATE  := NULLIF(v_header->>'leverdatum', '')::DATE;
  v_orderdatum       DATE  := COALESCE(NULLIF(v_header->>'orderdatum','')::DATE, CURRENT_DATE);
  v_gln_gefact       TEXT  := v_header->>'gln_gefactureerd';
  v_gln_best         TEXT  := v_header->>'gln_besteller';
  v_gln_afl          TEXT  := v_header->>'gln_afleveradres';
  v_deb_naam         TEXT;
  v_deb_adres        TEXT;
  v_deb_postcode     TEXT;
  v_deb_plaats       TEXT;
  v_deb_land         TEXT;
  v_fact_naam        TEXT;
  v_fact_adres       TEXT;
  v_fact_postcode    TEXT;
  v_fact_plaats      TEXT;
  v_prijslijst_nr    TEXT;
  v_korting_pct      NUMERIC := 0;
  v_afl_naam         TEXT;
  v_afl_adres        TEXT;
  v_afl_postcode     TEXT;
  v_afl_plaats       TEXT;
  v_afl_land         TEXT;
  v_transactie_id    TEXT;
  v_is_test          BOOLEAN;
  r                  JSONB;
  v_regelnr          INTEGER := 0;
  v_match            RECORD;
  v_aantal           INTEGER;
  v_omschrijving     TEXT;
  v_prijs            NUMERIC;
  v_bedrag           NUMERIC;
BEGIN
  SELECT transactie_id, is_test
    INTO v_transactie_id, v_is_test
    FROM edi_berichten
   WHERE id = p_inkomend_bericht_id;

  IF v_transactie_id IS NULL THEN
    RAISE EXCEPTION 'edi_berichten id=% niet gevonden of geen transactie_id', p_inkomend_bericht_id;
  END IF;

  SELECT id INTO v_existing_id
    FROM orders
   WHERE bron_systeem = 'edi'
     AND bron_order_id = v_transactie_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE edi_berichten SET order_id = v_existing_id WHERE id = p_inkomend_bericht_id;
    RETURN v_existing_id;
  END IF;

  IF p_debiteur_nr IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           COALESCE(fact_naam, naam),
           COALESCE(fact_adres, adres),
           COALESCE(fact_postcode, postcode),
           COALESCE(fact_plaats, plaats),
           prijslijst_nr,
           COALESCE(korting_pct, 0)
      INTO v_deb_naam, v_deb_adres, v_deb_postcode, v_deb_plaats, v_deb_land,
           v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats,
           v_prijslijst_nr, v_korting_pct
      FROM debiteuren
     WHERE debiteur_nr = p_debiteur_nr;
  END IF;

  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land
      FROM afleveradressen
     WHERE debiteur_nr = p_debiteur_nr
       AND gln_afleveradres = v_gln_afl
     LIMIT 1;
  END IF;

  IF v_afl_naam IS NULL THEN
    v_afl_naam := v_deb_naam;
    v_afl_adres := v_deb_adres;
    v_afl_postcode := v_deb_postcode;
    v_afl_plaats := v_deb_plaats;
    v_afl_land := v_deb_land;
  END IF;

  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr, debiteur_nr, klant_referentie,
    orderdatum, afleverdatum, edi_gewenste_afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    factuuradres_gln, besteller_gln, afleveradres_gln,
    bron_systeem, bron_order_id, status
  ) VALUES (
    v_ordernr, p_debiteur_nr, v_klantref,
    v_orderdatum, v_leverdatum, v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
    v_gln_gefact, v_gln_best, v_gln_afl,
    'edi', v_transactie_id, 'Nieuw'
  )
  RETURNING id INTO v_order_id;

  FOR r IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    v_aantal := COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1);
    v_prijs := NULL;

    SELECT * INTO v_match
      FROM match_edi_artikel(r->>'gtin', r->>'artikelcode');

    IF v_match.artikelnr IS NULL THEN
      v_omschrijving := '[EDI ongematcht: ' ||
        COALESCE(NULLIF(r->>'artikelcode', ''), r->>'gtin', '?') || ']';
    ELSE
      v_omschrijving := COALESCE(v_match.omschrijving, v_match.artikelnr);

      IF v_prijslijst_nr IS NOT NULL THEN
        SELECT pr.prijs
          INTO v_prijs
          FROM prijslijst_regels pr
         WHERE pr.prijslijst_nr = v_prijslijst_nr
           AND pr.artikelnr = v_match.artikelnr
         LIMIT 1;
      END IF;

      v_prijs := COALESCE(v_prijs, v_match.verkoopprijs);
    END IF;

    v_bedrag := ROUND(COALESCE(v_prijs, 0) * v_aantal * (1 - COALESCE(v_korting_pct, 0) / 100), 2);

    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag
    ) VALUES (
      v_order_id, v_regelnr,
      v_match.artikelnr,
      v_omschrijving,
      v_aantal, v_aantal,
      v_prijs,
      COALESCE(v_korting_pct, 0),
      v_bedrag
    );
  END LOOP;

  UPDATE edi_berichten SET order_id = v_order_id WHERE id = p_inkomend_bericht_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_edi_order(BIGINT, JSONB, INTEGER) TO authenticated;

COMMENT ON FUNCTION create_edi_order IS
  'Maakt een order + regels aan op basis van een geparseerde inkomende EDI-payload. '
  'Idempotent op (bron_systeem=edi, bron_order_id=TransactionID). Gebruikt '
  'match_edi_artikel voor artikelmatching en prijst regels via debiteuren.prijslijst_nr '
  '→ prijslijst_regels; fallback op producten.verkoopprijs. Sinds mig 309 vult de '
  'functie OOK edi_gewenste_afleverdatum (= leverdatum-snapshot van de partner); de '
  'order blijft "te bevestigen" tot edi_bevestigd_op gezet is.';

-- ============================================================================
-- 3. orders_list — exposeer edi_bevestigd_op + edi_gewenste_afleverdatum
--    (volledige herdefinitie van mig 259; enige verschil = 2 extra kolommen)
-- ============================================================================
DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS aantal_orders
      FROM zending_orders zo2
     WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY
    zo.order_id,
    CASE z.status
      WHEN 'Picken'                  THEN 1
      WHEN 'Klaar voor verzending'   THEN 2
      WHEN 'Onderweg'                THEN 3
      WHEN 'Afgeleverd'              THEN 4
      ELSE 5
    END,
    z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  -- Mig 309: EDI-leverweek-bevestiging
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  -- Mig 259: bundel-info — NULL voor solo-orders
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel_zending_nr + bundel_order_count. '
  'Sinds mig 309: edi_bevestigd_op + edi_gewenste_afleverdatum voor het '
  '"Te bevestigen"-filter (EDI-orders met onbevestigde leverweek).';

-- ============================================================================
-- 4. Backfill — bestaande EDI-orders niet onterecht als "te bevestigen" tonen
-- ============================================================================
-- Snapshot de wens voor alle EDI-orders die er nog geen hebben.
UPDATE orders
   SET edi_gewenste_afleverdatum = afleverdatum
 WHERE bron_systeem = 'edi'
   AND edi_gewenste_afleverdatum IS NULL
   AND afleverdatum IS NOT NULL;

-- Markeer als bevestigd: orders die al een late fase bereikten of al een
-- (niet-geannuleerde) orderbev op de uitgaande wachtrij/verstuurd hebben.
UPDATE orders o
   SET edi_bevestigd_op = COALESCE(o.edi_bevestigd_op, now())
 WHERE o.bron_systeem = 'edi'
   AND o.edi_bevestigd_op IS NULL
   AND (
     o.status IN ('In pickronde', 'Deels verzonden', 'Verzonden', 'Klaar voor verzending')
     OR EXISTS (
       SELECT 1 FROM edi_berichten eb
        WHERE eb.order_id = o.id
          AND eb.richting = 'uit'
          AND eb.berichttype = 'orderbev'
          AND eb.status NOT IN ('Fout', 'Geannuleerd')
     )
   );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer dat het bestand klopt (syntax-scan)**

Run: `node -e "const f=require('fs').readFileSync('supabase/migrations/309_edi_gewenste_leverweek.sql','utf8'); if(!f.includes('edi_gewenste_afleverdatum')||!f.includes('CREATE OR REPLACE FUNCTION create_edi_order')||!f.includes('CREATE VIEW orders_list')) throw new Error('mist sectie'); console.log('OK', f.split('\n').length, 'regels')"`
Expected: `OK <n> regels` zonder error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/309_edi_gewenste_leverweek.sql
git commit -m "feat(edi): leverweek-snapshot + create_edi_order vult edi_gewenste_afleverdatum (mig 309)"
```

> **Toepassen (door gebruiker, niet de agent):** plak mig 309 in de Supabase SQL-editor. Verifieer daarna:
> ```sql
> SELECT column_name FROM information_schema.columns
>  WHERE table_name='orders' AND column_name='edi_gewenste_afleverdatum';
> -- 1 rij verwacht
> SELECT count(*) FILTER (WHERE edi_bevestigd_op IS NULL) AS te_bevestigen,
>        count(*) AS totaal_edi
>   FROM orders WHERE bron_systeem='edi';
> ```

---

### Task 2: Migratie 310 — `snijplanning_overzicht` blokkeert onbevestigde EDI-orders

**Files:**
- Create: `supabase/migrations/310_snijplanning_overzicht_edi_gate.sql`
- Reference (niet muteren): `supabase/migrations/290_order_annulering_release_snijplannen.sql`

- [ ] **Step 1: Schrijf de migratie**

Maak `supabase/migrations/310_snijplanning_overzicht_edi_gate.sql`. Dit is de volledige view uit mig 290 (44 kolommen, posities ongewijzigd) met één extra WHERE-conditie:

```sql
-- Migratie 310: snijplanning_overzicht sluit onbevestigde EDI-orders uit
--
-- Een EDI-order met onbevestigde leverweek (bron_systeem='edi' AND
-- edi_bevestigd_op IS NULL, mig 309) mag de productie-intake niet in: de
-- meegestuurde leverweek is een klantwens, nog niet getoetst op
-- voorraad/inkoop/capaciteit. Net als mig 290 ('Geannuleerd') is dit een
-- defense-in-depth-filter op de view die de planning-pool voedt.
--
-- Volledig identiek aan mig 290 op de WHERE-clause na. Bewust NIET ook
-- 'Verzonden' — deze view voedt óók de fysieke rol-uitvoer + packer.
--
-- Idempotent: CREATE OR REPLACE VIEW.

CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,                                                                       -- 1
  sp.snijplan_nr,                                                              -- 2
  sp.scancode,                                                                 -- 3
  sp.status,                                                                   -- 4
  sp.rol_id,                                                                   -- 5
  sp.lengte_cm    AS snij_lengte_cm,                                           -- 6
  sp.breedte_cm   AS snij_breedte_cm,                                          -- 7
  sp.prioriteit,                                                               -- 8
  sp.planning_week,                                                            -- 9
  sp.planning_jaar,                                                            -- 10
  o.afleverdatum,                                                              -- 11
  sp.positie_x_cm,                                                             -- 12
  sp.positie_y_cm,                                                             -- 13
  sp.geroteerd,                                                                -- 14
  sp.gesneden_datum,                                                           -- 15
  sp.gesneden_op,                                                              -- 16
  sp.gesneden_door,                                                            -- 17
  r.rolnummer,                                                                 -- 18
  r.breedte_cm    AS rol_breedte_cm,                                           -- 19
  r.lengte_cm     AS rol_lengte_cm,                                            -- 20
  r.oppervlak_m2  AS rol_oppervlak_m2,                                         -- 21
  r.status        AS rol_status,                                               -- 22
  p.locatie       AS locatie,                                                  -- 23
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,  -- 24
  COALESCE(r.kleur_code,     p.kleur_code,     oreg.maatwerk_kleur_code)     AS kleur_code,      -- 25
  oreg.artikelnr,                                                              -- 26
  p.omschrijving  AS product_omschrijving,                                     -- 27
  p.karpi_code,                                                                -- 28
  oreg.maatwerk_vorm,                                                          -- 29
  oreg.maatwerk_lengte_cm,                                                     -- 30
  oreg.maatwerk_breedte_cm,                                                    -- 31
  oreg.maatwerk_afwerking,                                                     -- 32
  oreg.maatwerk_band_kleur,                                                    -- 33
  oreg.maatwerk_instructies,                                                   -- 34
  oreg.orderaantal,                                                            -- 35
  oreg.id         AS order_regel_id,                                           -- 36
  o.id            AS order_id,                                                 -- 37
  o.order_nr,                                                                  -- 38
  o.debiteur_nr,                                                               -- 39
  d.naam          AS klant_naam,                                               -- 40
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm, -- 41
  sp.locatie      AS snijplan_locatie,                                         -- 42
  sp.lengte_cm  + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_lengte_cm,   -- 43
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm   -- 44
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id
WHERE o.status <> 'Geannuleerd'
  AND NOT (o.bron_systeem = 'edi' AND o.edi_bevestigd_op IS NULL);

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'marge_cm (mig 143), placed_*_cm (mig 233), snijplan_locatie (mig 168). '
  'Mig 290: WHERE o.status <> ''Geannuleerd''. Mig 310: ook onbevestigde '
  'EDI-orders uitgesloten (bron_systeem=''edi'' AND edi_bevestigd_op IS NULL) — '
  'hun leverweek is nog niet getoetst.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer het bestand (syntax-scan)**

Run: `node -e "const f=require('fs').readFileSync('supabase/migrations/310_snijplanning_overzicht_edi_gate.sql','utf8'); if(!f.includes(\"NOT (o.bron_systeem = 'edi' AND o.edi_bevestigd_op IS NULL)\")) throw new Error('mist EDI-gate'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/310_snijplanning_overzicht_edi_gate.sql
git commit -m "feat(edi): snijplanning-pool sluit onbevestigde EDI-orders uit (mig 310)"
```

> **Toepassen (door gebruiker):** plak mig 310 in Supabase. Verifieer dat een test-EDI-order met `edi_bevestigd_op IS NULL` niet in `SELECT * FROM snijplanning_overzicht WHERE order_id = <id>` verschijnt.

---

### Task 3: Pure helpers `edi-leverweek.ts` (TDD)

Pure, framework-vrije helpers zodat de UI-logica testbaar is zonder Supabase. Volgt het patroon van [`verzendweek.ts`](../../../frontend/src/lib/orders/verzendweek.ts).

**Files:**
- Create: `frontend/src/lib/orders/edi-leverweek.ts`
- Test: `frontend/src/lib/orders/__tests__/edi-leverweek.test.ts`

- [ ] **Step 1: Schrijf de falende test**

Maak `frontend/src/lib/orders/__tests__/edi-leverweek.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isLeverweekTeBevestigen, vergelijkLeverweek } from '../edi-leverweek'

describe('isLeverweekTeBevestigen', () => {
  it('is true voor een EDI-order zonder edi_bevestigd_op', () => {
    expect(isLeverweekTeBevestigen({ bron_systeem: 'edi', edi_bevestigd_op: null })).toBe(true)
  })

  it('is false zodra een EDI-order bevestigd is', () => {
    expect(
      isLeverweekTeBevestigen({ bron_systeem: 'edi', edi_bevestigd_op: '2026-06-04T10:00:00Z' }),
    ).toBe(false)
  })

  it('is false voor niet-EDI-orders, ook zonder bevestiging', () => {
    expect(isLeverweekTeBevestigen({ bron_systeem: null, edi_bevestigd_op: null })).toBe(false)
    expect(isLeverweekTeBevestigen({ bron_systeem: 'lightspeed', edi_bevestigd_op: null })).toBe(
      false,
    )
  })
})

describe('vergelijkLeverweek', () => {
  it('meldt "gelijk" als gewenst en haalbaar in dezelfde ISO-week vallen', () => {
    const r = vergelijkLeverweek('2026-06-25', '2026-06-22') // beide week 26
    expect(r.relatie).toBe('gelijk')
    expect(r.weken).toBe(0)
  })

  it('meldt "later" met aantal weken als haalbaar later valt dan gewenst', () => {
    const r = vergelijkLeverweek('2026-06-22', '2026-07-06') // week 26 vs 28
    expect(r.relatie).toBe('later')
    expect(r.weken).toBe(2)
  })

  it('meldt "eerder" als haalbaar vóór de wens valt', () => {
    const r = vergelijkLeverweek('2026-07-06', '2026-06-22')
    expect(r.relatie).toBe('eerder')
    expect(r.weken).toBe(2)
  })

  it('geeft relatie "onbekend" als een van beide datums ontbreekt', () => {
    expect(vergelijkLeverweek(null, '2026-06-22').relatie).toBe('onbekend')
    expect(vergelijkLeverweek('2026-06-22', null).relatie).toBe('onbekend')
  })
})
```

- [ ] **Step 2: Run de test — moet falen**

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/edi-leverweek.test.ts`
Expected: FAIL — `Failed to resolve import "../edi-leverweek"`.

- [ ] **Step 3: Schrijf de implementatie**

Maak `frontend/src/lib/orders/edi-leverweek.ts`:

```typescript
// EDI-leverweek-seam: bepaalt of een EDI-order zijn (klant-gewenste) leverweek
// nog moet laten bevestigen, en vergelijkt de gewenste week met de haalbare
// week (= door allocator/mig 153 bijgewerkte orders.afleverdatum).
//
// Gate-conventie (mig 158 + 309): een EDI-order is "te bevestigen" zolang
// edi_bevestigd_op NULL is. Niet-EDI-orders kennen dit concept niet.

import { isoWeek } from './verzendweek'

export interface LeverweekOrderVelden {
  bron_systeem?: string | null
  edi_bevestigd_op?: string | null
}

/** True als dit een EDI-order is waarvan de leverweek nog bevestigd moet worden. */
export function isLeverweekTeBevestigen(order: LeverweekOrderVelden): boolean {
  return order.bron_systeem === 'edi' && !order.edi_bevestigd_op
}

export type LeverweekRelatie = 'gelijk' | 'later' | 'eerder' | 'onbekend'

export interface LeverweekVergelijking {
  relatie: LeverweekRelatie
  /** Absoluut aantal ISO-weken tussen gewenst en haalbaar (0 bij 'gelijk'). */
  weken: number
}

/**
 * Vergelijkt de gewenste leverdatum (EDI-wens) met de haalbare leverdatum
 * (huidige orders.afleverdatum). Vergelijking op ISO-weekniveau — de exacte
 * dag binnen de week is voor B2B-levering niet leidend (zie verzendweek.ts).
 */
export function vergelijkLeverweek(
  gewenstIso: string | null,
  haalbaarIso: string | null,
): LeverweekVergelijking {
  if (!gewenstIso || !haalbaarIso) return { relatie: 'onbekend', weken: 0 }
  const g = isoWeek(new Date(gewenstIso + 'T00:00:00'))
  const h = isoWeek(new Date(haalbaarIso + 'T00:00:00'))
  const diff = (h.jaar - g.jaar) * 53 + (h.week - g.week)
  if (diff === 0) return { relatie: 'gelijk', weken: 0 }
  if (diff > 0) return { relatie: 'later', weken: diff }
  return { relatie: 'eerder', weken: -diff }
}
```

- [ ] **Step 4: Run de test — moet slagen**

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/edi-leverweek.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/edi-leverweek.ts frontend/src/lib/orders/__tests__/edi-leverweek.test.ts
git commit -m "feat(edi): pure helpers leverweek-bevestiging (isLeverweekTeBevestigen, vergelijkLeverweek)"
```

---

### Task 4: Types uitbreiden + Pick & Ship-blokkade

**Files:**
- Modify: `frontend/src/lib/supabase/queries/orders.ts:5-71` (interfaces)
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts:121-168` (header-select + filter)

- [ ] **Step 1: Voeg de nieuwe velden toe aan `OrderRow`**

In [`orders.ts`](../../../frontend/src/lib/supabase/queries/orders.ts), in `interface OrderRow`, direct ná de bestaande `bron_shop?` regel (regel 21):

```typescript
  bron_shop?: string | null
  /** EDI (mig 158): tijdstip waarop de leverweek/orderbev bevestigd is. NULL = te bevestigen. */
  edi_bevestigd_op?: string | null
  /** EDI (mig 309): door de partner gewenste leverdatum (snapshot). NULL voor niet-EDI. */
  edi_gewenste_afleverdatum?: string | null
```

- [ ] **Step 2: Voeg dezelfde velden toe aan `OrderDetail`**

`OrderDetail extends OrderRow`, dus de velden zijn al overgeërfd — **geen extra wijziging nodig**. `fetchOrderDetail` doet `from('orders').select('*')` (regel 291), dus de kolommen komen automatisch mee. (Verificatie volgt in Task 7.)

- [ ] **Step 3: Breid de Pick & Ship header-query uit**

In [`pickbaarheid.ts`](../../../frontend/src/modules/magazijn/queries/pickbaarheid.ts), in `fetchOpenOrderHeaders` (regel 122-131), voeg de twee kolommen toe aan de select:

```typescript
    .select(
      'id, order_nr, status, debiteur_nr, afl_naam, afl_adres, afl_postcode, ' +
        'afl_plaats, afl_land, afleverdatum, afhalen, lever_type, ' +
        'bron_systeem, edi_bevestigd_op'
    )
```

- [ ] **Step 4: Breid het `OrderHeaderRij`-type uit**

Open [`pick-ship-transform.ts`](../../../frontend/src/modules/magazijn/queries/pick-ship-transform.ts). Zoek `interface OrderHeaderRij` en voeg toe (naast de bestaande velden):

```typescript
  bron_systeem: string | null
  edi_bevestigd_op: string | null
```

> Als `OrderHeaderRij` velden als `lever_type` al optioneel/`| null` declareert, volg exact dezelfde stijl. Lees het bestaande type eerst en spiegel de conventie (de andere velden zijn `string | null`).

- [ ] **Step 5: Voeg de blokkade-filter toe**

In `fetchPickShipOrders`, in de `result.filter(...)` op regel 103-114, als **eerste** check binnen de callback (vóór de `o.regels.length === 0`-check):

```typescript
  result = result.filter((o) => {
    const header = headerMap.get(o.order_id)
    // EDI-orders met onbevestigde leverweek blijven uit Pick & Ship tot een
    // operator de leverweek bevestigt (mig 309/310). De meegestuurde week is
    // een klantwens, nog niet getoetst op voorraad/inkoop.
    if (header?.bron_systeem === 'edi' && !header.edi_bevestigd_op) return false
    if (o.regels.length === 0) return false
    const allesPickbaar = o.regels.every((r) => r.is_pickbaar)
    if (header?.lever_type === 'datum' && header.afleverdatum) {
      const horizon = werkdagMinN(header.afleverdatum, 1)
      if (vandaagIso < horizon) return false
    }
    if (allesPickbaar) return true
    if (!header?.deelleveringen_toegestaan) return false
    return o.regels.some((r) => r.is_pickbaar)
  })
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors (mits `OrderHeaderRij` correct uitgebreid).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/supabase/queries/orders.ts frontend/src/modules/magazijn/queries/pickbaarheid.ts frontend/src/modules/magazijn/queries/pick-ship-transform.ts
git commit -m "feat(edi): Pick & Ship blokkeert onbevestigde EDI-orders + OrderRow-velden"
```

---

### Task 5: "Te bevestigen"-chip op het orders-overzicht

**Files:**
- Modify: `frontend/src/components/orders/status-tabs.tsx:9-20`
- Modify: `frontend/src/lib/supabase/queries/orders.ts:130-258` (`fetchOrders` + `fetchStatusCounts`)

- [ ] **Step 1: Voeg de chip toe aan `ALL_STATUSES`**

In [`status-tabs.tsx`](../../../frontend/src/components/orders/status-tabs.tsx), breid de array uit. Plaats `'Te bevestigen'` direct ná `'Actie vereist'` (beide zijn aandacht-vereisende, status-overstijgende buckets):

```typescript
const ALL_STATUSES = [
  'Alle',
  'Klaar voor picken',
  'Actie vereist',
  'Te bevestigen',
  'Wacht op voorraad',
  'Wacht op inkoop',
  'Wacht op maatwerk',
  'In pickronde',
  'Deels verzonden',
  'Verzonden',
  'Geannuleerd',
]
```

Werk ook de comment erboven bij (regel 4-8), voeg een regel toe:

```typescript
// 'Te bevestigen' = EDI-orders met onbevestigde leverweek
// (bron_systeem='edi' AND edi_bevestigd_op IS NULL); status-overstijgend, net als 'Actie vereist'.
```

- [ ] **Step 2: Behandel het filter in `fetchOrders`**

In [`orders.ts`](../../../frontend/src/lib/supabase/queries/orders.ts), in de status-afhandeling (regel 153-163), voeg een tak toe vóór de `else if (status && status !== 'Alle')`:

```typescript
  if (status === 'Actie vereist') {
    query = query.or(
      'status.eq.Wacht op voorraad,status.eq.Wacht op inkoop,status.eq.Actie vereist,heeft_unmatched_regels.eq.true'
    )
  } else if (status === 'Te bevestigen') {
    // EDI-orders waarvan de leverweek nog bevestigd moet worden (mig 309).
    // Status-overstijgend: filtert op bron + ontbrekende bevestiging.
    query = query.eq('bron_systeem', 'edi').is('edi_bevestigd_op', null)
  } else if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }
```

- [ ] **Step 3: Tel de chip in `fetchStatusCounts`**

In `fetchStatusCounts` (regel 236-258), voeg een extra count-query toe aan de `Promise.all` en push het resultaat als losse telling (net als de unmatched-aanvulling):

```typescript
export async function fetchStatusCounts(): Promise<StatusCount[]> {
  const [tellingRes, unmatchedRes, teBevestigenRes] = await Promise.all([
    supabase.from('orders_status_telling').select('status, aantal'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('heeft_unmatched_regels', true)
      .neq('status', 'Actie vereist'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('bron_systeem', 'edi')
      .is('edi_bevestigd_op', null),
  ])

  if (tellingRes.error) throw tellingRes.error

  const counts = (tellingRes.data ?? []) as StatusCount[]
  const extraUnmatched = unmatchedRes.count ?? 0

  if (extraUnmatched > 0) {
    const existing = counts.find((c) => c.status === 'Actie vereist')
    if (existing) existing.aantal += extraUnmatched
    else counts.push({ status: 'Actie vereist', aantal: extraUnmatched })
  }

  const teBevestigen = teBevestigenRes.count ?? 0
  if (teBevestigen > 0) {
    counts.push({ status: 'Te bevestigen', aantal: teBevestigen })
  }

  return counts
}
```

- [ ] **Step 4: Typecheck + bestaande tests**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run src/components/orders/__tests__/`
Expected: typecheck schoon; bestaande order-tests blijven groen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/orders/status-tabs.tsx frontend/src/lib/supabase/queries/orders.ts
git commit -m "feat(edi): 'Te bevestigen'-filter op orders-overzicht (EDI onbevestigde leverweek)"
```

---

### Task 6: Orderbev stuurt de bevestigde `afleverdatum`

De orderbevestiging moet de **bevestigde** leverdatum naar de partner sturen, niet de rauwe wens. We laten `buildOrderbevInput` de huidige `orders.afleverdatum` ophalen en gebruiken; valt die weg, dan fallback op de oorspronkelijke wens.

**Files:**
- Modify: `frontend/src/modules/edi/lib/bevestig-helper.ts:28-173`

- [ ] **Step 1: Haal de bevestigde afleverdatum op in `bevestigOrderViaEdi`**

In [`bevestig-helper.ts`](../../../frontend/src/modules/edi/lib/bevestig-helper.ts), direct ná de `markeer_order_edi_bevestigd`-aanroep (regel 38), voeg toe:

```typescript
  if (rpcErr) throw rpcErr

  // De orderbev moet de BEVESTIGDE leverdatum dragen (operator kan die op
  // order-detail hebben gecorrigeerd t.o.v. de EDI-wens — mig 309). Lees de
  // actuele orders.afleverdatum; valt die weg, dan fallback op de EDI-wens.
  const { data: orderRow } = await supabase
    .from('orders')
    .select('afleverdatum')
    .eq('id', orderId)
    .maybeSingle()
  const bevestigdeLeverdatum =
    (orderRow as { afleverdatum: string | null } | null)?.afleverdatum ??
    parsedOrder.header.leverdatum

  const isTest = options.isTest ?? isTestMessage(parsedOrder.header)
  const orderbevInput = buildOrderbevInput(parsedOrder, karpiGln, isTest, bevestigdeLeverdatum)
```

(De bestaande regel 40-41 `const isTest = ...` en `const orderbevInput = ...` worden door bovenstaande vervangen — let op: verwijder de oude twee regels zodat er geen dubbele declaratie ontstaat.)

- [ ] **Step 2: Pas `buildOrderbevInput` aan om de override te accepteren**

Vervang de signatuur en de `leverdatum`-regel (regel 150-157):

```typescript
function buildOrderbevInput(
  parsedOrder: KarpiOrder,
  karpiGln: string,
  isTest: boolean,
  leverdatumOverride?: string | null,
): OrderbevInput {
  return {
    ordernummer: parsedOrder.header.ordernummer,
    leverdatum: leverdatumOverride ?? parsedOrder.header.leverdatum,
    orderdatum: new Date().toISOString().slice(0, 10),
    afnemer_naam: parsedOrder.header.afnemer_naam,
```

(Rest van de functie ongewijzigd.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/edi/lib/bevestig-helper.ts
git commit -m "feat(edi): orderbev draagt de bevestigde afleverdatum i.p.v. de rauwe EDI-wens"
```

---

### Task 7: Bevestig-paneel op order-detail

Een paneel dat alleen verschijnt voor EDI-orders met onbevestigde leverweek. Het toont: gewenste leverweek (klant), haalbare leverweek (huidige `afleverdatum`, na allocator/mig 153) met een waarschuwing als die later valt, een bewerkbare leverweek-keuze, en een bevestig-knop die `afleverdatum` vastzet en `bevestigOrderViaEdi` aanroept.

**Files:**
- Modify: `frontend/src/modules/edi/queries/edi.ts` (nieuwe query)
- Create: `frontend/src/components/orders/edi-leverweek-bevestigen.tsx`
- Modify: `frontend/src/pages/orders/order-detail.tsx`

- [ ] **Step 1: Query — vind het inkomende EDI-bericht bij een order**

In [`edi.ts`](../../../frontend/src/modules/edi/queries/edi.ts), voeg onderaan toe (gebruikt `fetchEdiBericht` voor de volledige detail-shape incl. `payload_parsed`):

```typescript
/**
 * Vindt het inkomende order-bericht dat bij een interne order hoort (mig 158:
 * edi_berichten.order_id = orders.id). Nodig om vanaf order-detail de
 * orderbev-bevestiging te kunnen aanroepen (payload_parsed = de partner-order).
 * Retourneert null voor niet-EDI-orders of als het bron-bericht ontbreekt.
 */
export async function fetchInkomendBerichtVoorOrder(
  orderId: number,
): Promise<EdiBerichtDetail | null> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select('id')
    .eq('order_id', orderId)
    .eq('richting', 'in')
    .eq('berichttype', 'order')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { id: number } | null
  if (!row) return null
  return fetchEdiBericht(row.id)
}
```

- [ ] **Step 2: Exporteer de query + helper vanuit de EDI-module barrel**

Controleer [`frontend/src/modules/edi/index.ts`](../../../frontend/src/modules/edi/index.ts) (of de bestaande barrel). Voeg toe (spiegel de bestaande export-stijl in dat bestand):

```typescript
export { fetchInkomendBerichtVoorOrder } from './queries/edi'
export { bevestigOrderViaEdi } from './lib/bevestig-helper'
export { KARPI_GLN_DEFAULT } from './lib/karpi-fixed-width'
```

> Eerst het barrel-bestand lezen: als `bevestigOrderViaEdi` / `KARPI_GLN_DEFAULT` al geëxporteerd zijn, voeg alleen de ontbrekende toe. `KARPI_GLN_DEFAULT` wordt in [`bericht-detail.tsx`](../../../frontend/src/modules/edi/pages/bericht-detail.tsx) geïmporteerd — kopieer exact diezelfde import-bron als de barrel hem niet heeft.

- [ ] **Step 3: Maak de paneel-component**

Maak `frontend/src/components/orders/edi-leverweek-bevestigen.tsx`:

```typescript
import { useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import {
  verzendWeekKort,
  verzendWeekIsoString,
  verzendWeekStringToDatum,
} from '@/lib/orders/verzendweek'
import { vergelijkLeverweek } from '@/lib/orders/edi-leverweek'
import {
  fetchInkomendBerichtVoorOrder,
  bevestigOrderViaEdi,
  KARPI_GLN_DEFAULT,
} from '@/modules/edi'
import type { KarpiOrder } from '@/modules/edi/lib/karpi-fixed-width'

interface Props {
  orderId: number
  /** EDI-gewenste leverdatum (klant) — orders.edi_gewenste_afleverdatum (ISO). */
  gewenstIso: string | null
  /** Huidige (haalbare) afleverdatum — orders.afleverdatum (ISO). */
  afleverdatumIso: string | null
  /** Order-status, als haalbaarheidssignaal (bv. 'Wacht op inkoop'). */
  orderStatus: string
}

/**
 * Bevestig-paneel voor EDI-orders met onbevestigde leverweek (mig 309/310).
 * Operator ziet de klant-wens vs. de haalbare week, kan de week corrigeren en
 * bevestigt — dat zet orders.afleverdatum vast en plaatst de orderbev op de
 * uitgaande wachtrij (edi_bevestigd_op), waarna de order vrijkomt voor
 * picken/productie.
 */
export function EdiLeverweekBevestigen({ orderId, gewenstIso, afleverdatumIso, orderStatus }: Props) {
  const qc = useQueryClient()
  const [weekStr, setWeekStr] = useState(verzendWeekIsoString(afleverdatumIso || gewenstIso))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: bericht, isLoading } = useQuery({
    queryKey: ['edi-inkomend-voor-order', orderId],
    queryFn: () => fetchInkomendBerichtVoorOrder(orderId),
  })

  const gekozenDatum = verzendWeekStringToDatum(weekStr)
  const vergelijking = vergelijkLeverweek(gewenstIso, gekozenDatum)

  async function handleBevestig() {
    if (!bericht?.payload_parsed || !gekozenDatum) return
    setBusy(true)
    setError(null)
    try {
      // 1. Zet de bevestigde afleverdatum vast (operator-keuze).
      const { error: updErr } = await supabase
        .from('orders')
        .update({ afleverdatum: gekozenDatum })
        .eq('id', orderId)
      if (updErr) throw updErr

      // 2. Bevestig via EDI: zet edi_bevestigd_op + plaats orderbev op wachtrij.
      //    bevestigOrderViaEdi leest de zojuist-vastgezette afleverdatum (Task 6).
      await bevestigOrderViaEdi(
        orderId,
        bericht.id,
        bericht.payload_parsed as unknown as KarpiOrder,
        KARPI_GLN_DEFAULT,
        { isTest: bericht.is_test ?? false },
      )

      // 3. Verfris order-detail + overzicht + tellingen.
      qc.invalidateQueries({ queryKey: ['order', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['status-counts'] })
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2 font-medium text-amber-900">
        <CalendarClock size={18} />
        Leverweek bevestigen (EDI-order)
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-slate-500">Klant wenst</div>
          <div className="font-medium text-slate-800">
            {gewenstIso ? `${verzendWeekKort(gewenstIso)} · ${gewenstIso}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Haalbaar (voorraad/inkoop)</div>
          <div className="font-medium text-slate-800">
            {afleverdatumIso ? `${verzendWeekKort(afleverdatumIso)} · ${afleverdatumIso}` : '—'}
            <span className="ml-2 text-xs text-slate-500">status: {orderStatus}</span>
          </div>
        </div>
      </div>

      {vergelijking.relatie === 'later' && (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-100 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={14} />
          Gekozen week valt {vergelijking.weken} {vergelijking.weken === 1 ? 'week' : 'weken'} later
          dan de klantwens.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">Bevestig leverweek</span>
          <input
            type="week"
            value={weekStr}
            onChange={(e) => setWeekStr(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          onClick={handleBevestig}
          disabled={busy || isLoading || !bericht || !gekozenDatum}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-terracotta-500 px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-600 disabled:opacity-50"
          title="Zet de leverweek vast en verstuur de orderbevestiging. Hierna komt de order vrij voor picken/productie."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Bevestig leverweek + verstuur orderbev
        </button>

        {!isLoading && !bericht && (
          <span className="text-sm text-rose-600">
            Geen bron-EDI-bericht gevonden — bevestigen kan alleen via de EDI-module.
          </span>
        )}
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Haak het paneel in op order-detail**

In [`order-detail.tsx`](../../../frontend/src/pages/orders/order-detail.tsx):

1. Voeg de imports toe (bij de andere component-imports, regel 4-9):

```typescript
import { EdiLeverweekBevestigen } from '@/components/orders/edi-leverweek-bevestigen'
import { isLeverweekTeBevestigen } from '@/lib/orders/edi-leverweek'
```

2. Render het paneel direct ná `<OrderHeader ... />` (regel 67) en vóór `<OrderAddresses ... />`:

```typescript
      <OrderHeader order={order} locked={computeOrderLock(regels) === 'full'} />
      {isLeverweekTeBevestigen(order) && (
        <EdiLeverweekBevestigen
          orderId={order.id}
          gewenstIso={order.edi_gewenste_afleverdatum ?? null}
          afleverdatumIso={order.afleverdatum}
          orderStatus={order.status}
        />
      )}
      <OrderAddresses order={order} />
```

- [ ] **Step 5: Verifieer de query-key-conventies**

De `invalidateQueries`-keys (`['order', orderId]`, `['orders']`, `['status-counts']`) moeten matchen met de echte keys uit [`use-orders.ts`](../../../frontend/src/hooks/use-orders.ts). Lees dat bestand en corrigeer de keys in `edi-leverweek-bevestigen.tsx` indien ze afwijken (bv. `useOrderDetail` gebruikt mogelijk `['order-detail', id]`, `useStatusCounts` mogelijk `['order-status-counts']`).

Run: `cd frontend && grep -n "queryKey" src/hooks/use-orders.ts`
Pas de invalidate-keys aan tot ze exact overeenkomen.

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/components/orders/edi-leverweek-bevestigen.tsx src/pages/orders/order-detail.tsx`
Expected: geen errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/edi/queries/edi.ts frontend/src/modules/edi/index.ts frontend/src/components/orders/edi-leverweek-bevestigen.tsx frontend/src/pages/orders/order-detail.tsx
git commit -m "feat(edi): leverweek-bevestig-paneel op order-detail (gewenst vs haalbaar)"
```

---

### Task 8: Documentatie bijwerken

**Files:**
- Modify: `CLAUDE.md` (Bedrijfsregels-sectie)
- Modify: `docs/changelog.md`
- Modify: `docs/database-schema.md` (orders-kolommen)

- [ ] **Step 1: Voeg een bedrijfsregel toe aan CLAUDE.md**

In `CLAUDE.md`, in de Bedrijfsregels-lijst, ná de "EDI debiteur-GLN-alias"-bullet, voeg toe:

```markdown
- **EDI-leverweek als voorstel + bevestigingsstap (mig 309-310):** de door de partner meegestuurde leverdatum (header [44,52]) is een **klantwens**, geen toezegging. `create_edi_order` schrijft die naast `orders.afleverdatum` (initieel voorstel — allocator + mig 153 mogen vooruit schuiven) ook als snapshot in `orders.edi_gewenste_afleverdatum` (verandert nooit). Een EDI-order is **"te bevestigen"** zolang `edi_bevestigd_op IS NULL` (hergebruikt de mig 158-gate — **niet** `bevestigd_at` van mig 304, dat is de e-mail-orderbevestiging). Zolang onbevestigd is de order **geblokkeerd**: uit Pick & Ship (`fetchPickShipOrders`-filter) én uit de productie-intake (`snijplanning_overzicht` WHERE `NOT (bron_systeem='edi' AND edi_bevestigd_op IS NULL)`, mig 310, defense-in-depth net als de Geannuleerd-filter van mig 290). Een operator bevestigt op **order-detail** ([`EdiLeverweekBevestigen`](frontend/src/components/orders/edi-leverweek-bevestigen.tsx)): ziet gewenst vs. haalbaar, kiest de definitieve leverweek → zet `afleverdatum` vast + roept `bevestigOrderViaEdi` aan (zet `edi_bevestigd_op`, plaatst orderbev op de wachtrij). De orderbev draagt sinds de wijziging de **bevestigde** `afleverdatum`, niet de rauwe wens. Overzicht-chip **"Te bevestigen"** = `bron_systeem='edi' AND edi_bevestigd_op IS NULL` (status-overstijgend, `fetchOrders`/`fetchStatusCounts`). **Niet te verwarren** met **"Te koppelen"** (mig 306/307) = inkomend bericht zonder order (`edi_berichten.order_id IS NULL`). Pure helpers: [`edi-leverweek.ts`](frontend/src/lib/orders/edi-leverweek.ts) (`isLeverweekTeBevestigen`, `vergelijkLeverweek`).
```

- [ ] **Step 2: Voeg een changelog-entry toe**

Bovenaan de chronologische lijst in `docs/changelog.md`:

```markdown
## 2026-06-04 — EDI-leverweek als voorstel + bevestigingsstap (mig 309-310)
- **Probleem:** de door EDI-partners meegestuurde leverweek werd 1-op-1 in `orders.afleverdatum` gezet en de order stroomde direct door naar picken/productie — zonder toets op voorraad/inkoop.
- **Oplossing:** nieuwe kolom `orders.edi_gewenste_afleverdatum` (snapshot klantwens). EDI-orders zijn "te bevestigen" tot `edi_bevestigd_op` gezet is; zolang geblokkeerd uit Pick & Ship en `snijplanning_overzicht`. Operator bevestigt de definitieve leverweek op order-detail (paneel `EdiLeverweekBevestigen`), wat `afleverdatum` vastzet en de orderbev (met bevestigde datum) verstuurt. Nieuw overzicht-filter "Te bevestigen".
- **Raakvlak:** alleen EDI-orders; niet-EDI ongewijzigd. Gate hergebruikt mig 158 (`edi_bevestigd_op`), níet de mig 304 e-mail-bevestiging.
```

- [ ] **Step 3: Werk database-schema.md bij**

In `docs/database-schema.md`, bij de `orders`-tabel, voeg de kolom toe (in dezelfde stijl als de bestaande regels):

```markdown
| `edi_gewenste_afleverdatum` | DATE | EDI-only (mig 309): door de partner gewenste leverdatum (snapshot, verandert nooit). `afleverdatum` mag afwijken zodra de allocator/mig 153 een haalbare datum berekent of de operator bij bevestiging corrigeert. NULL voor niet-EDI. |
```

Controleer of `edi_bevestigd_op` (mig 158) al in het schema staat; zo niet, voeg ook die toe.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/changelog.md docs/database-schema.md
git commit -m "docs(edi): bedrijfsregel + changelog + schema voor leverweek-bevestiging (mig 309-310)"
```

---

## Eindverificatie (handmatig, na toepassen mig 309 + 310)

- [ ] **V1 — Nieuwe EDI-order is geblokkeerd:** poll/maak een test-EDI-order. Verifieer: verschijnt onder chip **"Te bevestigen"**, NIET in Pick & Ship, NIET in `snijplanning_overzicht`. `edi_gewenste_afleverdatum` = de EDI-wens; `edi_bevestigd_op IS NULL`.
- [ ] **V2 — Haalbaarheid zichtbaar:** open order-detail. Paneel toont "Klant wenst: wk X" en "Haalbaar: wk Y · status". Bij een order met IO-tekort schuift `afleverdatum` (mig 153) vooruit → Y > X en de amber-waarschuwing verschijnt.
- [ ] **V3 — Bevestigen werkt:** kies een leverweek, klik "Bevestig leverweek + verstuur orderbev". Verifieer: `afleverdatum` = gekozen vrijdag-datum van de week; `edi_bevestigd_op` gezet; een `orderbev`-rij staat op de uitgaande wachtrij met de **bevestigde** leverdatum; de order verdwijnt uit "Te bevestigen" en verschijnt (mits pickbaar) in Pick & Ship / snijplanning.
- [ ] **V4 — Geen regressie niet-EDI:** een handmatige order (`bron_systeem` NULL) verschijnt nooit onder "Te bevestigen", krijgt geen paneel, en blijft normaal pickbaar/planbaar.
- [ ] **V5 — Backfill correct:** reeds-verzonden EDI-orders staan NIET in "Te bevestigen" (backfill zette `edi_bevestigd_op`).
- [ ] **V6 — Volledige testsuite:** `cd frontend && npx vitest run && npx tsc -b --noEmit`.

## Open aandachtspunten voor de uitvoerder

- **`OrderHeaderRij`-stijl (Task 4 Step 4):** lees het bestaande type voordat je velden toevoegt; spiegel `string | null` vs. optioneel exact.
- **Barrel-export (Task 7 Step 2):** `KARPI_GLN_DEFAULT` en `bevestigOrderViaEdi` mogelijk al elders geëxporteerd — controleer vóór toevoegen om dubbele-export-fouten te vermijden.
- **Query-keys (Task 7 Step 5):** invalidate-keys MOETEN matchen met `use-orders.ts`; verifieer met grep.
- **EDI bericht-detail-knop blijft bestaan:** de bestaande "Bevestig + verstuur orderbev"-knop op [`bericht-detail.tsx`](../../../frontend/src/modules/edi/pages/bericht-detail.tsx) werkt ook nog en stuurt sinds Task 6 eveneens de actuele `afleverdatum`. De canonieke haalbaarheids-review gebeurt op order-detail; beide paden zetten dezelfde gate.
