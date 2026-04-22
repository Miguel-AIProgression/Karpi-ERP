# Facturatie-module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per klant automatisch facturen genereren + als PDF mailen (met algemene voorwaarden als bijlage) in twee modi: direct na verzending van de bestelling, of wekelijks als verzamelfactuur.

**Architecture:** Server-side PDF-generatie in een Deno Edge Function (`pdf-lib`), Resend voor email-verzending, DB-gestuurd (trigger op `orders.status = 'Verzonden'` plaatst job in een queue-tabel, Edge Functions pikken op). Wekelijkse verzamelfacturen worden via `pg_cron` getrokken. Factuur-PDF en algemene voorwaarden worden opgeslagen in Supabase Storage. Klant-voorkeur (`per_zending` | `wekelijks`) staat op `debiteuren.factuurvoorkeur`.

**Tech Stack:** PostgreSQL (migraties, triggers, pg_cron), Deno/TypeScript (Edge Functions), `pdf-lib` (via esm.sh) voor PDF-compositie, Resend REST API voor email, React + TanStack Query + shadcn/ui voor frontend.

---

## Context & Ontwerpkeuzes

**Waarom server-side PDF (niet client-side)?**
Bij wekelijkse verzamelfacturen draait alles op een schedule zonder actieve browser. PDF moet sowieso server-side gemaakt worden om als bijlage aan email te hangen. Client-side (jsPDF) toevoegen zou dezelfde layout twee keer maken.

**Waarom Resend?**
Eerste-klas Deno support, native attachment-ondersteuning, eenvoudige REST, acceptabel voor NL/EU bedrijf (DPA beschikbaar). Alternatieven (SendGrid, Postmark) vragen meer lijmwerk in Deno edge runtime.

**Waarom queue-tabel i.p.v. directe invocatie vanuit trigger?**
`pg_net` voor HTTP-calls vanuit triggers is fragiel (async, zwakke foutafhandeling). Queue-tabel + periodieke pg_cron-drain (elke minuut) is robuuster, makkelijker te debuggen, en herstart-veilig.

**Scope V1 (dit plan):**
- Alleen status-flow: `Concept` → `Verstuurd` → `Betaald`. Geen herinneringen, aanmaningen, credit-nota's.
- Zendingen-tabel bouwen we NIET in dit plan — trigger luistert naar `orders.status = 'Verzonden'`. Als later een `zendingen`-tabel komt kan de trigger migreren.
- `order_regels.gefactureerd` wordt bijgewerkt naar `orderaantal` bij facturatie; partiële facturatie is buiten scope.
- Herversturen / opnieuw genereren kan handmatig via knop op facturatiepagina (alleen als status = `Concept` of na expliciete bevestiging bij `Verstuurd`).

**Buiten scope:**
- SEPA-incasso / betalingsmatching
- Factuur-PDF's in andere talen dan NL (factuur + email-tekst zijn enkel NL)
- Elektronische facturen (UBL/Peppol)
- Credit-nota's
- Automatische BTW-afleiding uit land/btw_nummer (intracommunautair, export)

**Afspraken met Miguel (2026-04-22):**
- Resend-account: Miguel zet zelf op, levert API-key + from-adres aan vóór Task 9.
- Algemene voorwaarden: Engelstalige `karpvw.pdf` blijft de bijlage. Geen NL-versie.
- Factuur-email: alleen Nederlands (geen tri-lingual template zoals huidig voorbeeld).
- Vertegenwoordiger: `debiteuren.vertegenw_code → vertegenwoordigers.naam` (al zo in Task 9).
- BTW: niet hard-coded. Kolom `debiteuren.btw_percentage` NUMERIC(5,2) DEFAULT 21.00; buitenlandse afnemers (DE, EU intracom, export) krijgen handmatig 0% of ander tarief. Wijzigt Task 1, Task 3 (RPC), Task 13 (Facturering tab toont/bewerkt).

---

## File Structure

### Database migraties
- `supabase/migrations/117_facturatie_enums_tabellen.sql` — enums `factuur_status`, tabellen `facturen`, `factuur_regels`, kolom `debiteuren.factuurvoorkeur`
- `supabase/migrations/118_facturatie_queue_trigger.sql` — tabel `factuur_queue`, trigger op `orders` bij status-wissel naar `Verzonden`
- `supabase/migrations/119_factuur_genereer_rpc.sql` — SQL RPC `genereer_factuur(order_ids bigint[])` die factuur + regels insert
- `supabase/migrations/120_bedrijfsconfig_karpi_bv.sql` — seed Karpi BV in `app_config` onder sleutel `bedrijfsgegevens`
- `supabase/migrations/121_facturatie_queue_recovery.sql` — cleanup-functie voor stuck `processing`-items (>10 min terugzetten op `pending`)
- `supabase/migrations/122_facturatie_pg_cron.sql` — pg_cron voor queue-drain (elke minuut), recovery (elke 5 min), wekelijkse verzamelfactuur (maandag 05:00 UTC). Laatste migratie omdat hij afhangt van edge function deploy + RPC.

### Edge Functions
- `supabase/functions/factuur-verzenden/index.ts` — orchestrator: pakt queue-items, roept genereer_factuur RPC, bouwt PDF, mailt
- `supabase/functions/_shared/factuur-pdf.ts` — PDF-compositie (Karpi layout)
- `supabase/functions/_shared/factuur-pdf.test.ts` — unit tests voor PDF-helper (snapshot + basic assertions)
- `supabase/functions/_shared/resend-client.ts` — thin wrapper rond Resend API met attachment-support
- `supabase/functions/_shared/resend-client.test.ts` — unit tests (mock fetch)
- `supabase/functions/_shared/factuur-bedrag.ts` — pure functie: berekent regel-bedrag, subtotaal, BTW uit order_regels
- `supabase/functions/_shared/factuur-bedrag.test.ts` — unit tests (rekenlogica)

### Frontend — queries & hooks
- `frontend/src/lib/supabase/queries/facturen.ts` — list/detail/mutations voor facturen
- `frontend/src/lib/supabase/queries/bedrijfsconfig.ts` — fetch/update Karpi BV config
- `frontend/src/hooks/use-facturen.ts` — TanStack hooks

### Frontend — componenten & pagina's
- `frontend/src/components/klanten/klant-facturering-tab.tsx` — nieuwe tab in klant-detail
- `frontend/src/components/facturatie/factuur-status-badge.tsx` — statusbadge-variant
- `frontend/src/components/facturatie/factuur-lijst.tsx` — herbruikbare lijst (voor /facturatie én klant-detail)
- `frontend/src/pages/facturatie/facturatie-overview.tsx` — vervangt `PlaceholderPage`
- `frontend/src/pages/facturatie/factuur-detail.tsx` — detail met download-link + opnieuw versturen
- `frontend/src/pages/instellingen/bedrijfsgegevens.tsx` — nieuwe instellingenpagina

### Frontend — routing & bestaand
- **Modify** `frontend/src/router.tsx` — vervang `/facturatie` placeholder, voeg `/facturatie/:id` en `/instellingen/bedrijfsgegevens` toe
- **Modify** `frontend/src/pages/klanten/klant-detail.tsx` — voeg 'facturering' toe aan `Tab`-union + `TABS`-array + render

### Storage
- Bucket `facturen` (private, per-klant pad `{debiteur_nr}/FACT-YYYY-NNNN.pdf`)
- Bucket `documenten` (public-read, voor algemene voorwaarden) — alleen 1 bestand: `algemene-voorwaarden-karpi-bv.pdf`

### Docs
- **Modify** `docs/database-schema.md` — sectie facturen/factuur_regels/factuur_queue markeren als ✅ aanwezig i.p.v. planning
- **Modify** `docs/changelog.md` — 2026-04-22 entry
- **Modify** `docs/architectuur.md` — sectie "Facturatie-flow" toevoegen

---

## Environment / Secrets

**Supabase secrets (via `supabase secrets set`):**
- `RESEND_API_KEY` — Resend API sleutel (user levert aan)
- `FACTUUR_FROM_EMAIL` — bv. `verkoop@karpi.nl`
- `FACTUUR_REPLY_TO` — bv. `administratie@karpi.nl`
- `ALGEMENE_VOORWAARDEN_PATH` — pad in storage bucket `documenten`, default `algemene-voorwaarden-karpi-bv.pdf`

**Before starting Task 7:** bevestig met user dat deze secrets gezet zijn.

---

## Testing Strategy

- **Pure TypeScript helpers** (`factuur-bedrag.ts`, `factuur-pdf.ts`, `resend-client.ts`) krijgen Deno-native tests, draaibaar met `deno test supabase/functions/_shared/`.
- **DB-migraties** worden gevalideerd door (a) migratie toepassen, (b) smoke-SQL (`SELECT * FROM information_schema.columns WHERE ...`) uit te voeren, (c) handmatig een queue-item in de DB zetten en de edge function lokaal invoken (`supabase functions serve factuur-verzenden`).
- **Integratie**: één end-to-end test-scenario (een test-klant, test-order op status=`Verzonden` zetten, verifiëren dat factuur + PDF + email-log ontstaan). Resend heeft een test-mode (`delivered@resend.dev`); gebruik dat adres in dev.
- **Frontend**: type-check via `npm run build` + handmatige browser-check per pagina (zie CLAUDE.md regel "voor UI-taken: daadwerkelijk testen in browser").

