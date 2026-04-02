# RugFlow ERP - Database & Frontend Structuur (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ontwerp en bouw de complete Supabase database-structuur en React frontend voor het RugFlow ERP systeem, zodat alle bestaande data (debiteuren, voorraad, orders) foutloos geimporteerd kan worden en het systeem operationeel draait.

**Architecture:** Supabase (PostgreSQL) als backend met Row Level Security, Supabase Storage voor logo's, en een React/TypeScript frontend (via Lovable of Vite+React). De database is de single source of truth; alle relaties worden afgedwongen met foreign keys en constraints. Import gebeurt via Python scripts die de bestaande Excel-bestanden transformeren naar SQL inserts.

**Tech Stack:** Supabase (PostgreSQL, Auth, Storage, Edge Functions), React 18+, TypeScript, TailwindCSS, shadcn/ui, Python 3 (import scripts)

---

## Data-validatie samenvatting

Alle foreign key relaties uit de brondata zijn geverifieerd:

| Relatie | Bron A | Bron B | Overlap | Wees-records |
|---------|--------|--------|---------|--------------|
| Rollen → Producten | 412 artikelnrs | 27.381 artikelnrs | 412 (100%) | 0 |
| Orders → Debiteuren | 542 debiteurnrs | 3.825 debiteurnrs | 542 (100%) | 0 |
| Orders → Producten | 1.965 artikelnrs | 27.381 artikelnrs | 1.965 (100%) | 0 |

**Geen wees-records** = alle FK constraints zullen slagen bij import.

---

## Deel 1: Database Ontwerp (Supabase/PostgreSQL)

### Volledig Entiteiten-diagram

```
┌─────────────────────┐
│  vertegenwoordigers  │ ◄─── code (bijv. "19") + naam ("Emily Dobbe")
│  PK: id             │
│  UK: code           │
└──────────┬──────────┘
           │ FK (code)
           │
┌──────────┴──────────┐      ┌──────────────────────┐
│  debiteuren          │─────<│  afleveradressen      │
│  PK: debiteur_nr     │      │  PK: id               │
│  FK: vertegenw_code  │      │  FK: debiteur_nr       │
│  FK: prijslijst_nr   │      │  UK: (debiteur_nr,     │
│  FK: betaler         │      │       adres_nr)        │
└──────────┬──────────┘      └──────────────────────┘
           │
           ├──────────────────────────────────────────────────────┐
           │                                                      │
           │  ┌──────────────────────┐                            │
           ├─<│  klanteigen_namen     │                            │
           │  │  FK: debiteur_nr      │   ┌────────────────┐      │
           │  │  KEY: kwaliteit_code ─┼──>│  kwaliteiten    │      │
           │  └──────────────────────┘   │  PK: code       │      │
           │                              │  FK: collectie   │      │
           │  ┌──────────────────────┐   └───────┬────────┘      │
           ├─<│  klant_artikelnummers │           │               │
           │  │  FK: debiteur_nr      │   ┌───────┴────────┐      │
           │  │  FK: artikelnr ───────┼──>│  collecties     │      │
           │  └──────────────────────┘   │  PK: id         │      │
           │                              └────────────────┘      │
           │                                                      │
           │  ┌──────────────────┐    ┌──────────────────┐       │
           ├─<│  orders           │───<│  order_regels    │       │
           │  │  FK: debiteur_nr  │    │  FK: order_id    │       │
           │  │  FK: vertegenw    │    │  FK: artikelnr ──┼──>┌───┴──────────┐
           │  │  FK: betaler      │    └────────┬─────────┘   │  producten    │
           │  └──────────────────┘             │              │  PK: artikelnr│
           │                                    │              │  FK: kwaliteit│
           │  ┌──────────────────┐             │              └───┬──────────┘
           ├─<│  facturen         │             │                  │
           │  │  FK: debiteur_nr  │             │          ┌───────┴────────┐
           │  │  FK: order_id     │             │          │  rollen         │
           │  └──────────────────┘             │          │  PK: id         │
           │                                    │          │  UK: rolnummer  │
           │  ┌──────────────────┐             │          │  FK: artikelnr  │
           └─<│  samples          │             │          └────────────────┘
              │  FK: debiteur_nr  │             │
              │  FK: artikelnr    │             │
              └──────────────────┘             │
                                                │
     ┌──────────────────┐    ┌─────────────────┴──┐
     │  zendingen        │───<│  zending_regels     │
     │  FK: order_id     │    │  FK: order_regel_id │
     └──────────────────┘    │  FK: rol (optioneel) │
                              └─────────────────────┘

     ┌──────────────────┐    ┌─────────────────────┐
     │  snijplannen      │    │  confectie_orders    │
     │  FK: order_regel  │    │  FK: order_regel     │
     │  FK: rol          │    │  FK: rol (optioneel) │
     └──────────────────┘    └─────────────────────┘

     ┌──────────────────┐           ┌─────────────────────┐
     │  leveranciers     │──────────<│  inkooporders        │
     │  PK: id           │           │  FK: leverancier_id  │
     └──────────────────┘           └──────────┬──────────┘
                                                │
                                     ┌──────────┴──────────┐
                                     │  inkooporder_regels  │
                                     │  FK: inkooporder_id  │
                                     │  FK: artikelnr       │
                                     └─────────────────────┘

     ┌──────────────────┐    ┌─────────────────────┐
     │  prijslijst_      │───<│  prijslijst_regels   │
     │  headers          │    │  FK: prijslijst_nr   │
     │  PK: nr (TEXT)    │    │  FK: artikelnr       │
     └──────────────────┘    └─────────────────────┘

     ┌──────────────────┐    ┌─────────────────────┐
     │  nummering        │    │  magazijn_locaties   │
     │  (sequences)      │    │  PK: id              │
     └──────────────────┘    └─────────────────────┘

     ┌──────────────────┐
     │  activiteiten_log │  (audit trail)
     └──────────────────┘
```

---

### Task 1: Basis-infrastructuur — Functies, Enums & Nummering

**Files:**
- Create: `supabase/migrations/001_basis.sql`

**Waarom eerst:** Alle volgende tabellen gebruiken de `update_updated_at()` trigger en enums. De nummering-tabel genereert order/factuur/zending nummers.

- [ ] **Step 1: Schrijf de basis-migratie**

```sql
-- =============================================================
-- BASIS INFRASTRUCTUUR
-- Herbruikbare functies, enums en nummering
-- =============================================================

-- === TRIGGER FUNCTIE: auto-update updated_at ===

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- === ENUMS ===

CREATE TYPE order_status AS ENUM (
    'Nieuw',
    'Actie vereist',
    'Wacht op picken',
    'Wacht op voorraad',
    'In snijplan',
    'In productie',
    'Deels gereed',
    'Klaar voor verzending',
    'Verzonden',
    'Geannuleerd'
);

CREATE TYPE zending_status AS ENUM (
    'Gepland',
    'Picken',
    'Ingepakt',
    'Klaar voor verzending',
    'Onderweg',
    'Afgeleverd'
);

CREATE TYPE factuur_status AS ENUM (
    'Concept',
    'Verstuurd',
    'Betaald',
    'Herinnering',
    'Aanmaning',
    'Gecrediteerd'
);

CREATE TYPE snijplan_status AS ENUM (
    'Gepland',
    'In productie',
    'Gereed',
    'Geannuleerd'
);

CREATE TYPE inkooporder_status AS ENUM (
    'Concept',
    'Besteld',
    'Deels ontvangen',
    'Ontvangen',
    'Geannuleerd'
);

CREATE TYPE confectie_status AS ENUM (
    'Wacht op materiaal',
    'In productie',
    'Kwaliteitscontrole',
    'Gereed',
    'Geannuleerd'
);

-- === NUMMERING ===
-- Genereert doorlopende nummers per type per jaar
-- Bijv. ORD-2026-0001, FACT-2026-0001, ZEND-2026-0001

CREATE TABLE public.nummering (
    type              TEXT NOT NULL,      -- 'ORD', 'FACT', 'ZEND', 'SNIJ', 'SAMP', 'INK'
    jaar              INTEGER NOT NULL,
    laatste_nummer    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (type, jaar)
);

CREATE OR REPLACE FUNCTION volgend_nummer(p_type TEXT)
RETURNS TEXT AS $$
DECLARE
    v_jaar INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_nr INTEGER;
BEGIN
    INSERT INTO nummering (type, jaar, laatste_nummer)
    VALUES (p_type, v_jaar, 1)
    ON CONFLICT (type, jaar)
    DO UPDATE SET laatste_nummer = nummering.laatste_nummer + 1
    RETURNING laatste_nummer INTO v_nr;
    
    RETURN p_type || '-' || v_jaar || '-' || LPAD(v_nr::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Gebruik: SELECT volgend_nummer('ORD');  --> 'ORD-2026-0001'
-- Gebruik: SELECT volgend_nummer('FACT'); --> 'FACT-2026-0001'
```

- [ ] **Step 2: Pas migratie toe in Supabase**
- [ ] **Step 3: Test nummering**

```sql
SELECT volgend_nummer('ORD');  -- ORD-2026-0001
SELECT volgend_nummer('ORD');  -- ORD-2026-0002
SELECT volgend_nummer('FACT'); -- FACT-2026-0001
-- Reset voor test:
DELETE FROM nummering;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/001_basis.sql
git commit -m "feat: add base infrastructure - triggers, enums, numbering"
```

---

### Task 2: Vertegenwoordigers & Collecties/Kwaliteiten

**Files:**
- Create: `supabase/migrations/002_referentiedata.sql`

