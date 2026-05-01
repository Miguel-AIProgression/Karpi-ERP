# Logistiek — Vervoerder-instellingen + tarieven roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development of superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Karpi kan per vervoerder zien wie ze zijn, hoe ze configureren, wat de tarieven zijn (vrije tekst V1), en zien hoeveel zendingen er via hen lopen. Eindstaat = automatische vervoerder-selectie per zending.

**Architectuur:** Drie fasen waarvan A nu wordt gebouwd. B en C als roadmap-secties.

---

## Fase A — Vervoerder-instellingen UI (concreet, in scope)

### Doelen

- Uitbreiding `vervoerders`-tabel met instellingen-kolommen + contactgegevens + tarief-notities (vrije tekst).
- View `vervoerder_stats` voor klant-aantal + zending-aantal per vervoerder.
- Frontend overzichtspagina `/logistiek/vervoerders` + detail-pagina `/logistiek/vervoerders/:code`.
- Sidebar-uitbreiding onder "Logistiek".

### Non-doelen Fase A

- ❌ Gestructureerde tariefmatrix → Fase B.
- ❌ Auto-selectie → Fase C.
- ❌ Per-klant override van vervoerderkeuze (blijft per-klant via `edi_handelspartner_config.vervoerder_code`).

### File structure

**Database:**
- `supabase/migrations/174_vervoerder_instellingen.sql` — kolommen + view.

**Frontend:**
- `frontend/src/modules/logistiek/queries/vervoerders.ts` — `fetchVervoerders`, `fetchVervoerder(code)`, `updateVervoerder(code, data)`, `fetchVervoerderStats()`.
- `frontend/src/modules/logistiek/hooks/use-vervoerders.ts` — TanStack Query wrappers.
- `frontend/src/modules/logistiek/pages/vervoerders-overzicht.tsx` — lijst.
- `frontend/src/modules/logistiek/pages/vervoerder-detail.tsx` — detail + edit-form.
- `frontend/src/modules/logistiek/components/vervoerder-stats-card.tsx` — statistieken-blok.

**Modify:**
- `frontend/src/router.tsx` — twee nieuwe routes `/logistiek/vervoerders` + `/logistiek/vervoerders/:code`.
- `frontend/src/lib/utils/constants.ts` — sidebar item "Vervoerders" toevoegen onder "Operationeel" naast "Logistiek".

### Schema (mig 174)

```sql
ALTER TABLE vervoerders
  ADD COLUMN IF NOT EXISTS api_endpoint    TEXT,
  ADD COLUMN IF NOT EXISTS api_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS account_nummer  TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_naam    TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_email   TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_telefoon TEXT,
  ADD COLUMN IF NOT EXISTS tarief_notities TEXT;

CREATE OR REPLACE VIEW vervoerder_stats AS
SELECT
  v.code,
  v.display_naam,
  v.type,
  v.actief,
  COALESCE(klanten.aantal, 0) AS aantal_klanten,
  COALESCE(zendingen_totaal.aantal, 0) AS aantal_zendingen_totaal,
  COALESCE(zendingen_maand.aantal, 0) AS aantal_zendingen_deze_maand,
  COALESCE(hst_succes.aantal, 0) AS hst_aantal_verstuurd,
  COALESCE(hst_fout.aantal, 0) AS hst_aantal_fout
FROM vervoerders v
LEFT JOIN (
  SELECT vervoerder_code, COUNT(*)::INT AS aantal
    FROM edi_handelspartner_config
   WHERE vervoerder_code IS NOT NULL
   GROUP BY vervoerder_code
) klanten ON klanten.vervoerder_code = v.code
LEFT JOIN (
  SELECT ehc.vervoerder_code, COUNT(z.id)::INT AS aantal
    FROM zendingen z
    JOIN orders o  ON o.id = z.order_id
    JOIN edi_handelspartner_config ehc ON ehc.debiteur_nr = o.debiteur_nr
   GROUP BY ehc.vervoerder_code
) zendingen_totaal ON zendingen_totaal.vervoerder_code = v.code
LEFT JOIN (
  SELECT ehc.vervoerder_code, COUNT(z.id)::INT AS aantal
    FROM zendingen z
    JOIN orders o  ON o.id = z.order_id
    JOIN edi_handelspartner_config ehc ON ehc.debiteur_nr = o.debiteur_nr
   WHERE z.created_at >= date_trunc('month', now())
   GROUP BY ehc.vervoerder_code
) zendingen_maand ON zendingen_maand.vervoerder_code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Verstuurd'
) hst_succes ON hst_succes.code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Fout'
) hst_fout ON hst_fout.code = v.code;

GRANT SELECT ON vervoerder_stats TO authenticated;

COMMENT ON VIEW vervoerder_stats IS
  'Per-vervoerder dashboard: aantal klanten, zendingen, success/fail-counts. '
  'Voorlopig zijn hst_aantal_* alleen niet-NULL voor hst_api; bij EDI-vervoerders '
  'volgt later iets vergelijkbaars uit edi_berichten.';
```