---

## Task 1: Enums, facturen-tabellen, factuurvoorkeur-kolom

**Files:**
- Create: `supabase/migrations/117_facturatie_enums_tabellen.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 117: Facturatie — enums + tabellen + factuurvoorkeur
-- Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

CREATE TYPE factuur_status AS ENUM (
  'Concept', 'Verstuurd', 'Betaald', 'Herinnering', 'Aanmaning', 'Gecrediteerd'
);

CREATE TYPE factuurvoorkeur AS ENUM ('per_zending', 'wekelijks');

ALTER TABLE debiteuren
  ADD COLUMN factuurvoorkeur factuurvoorkeur NOT NULL DEFAULT 'per_zending',
  ADD COLUMN btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00
    CHECK (btw_percentage >= 0 AND btw_percentage <= 100);

COMMENT ON COLUMN debiteuren.factuurvoorkeur IS
  'Bepaalt of elke verzonden order direct gefactureerd wordt (per_zending) of '
  'als wekelijkse verzamelfactuur op maandag voor de week ervoor (wekelijks).';

COMMENT ON COLUMN debiteuren.btw_percentage IS
  'BTW-percentage dat op facturen wordt toegepast. Default 21.00 (NL binnenlands). '
  'Zet op 0.00 voor intracommunautaire leveringen (EU met geldig btw_nummer → verlegging) '
  'of export (niet-EU). V1: handmatige keuze per klant, geen auto-afleiding uit land.';

CREATE TABLE facturen (
  id BIGSERIAL PRIMARY KEY,
  factuur_nr TEXT UNIQUE NOT NULL,
  debiteur_nr INTEGER NOT NULL REFERENCES debiteuren(debiteur_nr),
  factuurdatum DATE NOT NULL DEFAULT CURRENT_DATE,
  vervaldatum DATE NOT NULL,
  status factuur_status NOT NULL DEFAULT 'Concept',
  subtotaal NUMERIC(12,2) NOT NULL DEFAULT 0,
  btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  btw_bedrag NUMERIC(12,2) NOT NULL DEFAULT 0,
  totaal NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Adres-snapshot (consistent met orders-patroon):
  fact_naam TEXT,
  fact_adres TEXT,
  fact_postcode TEXT,
  fact_plaats TEXT,
  fact_land TEXT,
  btw_nummer TEXT,
  opmerkingen TEXT,
  pdf_storage_path TEXT,
  verstuurd_op TIMESTAMPTZ,
  verstuurd_naar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_facturen_debiteur ON facturen(debiteur_nr, factuurdatum DESC);
CREATE INDEX idx_facturen_status ON facturen(status) WHERE status IN ('Concept', 'Verstuurd');

CREATE TABLE factuur_regels (
  id BIGSERIAL PRIMARY KEY,
  factuur_id BIGINT NOT NULL REFERENCES facturen(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  order_regel_id BIGINT NOT NULL REFERENCES order_regels(id),
  regelnummer INTEGER NOT NULL,
  artikelnr TEXT,
  omschrijving TEXT,
  omschrijving_2 TEXT,
  uw_referentie TEXT,          -- snapshot van order.uw_referentie
  order_nr TEXT,               -- snapshot van order.order_nr, voor "Ons Ordernummer"-regel
  aantal INTEGER NOT NULL,
  prijs NUMERIC(10,2) NOT NULL,
  korting_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  bedrag NUMERIC(12,2) NOT NULL,
  btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00
);

CREATE INDEX idx_factuur_regels_factuur ON factuur_regels(factuur_id);
CREATE UNIQUE INDEX idx_factuur_regels_order_regel ON factuur_regels(order_regel_id);
-- Hard-enforce: één order-regel wordt maximaal één keer gefactureerd.

-- Trigger: houd updated_at bij
CREATE OR REPLACE FUNCTION set_facturen_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_facturen_updated_at
  BEFORE UPDATE ON facturen
  FOR EACH ROW EXECUTE FUNCTION set_facturen_updated_at();
```

- [ ] **Step 2: Apply migratie via MCP of handmatig**

Aangezien de MCP geen toegang heeft tot het Karpi-project (zie `reference_karpi_supabase_mcp.md`): gebruiker moet dit handmatig runnen via Supabase SQL Editor. Vraag user: "Migratie 117 klaar — kun je 'm runnen in Supabase SQL Editor?" Wacht op bevestiging voordat je naar Step 3 gaat.

- [ ] **Step 3: Verifieer schema**

Vraag user deze query te draaien:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('facturen', 'factuur_regels')
ORDER BY table_name, ordinal_position;
```
Expected: alle kolommen uit Step 1 verschijnen.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/117_facturatie_enums_tabellen.sql
git commit -m "feat(facturatie): enums, facturen/factuur_regels tabellen, debiteuren.factuurvoorkeur kolom"
```

---

## Task 2: factuur_queue + trigger op orders

**Files:**
- Create: `supabase/migrations/118_facturatie_queue_trigger.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 118: Factuur-queue + order-trigger
-- Als orders.status overgaat naar 'Verzonden' EN klant.factuurvoorkeur = 'per_zending',
-- wordt een queue-entry aangemaakt. Een edge function (via pg_cron, migratie 119) pikt deze op.

CREATE TYPE factuur_queue_status AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE factuur_queue (
  id BIGSERIAL PRIMARY KEY,
  debiteur_nr INTEGER NOT NULL REFERENCES debiteuren(debiteur_nr),
  order_ids BIGINT[] NOT NULL,        -- meestal 1 order, bij 'wekelijks' meerdere
  type TEXT NOT NULL CHECK (type IN ('per_zending', 'wekelijks')),
  status factuur_queue_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  factuur_id BIGINT REFERENCES facturen(id),  -- gezet na succes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_factuur_queue_pending ON factuur_queue(created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION enqueue_factuur_bij_verzonden() RETURNS TRIGGER AS $$
DECLARE
  v_voorkeur factuurvoorkeur;
BEGIN
  -- Alleen reageren op transitie NAAR 'Verzonden'
  IF NEW.status <> 'Verzonden' OR OLD.status = 'Verzonden' THEN
    RETURN NEW;
  END IF;

  SELECT factuurvoorkeur INTO v_voorkeur
    FROM debiteuren WHERE debiteur_nr = NEW.debiteur_nr;

  -- 'wekelijks'-klanten worden door een cron-job opgepakt, niet hier.
  IF v_voorkeur = 'per_zending' THEN
    INSERT INTO factuur_queue (debiteur_nr, order_ids, type)
    VALUES (NEW.debiteur_nr, ARRAY[NEW.id], 'per_zending');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_factuur
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_factuur_bij_verzonden();
```

- [ ] **Step 2: Apply migratie** — vraag user te runnen in SQL Editor.

- [ ] **Step 3: Verifieer trigger**

Vraag user:
```sql
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname = 'trg_enqueue_factuur';
-- Expected: 1 rij.
```

- [ ] **Step 4: Smoke test (nog geen edge function; check alleen dat queue gevuld wordt)**

Vraag user een test-klant+order op `per_zending` te zetten en status naar `Verzonden` te wijzigen. Dan:
```sql
SELECT * FROM factuur_queue ORDER BY id DESC LIMIT 1;
-- Expected: pending rij met order_ids = [die order].
```
**Rol terug na test** om de DB schoon te houden: `DELETE FROM factuur_queue WHERE status = 'pending'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/118_facturatie_queue_trigger.sql
git commit -m "feat(facturatie): factuur_queue tabel + trigger op orders.status=Verzonden"
```

---

## Task 3: RPC genereer_factuur

**Files:**
- Create: `supabase/migrations/119_factuur_genereer_rpc.sql`

Deze RPC wordt aangeroepen door de edge function. Hij doet atomair: `volgend_nummer('FACT')`, factuur-header, factuur-regels voor alle meegegeven order_ids, totalen berekenen, `order_regels.gefactureerd = orderaantal` zetten. Alle in één transactie zodat bij falen niets gedeeltelijk blijft staan.

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 119: RPC genereer_factuur
-- Atomair: maakt factuur + regels aan voor gegeven order_ids. Vereist dat alle orders
-- dezelfde debiteur hebben. Retourneert factuur_id.
-- Gebruik: edge function factuur-verzenden + wekelijkse cron roepen deze aan.

CREATE OR REPLACE FUNCTION genereer_factuur(p_order_ids BIGINT[])
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_subtotaal NUMERIC(12,2);
  v_btw_pct NUMERIC(5,2);  -- gelezen uit debiteuren.btw_percentage (default 21.00)
  v_btw_bedrag NUMERIC(12,2);
  v_totaal NUMERIC(12,2);
  v_betaaltermijn_dagen INTEGER := 30;  -- default, overschreven door debiteuren.betaalconditie indien numeriek