**Waarom eerst:** Debiteuren, producten en orders verwijzen naar vertegenwoordigers en kwaliteiten. Deze moeten eerst bestaan.

**Belangrijk inzicht — Vertegenwoordiger mapping:**
- In `debadres_alles` staat de NAAM: "Emily Dobbe", "Frans Smit", etc. (20 unieke waarden)
- In orders staat de CODE: 19, 16, etc. (12 unieke codes)
- De vertegenwoordigers-tabel koppelt code ↔ naam
- Bij import: debiteuren.vertegenw_code wordt opgezocht via de naam

**Belangrijk inzicht — Kwaliteiten, Collecties & Uitwisselbaarheid:**
- Het bestand `Kwaliteit lijsten aliassen 26-08-2024.xlsx` definieert **56 groepen** van **uitwisselbare** kwaliteitscodes (170 codes totaal)
- Bijv. collectie "x06" (Vernissage/Lago) = VERI, LAGO, GLOR, LUGA, KAES, ROVE, LAVA, GLAM, LAMI, VEMI
  → Deze 10 kwaliteiten zijn **uitwisselbaar** = zelfde type tapijt, andere naam/variant
- Producten worden ingedeeld via hun `kwaliteit_code` (eerste 3-4 letters van karpi_code)
- Klanteigen namen verwijzen naar `kwaliteit_code` (bijv. "BEAC" = Beach Life)

**Data-inventarisatie kwaliteitscodes:**

| Bron | Aantal | Opmerkingen |
|------|--------|-------------|
| Producten | 991 unieke codes | Alle actieve producten |
| Aliassen (uitwisselbaar) | 170 codes in 56 groepen | 17% van productcodes |
| Klanteigen namen | 363 codes | Klanten benoemen 363 kwaliteiten |
| **Totaal uniek** | **997** | 5 klanteigen codes bestaan niet als product |

**Gevolgen voor schema:**
- De `kwaliteiten` tabel moet ALLE 997 codes bevatten (niet alleen de 170 gealiasde)
- 822 kwaliteiten staan **niet** in een collectie → `collectie_id = NULL`
- 170 kwaliteiten staan **wel** in een collectie → uitwisselbaar met andere codes in dezelfde groep
- Bij import: eerst alle unieke codes uit producten+aliassen+klanteigen namen verzamelen → kwaliteiten tabel vullen
- 5 klanteigen-namen codes (VENI, MOLN, HAR1, DOTS, ZENZ) bestaan niet als product → toch opnemen in kwaliteiten

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- VERTEGENWOORDIGERS (Sales reps)
-- Koppelt code (uit orders) aan naam (uit debiteuren)
-- =============================================================