### Frontend hoogtepunten

**Vervoerders-overzicht:**
- Tabel: vervoerder | type-badge | actief? | aantal klanten | zendingen deze maand | success-rate
- Klik → detail.

**Vervoerder-detail:**
- Header: display_naam + type-badge + actief-toggle (saved direct).
- Sectie 1 — **Instellingen** (form):
  - `api_endpoint` (alleen tonen voor `type='api'`)
  - `api_customer_id` (idem)
  - `account_nummer` (algemeen)
- Sectie 2 — **Contact**: naam, email, telefoon.
- Sectie 3 — **Tarieven** (textarea `tarief_notities`): vrije tekst voor V1.
- Sectie 4 — **Algemene notities** (textarea, gebruikt bestaand `notities`-veld).
- Sectie 5 — **Statistieken** (read-only kaart): klanten + zendingen totaal/maand + success-rate.
- Sectie 6 — **Recente zendingen via deze vervoerder** (laatste 10): zending_nr, klant, status, track_trace.
- Save-knop (form-level, saves alle textareas + inputs in één call).

### Tasks Fase A

- [ ] **Task A.1:** Migratie 174 schrijven (kolommen + view) → apply → verifieer in Supabase Studio.
- [ ] **Task A.2:** Frontend queries + hooks (`vervoerders.ts`, `use-vervoerders.ts`).
- [ ] **Task A.3:** Vervoerder-stats-card component.
- [ ] **Task A.4:** Vervoerders-overzicht-pagina.
- [ ] **Task A.5:** Vervoerder-detail-pagina + edit-form.
- [ ] **Task A.6:** Router-routes + sidebar-item.
- [ ] **Task A.7:** Docs: changelog + database-schema (vervoerders kolommen + view).
- [ ] **Task A.8:** Browser-smoke-test: HST instellingen invullen, opslaan, refresh, check stats-kaart.

---

## Fase B — Gestructureerde tarieven (roadmap)

> **Activate when:** Karpi heeft via Fase A genoeg tarief-info verzameld om de echte structuur te kennen. Verwacht na ~4-8 weken werkelijk gebruik van Fase A.

### Concept

Vervang vrije-tekst `tarief_notities` door 2-3 echte tabellen:

```sql
CREATE TABLE vervoerder_zones (
  vervoerder_code TEXT REFERENCES vervoerders(code),
  zone_code       TEXT,                  -- 'NL', 'BE', 'DE', 'EU-1', 'EU-2', 'WORLD'
  display_naam    TEXT,
  PRIMARY KEY (vervoerder_code, zone_code)
);

CREATE TABLE vervoerder_zone_postcodes (
  vervoerder_code TEXT,
  zone_code       TEXT,
  land_code       CHAR(2),
  postcode_van    TEXT,
  postcode_tot    TEXT,
  PRIMARY KEY (vervoerder_code, zone_code, land_code, postcode_van),
  FOREIGN KEY (vervoerder_code, zone_code) REFERENCES vervoerder_zones (vervoerder_code, zone_code)
);

CREATE TABLE vervoerder_tarieven (
  id              BIGSERIAL PRIMARY KEY,
  vervoerder_code TEXT REFERENCES vervoerders(code),
  zone_code       TEXT,
  gewicht_van_kg  NUMERIC,
  gewicht_tot_kg  NUMERIC,
  prijs_eur       NUMERIC NOT NULL,
  geldig_vanaf    DATE NOT NULL DEFAULT CURRENT_DATE,
  geldig_tot      DATE,                  -- NULL = nog actief
  bron            TEXT,                  -- 'hst-prijslijst-2026-q2'
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Open-vragen voor Fase B

- Per-klant overrides nodig? → extra tabel `klant_tarief_afspraken` of NULL betekent default.
- Versie-historie: nieuwe rijen met `geldig_tot` op de oude i.p.v. UPDATE? Voorkeur: ja (audit-trail).
- Uitlees-RPC: `get_tarief(vervoerder_code, zone, gewicht_kg, datum)` → `(prijs, tarief_id, bron)`.
- Import-script: per vervoerder een Python/SQL-importer voor hun prijsdocument (Excel/PDF).

### Non-doelen Fase B

- Géén automatische selectie nog (Fase C).
- Géén factuurberekening op basis van vervoerder-tarief (apart traject).

---

## Fase C — Automatische vervoerder-selectie (roadmap)

> **Activate when:** Fase B operationeel is + tarieven van alle 3 vervoerders ingevoerd + voorwaarden vastgelegd.

### Concept

```sql
CREATE TABLE vervoerder_voorwaarden (
  vervoerder_code TEXT PRIMARY KEY REFERENCES vervoerders(code),
  max_gewicht_kg          NUMERIC,
  max_lengte_cm           INTEGER,
  max_breedte_cm          INTEGER,
  max_hoogte_cm           INTEGER,
  max_omtrek_cm           INTEGER,
  ondersteunde_landen     TEXT[],         -- ['NL','BE','DE','LU','FR']
  leverdagen              TEXT[],         -- ['ma','di','wo','do','vr']
  cutoff_tijd             TIME,
  -- ... wat nodig blijkt na Fase B
);

-- Selector: filter harde regels, score zachte (kosten + klant-voorkeur).
CREATE OR REPLACE FUNCTION selecteer_vervoerder_voor_zending(p_zending_id BIGINT)
RETURNS TABLE (
  gekozen_vervoerder_code TEXT,
  score                   NUMERIC,
  uitleg                  JSONB
) AS $$ ... $$;
```

### Architectuur-impact

- Trigger `fn_zending_klaar_voor_verzending` evolueert: roept eerst `selecteer_vervoerder_voor_zending` aan, schrijft resultaat op `zendingen.gekozen_vervoerder_code`, dan `enqueue_zending_naar_vervoerder` met die code (inplaats van uit `edi_handelspartner_config` te halen).
- `edi_handelspartner_config.vervoerder_code` wordt **zachte voorkeur** (override met hoge score in selector) — niet meer harde keuze.
- `zendingen` krijgt nieuwe kolom `vervoerder_keuze_uitleg JSONB` voor audit-trail.
- Frontend-zending-detail toont "Gekozen door auto-selector: [vervoerder] (score X) — uitleg: [breakdown]".
- UI-knop "vervoerder handmatig overrulen" voor uitzonderingen.

### Non-doelen Fase C

- Géén machine-learning of historisch-leren — eerst regels-gebaseerd. Later evt.
- Géén realtime-tarief-API met de vervoerder — gebruikt alleen lokale `vervoerder_tarieven`.

---

## Volgorde

A → B → C is hard. Geen Fase B starten voordat Karpi minstens 2 weken de UI uit Fase A heeft gebruikt en de echte tariefstructuur kan beschrijven; geen Fase C voordat ten minste 2 vervoerders volledige tarieven in B hebben.