BEGIN
  IF array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids mag niet leeg zijn';
  END IF;

  -- Verifieer: één debiteur voor alle orders
  SELECT DISTINCT debiteur_nr INTO v_debiteur_nr
    FROM orders WHERE id = ANY(p_order_ids);
  IF v_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'Geen orders gevonden voor ids %', p_order_ids;
  END IF;
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(p_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Orders behoren niet tot dezelfde debiteur';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  -- BTW-percentage uit klantprofiel (21% NL, 0% EU-intracom/export, enz.)
  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);

  -- Probeer betaaltermijn uit betaalconditie te halen (bv. "30 dagen" → 30)
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Factuur-regels: kopieer alle order_regels waarvoor nog niet gefactureerd
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.uw_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(p_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
  ORDER BY orr.order_id, orr.regelnummer;

  -- Markeer order_regels als gefactureerd
  UPDATE order_regels
    SET gefactureerd = orderaantal
  WHERE order_id = ANY(p_order_ids);

  -- Totalen berekenen + schrijven
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
    SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
  WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur IS
  'Atomair: maakt factuur + regels aan voor een of meerdere order_ids van dezelfde debiteur. '
  'Markeert order_regels.gefactureerd = orderaantal. Retourneert factuur_id. '
  'Geen PDF/email — dat doet edge function factuur-verzenden.';
```

- [ ] **Step 2: Apply migratie** — user runt in SQL Editor.

- [ ] **Step 3: Smoke test**

Gebruik een test-order met bekende totaal:
```sql
SELECT genereer_factuur(ARRAY[<test_order_id>]);
SELECT * FROM facturen WHERE id = <returned>;
SELECT * FROM factuur_regels WHERE factuur_id = <returned>;
-- Expected: subtotaal + btw + totaal kloppen; alle order_regels gekopieerd.
```

- [ ] **Step 4: Rollback test-factuur**

```sql
DELETE FROM facturen WHERE id = <returned>;
UPDATE order_regels SET gefactureerd = 0 WHERE order_id = <test_order_id>;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/119_factuur_genereer_rpc.sql
git commit -m "feat(facturatie): RPC genereer_factuur voor atomaire factuur-creatie"
```

---

## Task 4: Bedrijfsgegevens Karpi BV in app_config

**Files:**
- Create: `supabase/migrations/120_bedrijfsconfig_karpi_bv.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 120: Seed Karpi BV bedrijfsgegevens in app_config
-- Later aanpasbaar via frontend pagina Instellingen > Bedrijfsgegevens.

INSERT INTO app_config (sleutel, waarde) VALUES (
  'bedrijfsgegevens',
  '{
    "bedrijfsnaam": "KARPI BV",
    "adres": "Tweede Broekdijk 10",
    "postcode": "7122 LB",
    "plaats": "Aalten",
    "land": "Nederland",
    "telefoon": "+31 (0)543-476116",
    "fax": "+31 (0)543-476015",
    "email": "info@karpi.nl",
    "website": "www.karpi.nl",
    "kvk": "09060322",
    "btw_nummer": "NL008543446B01",
    "iban": "NL37INGB0689412401",
    "bic": "INGBNL2A",
    "bank": "ING Bank",
    "rekeningnummer": "689412401",
    "betalingscondities_tekst": "30 dagen netto"
  }'::jsonb
)
ON CONFLICT (sleutel) DO NOTHING;
```

- [ ] **Step 2: Apply + verifieer**

```sql
SELECT waarde FROM app_config WHERE sleutel = 'bedrijfsgegevens';
-- Expected: object met alle velden.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/120_bedrijfsconfig_karpi_bv.sql
git commit -m "feat(facturatie): seed Karpi BV bedrijfsgegevens in app_config"
```

---

## Task 5: Upload algemene voorwaarden + maak storage bucket

**Files:**
- Noop in code — alleen storage-setup via Supabase dashboard

- [ ] **Step 1: Vraag user buckets te maken**

Instructie aan user:
1. Supabase dashboard → Storage → New bucket
2. Naam: `documenten`, public: **ja** (read-only via URL)
3. Naam: `facturen`, public: **nee** (alleen via signed URL)

- [ ] **Step 2: Vraag user algemene voorwaarden te uploaden**

User moet `karpvw.pdf` (uit de bijlage bij dit ticket) uploaden naar bucket `documenten/` onder naam `algemene-voorwaarden-karpi-bv.pdf`.

- [ ] **Step 3: Verifieer publieke URL**

User runt in browser:
`https://<project>.supabase.co/storage/v1/object/public/documenten/algemene-voorwaarden-karpi-bv.pdf`
Expected: PDF downloadt / opent in browser.

**Geen commit** — dit is alleen storage-config.

---

## Task 6: Pure helper `factuur-bedrag.ts` (TDD)

**Files:**
- Create: `supabase/functions/_shared/factuur-bedrag.test.ts`
- Create: `supabase/functions/_shared/factuur-bedrag.ts`

Deze module heeft GEEN DB-afhankelijkheden — het is puur rekenen op al opgehaalde factuur-regels. Dit houdt de edge function slank en testbaar.

- [ ] **Step 1: Schrijf failing test**

```typescript
// supabase/functions/_shared/factuur-bedrag.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { berekenFactuurTotalen } from './factuur-bedrag.ts'

Deno.test('berekenFactuurTotalen: enkele regel', () => {
  const result = berekenFactuurTotalen(
    [{ bedrag: 100 }],
    21,
  )
  assertEquals(result.subtotaal, 100)
  assertEquals(result.btw_bedrag, 21)
  assertEquals(result.totaal, 121)
})

Deno.test('berekenFactuurTotalen: meerdere regels, centen-afronding', () => {
  const result = berekenFactuurTotalen(
    [{ bedrag: 33.33 }, { bedrag: 66.67 }, { bedrag: 10.01 }],
    21,
  )
  assertEquals(result.subtotaal, 110.01)
  assertEquals(result.btw_bedrag, 23.10)   // 110.01 * 0.21 = 23.1021 → round 23.10
  assertEquals(result.totaal, 133.11)
})

Deno.test('berekenFactuurTotalen: lege input → nullen', () => {
  const result = berekenFactuurTotalen([], 21)
  assertEquals(result.subtotaal, 0)
  assertEquals(result.btw_bedrag, 0)
  assertEquals(result.totaal, 0)
})
```

- [ ] **Step 2: Run test → moet falen**

```bash
deno test supabase/functions/_shared/factuur-bedrag.test.ts
```
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Minimale implementatie**

```typescript
// supabase/functions/_shared/factuur-bedrag.ts
export interface FactuurRegelBedrag {
  bedrag: number
}

export interface FactuurTotalen {
  subtotaal: number
  btw_bedrag: number
  totaal: number
}

export function berekenFactuurTotalen(
  regels: FactuurRegelBedrag[],
  btw_percentage: number,
): FactuurTotalen {
  const subtotaal = round2(regels.reduce((sum, r) => sum + r.bedrag, 0))
  const btw_bedrag = round2(subtotaal * btw_percentage / 100)
  const totaal = round2(subtotaal + btw_bedrag)
  return { subtotaal, btw_bedrag, totaal }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run test → moet slagen**

```bash
deno test supabase/functions/_shared/factuur-bedrag.test.ts
```
Expected: PASS (3 ok).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/factuur-bedrag.ts supabase/functions/_shared/factuur-bedrag.test.ts
git commit -m "feat(facturatie): pure helper berekenFactuurTotalen + tests"
```

---

## Task 7: Resend email-client wrapper (TDD)

**Files:**
- Create: `supabase/functions/_shared/resend-client.test.ts`
- Create: `supabase/functions/_shared/resend-client.ts`

- [ ] **Step 1: Schrijf failing test**

```typescript
// supabase/functions/_shared/resend-client.test.ts
import { assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { sendFactuurEmail, type ResendSendInput } from './resend-client.ts'

function mockFetch(response: { status: number; body: unknown }) {
  return async (_url: string | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response
  }
}

Deno.test('sendFactuurEmail: success → returnt resend id', async () => {
  const input: ResendSendInput = {
    apiKey: 'test-key',
    from: 'verkoop@karpi.nl',
    to: 'klant@example.nl',
    replyTo: 'administratie@karpi.nl',
    subject: 'Factuur FACT-2026-0001',
    html: '<p>Bijgaand uw factuur.</p>',
    attachments: [
      { filename: 'FACT-2026-0001.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
      { filename: 'algemene-voorwaarden.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    ],
  }
  const fetchMock = mockFetch({ status: 200, body: { id: 'abc-123' } })
  const result = await sendFactuurEmail(input, fetchMock)
  assertEquals(result.id, 'abc-123')
})

Deno.test('sendFactuurEmail: HTTP-fout → gooit met nuttige message', async () => {
  const fetchMock = mockFetch({ status: 422, body: { message: 'Invalid from address' } })
  await assertRejects(
    () => sendFactuurEmail({
      apiKey: 'k', from: 'x', to: 'y', subject: 's', html: '', attachments: [],
    }, fetchMock),
    Error,
    'Invalid from address',
  )
})
```

- [ ] **Step 2: Run → moet falen**
```bash
deno test supabase/functions/_shared/resend-client.test.ts
```

- [ ] **Step 3: Implementeer**