CREATE TABLE public.vertegenwoordigers (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE,   -- "19", "16" etc. uit orders
    naam              TEXT NOT NULL,          -- "Emily Dobbe" etc. uit debiteuren
    email             TEXT,
    telefoon          TEXT,
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER vertegenwoordigers_updated_at
    BEFORE UPDATE ON public.vertegenwoordigers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- === Initiële data (code <-> naam mapping moet bij import bepaald worden) ===
-- De mapping wordt afgeleid door te kijken welke vertegenwoordiger-naam
-- het meest voorkomt bij orders met een bepaalde vertegenwoordiger-code.

-- =============================================================
-- COLLECTIES
-- Een collectie is een groep kwaliteiten die samen één
-- productlijn vormen (bijv. "Vernissage" = VERI+LAGO+GLOR+...)
-- Bron: "Kwaliteit lijsten aliassen 26-08-2024.xlsx"
-- =============================================================

CREATE TABLE public.collecties (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    groep_code        TEXT NOT NULL UNIQUE,   -- "x01", "x02", ... uit aliassen-bestand
    naam              TEXT NOT NULL,          -- "Mirage/Renaissance/Coll", etc.
    omschrijving      TEXT,
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER collecties_updated_at
    BEFORE UPDATE ON public.collecties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- KWALITEITEN
-- ALLE unieke kwaliteitscodes (3-4 letters): 997 stuks
-- - 170 codes horen bij een collectie (uitwisselbaar)
-- - 822 codes staan los (collectie_id = NULL)
-- - 5 codes bestaan alleen in klanteigen namen
--
-- UITWISSELBAARHEID: kwaliteiten met dezelfde collectie_id
-- zijn uitwisselbaar. Query voorbeeld:
--   SELECT code FROM kwaliteiten 
--   WHERE collectie_id = (SELECT collectie_id FROM kwaliteiten WHERE code = 'VERI')
--   → geeft: VERI, LAGO, GLOR, LUGA, KAES, ROVE, LAVA, GLAM, LAMI, VEMI
--
-- Bron: producten karpi_code + aliassen-bestand + klanteigen namen
-- =============================================================

CREATE TABLE public.kwaliteiten (
    code              TEXT PRIMARY KEY,       -- "MIRA", "CISC", "BEAC" etc.
    collectie_id      BIGINT REFERENCES public.collecties(id),
    omschrijving      TEXT,                   -- Volledige naam, bijv. "Mirage"
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kwaliteiten_collectie ON public.kwaliteiten (collectie_id);

-- === FUNCTIE: Vind uitwisselbare kwaliteiten ===
-- Geeft alle kwaliteitscodes terug die uitwisselbaar zijn met de opgegeven code
CREATE OR REPLACE FUNCTION uitwisselbare_kwaliteiten(p_code TEXT)
RETURNS TABLE(code TEXT, omschrijving TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT k.code, k.omschrijving
    FROM kwaliteiten k
    WHERE k.collectie_id = (
        SELECT k2.collectie_id FROM kwaliteiten k2 WHERE k2.code = p_code
    )
    AND k.collectie_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Gebruik: SELECT * FROM uitwisselbare_kwaliteiten('VERI');
-- → VERI, LAGO, GLOR, LUGA, KAES, ROVE, LAVA, GLAM, LAMI, VEMI

-- =============================================================
-- MAGAZIJN LOCATIES
-- Waar liggen rollen fysiek in het magazijn?
-- =============================================================

CREATE TABLE public.magazijn_locaties (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE,   -- bijv. "A01-R03-P02" (gang-rek-positie)
    omschrijving      TEXT,
    type              TEXT DEFAULT 'rek'
                      CHECK (type IN ('rek', 'vloer', 'stellage', 'expeditie')),
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Pas toe en verifieer**
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_referentiedata.sql
git commit -m "feat: add vertegenwoordigers, collecties, kwaliteiten, magazijn_locaties"
```

---

### Task 3: Debiteuren & Afleveradressen

**Files:**
- Create: `supabase/migrations/003_debiteuren.sql`

**Waarom deze structuur:**
- `debiteur_nr` (INTEGER) = PK uit het oude systeem. Alle bronbestanden, logo-bestanden (`KlantLogo/100004.jpg`), klanteigen namen, orders verwijzen hiernaar.
- `vertegenw_code` verwijst naar vertegenwoordigers.code
- `prijslijst_nr` verwijst naar prijslijst_headers.nr (komt in Task 5)
- `betaler` is een self-reference: sommige debiteuren betalen via een ander debiteurnummer

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- DEBITEUREN (Klanten)
-- PK = debiteur_nr uit het oude systeem (INTEGER)
-- Alle bronbestanden en logo's verwijzen via dit nummer
-- =============================================================

CREATE TABLE public.debiteuren (
    debiteur_nr       INTEGER PRIMARY KEY,
    naam              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'Actief' 
                      CHECK (status IN ('Actief', 'Inactief')),
    
    -- Hoofdadres
    adres             TEXT,
    postcode          TEXT,
    plaats            TEXT,
    land              TEXT DEFAULT 'NL',
    telefoon          TEXT,
    
    -- Factuuradres (kan afwijken van hoofdadres)
    fact_naam         TEXT,
    fact_adres        TEXT,
    fact_postcode     TEXT,
    fact_plaats       TEXT,
    
    -- Communicatie
    email_factuur     TEXT,
    email_overig      TEXT,
    email_2           TEXT,
    fax               TEXT,
    
    -- Commercieel — verwijzingen
    vertegenw_code    TEXT REFERENCES public.vertegenwoordigers(code),
    route             TEXT,
    rayon             TEXT,
    rayon_naam        TEXT,
    -- prijslijst_nr wordt als FK toegevoegd NA creatie prijslijst_headers (Task 5)
    prijslijst_nr     TEXT,  
    korting_pct       NUMERIC(5,2) DEFAULT 0,
    betaalconditie    TEXT,
    inkooporganisatie TEXT,
    betaler           INTEGER, -- Self-reference, added after table exists
    
    -- Identificatie
    btw_nummer        TEXT,
    gln_bedrijf       TEXT,   -- GLN/EAN van moederbedrijf (13 cijfers)
    
    -- Klantwaarde (berekend, gecached door trigger/cron)
    tier              TEXT DEFAULT 'Bronze' 
                      CHECK (tier IN ('Gold', 'Silver', 'Bronze')),
    omzet_ytd         NUMERIC(12,2) DEFAULT 0,
    omzet_pct_totaal  NUMERIC(5,2) DEFAULT 0,  -- % van totale omzet
    gem_omzet_maand   NUMERIC(12,2) DEFAULT 0,
    
    -- Logo pad in Supabase Storage
    logo_path         TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Self-reference FK (betaler verwijst naar andere debiteur)
ALTER TABLE public.debiteuren 
    ADD CONSTRAINT fk_debiteuren_betaler 
    FOREIGN KEY (betaler) REFERENCES public.debiteuren(debiteur_nr);

-- Indexen
CREATE INDEX idx_debiteuren_naam ON public.debiteuren (naam);
CREATE INDEX idx_debiteuren_status ON public.debiteuren (status);
CREATE INDEX idx_debiteuren_vertegenw ON public.debiteuren (vertegenw_code);
CREATE INDEX idx_debiteuren_tier ON public.debiteuren (tier);
CREATE INDEX idx_debiteuren_prijslijst ON public.debiteuren (prijslijst_nr);

CREATE TRIGGER debiteuren_updated_at
    BEFORE UPDATE ON public.debiteuren
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- AFLEVERADRESSEN
-- Per debiteur meerdere afleveradressen
-- adres_nr 0 = hoofdadres (kopie van debiteuren.adres etc.)
-- adres_nr 1+ = extra afleveradressen
-- =============================================================

CREATE TABLE public.afleveradressen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    debiteur_nr       INTEGER NOT NULL REFERENCES public.debiteuren(debiteur_nr) 
                      ON DELETE CASCADE,
    adres_nr          INTEGER NOT NULL DEFAULT 0,
    
    naam              TEXT,
    naam_2            TEXT,           -- Toevoeging (bijv. "(NR. 1025)")
    gln_afleveradres  TEXT,           -- GLN voor EDI (10-14 cijfers, uit Naam 2)
    
    adres             TEXT,
    postcode          TEXT,
    plaats            TEXT,
    land              TEXT,
    telefoon          TEXT,
    email             TEXT,
    email_2           TEXT,
    route             TEXT,
    vertegenw_code    TEXT REFERENCES public.vertegenwoordigers(code),
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (debiteur_nr, adres_nr)
);

CREATE INDEX idx_afleveradressen_debiteur ON public.afleveradressen (debiteur_nr);
CREATE INDEX idx_afleveradressen_gln ON public.afleveradressen (gln_afleveradres) 
    WHERE gln_afleveradres IS NOT NULL;

CREATE TRIGGER afleveradressen_updated_at
    BEFORE UPDATE ON public.afleveradressen
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Pas toe en verifieer FK constraints**

```sql
-- Test: debiteur met betaler-verwijzing
INSERT INTO vertegenwoordigers (code, naam) VALUES ('19', 'Emily Dobbe');
INSERT INTO debiteuren (debiteur_nr, naam, vertegenw_code) VALUES (999999, 'TEST BV', '19');
INSERT INTO debiteuren (debiteur_nr, naam, betaler) VALUES (999998, 'FILIAAL BV', 999999);
INSERT INTO afleveradressen (debiteur_nr, adres_nr, naam, adres, gln_afleveradres) 
VALUES (999999, 0, 'TEST BV', 'Teststraat 1', '8712345678901');

-- FK check: dit MOET falen (onbekende vertegenwoordiger)
-- INSERT INTO debiteuren (debiteur_nr, naam, vertegenw_code) VALUES (999997, 'FOUT', 'XX');

-- Cascade delete: verwijder debiteur -> afleveradressen ook weg
DELETE FROM debiteuren WHERE debiteur_nr = 999998;
DELETE FROM debiteuren WHERE debiteur_nr = 999999;
DELETE FROM vertegenwoordigers WHERE code = '19';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_debiteuren.sql
git commit -m "feat: add debiteuren with vertegenwoordiger FK and afleveradressen"
```

---

### Task 4: Producten & Rollen

**Files:**
- Create: `supabase/migrations/004_producten.sql`

**Waarom:**
- `artikelnr` (TEXT) = PK. Alle nummers zijn numeriek in de huidige data, maar TEXT is veiliger voor toekomstige codes.
- `kwaliteit_code` verwijst naar kwaliteiten.code → automatische koppeling met collecties
- Rollen zijn individuele fysieke rollen, elk met uniek `rolnummer`
- Rollen verwijzen naar producten via `artikelnr` (100% overlap geverifieerd)
- Rollen hebben optioneel een `magazijn_locatie`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- PRODUCTEN (Artikelen)
-- PK = artikelnr (TEXT) uit het oude systeem
-- =============================================================

CREATE TABLE public.producten (
    artikelnr         TEXT PRIMARY KEY,
    karpi_code        TEXT,
    ean_code          TEXT,
    omschrijving      TEXT NOT NULL,
    vervolgomschrijving TEXT,
    
    -- Voorraad (bijgewerkt door import en mutaties)
    voorraad          INTEGER DEFAULT 0,
    backorder         INTEGER DEFAULT 0,
    gereserveerd      INTEGER DEFAULT 0,
    besteld_inkoop    INTEGER DEFAULT 0,
    vrije_voorraad    INTEGER DEFAULT 0,
    
    -- Classificatie (afgeleid uit karpi_code)
    kwaliteit_code    TEXT REFERENCES public.kwaliteiten(code),
    kleur_code        TEXT,
    zoeksleutel       TEXT,    -- kwaliteit_code || '_' || kleur_code
    
    -- Prijzen
    inkoopprijs       NUMERIC(10,2),
    verkoopprijs      NUMERIC(10,2),
    
    -- Gewicht
    gewicht_kg        NUMERIC(8,2),
    
    -- Status
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_producten_zoeksleutel ON public.producten (zoeksleutel);
CREATE INDEX idx_producten_kwaliteit ON public.producten (kwaliteit_code);
CREATE INDEX idx_producten_karpi_code ON public.producten (karpi_code);
CREATE INDEX idx_producten_ean ON public.producten (ean_code) WHERE ean_code IS NOT NULL;
-- Full-text search op omschrijving
CREATE INDEX idx_producten_omschrijving ON public.producten 
    USING gin(to_tsvector('dutch', omschrijving));

CREATE TRIGGER producten_updated_at
    BEFORE UPDATE ON public.producten
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- ROLLEN (Individuele fysieke rollen)
-- Elke rol is uniek (eigen rolnummer)
-- Gekoppeld aan product via artikelnr (100% overlap geverifieerd)
-- =============================================================

CREATE TABLE public.rollen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rolnummer         TEXT NOT NULL UNIQUE,
    artikelnr         TEXT NOT NULL REFERENCES public.producten(artikelnr),
    karpi_code        TEXT,
    omschrijving      TEXT,
    
    -- Afmetingen
    lengte_cm         INTEGER,
    breedte_cm        INTEGER,
    oppervlak_m2      NUMERIC(10,2),
    
    -- Waarde
    vvp_m2            NUMERIC(10,2),   -- verkoopprijs per m2
    waarde            NUMERIC(12,2),   -- totale waarde
    
    -- Classificatie (zelfde als product, gedenormaliseerd voor snelle queries)
    kwaliteit_code    TEXT REFERENCES public.kwaliteiten(code),
    kleur_code        TEXT,
    zoeksleutel       TEXT,
    
    -- Status
    status            TEXT DEFAULT 'beschikbaar'
                      CHECK (status IN ('beschikbaar', 'gereserveerd', 'verkocht', 
                                        'gesneden', 'reststuk')),
    
    -- Magazijn locatie
    locatie_id        BIGINT REFERENCES public.magazijn_locaties(id),
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rollen_artikelnr ON public.rollen (artikelnr);
CREATE INDEX idx_rollen_zoeksleutel ON public.rollen (zoeksleutel);
CREATE INDEX idx_rollen_status ON public.rollen (status);
CREATE INDEX idx_rollen_locatie ON public.rollen (locatie_id) WHERE locatie_id IS NOT NULL;
CREATE INDEX idx_rollen_kwaliteit ON public.rollen (kwaliteit_code);

CREATE TRIGGER rollen_updated_at
    BEFORE UPDATE ON public.rollen
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Pas toe en verifieer**

```sql
-- Test: product met kwaliteit → collectie koppeling
INSERT INTO collecties (groep_code, naam) VALUES ('x01', 'Mirage/Renaissance');
INSERT INTO kwaliteiten (code, collectie_id, omschrijving) 
VALUES ('MIRA', (SELECT id FROM collecties WHERE groep_code = 'x01'), 'Mirage');

INSERT INTO producten (artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel)
VALUES ('999TEST', 'MIRA01XX100200', 'Test Product', 'MIRA', '01', 'MIRA_01');

INSERT INTO rollen (rolnummer, artikelnr, karpi_code, kwaliteit_code, zoeksleutel)
VALUES ('R999TEST', '999TEST', 'MIRA01XX100200', 'MIRA', 'MIRA_01');

-- Verifieer: van rol → product → kwaliteit → collectie
SELECT r.rolnummer, p.omschrijving, k.omschrijving AS kwaliteit, c.naam AS collectie
FROM rollen r
JOIN producten p ON p.artikelnr = r.artikelnr
LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
LEFT JOIN collecties c ON c.id = k.collectie_id
WHERE r.rolnummer = 'R999TEST';
-- Verwacht: R999TEST | Test Product | Mirage | Mirage/Renaissance

-- Opruimen
DELETE FROM rollen WHERE rolnummer = 'R999TEST';
DELETE FROM producten WHERE artikelnr = '999TEST';
DELETE FROM kwaliteiten WHERE code = 'MIRA';
DELETE FROM collecties WHERE groep_code = 'x01';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_producten.sql
git commit -m "feat: add producten with kwaliteit FK and rollen with magazijn locatie"
```

---

### Task 5: Prijslijsten & Klantspecifieke data

**Files:**
- Create: `supabase/migrations/005_klantdata.sql`

**Waarom:**
- Prijslijsten hebben een header (nr + naam, bijv. "0210 - BENELUX PER 16.03.2026") en regels (per artikel)
- Debiteuren verwijzen naar een prijslijst_nr → FK naar prijslijst_headers
- Klanteigen namen: sleutel is `debiteur_nr + kwaliteit_code` (NIET artikelnr!)
  - Bijv. debiteur 100004 noemt kwaliteit "BEAC" → "BREDA" (eigen benaming)
- Klant artikelnummers: sleutel is `debiteur_nr + artikelnr`
  - Bijv. debiteur 102006 noemt artikel 526210277 → "10024474"

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- PRIJSLIJST HEADERS
-- Metadata per prijslijst. Debiteuren verwijzen hiernaar.
-- Bron: eerste 4 tekens van debiteuren.prijslijst ("0210")
-- =============================================================

CREATE TABLE public.prijslijst_headers (
    nr                TEXT PRIMARY KEY,       -- "0210", "0101", etc.
    naam              TEXT,                   -- "BENELUX PER 16.03.2026"
    geldig_vanaf      DATE,
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER prijslijst_headers_updated_at
    BEFORE UPDATE ON public.prijslijst_headers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Nu kunnen we de FK toevoegen aan debiteuren
ALTER TABLE public.debiteuren
    ADD CONSTRAINT fk_debiteuren_prijslijst
    FOREIGN KEY (prijslijst_nr) REFERENCES public.prijslijst_headers(nr);

-- =============================================================
-- PRIJSLIJST REGELS
-- Per prijslijst: artikelprijzen
-- =============================================================

CREATE TABLE public.prijslijst_regels (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prijslijst_nr     TEXT NOT NULL REFERENCES public.prijslijst_headers(nr)
                      ON DELETE CASCADE,
    artikelnr         TEXT NOT NULL REFERENCES public.producten(artikelnr),
    ean_code          TEXT,
    omschrijving      TEXT,
    omschrijving_2    TEXT,
    prijs             NUMERIC(10,2) NOT NULL,
    gewicht           NUMERIC(8,2),
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (prijslijst_nr, artikelnr)
);

CREATE INDEX idx_prijslijst_regels_nr ON public.prijslijst_regels (prijslijst_nr);
CREATE INDEX idx_prijslijst_regels_art ON public.prijslijst_regels (artikelnr);

-- =============================================================
-- KLANTEIGEN NAMEN
-- Klanten geven kwaliteiten eigen namen
-- KEY = debiteur_nr + kwaliteit_code (NIET artikelnr!)
-- Bijv. debiteur 100004, kwaliteit "BEAC" → benaming "BREDA"
-- =============================================================

CREATE TABLE public.klanteigen_namen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    debiteur_nr       INTEGER NOT NULL REFERENCES public.debiteuren(debiteur_nr)
                      ON DELETE CASCADE,
    kwaliteit_code    TEXT NOT NULL REFERENCES public.kwaliteiten(code),
    benaming          TEXT NOT NULL,    -- Eigen naam die klant gebruikt
    omschrijving      TEXT,             -- Uitgebreide omschrijving
    leverancier       TEXT,             -- Leveranciercode
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (debiteur_nr, kwaliteit_code)
);

CREATE INDEX idx_klanteigen_namen_deb ON public.klanteigen_namen (debiteur_nr);
CREATE INDEX idx_klanteigen_namen_kwal ON public.klanteigen_namen (kwaliteit_code);

-- =============================================================
-- KLANT ARTIKELNUMMERS
-- Eigen artikelnummers per klant voor pakbonnen/facturen
-- KEY = debiteur_nr + artikelnr
-- Bijv. debiteur 102006, artikel 526210277 → klant-artikel "10024474"
-- =============================================================

CREATE TABLE public.klant_artikelnummers (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    debiteur_nr       INTEGER NOT NULL REFERENCES public.debiteuren(debiteur_nr)
                      ON DELETE CASCADE,
    artikelnr         TEXT NOT NULL REFERENCES public.producten(artikelnr),
    klant_artikel     TEXT NOT NULL,     -- Nummer dat de klant gebruikt
    omschrijving      TEXT,
    vervolg           TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (debiteur_nr, artikelnr)
);

CREATE INDEX idx_klant_artikelnrs_deb ON public.klant_artikelnummers (debiteur_nr);
CREATE INDEX idx_klant_artikelnrs_art ON public.klant_artikelnummers (artikelnr);
```

- [ ] **Step 2: Verifieer de volledige keten**

```sql
-- Test: debiteur → prijslijst → artikel → kwaliteit → collectie
-- En: debiteur → klanteigen naam → kwaliteit → collectie
-- Alles moet kloppen!

-- Setup
INSERT INTO collecties (groep_code, naam) VALUES ('x99', 'Test Collectie');
INSERT INTO kwaliteiten (code, collectie_id) 
VALUES ('BEAC', (SELECT id FROM collecties WHERE groep_code = 'x99'));
INSERT INTO prijslijst_headers (nr, naam) VALUES ('0210', 'BENELUX TEST');
INSERT INTO vertegenwoordigers (code, naam) VALUES ('19', 'Emily Dobbe');
INSERT INTO debiteuren (debiteur_nr, naam, prijslijst_nr, vertegenw_code) 
VALUES (100004, 'AD BOUW', '0210', '19');
INSERT INTO producten (artikelnr, omschrijving, kwaliteit_code) 
VALUES ('526210277', 'Test Product', 'BEAC');

-- Prijslijst regel
INSERT INTO prijslijst_regels (prijslijst_nr, artikelnr, prijs)
VALUES ('0210', '526210277', 309.00);

-- Klanteigen naam
INSERT INTO klanteigen_namen (debiteur_nr, kwaliteit_code, benaming, omschrijving)
VALUES (100004, 'BEAC', 'BREDA', 'BEACH LIFE');

-- Klant artikelnummer
INSERT INTO klant_artikelnummers (debiteur_nr, artikelnr, klant_artikel)
VALUES (100004, '526210277', 'CUSTOM-001');

-- Verifieer: welke prijs betaalt debiteur 100004 voor artikel 526210277?
SELECT d.naam, d.prijslijst_nr, pr.prijs, ka.klant_artikel, kn.benaming
FROM debiteuren d
JOIN prijslijst_regels pr ON pr.prijslijst_nr = d.prijslijst_nr 
    AND pr.artikelnr = '526210277'
LEFT JOIN klant_artikelnummers ka ON ka.debiteur_nr = d.debiteur_nr 
    AND ka.artikelnr = '526210277'
LEFT JOIN producten p ON p.artikelnr = '526210277'
LEFT JOIN klanteigen_namen kn ON kn.debiteur_nr = d.debiteur_nr 
    AND kn.kwaliteit_code = p.kwaliteit_code
WHERE d.debiteur_nr = 100004;
-- Verwacht: AD BOUW | 0210 | 309.00 | CUSTOM-001 | BREDA

-- Opruimen
DELETE FROM debiteuren WHERE debiteur_nr = 100004;
DELETE FROM producten WHERE artikelnr = '526210277';
DELETE FROM prijslijst_headers WHERE nr = '0210';
DELETE FROM kwaliteiten WHERE code = 'BEAC';
DELETE FROM collecties WHERE groep_code = 'x99';
DELETE FROM vertegenwoordigers WHERE code = '19';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_klantdata.sql
git commit -m "feat: add prijslijsten, klanteigen_namen (by kwaliteit), klant_artikelnummers"
```

---

### Task 6: Orders & Order Regels

**Files:**
- Create: `supabase/migrations/006_orders.sql`

**Waarom:**
- Orders zijn het hart van het ERP
- Elke order heeft een header (klant, data, adressen) en meerdere regels (producten)
- **Adres-snapshots**: factuur- en afleveradressen worden gekopieerd bij aanmaak zodat latere adreswijzigingen geen historische orders raken
- **oud_order_nr**: mapping naar het oude systeem (bijv. 26503460)
- **order_nr**: nieuw formaat via nummering (ORD-2026-xxxx)
- **vertegenw_code**: FK naar vertegenwoordigers (in orders is dit een numerieke code)
- 3.367 unieke orders met 8.033 regels in de brondata

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- ORDERS
-- Header per order. Adressen zijn snapshots (niet FK naar afleveradressen)
-- =============================================================

CREATE TABLE public.orders (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_nr          TEXT NOT NULL UNIQUE,    -- ORD-2026-0001 (gegenereerd)
    oud_order_nr      BIGINT UNIQUE,          -- 26503460 (uit oud systeem)
    
    -- Klant
    debiteur_nr       INTEGER NOT NULL REFERENCES public.debiteuren(debiteur_nr),
    klant_referentie  TEXT,                    -- "BRINK (18)", "#5435/16260113785"
    
    -- Data
    orderdatum        DATE NOT NULL,
    afleverdatum      DATE,
    week              TEXT,
    
    -- Factuuradres (SNAPSHOT op moment van order)
    fact_naam         TEXT,
    fact_adres        TEXT,
    fact_postcode     TEXT,
    fact_plaats       TEXT,
    fact_land         TEXT,
    
    -- Afleveradres (SNAPSHOT op moment van order)
    afl_naam          TEXT,
    afl_naam_2        TEXT,
    afl_adres         TEXT,
    afl_postcode      TEXT,
    afl_plaats        TEXT,
    afl_land          TEXT,
    
    -- Commercieel
    betaler           INTEGER REFERENCES public.debiteuren(debiteur_nr),
    vertegenw_code    TEXT REFERENCES public.vertegenwoordigers(code),
    inkooporganisatie TEXT,
    
    -- Status
    status            order_status NOT NULL DEFAULT 'Nieuw',
    compleet_geleverd BOOLEAN DEFAULT false,
    
    -- Totalen (bijgewerkt door trigger op order_regels)
    aantal_regels     INTEGER DEFAULT 0,
    totaal_bedrag     NUMERIC(12,2) DEFAULT 0,
    totaal_gewicht    NUMERIC(10,2) DEFAULT 0,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orders_debiteur ON public.orders (debiteur_nr);
CREATE INDEX idx_orders_status ON public.orders (status);
CREATE INDEX idx_orders_orderdatum ON public.orders (orderdatum DESC);
CREATE INDEX idx_orders_oud_nr ON public.orders (oud_order_nr) WHERE oud_order_nr IS NOT NULL;
CREATE INDEX idx_orders_vertegenw ON public.orders (vertegenw_code);
-- Samengestelde index voor dashboard: open orders per status
CREATE INDEX idx_orders_status_datum ON public.orders (status, orderdatum DESC) 
    WHERE status NOT IN ('Verzonden', 'Geannuleerd');

CREATE TRIGGER orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- ORDER REGELS
-- Per order meerdere productregels
-- artikelnr is NULLABLE: sommige regels zijn service-items
-- (maar in huidige data bestaan alle artikelnrs in producten)
-- =============================================================

CREATE TABLE public.order_regels (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id          BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    regelnummer       INTEGER NOT NULL,
    
    -- Product (nullable voor service-regels zonder product)
    artikelnr         TEXT REFERENCES public.producten(artikelnr),
    karpi_code        TEXT,
    omschrijving      TEXT NOT NULL,
    omschrijving_2    TEXT,
    
    -- Aantallen
    orderaantal       INTEGER NOT NULL DEFAULT 1,
    te_leveren        INTEGER DEFAULT 0,
    backorder         INTEGER DEFAULT 0,
    te_factureren     INTEGER DEFAULT 0,
    gefactureerd      INTEGER DEFAULT 0,
    
    -- Prijs
    prijs             NUMERIC(10,2),
    korting_pct       NUMERIC(5,2) DEFAULT 0,
    bedrag            NUMERIC(12,2),
    
    -- Gewicht
    gewicht_kg        NUMERIC(8,2),
    
    -- Inkoop (koppeling met inkooporder uit oud systeem)
    is_inkooporder    BOOLEAN DEFAULT false,
    oud_inkooporder_nr BIGINT,           -- Nummer uit oud systeem
    
    -- Voorraad info (snapshot op moment van order)
    vrije_voorraad    NUMERIC(10,2),
    verwacht_aantal   NUMERIC(10,2),
    volgende_ontvangst DATE,
    
    laatste_bon       DATE,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (order_id, regelnummer)
);

CREATE INDEX idx_order_regels_order ON public.order_regels (order_id);
CREATE INDEX idx_order_regels_artikel ON public.order_regels (artikelnr) 
    WHERE artikelnr IS NOT NULL;

CREATE TRIGGER order_regels_updated_at
    BEFORE UPDATE ON public.order_regels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- TRIGGER: Auto-update order totalen bij wijziging regels
-- =============================================================

CREATE OR REPLACE FUNCTION update_order_totalen()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id BIGINT := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
    UPDATE orders SET
        aantal_regels = (
            SELECT COUNT(*) FROM order_regels WHERE order_id = v_order_id
        ),
        totaal_bedrag = (
            SELECT COALESCE(SUM(bedrag), 0) FROM order_regels WHERE order_id = v_order_id
        ),
        totaal_gewicht = (
            SELECT COALESCE(SUM(gewicht_kg * orderaantal), 0) 
            FROM order_regels WHERE order_id = v_order_id
        )
    WHERE id = v_order_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_regels_totalen
    AFTER INSERT OR UPDATE OR DELETE ON public.order_regels
    FOR EACH ROW EXECUTE FUNCTION update_order_totalen();
```

- [ ] **Step 2: Pas toe en verifieer auto-totalen**

```sql
-- Test: order + regels + auto-berekening
INSERT INTO vertegenwoordigers (code, naam) VALUES ('19', 'Emily Dobbe')
ON CONFLICT DO NOTHING;
INSERT INTO debiteuren (debiteur_nr, naam) VALUES (999998, 'ORDER TEST BV');
INSERT INTO orders (order_nr, debiteur_nr, orderdatum, vertegenw_code, status)
VALUES ('ORD-2026-9999', 999998, '2026-04-01', '19', 'Nieuw');

INSERT INTO producten (artikelnr, omschrijving) VALUES ('999TEST1', 'Product A');
INSERT INTO producten (artikelnr, omschrijving) VALUES ('999TEST2', 'Product B');

INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving, orderaantal, prijs, bedrag, gewicht_kg)
VALUES 
    ((SELECT id FROM orders WHERE order_nr = 'ORD-2026-9999'), 1, '999TEST1', 'Product A', 2, 100.00, 200.00, 5.0),
    ((SELECT id FROM orders WHERE order_nr = 'ORD-2026-9999'), 2, '999TEST2', 'Product B', 1, 50.00, 50.00, 3.0);

-- Check: aantal_regels=2, totaal_bedrag=250.00, totaal_gewicht=13.00
SELECT order_nr, aantal_regels, totaal_bedrag, totaal_gewicht 
FROM orders WHERE order_nr = 'ORD-2026-9999';

-- Opruimen
DELETE FROM debiteuren WHERE debiteur_nr = 999998;
DELETE FROM producten WHERE artikelnr IN ('999TEST1', '999TEST2');
DELETE FROM vertegenwoordigers WHERE code = '19';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/006_orders.sql
git commit -m "feat: add orders and order_regels with auto-totals trigger"
```

---

### Task 7: Operationele tabellen — Zendingen, Facturen, Snijplannen, Confectie

**Files:**
- Create: `supabase/migrations/007_operationeel.sql`

**Waarom:** Dit zijn de modules uit de Lovable sidebar: Pick & Ship, Logistiek, Facturatie, Snijplanning, Confectie. Ze verwijzen allemaal terug naar orders/order_regels en/of rollen.

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- ZENDINGEN (Pick & Ship / Logistiek)
-- Een zending is een fysieke levering vanuit een of meerdere orders
-- =============================================================

CREATE TABLE public.zendingen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zending_nr        TEXT NOT NULL UNIQUE,    -- ZEND-2026-0001
    order_id          BIGINT NOT NULL REFERENCES public.orders(id),
    
    status            zending_status NOT NULL DEFAULT 'Gepland',
    verzenddatum      DATE,
    track_trace       TEXT,
    
    -- Afleveradres (snapshot uit order)
    afl_naam          TEXT,
    afl_adres         TEXT,
    afl_postcode      TEXT,
    afl_plaats        TEXT,
    afl_land          TEXT,
    
    -- Gewicht / colli
    totaal_gewicht_kg NUMERIC(8,2),
    aantal_colli      INTEGER DEFAULT 1,
    
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_zendingen_order ON public.zendingen (order_id);
CREATE INDEX idx_zendingen_status ON public.zendingen (status);
CREATE INDEX idx_zendingen_datum ON public.zendingen (verzenddatum DESC);

CREATE TRIGGER zendingen_updated_at
    BEFORE UPDATE ON public.zendingen
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- ZENDING REGELS
-- Welke producten/rollen zitten in deze zending
-- Koppelt zending aan order_regels en optioneel aan specifieke rollen
-- =============================================================

CREATE TABLE public.zending_regels (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zending_id        BIGINT NOT NULL REFERENCES public.zendingen(id) ON DELETE CASCADE,
    order_regel_id    BIGINT REFERENCES public.order_regels(id),
    
    artikelnr         TEXT REFERENCES public.producten(artikelnr),
    rol_id            BIGINT REFERENCES public.rollen(id),  -- Specifieke rol (optioneel)
    
    aantal            INTEGER NOT NULL DEFAULT 1,
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_zending_regels_zending ON public.zending_regels (zending_id);
CREATE INDEX idx_zending_regels_order_regel ON public.zending_regels (order_regel_id);
CREATE INDEX idx_zending_regels_rol ON public.zending_regels (rol_id) WHERE rol_id IS NOT NULL;

-- =============================================================
-- FACTUREN
-- Gekoppeld aan order en debiteur
-- =============================================================

CREATE TABLE public.facturen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factuur_nr        TEXT NOT NULL UNIQUE,    -- FACT-2026-0001
    order_id          BIGINT REFERENCES public.orders(id),
    debiteur_nr       INTEGER NOT NULL REFERENCES public.debiteuren(debiteur_nr),
    
    factuurdatum      DATE NOT NULL DEFAULT CURRENT_DATE,
    vervaldatum       DATE,
    status            factuur_status NOT NULL DEFAULT 'Concept',
    
    -- Bedragen
    subtotaal         NUMERIC(12,2) DEFAULT 0,
    btw_percentage    NUMERIC(5,2) DEFAULT 21.0,
    btw_bedrag        NUMERIC(12,2) DEFAULT 0,
    totaal            NUMERIC(12,2) DEFAULT 0,
    
    -- Factuuradres (snapshot)
    fact_naam         TEXT,
    fact_adres        TEXT,
    fact_postcode     TEXT,
    fact_plaats       TEXT,
    fact_land         TEXT,
    
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_facturen_debiteur ON public.facturen (debiteur_nr);
CREATE INDEX idx_facturen_order ON public.facturen (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_facturen_status ON public.facturen (status);
CREATE INDEX idx_facturen_datum ON public.facturen (factuurdatum DESC);

CREATE TRIGGER facturen_updated_at
    BEFORE UPDATE ON public.facturen
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- FACTUUR REGELS
-- Per factuur: welke order_regels worden gefactureerd
-- =============================================================

CREATE TABLE public.factuur_regels (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factuur_id        BIGINT NOT NULL REFERENCES public.facturen(id) ON DELETE CASCADE,
    order_regel_id    BIGINT REFERENCES public.order_regels(id),
    
    omschrijving      TEXT NOT NULL,
    aantal            INTEGER NOT NULL DEFAULT 1,
    prijs             NUMERIC(10,2) NOT NULL,
    korting_pct       NUMERIC(5,2) DEFAULT 0,
    bedrag            NUMERIC(12,2) NOT NULL,
    btw_percentage    NUMERIC(5,2) DEFAULT 21.0,
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_factuur_regels_factuur ON public.factuur_regels (factuur_id);

-- =============================================================
-- SNIJPLANNEN (Snijplanning module)
-- Tapijt op maat snijden uit rollen voor order_regels
-- =============================================================

CREATE TABLE public.snijplannen (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snijplan_nr       TEXT NOT NULL UNIQUE,    -- SNIJ-2026-0001
    
    -- Koppeling: welke order_regel → welke rol
    order_regel_id    BIGINT REFERENCES public.order_regels(id),
    rol_id            BIGINT REFERENCES public.rollen(id),
    
    -- Snijinstructies
    lengte_cm         INTEGER NOT NULL,
    breedte_cm        INTEGER NOT NULL,
    
    status            snijplan_status NOT NULL DEFAULT 'Gepland',
    gesneden_datum    DATE,
    
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_snijplannen_status ON public.snijplannen (status);
CREATE INDEX idx_snijplannen_rol ON public.snijplannen (rol_id) WHERE rol_id IS NOT NULL;
CREATE INDEX idx_snijplannen_order_regel ON public.snijplannen (order_regel_id);

CREATE TRIGGER snijplannen_updated_at
    BEFORE UPDATE ON public.snijplannen
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- CONFECTIE ORDERS (Confectie module)
-- Nabewerking: afwerken randen, backing, etc.
-- =============================================================

CREATE TABLE public.confectie_orders (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    confectie_nr      TEXT NOT NULL UNIQUE,
    
    order_regel_id    BIGINT REFERENCES public.order_regels(id),
    snijplan_id       BIGINT REFERENCES public.snijplannen(id),
    rol_id            BIGINT REFERENCES public.rollen(id),
    
    -- Wat moet er gebeuren
    type_bewerking    TEXT,       -- bijv. "overzomen", "backing", "binden"
    instructies       TEXT,
    
    status            confectie_status NOT NULL DEFAULT 'Wacht op materiaal',
    gereed_datum      DATE,
    
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_confectie_status ON public.confectie_orders (status);
CREATE INDEX idx_confectie_snijplan ON public.confectie_orders (snijplan_id);

CREATE TRIGGER confectie_orders_updated_at
    BEFORE UPDATE ON public.confectie_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- SAMPLES (Stalen/monsters)
-- =============================================================

CREATE TABLE public.samples (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sample_nr         TEXT NOT NULL UNIQUE,    -- SAMP-2026-0001
    debiteur_nr       INTEGER REFERENCES public.debiteuren(debiteur_nr),
    
    artikelnr         TEXT REFERENCES public.producten(artikelnr),
    omschrijving      TEXT,
    
    status            TEXT DEFAULT 'Aangevraagd'
                      CHECK (status IN ('Aangevraagd', 'In voorbereiding', 
                                        'Verzonden', 'Geannuleerd')),
    
    verzenddatum      DATE,
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_samples_debiteur ON public.samples (debiteur_nr);
CREATE INDEX idx_samples_status ON public.samples (status);

CREATE TRIGGER samples_updated_at
    BEFORE UPDATE ON public.samples
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Pas toe en verifieer volledige keten order → snijplan → confectie → zending**

```sql
-- Test de volledige werkflow:
-- Order → Snijplan (uit rol) → Confectie → Zending

-- Setup
INSERT INTO vertegenwoordigers (code, naam) VALUES ('19', 'Test') ON CONFLICT DO NOTHING;
INSERT INTO debiteuren (debiteur_nr, naam) VALUES (999990, 'WORKFLOW TEST');
INSERT INTO collecties (groep_code, naam) VALUES ('x99', 'Test') ON CONFLICT DO NOTHING;
INSERT INTO kwaliteiten (code, collectie_id) VALUES ('TEST', (SELECT id FROM collecties WHERE groep_code = 'x99')) ON CONFLICT DO NOTHING;
INSERT INTO producten (artikelnr, omschrijving, kwaliteit_code) VALUES ('ART999', 'Test Tapijt', 'TEST');
INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, lengte_cm, breedte_cm, status)
VALUES ('ROL999', 'ART999', 'TEST', 1500, 400, 'beschikbaar');

-- 1. Order aanmaken
INSERT INTO orders (order_nr, debiteur_nr, orderdatum) VALUES ('ORD-2026-9990', 999990, CURRENT_DATE);
INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving, orderaantal, prijs, bedrag)
VALUES ((SELECT id FROM orders WHERE order_nr = 'ORD-2026-9990'), 1, 'ART999', 'Test Tapijt 200x300', 1, 500.00, 500.00);

-- 2. Snijplan aanmaken (koppel order_regel aan rol)
INSERT INTO snijplannen (snijplan_nr, order_regel_id, rol_id, lengte_cm, breedte_cm, status)
VALUES ('SNIJ-2026-9990',
    (SELECT id FROM order_regels WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-9990')),
    (SELECT id FROM rollen WHERE rolnummer = 'ROL999'),
    300, 200, 'Gepland');

-- 3. Confectie order (na snijden: randen afwerken)
INSERT INTO confectie_orders (confectie_nr, order_regel_id, snijplan_id, type_bewerking, status)
VALUES ('CONF-2026-9990',
    (SELECT id FROM order_regels WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-9990')),
    (SELECT id FROM snijplannen WHERE snijplan_nr = 'SNIJ-2026-9990'),
    'overzomen', 'Wacht op materiaal');

-- 4. Zending aanmaken
INSERT INTO zendingen (zending_nr, order_id, status) 
VALUES ('ZEND-2026-9990', (SELECT id FROM orders WHERE order_nr = 'ORD-2026-9990'), 'Gepland');
INSERT INTO zending_regels (zending_id, order_regel_id, artikelnr, rol_id, aantal)
VALUES (
    (SELECT id FROM zendingen WHERE zending_nr = 'ZEND-2026-9990'),
    (SELECT id FROM order_regels WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-9990')),
    'ART999',
    (SELECT id FROM rollen WHERE rolnummer = 'ROL999'),
    1
);

-- Verifieer: alle koppelingen intact
SELECT 
    o.order_nr, 
    oreg.omschrijving AS order_regel,
    sp.snijplan_nr,
    co.confectie_nr, co.type_bewerking,
    z.zending_nr, z.status AS zending_status,
    r.rolnummer, r.status AS rol_status
FROM orders o
JOIN order_regels oreg ON oreg.order_id = o.id
LEFT JOIN snijplannen sp ON sp.order_regel_id = oreg.id
LEFT JOIN confectie_orders co ON co.order_regel_id = oreg.id
LEFT JOIN zendingen z ON z.order_id = o.id
LEFT JOIN rollen r ON r.id = sp.rol_id
WHERE o.order_nr = 'ORD-2026-9990';

-- Opruimen (cascade doet het meeste werk)
DELETE FROM zendingen WHERE zending_nr = 'ZEND-2026-9990';
DELETE FROM debiteuren WHERE debiteur_nr = 999990;
DELETE FROM producten WHERE artikelnr = 'ART999';
DELETE FROM kwaliteiten WHERE code = 'TEST';
DELETE FROM collecties WHERE groep_code = 'x99';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_operationeel.sql
git commit -m "feat: add zendingen, facturen, snijplannen, confectie, samples"
```

---

### Task 8: Leveranciers & Inkoop

**Files:**
- Create: `supabase/migrations/008_inkoop.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================
-- LEVERANCIERS
-- =============================================================

CREATE TABLE public.leveranciers (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    naam              TEXT NOT NULL,
    
    adres             TEXT,
    postcode          TEXT,
    plaats            TEXT,
    land              TEXT,
    
    contactpersoon    TEXT,
    telefoon          TEXT,
    email             TEXT,
    
    betaalconditie    TEXT,
    actief            BOOLEAN DEFAULT true,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER leveranciers_updated_at
    BEFORE UPDATE ON public.leveranciers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- INKOOPORDERS
-- =============================================================

CREATE TABLE public.inkooporders (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inkooporder_nr    TEXT NOT NULL UNIQUE,    -- INK-2026-0001
    leverancier_id    BIGINT NOT NULL REFERENCES public.leveranciers(id),
    
    besteldatum       DATE NOT NULL DEFAULT CURRENT_DATE,
    verwacht_datum    DATE,
    
    status            inkooporder_status NOT NULL DEFAULT 'Concept',
    opmerkingen       TEXT,
    
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_inkooporders_leverancier ON public.inkooporders (leverancier_id);
CREATE INDEX idx_inkooporders_status ON public.inkooporders (status);

CREATE TRIGGER inkooporders_updated_at
    BEFORE UPDATE ON public.inkooporders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- INKOOPORDER REGELS
-- =============================================================

CREATE TABLE public.inkooporder_regels (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inkooporder_id    BIGINT NOT NULL REFERENCES public.inkooporders(id) ON DELETE CASCADE,
    artikelnr         TEXT NOT NULL REFERENCES public.producten(artikelnr),
    
    aantal            INTEGER NOT NULL,
    inkoopprijs       NUMERIC(10,2),
    ontvangen         INTEGER DEFAULT 0,
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_inkooporder_regels_order ON public.inkooporder_regels (inkooporder_id);
CREATE INDEX idx_inkooporder_regels_artikel ON public.inkooporder_regels (artikelnr);
```

- [ ] **Step 2: Pas toe en verifieer**
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/008_inkoop.sql
git commit -m "feat: add leveranciers and inkooporders"
```

---

### Task 9: Views, Berekende velden & Audit log

**Files:**
- Create: `supabase/migrations/009_views.sql`

- [ ] **Step 1: Schrijf views en audit log**

```sql
-- =============================================================
-- ACTIVITEITEN LOG (Audit trail)
-- Wie heeft wat wanneer gedaan?
-- =============================================================

CREATE TABLE public.activiteiten_log (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabel             TEXT NOT NULL,
    record_id         TEXT NOT NULL,
    actie             TEXT NOT NULL CHECK (actie IN ('aangemaakt', 'gewijzigd', 'verwijderd')),
    wijzigingen       JSONB,              -- {"veld": {"oud": x, "nieuw": y}}
    gebruiker_id      UUID REFERENCES auth.users(id),
    
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activiteiten_tabel ON public.activiteiten_log (tabel, record_id);
CREATE INDEX idx_activiteiten_datum ON public.activiteiten_log (created_at DESC);

-- =============================================================
-- VIEW: Dashboard statistieken
-- =============================================================

CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
    -- Voorraad
    (SELECT COUNT(*) FROM producten WHERE actief = true) AS aantal_producten,
    (SELECT COUNT(*) FROM rollen WHERE status = 'beschikbaar') AS beschikbare_rollen,
    (SELECT COALESCE(SUM(waarde), 0) FROM rollen WHERE status = 'beschikbaar') AS voorraadwaarde_inkoop,
    (SELECT COALESCE(SUM(oppervlak_m2 * vvp_m2), 0) FROM rollen WHERE status = 'beschikbaar') AS voorraadwaarde_verkoop,
    
    -- Berekende marge
    CASE 
        WHEN (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar') > 0
        THEN ROUND(
            (1 - (SELECT SUM(waarde) FROM rollen WHERE status = 'beschikbaar') 
                / (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar')
            ) * 100, 1
        )
        ELSE 0
    END AS gemiddelde_marge_pct,
    
    -- Orders
    (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Verzonden', 'Geannuleerd')) AS open_orders,
    (SELECT COUNT(*) FROM orders WHERE status = 'Actie vereist') AS actie_vereist_orders,
    
    -- Klanten
    (SELECT COUNT(*) FROM debiteuren WHERE status = 'Actief') AS actieve_klanten,
    
    -- Productie
    (SELECT COUNT(*) FROM snijplannen WHERE status IN ('Gepland', 'In productie')) AS in_productie,
    
    -- Collecties
    (SELECT COUNT(*) FROM collecties WHERE actief = true) AS actieve_collecties;

-- =============================================================
-- VIEW: Klant omzet YTD (voor tier-berekening en klanten-pagina)
-- Geeft per klant: omzet, % van totaal, gem. per maand
-- =============================================================

CREATE OR REPLACE VIEW public.klant_omzet_ytd AS
WITH totalen AS (
    SELECT 
        COALESCE(SUM(totaal_bedrag), 0) AS totaal_omzet_ytd,
        GREATEST(EXTRACT(MONTH FROM CURRENT_DATE), 1) AS maanden_ytd
    FROM orders
    WHERE orderdatum >= date_trunc('year', CURRENT_DATE)
      AND status NOT IN ('Geannuleerd')
)
SELECT
    d.debiteur_nr,
    d.naam,
    d.status,
    d.tier,
    d.logo_path,
    d.vertegenw_code,
    v.naam AS vertegenwoordiger_naam,
    d.email_factuur,
    d.telefoon,
    COALESCE(SUM(o.totaal_bedrag), 0) AS omzet_ytd,
    COUNT(DISTINCT o.id) AS aantal_orders_ytd,
    CASE WHEN t.totaal_omzet_ytd > 0 
        THEN ROUND(COALESCE(SUM(o.totaal_bedrag), 0) / t.totaal_omzet_ytd * 100, 1)
        ELSE 0 
    END AS pct_van_totaal,
    ROUND(COALESCE(SUM(o.totaal_bedrag), 0) / t.maanden_ytd, 2) AS gem_per_maand
FROM debiteuren d
CROSS JOIN totalen t
LEFT JOIN orders o ON o.debiteur_nr = d.debiteur_nr 
    AND o.orderdatum >= date_trunc('year', CURRENT_DATE)
    AND o.status != 'Geannuleerd'
LEFT JOIN vertegenwoordigers v ON v.code = d.vertegenw_code
GROUP BY d.debiteur_nr, d.naam, d.status, d.tier, d.logo_path, 
         d.vertegenw_code, v.naam, d.email_factuur, d.telefoon,
         t.totaal_omzet_ytd, t.maanden_ytd;

-- =============================================================
-- VIEW: Rollen overzicht (per kwaliteit/kleur)
-- Vervangt "Rollen Overzicht" tabblad uit de Excel import
-- =============================================================

CREATE OR REPLACE VIEW public.rollen_overzicht AS
SELECT
    r.kwaliteit_code,
    r.kleur_code,
    r.zoeksleutel,
    MIN(r.omschrijving) AS omschrijving,
    k.omschrijving AS kwaliteit_naam,
    c.naam AS collectie_naam,
    COUNT(*) AS aantal_rollen,
    SUM(r.oppervlak_m2) AS totaal_oppervlak,
    SUM(r.waarde) AS totaal_waarde,
    AVG(r.vvp_m2) AS gem_vvp_m2
FROM rollen r
LEFT JOIN kwaliteiten k ON k.code = r.kwaliteit_code
LEFT JOIN collecties c ON c.id = k.collectie_id
WHERE r.status = 'beschikbaar'
GROUP BY r.kwaliteit_code, r.kleur_code, r.zoeksleutel, k.omschrijving, c.naam;

-- =============================================================
-- VIEW: Recente orders (voor dashboard)
-- =============================================================

CREATE OR REPLACE VIEW public.recente_orders AS
SELECT
    o.id,
    o.order_nr,
    o.oud_order_nr,
    o.orderdatum,
    o.status,
    o.totaal_bedrag,
    o.aantal_regels,
    o.klant_referentie,
    d.debiteur_nr,
    d.naam AS klant_naam
FROM orders o
JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
ORDER BY o.orderdatum DESC
LIMIT 50;

-- =============================================================
-- VIEW: Orders per status (voor status-tabs op orders pagina)
-- =============================================================

CREATE OR REPLACE VIEW public.orders_status_telling AS
SELECT 
    status,
    COUNT(*) AS aantal
FROM orders
GROUP BY status;

-- =============================================================
-- FUNCTIE: Herbereken klant-tiers
-- Gold = top 10% omzet, Silver = top 30%, Bronze = rest
-- Draai periodiek via Supabase cron of Edge Function
-- =============================================================

CREATE OR REPLACE FUNCTION herbereken_klant_tiers()
RETURNS void AS $$
BEGIN
    WITH klant_ranking AS (
        SELECT 
            d.debiteur_nr,
            COALESCE(SUM(o.totaal_bedrag), 0) AS omzet,
            PERCENT_RANK() OVER (ORDER BY COALESCE(SUM(o.totaal_bedrag), 0) DESC) AS ranking
        FROM debiteuren d
        LEFT JOIN orders o ON o.debiteur_nr = d.debiteur_nr
            AND o.orderdatum >= date_trunc('year', CURRENT_DATE)
            AND o.status != 'Geannuleerd'
        WHERE d.status = 'Actief'
        GROUP BY d.debiteur_nr
    )
    UPDATE debiteuren SET
        tier = CASE
            WHEN kr.ranking <= 0.10 THEN 'Gold'
            WHEN kr.ranking <= 0.30 THEN 'Silver'
            ELSE 'Bronze'
        END,
        omzet_ytd = kr.omzet
    FROM klant_ranking kr
    WHERE debiteuren.debiteur_nr = kr.debiteur_nr;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Pas toe en verifieer**
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/009_views.sql
git commit -m "feat: add views, audit log, and tier calculation function"
```

---

### Task 10: Row Level Security (RLS) & Storage

**Files:**
- Create: `supabase/migrations/010_rls_storage.sql`

- [ ] **Step 1: Schrijf RLS en storage**

```sql
-- =============================================================
-- ROW LEVEL SECURITY
-- Fase 1: authenticated users = volledige toegang
-- Fase 2 (later): rollen per gebruiker (admin, verkoop, magazijn)
-- =============================================================

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'debiteuren', 'afleveradressen', 'producten', 'rollen',
            'prijslijst_headers', 'prijslijst_regels',
            'collecties', 'kwaliteiten', 'magazijn_locaties',
            'klanteigen_namen', 'klant_artikelnummers',
            'orders', 'order_regels', 
            'zendingen', 'zending_regels',
            'facturen', 'factuur_regels',
            'snijplannen', 'confectie_orders', 'samples',
            'vertegenwoordigers', 'leveranciers', 
            'inkooporders', 'inkooporder_regels',
            'activiteiten_log', 'nummering'
        ])
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY "Authenticated full access" ON public.%I 
             FOR ALL TO authenticated USING (true) WITH CHECK (true)',
            tbl
        );
    END LOOP;
END $$;

-- =============================================================
-- SUPABASE STORAGE: Logo's
-- =============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('logos', 'logos', true, 2097152)  -- 2MB max, publiek leesbaar
ON CONFLICT DO NOTHING;

CREATE POLICY "Authenticated upload logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'logos');

CREATE POLICY "Public read logos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'logos');

CREATE POLICY "Authenticated delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'logos');
```

- [ ] **Step 2: Pas toe en verifieer**
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_rls_storage.sql
git commit -m "feat: enable RLS on all tables and configure logo storage"
```

---

## Deel 2: Import Pipeline

### Task 11: Python import scripts voor Supabase

**Files:**
- Create: `import/config.py`
- Create: `import/supabase_import.py`

**Kritieke import-volgorde (foreign keys!):**

```
 1. vertegenwoordigers     (geen FK dependencies)
 2. collecties             (geen FK dependencies) — 56 groepen uit aliassen-bestand
 3. kwaliteiten            (FK → collecties) — ALLE 997 codes:
                             a) 170 uit aliassen-bestand (met collectie_id)
                             b) 822 uit producten (zonder collectie, collectie_id = NULL)
                             c) 5 uit klanteigen namen (zonder collectie of product)
 4. magazijn_locaties      (geen FK dependencies)
 5. prijslijst_headers     (geen FK dependencies)
 6. debiteuren             (FK → vertegenwoordigers, prijslijst_headers)
 7. afleveradressen        (FK → debiteuren, vertegenwoordigers)
 8. producten              (FK → kwaliteiten)
 9. rollen                 (FK → producten, kwaliteiten, magazijn_locaties)
10. prijslijst_regels      (FK → prijslijst_headers, producten)
11. klanteigen_namen       (FK → debiteuren, kwaliteiten)
12. klant_artikelnummers    (FK → debiteuren, producten)
13. orders                 (FK → debiteuren, vertegenwoordigers)
14. order_regels           (FK → orders, producten)
```

**Stap 3 in detail — kwaliteiten vullen:**
```python
# Verzamel ALLE unieke kwaliteitscodes uit drie bronnen:
codes_producten = set(df_producten['Kwaliteit_code'].dropna())      # 991 codes
codes_aliassen = set(aliassen_bestand[alle_code_kolommen].stack())   # 170 codes  
codes_klantnamen = set(df_klanteigen['Kwaliteit'].dropna())         # 363 codes
alle_codes = codes_producten | codes_aliassen | codes_klantnamen    # 997 uniek

# Insert: codes met collectie (uit aliassen) krijgen collectie_id
# Insert: codes zonder collectie krijgen collectie_id = NULL
```

**Mapping vertegenwoordiger naam → code:**
De debiteuren-export heeft namen, orders-export heeft codes. Bij import:
1. Importeer eerst orders → extraheer unieke vertegenw codes
2. Koppel handmatig of via heuristiek (meest voorkomende naam per code)

- [ ] **Step 1: Schrijf config**
- [ ] **Step 2: Schrijf import functies per tabel (in volgorde)**
- [ ] **Step 3: Schrijf vertegenw naam→code mapping logica**
- [ ] **Step 4: Test met subset van data**
- [ ] **Step 5: Full import en verifieer**
- [ ] **Step 6: Commit**

---

## Deel 3: Frontend Structuur

### Pagina-structuur (exact volgens Lovable demo sidebar)

```
src/
├── app/
│   ├── layout.tsx                    # Sidebar + top nav
│   ├── page.tsx                      # → Dashboard
│   ├── orders/
│   │   ├── page.tsx                  # Orders lijst + status-tabs
│   │   └── [id]/page.tsx            # Order detail + regels + workflow
│   ├── samples/page.tsx             # Samples overzicht
│   ├── facturatie/page.tsx          # Facturen lijst
│   ├── klanten/
│   │   ├── page.tsx                 # Klanten grid + tier badges + zoeken
│   │   └── [id]/page.tsx           # Klant detail (tabs: info, adressen, orders, namen)
│   ├── vertegenwoordigers/page.tsx  # Vertegenw. + hun klanten/omzet
│   ├── producten/
│   │   ├── page.tsx                 # Product catalogus
│   │   └── [id]/page.tsx           # Product detail + rollen + prijzen
│   ├── snijplanning/page.tsx        # Snijplannen Kanban/lijst
│   ├── confectie/page.tsx           # Confectie werkstation
│   ├── scanstation/page.tsx         # Barcode scanner (rolnummer)
│   ├── magazijn/page.tsx            # Locaties + rollen
│   ├── pick-ship/page.tsx           # Zendingen workflow
│   ├── rollen/page.tsx              # Rollen & Reststukken overzicht
│   ├── logistiek/page.tsx           # Zendingen tracking
│   ├── inkoop/page.tsx              # Inkooporders
│   ├── leveranciers/page.tsx        # Leveranciers beheer
│   └── instellingen/page.tsx        # Systeem config
│
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx              # Nav groepen: Overzicht, Commercieel, Operationeel, Systeem
│   │   ├── top-bar.tsx              # Global search + user menu
│   │   └── page-header.tsx          # Titel + breadcrumb + actieknoppen
│   ├── dashboard/                   # Stats cards, recente orders, quick actions
│   ├── klanten/                     # Klant cards, tier badges, omzet bars
│   ├── orders/                      # Status tabs, order tabel, detail
│   ├── producten/                   # Product cards, rollen tabel
│   └── ui/                          # shadcn/ui basis componenten
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── types.ts                 # supabase gen types
│   │   └── queries/                 # Per module: debiteuren.ts, orders.ts, etc.
│   └── utils/
│       ├── formatters.ts            # € bedragen, datums, percentages
│       └── constants.ts             # Status kleuren, tier definities
│
└── hooks/                           # React Query hooks per module
```

### Tasks 12-16: Frontend bouwen

Volgt het plan van de eerste versie (Tasks 10-14), nu met correcte data-queries die de verbeterde tabelstructuur gebruiken.

---

## Relatie-overzicht (compleet)

```
vertegenwoordigers ──┬── debiteuren.vertegenw_code
                     ├── afleveradressen.vertegenw_code
                     └── orders.vertegenw_code

collecties ──── kwaliteiten ──┬── producten.kwaliteit_code
                              ├── rollen.kwaliteit_code
                              └── klanteigen_namen.kwaliteit_code

prijslijst_headers ──┬── debiteuren.prijslijst_nr
                     └── prijslijst_regels.prijslijst_nr ──── producten.artikelnr

debiteuren ──┬── afleveradressen (1:N, cascade delete)
             ├── klanteigen_namen (1:N, cascade delete)
             ├── klant_artikelnummers (1:N, cascade delete) ──── producten
             ├── orders (1:N)
             ├── facturen (1:N)
             ├── samples (1:N)
             └── debiteuren.betaler (self-ref)

producten ──┬── rollen (1:N)
            ├── order_regels (N:1)
            ├── klant_artikelnummers (N:1)
            ├── prijslijst_regels (N:1)
            ├── inkooporder_regels (N:1)
            └── samples (N:1)

orders ──┬── order_regels (1:N, cascade delete)
         │     ├── snijplannen (N:1)
         │     ├── confectie_orders (N:1)
         │     ├── zending_regels (N:1)
         │     └── factuur_regels (N:1)
         ├── zendingen (1:N)
         └── facturen (1:N)

rollen ──┬── snijplannen (N:1)
         ├── confectie_orders (N:1)
         └── zending_regels (N:1)

magazijn_locaties ──── rollen.locatie_id

leveranciers ──── inkooporders ──── inkooporder_regels ──── producten
```

## Kritieke aandachtspunten

1. **Import volgorde:** Strikt volgens FK dependencies (zie Task 11)
2. **debiteur_nr INTEGER PK:** Niet UUID — alle bronbestanden en logo's verwijzen hiernaar
3. **artikelnr TEXT PK:** Alle nummers zijn momenteel numeriek, maar TEXT is veilig voor de toekomst
4. **Adres-snapshots in orders:** Kopiëren, niet FK — wijzigingen raken geen historie
5. **Vertegenwoordiger dual-key:** Naam in debiteuren, code in orders — kwaliteiten-tabel koppelt beide
6. **Klanteigen namen key = kwaliteit_code:** NIET artikelnr! Een klant geeft een kwaliteit een eigen naam
7. **Prijslijst = header + regels:** Debiteuren verwijzen naar header, artikelprijzen staan in regels
8. **Kwaliteit → Collectie keten:** product.kwaliteit_code → kwaliteiten.code → collecties.id
9. **Uitwisselbare kwaliteiten:** 56 groepen uit aliassen-bestand. Kwaliteiten met dezelfde `collectie_id` zijn uitwisselbaar. 822 van 991 productkwaliteiten staan NIET in een groep (staan los). Functie `uitwisselbare_kwaliteiten('VERI')` geeft alle alternatieven.
10. **Kwaliteiten tabel moet ALLE 997 codes bevatten** voordat producten/klanteigen namen geïmporteerd worden — ook de 822 zonder collectie en 5 die alleen in klanteigen namen bestaan
11. **Cascade deletes:** Alleen op child-tabellen (afleveradressen, order_regels, etc.)
12. **Tier-berekening:** Via `herbereken_klant_tiers()` functie, periodiek draaien
13. **Nummering:** Via `volgend_nummer('ORD')` functie, gegarandeerd uniek en doorlopend