```typescript
// supabase/functions/_shared/resend-client.ts
// Dunne wrapper rond Resend API. `fetch` injecteerbaar voor tests.

export interface ResendAttachment {
  filename: string
  content: Uint8Array
}

export interface ResendSendInput {
  apiKey: string
  from: string
  to: string
  replyTo?: string
  subject: string
  html: string
  attachments: ResendAttachment[]
}

export interface ResendSendResult {
  id: string
}

type FetchFn = typeof fetch

export async function sendFactuurEmail(
  input: ResendSendInput,
  fetchImpl: FetchFn = fetch,
): Promise<ResendSendResult> {
  const body = {
    from: input.from,
    to: [input.to],
    reply_to: input.replyTo,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: base64Encode(a.content),
    })),
  }

  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { message?: string }).message ?? `Resend error ${res.status}`
    throw new Error(msg)
  }
  return { id: (json as { id: string }).id }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
```

- [ ] **Step 4: Run → moet slagen**
```bash
deno test supabase/functions/_shared/resend-client.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/resend-client.ts supabase/functions/_shared/resend-client.test.ts
git commit -m "feat(facturatie): Resend API wrapper met attachment-support + tests"
```

---

## Task 8: Factuur-PDF generator

**Files:**
- Create: `supabase/functions/_shared/factuur-pdf.test.ts`
- Create: `supabase/functions/_shared/factuur-pdf.ts`

PDF-layout volgens voorbeeld `fc26039757.pdf`:
- Header rechts: Karpi BV contact + adres
- "FACTUUR" links + "GROUP" rechts, horizontale lijn
- Klant-blok links (fact_naam, fact_adres, postcode plaats)
- Info-blok rechts: debiteurnummer, factuurnummer, factuurdatum, vertegenwoordiger
- Tabel header: Artikel | Aantal | Eh | Omschrijving | Prijs | Bedrag
- Per factuur-regel: groep "Ons Ordernummer: {order_nr}" + "Uw Referentie: {uw_referentie}", dan regels
- Paginatie: bij overflow "TRANSPORTEREN BLAD {subtotaal}" onderaan, "TRANSPORT BLAD {subtotaal}" bovenaan volgende pagina
- Voettekst laatste pagina: totaal m², totaal gewicht (optioneel, kan NULL); BTW-tabel; "Betalingscond.: {condities_tekst}"
- Footer alle pagina's: KvK, BTW, bank, IBAN, BIC (uit bedrijfsgegevens)

- [ ] **Step 1: Schrijf failing test (basic smoke + structurele asserties)**

```typescript
// supabase/functions/_shared/factuur-pdf.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { genereerFactuurPDF, type FactuurPDFInput } from './factuur-pdf.ts'

const MINIMAL_INPUT: FactuurPDFInput = {
  bedrijf: {
    bedrijfsnaam: 'KARPI BV',
    adres: 'Tweede Broekdijk 10',
    postcode: '7122 LB',
    plaats: 'Aalten',
    land: 'Nederland',
    telefoon: '+31 (0)543-476116',
    email: 'info@karpi.nl',
    website: 'www.karpi.nl',
    kvk: '09060322',
    btw_nummer: 'NL008543446B01',
    iban: 'NL37INGB0689412401',
    bic: 'INGBNL2A',
    bank: 'ING Bank',
    rekeningnummer: '689412401',
    betalingscondities_tekst: '30 dagen netto',
  },
  factuur: {
    factuur_nr: 'FACT-2026-0001',
    factuurdatum: '2026-04-22',
    debiteur_nr: 260000,
    vertegenwoordiger: 'Niet van Toepassing',
    fact_naam: 'FLOORPASSION',
    fact_adres: 'BILTSTRAAT 35G',
    fact_postcode: '3572 AC',
    fact_plaats: 'UTRECHT',
    subtotaal: 100,
    btw_percentage: 21,
    btw_bedrag: 21,
    totaal: 121,
  },
  regels: [
    {
      order_nr: 'ORD-2026-0001',
      uw_referentie: 'FPNL000001',
      artikelnr: 'BANG21MAATWERK',
      aantal: 1,
      eenheid: 'St',
      omschrijving: 'BANG21XX230260',
      omschrijving_2: 'BANGKOK KLEUR 21 ca: 230x260 cm',
      prijs: 100,
      bedrag: 100,
    },
  ],
}

Deno.test('genereerFactuurPDF: produceert geldige PDF (magic bytes)', async () => {
  const bytes = await genereerFactuurPDF(MINIMAL_INPUT)
  // PDF-magic: %PDF
  assertEquals(bytes[0], 0x25)
  assertEquals(bytes[1], 0x50)
  assertEquals(bytes[2], 0x44)
  assertEquals(bytes[3], 0x46)
  assert(bytes.length > 500, 'PDF te klein — waarschijnlijk leeg')
})

Deno.test('genereerFactuurPDF: handelt 50 regels af (paginering)', async () => {
  const veelRegels = Array.from({ length: 50 }, (_, i) => ({
    order_nr: `ORD-2026-${String(i).padStart(4, '0')}`,
    uw_referentie: `REF${i}`,
    artikelnr: 'X',
    aantal: 1,
    eenheid: 'St',
    omschrijving: `Regel ${i}`,
    prijs: 10,
    bedrag: 10,
  }))
  const bytes = await genereerFactuurPDF({ ...MINIMAL_INPUT, regels: veelRegels })
  assert(bytes.length > 1000)
})
```

- [ ] **Step 2: Run → moet falen**
```bash
deno test supabase/functions/_shared/factuur-pdf.test.ts
```

- [ ] **Step 3: Implementeer met `pdf-lib`**

Volledige implementatie: zie `pdf-lib` docs (`https://esm.sh/pdf-lib@1.17.1`). Belangrijkste structuur:

```typescript
// supabase/functions/_shared/factuur-pdf.ts
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'https://esm.sh/pdf-lib@1.17.1'

export interface BedrijfsInfo {
  bedrijfsnaam: string; adres: string; postcode: string; plaats: string; land: string
  telefoon: string; email: string; website: string
  kvk: string; btw_nummer: string; iban: string; bic: string; bank: string
  rekeningnummer: string; betalingscondities_tekst: string
}

export interface FactuurHeader {
  factuur_nr: string; factuurdatum: string; debiteur_nr: number
  vertegenwoordiger: string
  fact_naam: string; fact_adres: string; fact_postcode: string; fact_plaats: string
  subtotaal: number; btw_percentage: number; btw_bedrag: number; totaal: number
}

export interface FactuurPDFRegel {
  order_nr: string; uw_referentie: string
  artikelnr: string; aantal: number; eenheid: string
  omschrijving: string; omschrijving_2?: string
  prijs: number; bedrag: number
}

export interface FactuurPDFInput {
  bedrijf: BedrijfsInfo
  factuur: FactuurHeader
  regels: FactuurPDFRegel[]
}

const MM = 2.8346457  // punten per mm
const PAGE_WIDTH = 210 * MM
const PAGE_HEIGHT = 297 * MM
const MARGIN_L = 20 * MM
const MARGIN_R = 20 * MM
const MARGIN_T = 20 * MM
const MARGIN_B = 25 * MM
const LINE_H = 4 * MM
const COL_ARTIKEL = MARGIN_L
const COL_AANTAL = MARGIN_L + 45 * MM
const COL_EH = MARGIN_L + 60 * MM
const COL_OMSCHR = MARGIN_L + 70 * MM
const COL_PRIJS = PAGE_WIDTH - MARGIN_R - 40 * MM
const COL_BEDRAG = PAGE_WIDTH - MARGIN_R - 10 * MM  // right-aligned

export async function genereerFactuurPDF(input: FactuurPDFInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Courier)
  const fontBold = await pdf.embedFont(StandardFonts.CourierBold)

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let cursorY = PAGE_HEIGHT - MARGIN_T
  let paginaTotaal = 0
  let paginaNr = 1

  // --- Header (kop + klantblok) ---
  drawHeader(page, font, fontBold, input)
  cursorY = PAGE_HEIGHT - MARGIN_T - 60 * MM  // onder header-blok

  // --- Tabel-header ---
  drawTableHeader(page, font, fontBold, cursorY)
  cursorY -= LINE_H * 2

  // --- Regels per order ---
  for (const groep of groepeerPerOrder(input.regels)) {
    // Check pagina-overflow
    const benodigdeRuimte = (groep.regels.length + 2) * LINE_H
    if (cursorY - benodigdeRuimte < MARGIN_B + 15 * MM) {
      drawTransporteren(page, font, cursorY, paginaTotaal)
      drawFooter(page, font, input.bedrijf, paginaNr)
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      paginaNr++
      drawHeader(page, font, fontBold, input)
      cursorY = PAGE_HEIGHT - MARGIN_T - 60 * MM
      drawTableHeader(page, font, fontBold, cursorY)
      cursorY -= LINE_H * 2
      drawTransport(page, font, cursorY, paginaTotaal)
      cursorY -= LINE_H * 2
    }

    drawOrderKop(page, font, cursorY, groep.order_nr, groep.uw_referentie)
    cursorY -= LINE_H * 2
    for (const r of groep.regels) {
      drawRegel(page, font, cursorY, r)
      cursorY -= LINE_H
      if (r.omschrijving_2) {
        drawRegelOmschrijving2(page, font, cursorY, r.omschrijving_2)
        cursorY -= LINE_H
      }
      paginaTotaal += r.bedrag
    }
    cursorY -= LINE_H
  }

  // --- Laatste pagina: BTW-blok + betaling ---
  drawBtwBlok(page, font, fontBold, cursorY, input.factuur, input.bedrijf)
  drawFooter(page, font, input.bedrijf, paginaNr)

  return await pdf.save()
}

// Stubs — implementatie-details:
function drawHeader(_p: PDFPage, _f: PDFFont, _fb: PDFFont, _i: FactuurPDFInput) { /* ... */ }
function drawTableHeader(_p: PDFPage, _f: PDFFont, _fb: PDFFont, _y: number) { /* ... */ }
function drawOrderKop(_p: PDFPage, _f: PDFFont, _y: number, _o: string, _r: string) { /* ... */ }
function drawRegel(_p: PDFPage, _f: PDFFont, _y: number, _r: FactuurPDFRegel) { /* ... */ }
function drawRegelOmschrijving2(_p: PDFPage, _f: PDFFont, _y: number, _t: string) { /* ... */ }
function drawTransporteren(_p: PDFPage, _f: PDFFont, _y: number, _s: number) { /* ... */ }
function drawTransport(_p: PDFPage, _f: PDFFont, _y: number, _s: number) { /* ... */ }
function drawBtwBlok(_p: PDFPage, _f: PDFFont, _fb: PDFFont, _y: number, _fh: FactuurHeader, _b: BedrijfsInfo) { /* ... */ }
function drawFooter(_p: PDFPage, _f: PDFFont, _b: BedrijfsInfo, _nr: number) { /* ... */ }

interface OrderGroep { order_nr: string; uw_referentie: string; regels: FactuurPDFRegel[] }
function groepeerPerOrder(regels: FactuurPDFRegel[]): OrderGroep[] {
  const byOrder = new Map<string, OrderGroep>()
  for (const r of regels) {
    const key = r.order_nr
    if (!byOrder.has(key)) byOrder.set(key, { order_nr: r.order_nr, uw_referentie: r.uw_referentie, regels: [] })
    byOrder.get(key)!.regels.push(r)
  }
  return [...byOrder.values()]
}
```

**Note aan implementer:** de `drawXxx` stubs moet je volledig uitwerken — dit is het grootste stuk werk in dit plan. Gebruik `page.drawText(text, { x, y, size: 9, font })`, `page.drawLine(...)`, `page.drawRectangle(...)`. Referentie: https://pdf-lib.js.org/docs/api/. Koerier-font is bewust (monospace, matcht origineel).

**Layout-cheatsheet (gebaseerd op fc26039757.pdf, A4 staand):**
- Header (rechts): `KARPI BV` uppercase bold ~14pt op y=PAGE_HEIGHT-15mm; daaronder adres/telefoon 8pt vanaf x=PAGE_WIDTH-60mm tot marge.
- Woord "FACTUUR" links op y=PAGE_HEIGHT-30mm, 12pt bold. "GROUP" rechts op dezelfde regel.
- Horizontale lijn op y=PAGE_HEIGHT-35mm over volle breedte.
- Klantblok (fact_naam etc.) links vanaf y=PAGE_HEIGHT-50mm, 10pt, interlinie 4mm.
- Info-blok rechts (debiteurnummer/factuurnummer/factuurdatum/vertegenwoordiger) vanaf x=PAGE_WIDTH-90mm, y=PAGE_HEIGHT-55mm, label-kolom en waarde-kolom gescheiden door ":".
- Tabel-kolombreedte: Artikel 45mm, Aantal 10mm, Eh 8mm, Omschrijving flex, Prijs 20mm rechts-uitgelijnd, Bedrag 20mm rechts-uitgelijnd.
- Regel-hoogte 4mm. Groep-kop ("Ons Ordernummer: ... / Uw Referentie: ...") 2 regels + 1mm extra wit boven.
- "TRANSPORTEREN BLAD" onderaan (rechts-uitgelijnd, 10pt) boven de footer-lijn op y=MARGIN_B+15mm; "TRANSPORT BLAD" idem bovenaan volgende pagina direct onder tabel-header.
- Footer (alle pagina's): twee lijnen met `k.v.k. | btw | ING Bank | nr | BIC | IBAN` en daaronder `Commerzbank AG Bocholt | Konto | Blz | BIC | IBAN`, 7pt, gecentreerd.
- BTW-tabel eind: 3 kolommen `Grondsl. | BTW % | BTWbedrag` en rechts `Te Betalen`. Horizontale lijnen boven en onder headers. Waardes in 10pt, headers in 9pt bold.

Exacte pixel-matching met `fc26039757.pdf` is NIET nodig — "herkenbaar als Karpi-factuur met leesbare layout en werkende paginering bij 50+ regels" is het acceptatie-criterium.

- [ ] **Step 4: Run → moet slagen**
```bash
deno test supabase/functions/_shared/factuur-pdf.test.ts
```

- [ ] **Step 5: Visuele smoke check**

Schrijf een eenmalige script `supabase/functions/_shared/factuur-pdf.preview.ts`:
```typescript
import { genereerFactuurPDF } from './factuur-pdf.ts'
const bytes = await genereerFactuurPDF({ /* sample input */ })
await Deno.writeFile('/tmp/factuur-preview.pdf', bytes)
```
Run: `deno run --allow-write supabase/functions/_shared/factuur-pdf.preview.ts`, open `/tmp/factuur-preview.pdf`, vergelijk visueel met `fc26039757.pdf`. Doel: klant moet zien dat het dezelfde bedoeling heeft (niet pixel-perfect).

**Commit-ready criterium:** layout is herkenbaar als Karpi-factuur, geen onleesbare overlaps, paginering werkt bij 50+ regels.

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/_shared/factuur-pdf.ts supabase/functions/_shared/factuur-pdf.test.ts
git commit -m "feat(facturatie): PDF-generator met Karpi-layout (pdf-lib) + tests"
```

---

## Task 9: Edge function `factuur-verzenden`

**Files:**
- Create: `supabase/functions/factuur-verzenden/index.ts`

Deze function drainst de queue: pakt tot N `pending` items, per item: markeert `processing`, roept `genereer_factuur`, haalt factuur-data + bedrijfsconfig + algemene voorwaarden op, bouwt PDF, uploadt naar `facturen` bucket, verstuurt email, markeert `done`. Bij fout: increment attempts, markeer `failed` bij ≥3 pogingen.

- [ ] **Step 1: Schrijf function**

```typescript
// supabase/functions/factuur-verzenden/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/resend-client.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FACTUUR_FROM = Deno.env.get('FACTUUR_FROM_EMAIL')!
const FACTUUR_REPLY_TO = Deno.env.get('FACTUUR_REPLY_TO') ?? FACTUUR_FROM
const AV_PATH = Deno.env.get('ALGEMENE_VOORWAARDEN_PATH') ?? 'algemene-voorwaarden-karpi-bv.pdf'
const MAX_BATCH = 10
const MAX_ATTEMPTS = 3

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  const { data: items } = await supabase
    .from('factuur_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at')
    .limit(MAX_BATCH)

  const results: Array<{ id: number; status: string; error?: string }> = []

  for (const item of items ?? []) {
    try {
      await supabase.from('factuur_queue').update({ status: 'processing' }).eq('id', item.id)

      // 1. Genereer factuur via RPC
      const { data: factuurId, error: rpcErr } = await supabase.rpc('genereer_factuur', {
        p_order_ids: item.order_ids,
      })
      if (rpcErr) throw new Error(`RPC genereer_factuur: ${rpcErr.message}`)

      // 2. Haal factuur + regels + bedrijfsconfig + debiteur-email op
      const { data: factuur } = await supabase
        .from('facturen').select('*').eq('id', factuurId).single()
      const { data: regels } = await supabase
        .from('factuur_regels').select('*').eq('factuur_id', factuurId).order('regelnummer')
      const { data: bedrijf } = await supabase
        .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single()
      const { data: debiteur } = await supabase
        .from('debiteuren').select('email_factuur, naam, vertegenw_code')
        .eq('debiteur_nr', item.debiteur_nr).single()
      const { data: vert } = debiteur?.vertegenw_code
        ? await supabase.from('vertegenwoordigers').select('naam').eq('code', debiteur.vertegenw_code).single()
        : { data: null }

      if (!debiteur?.email_factuur) {
        throw new Error(`Debiteur ${item.debiteur_nr} heeft geen email_factuur`)
      }

      // 3. Bouw PDF
      const pdfBytes = await genereerFactuurPDF({
        bedrijf: bedrijf!.waarde,
        factuur: {
          factuur_nr: factuur!.factuur_nr,
          factuurdatum: factuur!.factuurdatum,
          debiteur_nr: factuur!.debiteur_nr,
          vertegenwoordiger: vert?.naam ?? 'Niet van Toepassing',
          fact_naam: factuur!.fact_naam,
          fact_adres: factuur!.fact_adres,
          fact_postcode: factuur!.fact_postcode,
          fact_plaats: factuur!.fact_plaats,
          subtotaal: Number(factuur!.subtotaal),
          btw_percentage: Number(factuur!.btw_percentage),
          btw_bedrag: Number(factuur!.btw_bedrag),
          totaal: Number(factuur!.totaal),
        },
        regels: (regels ?? []).map((r) => ({
          order_nr: r.order_nr,
          uw_referentie: r.uw_referentie ?? '',
          artikelnr: r.artikelnr ?? '',
          aantal: r.aantal,
          eenheid: 'St',
          omschrijving: r.omschrijving ?? '',
          omschrijving_2: r.omschrijving_2 ?? undefined,
          prijs: Number(r.prijs),
          bedrag: Number(r.bedrag),
        })),
      })

      // 4. Upload PDF naar storage
      const pdfPath = `${item.debiteur_nr}/${factuur!.factuur_nr}.pdf`
      await supabase.storage.from('facturen').upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf', upsert: true,
      })

      // 5. Download algemene voorwaarden
      const { data: avBlob } = await supabase.storage.from('documenten').download(AV_PATH)
      const avBytes = new Uint8Array(await avBlob!.arrayBuffer())

      // 6. Verstuur email
      const emailResult = await sendFactuurEmail({
        apiKey: RESEND_API_KEY,
        from: FACTUUR_FROM,
        to: debiteur.email_factuur,
        replyTo: FACTUUR_REPLY_TO,
        subject: `Factuur ${factuur!.factuur_nr}`,
        html: `<p>Geachte heer/mevrouw,</p><p>Hierbij ontvangt u bijgaand factuur <strong>${factuur!.factuur_nr}</strong>.</p><p>Onze algemene voorwaarden vindt u als bijlage.</p><p>Met vriendelijke groet,<br/>KARPI BV</p>`,
        attachments: [
          { filename: `${factuur!.factuur_nr}.pdf`, content: pdfBytes },
          { filename: 'Algemene voorwaarden KARPI BV.pdf', content: avBytes },
        ],
      })

      // 7. Update factuur + queue
      await supabase.from('facturen').update({
        status: 'Verstuurd',
        verstuurd_op: new Date().toISOString(),
        verstuurd_naar: debiteur.email_factuur,
        pdf_storage_path: pdfPath,
      }).eq('id', factuurId)

      await supabase.from('factuur_queue').update({
        status: 'done',
        factuur_id: factuurId,
        processed_at: new Date().toISOString(),
      }).eq('id', item.id)

      results.push({ id: item.id, status: 'done' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const nextAttempts = item.attempts + 1
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await supabase.from('factuur_queue').update({
        status: nextStatus,
        attempts: nextAttempts,
        last_error: msg,
      }).eq('id', item.id)
      results.push({ id: item.id, status: nextStatus, error: msg })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { 'content-type': 'application/json' },
  })
})
```

- [ ] **Step 2: Deploy naar Supabase**

User runt:
```bash
supabase functions deploy factuur-verzenden
supabase secrets set RESEND_API_KEY=re_xxx FACTUUR_FROM_EMAIL=verkoop@karpi.nl FACTUUR_REPLY_TO=administratie@karpi.nl
```

- [ ] **Step 3: Manueel invoken met 1 pending queue-item**

Zet een test-klant op `factuurvoorkeur = 'per_zending'`, test-order met geldige regels. Zet order.status → 'Verzonden' (dit vult de queue). Dan:
```bash
curl -X POST https://<project>.supabase.co/functions/v1/factuur-verzenden -H "Authorization: Bearer <anon-or-service>"
```
Verwacht: response met `processed: 1, results: [{ status: 'done' }]`. Check dat email aankomt (bij Resend: gebruik `delivered@resend.dev` als test-email in dev).

- [ ] **Step 4: Fouten-pad testen**

Zet een test-item met ongeldige order_id in queue. Run function opnieuw. Expected: `attempts` gaat omhoog, `last_error` gevuld, `status` blijft `pending` tot 3 pogingen → `failed`.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/factuur-verzenden/
git commit -m "feat(facturatie): edge function factuur-verzenden (queue drain + PDF + email)"
```

---

## Task 10a: Queue recovery-functie (stuck processing-items)

**Files:**
- Create: `supabase/migrations/121_facturatie_queue_recovery.sql`

Als de edge function crasht nadat een queue-item op `processing` is gezet maar voordat het op `done`/`pending` is teruggezet, blijft dat item permanent stuck (cron pikt alleen `pending` op). Deze functie zet items ouder dan 10 minuten in `processing` terug naar `pending` zodat de drain ze opnieuw probeert.

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 121: Recovery van stuck factuur_queue items
-- Als factuur-verzenden edge function crasht tussen 'processing' markeren en finalisatie,
-- blijft item stuck. Deze functie zet items >10 min in 'processing' terug op 'pending'.

ALTER TABLE factuur_queue
  ADD COLUMN processing_started_at TIMESTAMPTZ;

-- Edge function moet deze kolom bij 'processing' updaten; zie Task 9, Step 1 aanpassing hieronder.

CREATE OR REPLACE FUNCTION recover_stuck_factuur_queue() RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE factuur_queue
    SET status = 'pending', processing_started_at = NULL
  WHERE status = 'processing'
    AND processing_started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION recover_stuck_factuur_queue IS
  'Zet factuur_queue items die >10 min in processing staan terug op pending. '
  'Aangeroepen door pg_cron elke 5 min (migratie 122).';
```

- [ ] **Step 2: Pas edge function aan om `processing_started_at` te zetten**

In `supabase/functions/factuur-verzenden/index.ts` (Task 9, Step 1), wijzig de regel:
```typescript
await supabase.from('factuur_queue').update({ status: 'processing' }).eq('id', item.id)
```
naar:
```typescript
await supabase.from('factuur_queue').update({
  status: 'processing',
  processing_started_at: new Date().toISOString(),
}).eq('id', item.id)
```
En bij `done`/`pending`/`failed` branches: zet `processing_started_at: null` mee.

- [ ] **Step 3: Apply + verifieer**

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name='factuur_queue' AND column_name='processing_started_at';
-- Expected: 1 rij.
SELECT recover_stuck_factuur_queue();
-- Expected: 0 (geen stuck items op dit moment).
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/121_facturatie_queue_recovery.sql supabase/functions/factuur-verzenden/index.ts
git commit -m "feat(facturatie): queue recovery voor stuck processing-items"
```

---

## Task 10b: pg_cron voor queue-drain + recovery + wekelijkse verzamelfactuur

**Files:**
- Create: `supabase/migrations/122_facturatie_pg_cron.sql`

**⚠️ Pre-requisite:** Edge function `factuur-verzenden` moet eerst gedeployed zijn (Task 9) voordat deze migratie zinvol is. Anders draait de drain elke minuut tegen een 404.

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 122: pg_cron jobs voor facturatie
-- Vereist: extensions pg_cron + pg_net (check: SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');)
-- VERVANG <PROJECT_REF> hieronder door de daadwerkelijke Supabase project-ref VOOR applien!
-- Zie: https://supabase.com/docs/guides/functions/schedule-functions

-- Drain elke minuut
SELECT cron.schedule(
  'facturatie-queue-drain',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/factuur-verzenden',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Recovery elke 5 minuten
SELECT cron.schedule(
  'facturatie-queue-recovery',
  '*/5 * * * *',
  $$SELECT recover_stuck_factuur_queue();$$
);

-- Wekelijkse verzamelfactuur: maandag 06:00 NL-tijd = 04:00 UTC (zomer) / 05:00 UTC (winter)
-- Kies 05:00 UTC als compromis (draait dan maandag 06:00 winter / 07:00 zomer — acceptabel).
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_week_begin DATE := DATE_TRUNC('week', CURRENT_DATE - INTERVAL '7 days')::DATE;
  v_week_eind  DATE := v_week_begin + INTERVAL '6 days';
BEGIN
  -- Voor elke debiteur met factuurvoorkeur = 'wekelijks':
  -- verzamel alle orders die in week v_week_begin..v_week_eind status='Verzonden' hebben
  -- en nog niet zijn gefactureerd. Voeg toe aan queue als 1 bulk-item.
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type)
  SELECT
    o.debiteur_nr,
    ARRAY_AGG(o.id ORDER BY o.id),
    'wekelijks'
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE d.factuurvoorkeur = 'wekelijks'
    AND o.status = 'Verzonden'
    AND o.id NOT IN (SELECT order_id FROM factuur_regels)
    -- Optioneel: alleen orders die in de afgelopen week verzonden zijn.
    -- Als `verzonden_op` niet bestaat, laten we ALLE ongefactureerde orders meedoen;
    -- dat is veilig omdat ze één keer kunnen. Bij introductie zending_datum: filter strakker.
  GROUP BY o.debiteur_nr
  HAVING COUNT(*) > 0;
END;
$$;

SELECT cron.schedule(
  'facturatie-wekelijks',
  '0 5 * * 1',  -- elke maandag 05:00 UTC
  $$SELECT enqueue_wekelijkse_verzamelfacturen();$$
);
```

- [ ] **Step 2: Vraag user service-role-key in vault te zetten**

Instructie:
```sql
-- Supabase dashboard → Database → Settings → custom settings.
-- Of via SQL:
ALTER DATABASE postgres SET "app.settings.service_role_key" = '<service-role-key>';
-- Reload: SELECT pg_reload_conf();
```

- [ ] **Step 3: Vervang `<PROJECT_REF>` in de migratie door de echte project-ref**

Open `supabase/migrations/122_facturatie_pg_cron.sql` en vervang **alle voorkomens** van `<PROJECT_REF>` door de waarde uit `VITE_SUPABASE_URL` (alleen het subdomein-gedeelte, bv. `abcdefg`). Als je dit vergeet, draait de cron elke minuut tegen een ongeldige URL.

- [ ] **Step 4: Apply migratie**

- [ ] **Step 5: Verifieer schedules**
```sql
SELECT jobname, schedule FROM cron.job ORDER BY jobname;
-- Expected: facturatie-queue-drain, facturatie-queue-recovery, facturatie-wekelijks
```

- [ ] **Step 6: Manuele run wekelijkse cron**

```sql
SELECT enqueue_wekelijkse_verzamelfacturen();
SELECT * FROM factuur_queue WHERE type = 'wekelijks';
```

- [ ] **Step 7: Commit**
```bash
git add supabase/migrations/122_facturatie_pg_cron.sql
git commit -m "feat(facturatie): pg_cron drain (1min) + recovery (5min) + wekelijkse verzamelfactuur"
```

---

## Task 11: Frontend queries & hooks

**Files:**
- Create: `frontend/src/lib/supabase/queries/facturen.ts`
- Create: `frontend/src/lib/supabase/queries/bedrijfsconfig.ts`
- Create: `frontend/src/hooks/use-facturen.ts`

- [ ] **Step 1: Schrijf `bedrijfsconfig.ts`**

```typescript
// frontend/src/lib/supabase/queries/bedrijfsconfig.ts
import { supabase } from '../client'

export interface BedrijfsConfig {
  bedrijfsnaam: string; adres: string; postcode: string; plaats: string; land: string
  telefoon: string; email: string; website: string
  kvk: string; btw_nummer: string; iban: string; bic: string; bank: string
  rekeningnummer: string; betalingscondities_tekst: string
  fax?: string
}

export async function fetchBedrijfsConfig(): Promise<BedrijfsConfig> {
  const { data, error } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single()
  if (error) throw error
  return data.waarde as BedrijfsConfig
}

export async function updateBedrijfsConfig(config: BedrijfsConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .upsert({ sleutel: 'bedrijfsgegevens', waarde: config as unknown as Record<string, unknown> },
            { onConflict: 'sleutel' })
  if (error) throw error
}
```

- [ ] **Step 2: Schrijf `facturen.ts`**

```typescript
// frontend/src/lib/supabase/queries/facturen.ts
import { supabase } from '../client'

export interface FactuurListItem {
  id: number
  factuur_nr: string
  debiteur_nr: number
  klant_naam?: string
  factuurdatum: string
  vervaldatum: string
  status: 'Concept' | 'Verstuurd' | 'Betaald' | 'Herinnering' | 'Aanmaning' | 'Gecrediteerd'
  totaal: number
  verstuurd_op: string | null
  pdf_storage_path: string | null
}

export async function fetchFacturen(params?: { debiteurNr?: number }): Promise<FactuurListItem[]> {
  let q = supabase
    .from('facturen')
    .select('id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status, totaal, verstuurd_op, pdf_storage_path, debiteuren(naam)')
    .order('factuurdatum', { ascending: false })
  if (params?.debiteurNr) q = q.eq('debiteur_nr', params.debiteurNr)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((f) => ({
    ...f,
    klant_naam: (f.debiteuren as { naam: string } | null)?.naam,
  })) as FactuurListItem[]
}

export async function fetchFactuurDetail(id: number) {
  const { data: factuur, error: e1 } = await supabase.from('facturen').select('*').eq('id', id).single()
  if (e1) throw e1
  const { data: regels, error: e2 } = await supabase
    .from('factuur_regels').select('*').eq('factuur_id', id).order('regelnummer')
  if (e2) throw e2
  return { factuur, regels }
}

export async function getFactuurPdfSignedUrl(pdf_storage_path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('facturen').createSignedUrl(pdf_storage_path, 600)
  if (error) throw error
  return data.signedUrl
}

export async function zetFactuurOpBetaald(id: number): Promise<void> {
  const { error } = await supabase.from('facturen').update({ status: 'Betaald' }).eq('id', id)
  if (error) throw error
}

export async function herverstuurFactuur(id: number): Promise<void> {
  // Voegt een nieuw queue-item toe met order_ids uit bestaande factuur_regels
  const { data: regels } = await supabase.from('factuur_regels').select('order_id').eq('factuur_id', id)
  const { data: factuur } = await supabase.from('facturen').select('debiteur_nr').eq('id', id).single()
  const uniekeOrderIds = [...new Set((regels ?? []).map((r) => r.order_id))]
  // Let op: hergebruik van genereer_factuur zou dubbele factuur maken. Alternatief: aparte
  // RPC `herverstuur_factuur(factuur_id)` die alleen opnieuw PDF-genereert + mailt zonder DB-insert.
  // V1: laat dit open en log waarschuwing — factuurregels zijn al gekoppeld via UNIQUE idx.
  throw new Error('Herverstuur nog niet geïmplementeerd — zie V2')
  void uniekeOrderIds; void factuur
}
```

**Note:** `herverstuurFactuur` is stub in V1. Als user dit snel wil, maak in migratie 122 een RPC `herverstuur_factuur(p_factuur_id)` die alleen queue-item met type='herverstuur' maakt en de edge function aanpast om bij dat type de factuur te laden i.p.v. genereren.

- [ ] **Step 3: Schrijf `use-facturen.ts`**

```typescript
// frontend/src/hooks/use-facturen.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchFacturen, fetchFactuurDetail, zetFactuurOpBetaald,
} from '@/lib/supabase/queries/facturen'

export function useFacturen(debiteurNr?: number) {
  return useQuery({
    queryKey: ['facturen', debiteurNr ?? 'all'],
    queryFn: () => fetchFacturen({ debiteurNr }),
  })
}

export function useFactuurDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['facturen', 'detail', id],
    queryFn: () => fetchFactuurDetail(id!),
    enabled: !!id,
  })
}

export function useMarkeerBetaald() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: zetFactuurOpBetaald,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}
```

- [ ] **Step 4: Type-check**
```bash
cd frontend && npm run build
```
Expected: geen TS-fouten.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/supabase/queries/facturen.ts frontend/src/lib/supabase/queries/bedrijfsconfig.ts frontend/src/hooks/use-facturen.ts
git commit -m "feat(facturatie): frontend queries + hooks voor facturen en bedrijfsconfig"
```

---

## Task 12: Frontend — Facturatie overzichtspagina + detail

**Files:**
- Create: `frontend/src/components/facturatie/factuur-status-badge.tsx`
- Create: `frontend/src/components/facturatie/factuur-lijst.tsx`
- Create: `frontend/src/pages/facturatie/facturatie-overview.tsx`
- Create: `frontend/src/pages/facturatie/factuur-detail.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: StatusBadge + Lijst-component**

Volg bestaande patronen: `StatusBadge` in `frontend/src/components/ui/status-badge.tsx`. Kleuren: `Concept` (slate), `Verstuurd` (blue), `Betaald` (emerald), `Herinnering`/`Aanmaning` (amber/red), `Gecrediteerd` (slate).

`factuur-lijst.tsx` krijgt props `{ debiteurNr?: number }` zodat hij hergebruikt wordt op `/facturatie` én in de klant-detail tab.

- [ ] **Step 2: Overview-pagina**

Lijst alle facturen, filter op status + zoek op factuur_nr/klant. Klikbare rij → `/facturatie/:id`.

- [ ] **Step 3: Detail-pagina**

Toon factuur-header + regels-tabel. Knoppen: "Download PDF" (gebruikt `getFactuurPdfSignedUrl`), "Markeer als betaald" (gebruikt `useMarkeerBetaald`).

- [ ] **Step 4: Router update**

```diff
- { path: 'facturatie', element: <PlaceholderPage title="Facturatie" /> },
+ { path: 'facturatie', element: <FacturatieOverviewPage /> },
+ { path: 'facturatie/:id', element: <FactuurDetailPage /> },
```
Importeer nieuwe pagina's bovenin.

- [ ] **Step 5: Browser-check**

```bash
cd frontend && npm run dev
```
Open `/facturatie`, check: lijst laadt, filter werkt, klik naar detail werkt, download-knop opent PDF, "Betaald"-knop wisselt status.

- [ ] **Step 6: Commit**

---

## Task 13: Frontend — Klant-detail tab "Facturering"

**Files:**
- Create: `frontend/src/components/klanten/klant-facturering-tab.tsx`
- Modify: `frontend/src/pages/klanten/klant-detail.tsx`

Tab toont:
- **Voorkeur**: radio `per_zending` / `wekelijks` (mutatie op debiteuren.factuurvoorkeur)
- **E-mailadres factuur**: `email_factuur` editable (inline edit-patroon uit klant-detail.tsx)
- **BTW-percentage**: number input (inline edit, mutatie op debiteuren.btw_percentage). Quick-buttons: 21 (NL), 0 (EU-intracom/export). Toon waarschuwing als `btw_percentage = 0` maar `btw_nummer` leeg is.
- **Facturen**: hergebruik `<FactuurLijst debiteurNr={...} />` van Task 12

- [ ] **Step 1: Component**

```tsx
// frontend/src/components/klanten/klant-facturering-tab.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { FactuurLijst } from '@/components/facturatie/factuur-lijst'

interface Props {
  debiteurNr: number
  factuurvoorkeur: 'per_zending' | 'wekelijks'
  emailFactuur: string | null
  btwPercentage: number
  btwNummer: string | null
}

export function KlantFactureringTab({
  debiteurNr, factuurvoorkeur, emailFactuur, btwPercentage, btwNummer,
}: Props) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['klanten', debiteurNr] })

  const voorkeurMut = useMutation({
    mutationFn: async (v: 'per_zending' | 'wekelijks') => {
      const { error } = await supabase.from('debiteuren')
        .update({ factuurvoorkeur: v }).eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess,
  })
  const btwMut = useMutation({
    mutationFn: async (v: number) => {
      const { error } = await supabase.from('debiteuren')
        .update({ btw_percentage: v }).eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess,
  })

  const btwWaarschuwing = btwPercentage === 0 && !btwNummer

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Factuurvoorkeur</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" checked={factuurvoorkeur === 'per_zending'}
              onChange={() => voorkeurMut.mutate('per_zending')} />
            Direct na verzending
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={factuurvoorkeur === 'wekelijks'}
              onChange={() => voorkeurMut.mutate('wekelijks')} />
            Verzamelfactuur per week
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">E-mailadres factuur</h3>
        <div className="text-sm text-slate-600">{emailFactuur ?? <span className="text-red-600">Niet ingesteld</span>}</div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW-percentage</h3>
        <div className="flex items-center gap-2">
          <input
            type="number" step="0.01" min="0" max="100"
            defaultValue={btwPercentage}
            onBlur={(e) => {
              const v = Number(e.currentTarget.value)
              if (!Number.isNaN(v) && v !== btwPercentage) btwMut.mutate(v)
            }}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-500">%</span>
          <button type="button" onClick={() => btwMut.mutate(21)}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">21% NL</button>
          <button type="button" onClick={() => btwMut.mutate(0)}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">0% EU/export</button>
        </div>
        {btwWaarschuwing && (
          <p className="mt-2 text-xs text-amber-700">
            Let op: 0% BTW zonder btw-nummer. Intracommunautaire verlegging vereist een
            geldig btw-nummer bij de afnemer — vul dat in op de Info-tab.
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Facturen</h3>
        <FactuurLijst debiteurNr={debiteurNr} />
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Voeg tab toe aan klant-detail.tsx**

```diff
- type Tab = 'info' | 'adressen' | 'orders' | 'eigennamen' | 'artikelnummers' | 'prijslijst'
+ type Tab = 'info' | 'adressen' | 'orders' | 'facturering' | 'eigennamen' | 'artikelnummers' | 'prijslijst'

  const TABS: { key: Tab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'adressen', label: 'Afleveradressen' },
    { key: 'orders', label: 'Orders' },
+   { key: 'facturering', label: 'Facturering' },
    { key: 'eigennamen', label: 'Klanteigen namen' },
    { key: 'artikelnummers', label: 'Artikelnummers' },
    { key: 'prijslijst', label: 'Prijslijst' },
  ]
```

En in de render-switch: `activeTab === 'facturering' && <KlantFactureringTab ... />`.

Verifieer dat `useKlantDetail` ook `factuurvoorkeur`, `email_factuur`, `btw_percentage` en `btw_nummer` teruggeeft. Zo niet, voeg toe in `frontend/src/lib/supabase/queries/klanten.ts` (kolom-lijst uitbreiden).

- [ ] **Step 3: Browser-check**

Open klant-detail, klik tab "Facturering", wijzig voorkeur, refresh → waarde persistent.

- [ ] **Step 4: Commit**

---

## Task 14: Frontend — Instellingen > Bedrijfsgegevens

**Files:**
- Create: `frontend/src/pages/instellingen/bedrijfsgegevens.tsx`
- Modify: `frontend/src/router.tsx` (nieuwe route)
- Modify: sidebar/nav (zoek in `frontend/src/components/layout/` naar bestaand menu) — voeg "Bedrijfsgegevens" toe onder instellingen

- [ ] **Step 1: Formulier-pagina**

Form met alle `BedrijfsConfig`-velden, save-knop met success-feedback (patroon uit `productie-instellingen.tsx`).

- [ ] **Step 2: Route + menu**

```diff
- { path: 'instellingen', element: <ProductieInstellingenPage /> },
+ { path: 'instellingen', element: <ProductieInstellingenPage /> },
+ { path: 'instellingen/bedrijfsgegevens', element: <BedrijfsgegevensPage /> },
```

- [ ] **Step 3: Browser-check** — wijzig telefoonnummer, save, herlaad → persistent.

- [ ] **Step 4: Commit**

---

## Task 15: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`

- [ ] **Step 1: `database-schema.md`**

Voeg `factuur_queue` tabel toe (stond er nog niet) onder de sectie waar `facturen` staat. Voeg `debiteuren.factuurvoorkeur` kolom toe. Update enums-tabel met `factuur_queue_status` en `factuurvoorkeur`.

- [ ] **Step 2: `changelog.md`**

```markdown
## 2026-04-22 — Facturatie-module V1

Facturen worden automatisch gegenereerd + gemaild bij order-status 'Verzonden'
(klanten met `factuurvoorkeur='per_zending'`) of via wekelijkse cron (maandag 05:00 UTC,
voor klanten met `factuurvoorkeur='wekelijks'`). PDF volgens Karpi-layout, algemene
voorwaarden als tweede bijlage.

- Migraties 117–122: enums + tabellen facturen/factuur_regels, factuur_queue + trigger,
  RPC genereer_factuur, seed Karpi BV bedrijfsgegevens, queue-recovery, pg_cron
  (drain 1min + recovery 5min + wekelijks maandag 05:00 UTC).
- Edge function `factuur-verzenden` drainst queue: RPC → PDF → storage upload → Resend email.
- Frontend: `/facturatie` lijst + detail, klant-detail tab "Facturering",
  `/instellingen/bedrijfsgegevens`.
- Secrets: RESEND_API_KEY, FACTUUR_FROM_EMAIL, FACTUUR_REPLY_TO,
  ALGEMENE_VOORWAARDEN_PATH.
- Out of scope V1: herinneringen, aanmaningen, credit-nota's, partiële
  facturatie, herversturen-knop.
```

- [ ] **Step 3: `architectuur.md`**

Nieuwe sectie "Facturatie-flow" met ascii-diagram:

```
order.status='Verzonden'
        │
        ▼
  TRIGGER enqueue_factuur_bij_verzonden
        │ (als klant.factuurvoorkeur='per_zending')
        ▼
  factuur_queue (pending)
        │
        ▼  pg_cron 1x/min
  EDGE FN factuur-verzenden
        │
        ├─ RPC genereer_factuur (facturen + factuur_regels INSERT, order_regels.gefactureerd UPDATE)
        ├─ pdf-lib → Uint8Array
        ├─ Storage.upload('facturen/{debiteur}/FACT-YYYY-NNNN.pdf')
        ├─ Storage.download('documenten/algemene-voorwaarden-karpi-bv.pdf')
        ├─ Resend.emails.send(to=debiteur.email_factuur, attachments=[factuur, av])
        └─ facturen.status='Verstuurd', factuur_queue.status='done'

Wekelijks (maandag 05:00 UTC):
  pg_cron → enqueue_wekelijkse_verzamelfacturen()
        → per klant met factuurvoorkeur='wekelijks':
          INSERT factuur_queue(order_ids=[alle ongefactureerde verzonden orders])
```

- [ ] **Step 4: Commit**
```bash
git add docs/
git commit -m "docs(facturatie): schema, changelog, architectuur bijgewerkt voor V1"
```

---

## Afronding

- [ ] **Final check:** open `/facturatie`, maak een testklant op `per_zending`, zet een order op `Verzonden`, wacht max 1 minuut, verifieer factuur + mail.
- [ ] **Final check:** zet tweede klant op `wekelijks`, roep `SELECT enqueue_wekelijkse_verzamelfacturen()` handmatig, verifieer verzamelfactuur ontstaat.
- [ ] **Finishing-a-development-branch:** gebruik de skill `finishing-a-development-branch` om merge vs PR te bepalen (Miguel werkt direct op `main`, dus waarschijnlijk direct mergen zodra alles staat).

---

## Afgehandelde vragen (bevestigd 2026-04-22 door Miguel)

1. **Resend-account**: Miguel zet zelf op. API-key + from-adres worden vóór Task 9 aangeleverd via `supabase secrets set`. Implementer kan Tasks 1–8 + 11–14 alvast bouwen en testen (tests draaien lokaal zonder echte API).
2. **Algemene voorwaarden**: Engelstalige `karpvw.pdf` blijft de bijlage. Geen NL-versie.
3. **Factuuremail-tekst**: alleen Nederlands (geen tri-lingual template).
4. **Vertegenwoordiger**: `debiteuren.vertegenw_code → vertegenwoordigers.naam` (al zo gewired in Task 9).
5. **BTW**: per debiteur in te stellen via `debiteuren.btw_percentage` (default 21.00, te wijzigen naar 0 voor DE/EU-intracom/export). RPC `genereer_factuur` leest die waarde; Facturering-tab biedt edit + quick-buttons.
