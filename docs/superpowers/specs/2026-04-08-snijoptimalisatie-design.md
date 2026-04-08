# Snijoptimalisatie — Design Spec

**Datum:** 2026-04-08
**Status:** Concept
**Scope:** Automatische snijplanning per kwaliteit+kleur op basis van beschikbare rollen

---

## Probleem

Er zijn 2167+ snijplannen in status 'Wacht', gegroepeerd per kwaliteit+kleur. Momenteel is er geen manier om automatisch rollen toe te wijzen aan deze stukken. De gebruiker wil met één klik per groep een optimaal snijvoorstel genereren dat afval minimaliseert.

## Beslissingen

| Vraag | Beslissing |
|-------|-----------|
| Snijmethode | 2D strip-packing — stukken worden optimaal geplaatst op L×B van de rol |
| Rotatie | Toegestaan — systeem kiest oriëntatie met minste afval |
| Ronde stukken | Behandeld als vierkant (Ø200 = 200×200 cm op de rol). Afvalberekening gebruikt π×r² voor werkelijk materiaalverbruik. |
| Berekening | Server-side via Supabase Edge Function |
| Rolvolgorde | Reststukken → kleinste rollen → grootste rollen |
| Workflow | Automatisch voorstel → gebruiker keurt goed per rol of volledig |

---

## Architectuur

### Assen-definitie

```
Rol (bovenaanzicht):
  ← ─ ─ ─ ─ breedte_cm (X-as) ─ ─ ─ ─ →
  ┌─────────────────────────────────────┐  ↑
  │  Shelf 1: [Stuk A][Stuk B][  rest ]│  │
  │  Shelf 2: [  Stuk C  ][   rest    ]│  lengte_cm (Y-as)
  │  ...                                │  │
  │  (ongebruikt)                       │  │
  └─────────────────────────────────────┘  ↓

X = positie over de rolbreedte (links→rechts)
Y = positie langs de rollengte (boven→onder)
```

### Edge Function: `optimaliseer-snijplan`

**Endpoint:** `POST /optimaliseer-snijplan`
**Authenticatie:** Vereist geldige Supabase JWT (Authorization header). Gebruiker wordt opgeslagen in `aangemaakt_door`.

**Input:**
```json
{
  "kwaliteit_code": "AEST",
  "kleur_code": "13"
}
```

**Output:**
```json
{
  "voorstel_id": 42,
  "voorstel_nr": "SNIJV-2026-0001",
  "rollen": [
    {
      "rol_id": 101,
      "rolnummer": "R-00234",
      "rol_lengte_cm": 2500,
      "rol_breedte_cm": 400,
      "rol_status": "reststuk",
      "plaatsingen": [
        {
          "snijplan_id": 501,
          "positie_x_cm": 0,
          "positie_y_cm": 0,
          "lengte_cm": 350,
          "breedte_cm": 210,
          "geroteerd": false
        }
      ],
      "gebruikte_lengte_cm": 650,
      "afval_percentage": 12.3,
      "restlengte_cm": 1850
    }
  ],
  "niet_geplaatst": [
    { "snijplan_id": 510, "reden": "Geen rol met voldoende ruimte" }
  ],
  "samenvatting": {
    "totaal_stukken": 14,
    "geplaatst": 12,
    "niet_geplaatst": 2,
    "totaal_rollen": 3,
    "gemiddeld_afval_pct": 11.5,
    "totaal_m2_gebruikt": 87.2,
    "totaal_m2_afval": 11.1
  }
}
```

**Foutafhandeling:** De gehele operatie (voorstel + plaatsingen) draait in één database-transactie. Bij een fout wordt alles teruggedraaid.

### Algoritme: FFDH Strip-Packing

```
1. OPHALEN
   - Snijplannen: status='Wacht', matching kwaliteit_code + kleur_code
   - Rollen: status IN ('reststuk','beschikbaar'), matching kwaliteit_code + kleur_code
     (V1: geen 'in_snijplan' rollen — complexiteit van bestaande plaatsingen reconstructie
      wordt in een latere versie toegevoegd)

2. SORTEREN
   Stukken: aflopend op oppervlak (grootste eerst)
   Rollen:
     a) reststuk — oplopend op oppervlak (kleinste eerst, snel opgebruikt)
     b) beschikbaar — oplopend op oppervlak (kleinste volledige rollen eerst)

3. PLAATSEN (per rol)
   shelves = []  // horizontale stroken over de rolbreedte (X-as)

   Voor elk ongeplaatst stuk:
     Probeer oriëntatie A (L×B) en B (B×L)
     Voor elke oriëntatie:
       a) Zoek bestaande shelf waar stuk past (hoogte ≤ shelf_hoogte, restbreedte ≥ stuk_breedte)
       b) Zo niet: maak nieuwe shelf als restlengte ≥ stuk hoogte
       c) Kies oriëntatie+shelf met minste verspilde ruimte
     Plaats stuk, update shelf, registreer positie_x_cm (X), positie_y_cm (Y)

   Bereken: gebruikte_lengte, afval%, restlengte
   Afvalberekening: voor ronde stukken wordt π×r² gebruikt i.p.v. L×B

4. HERHAAL voor volgende rol als er ongeplaatste stukken zijn

5. OPSLAAN (in één transactie)
   - Insert snijvoorstellen record (via volgend_nummer('SNIJV'))
   - Insert snijvoorstel_plaatsingen per geplaatst stuk
   - Return voorstel_id + volledige plaatsingsdata
```

**Shelf-logica detail:**
- Een shelf is een horizontale strook met vaste hoogte (= hoogte van het eerste stuk dat erin geplaatst wordt)
- Stukken worden links-naar-rechts in een shelf geplaatst (X neemt toe)
- De shelf-hoogte bepaalt hoeveel lengte van de rol die strook kost (Y-extent)
- Nieuwe shelves worden onder de vorige geplaatst (Y neemt toe)

---

## Database wijzigingen

### Nieuwe tabel: `snijvoorstellen`

```sql
CREATE TABLE snijvoorstellen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voorstel_nr TEXT UNIQUE NOT NULL,
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code),
  kleur_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'concept'
    CHECK (status IN ('concept','goedgekeurd','verworpen')),
  totaal_stukken INTEGER NOT NULL DEFAULT 0,
  totaal_rollen INTEGER NOT NULL DEFAULT 0,
  totaal_m2_gebruikt NUMERIC(10,2) DEFAULT 0,
  totaal_m2_afval NUMERIC(10,2) DEFAULT 0,
  afval_percentage NUMERIC(5,2) DEFAULT 0,
  aangemaakt_door TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nummering registreren
INSERT INTO nummering (type, jaar, laatste_nummer)
VALUES ('SNIJV', 2026, 0) ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX idx_snijvoorstellen_kwaliteit_kleur ON snijvoorstellen(kwaliteit_code, kleur_code);
CREATE INDEX idx_snijvoorstellen_status ON snijvoorstellen(status);

-- Auto-update trigger
CREATE TRIGGER trg_snijvoorstellen_updated
  BEFORE UPDATE ON snijvoorstellen
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE snijvoorstellen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON snijvoorstellen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### Nieuwe tabel: `snijvoorstel_plaatsingen`

```sql
CREATE TABLE snijvoorstel_plaatsingen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voorstel_id BIGINT NOT NULL REFERENCES snijvoorstellen(id) ON DELETE CASCADE,
  snijplan_id BIGINT NOT NULL REFERENCES snijplannen(id),
  rol_id BIGINT NOT NULL REFERENCES rollen(id),
  positie_x_cm NUMERIC NOT NULL DEFAULT 0,
  positie_y_cm NUMERIC NOT NULL DEFAULT 0,
  geroteerd BOOLEAN NOT NULL DEFAULT false,
  lengte_cm INTEGER NOT NULL,
  breedte_cm INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_svp_voorstel ON snijvoorstel_plaatsingen(voorstel_id);
CREATE INDEX idx_svp_snijplan ON snijvoorstel_plaatsingen(snijplan_id);
CREATE INDEX idx_svp_rol ON snijvoorstel_plaatsingen(rol_id);

-- RLS
ALTER TABLE snijvoorstel_plaatsingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON snijvoorstel_plaatsingen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### Nieuwe kolom: `snijplannen.geroteerd`

```sql
ALTER TABLE snijplannen ADD COLUMN geroteerd BOOLEAN NOT NULL DEFAULT false;
```

Bij goedkeuring wordt deze kolom gezet vanuit de plaatsingsdata, zodat de SVG visualisatie weet of het stuk gedraaid is.

### Goedkeuringsfunctie

```sql
CREATE FUNCTION keur_snijvoorstel_goed(p_voorstel_id BIGINT)
RETURNS void AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Guard: alleen concept-voorstellen goedkeuren
  SELECT status INTO v_status FROM snijvoorstellen WHERE id = p_voorstel_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Voorstel % niet gevonden', p_voorstel_id;
  END IF;
  IF v_status <> 'concept' THEN
    RAISE EXCEPTION 'Voorstel % heeft status %, kan alleen concept goedkeuren', p_voorstel_id, v_status;
  END IF;

  -- Guard: alle snijplannen moeten nog op 'Wacht' staan
  IF EXISTS (
    SELECT 1 FROM snijvoorstel_plaatsingen svp
    JOIN snijplannen sp ON sp.id = svp.snijplan_id
    WHERE svp.voorstel_id = p_voorstel_id
      AND sp.status <> 'Wacht'
  ) THEN
    RAISE EXCEPTION 'Niet alle snijplannen staan nog op Wacht — voorstel is verlopen';
  END IF;

  -- Guard: alle rollen moeten nog beschikbaar zijn
  IF EXISTS (
    SELECT 1 FROM snijvoorstel_plaatsingen svp
    JOIN rollen r ON r.id = svp.rol_id
    WHERE svp.voorstel_id = p_voorstel_id
      AND r.status NOT IN ('beschikbaar', 'reststuk')
  ) THEN
    RAISE EXCEPTION 'Niet alle rollen zijn nog beschikbaar — voorstel is verlopen';
  END IF;

  -- Lock rollen om race conditions te voorkomen
  PERFORM 1 FROM rollen
  WHERE id IN (SELECT DISTINCT rol_id FROM snijvoorstel_plaatsingen WHERE voorstel_id = p_voorstel_id)
  FOR UPDATE;

  -- Update snijplannen met plaatsingsdata
  UPDATE snijplannen sp SET
    rol_id = svp.rol_id,
    positie_x_cm = svp.positie_x_cm,
    positie_y_cm = svp.positie_y_cm,
    geroteerd = svp.geroteerd,
    status = 'Gepland'
  FROM snijvoorstel_plaatsingen svp
  WHERE svp.snijplan_id = sp.id
    AND svp.voorstel_id = p_voorstel_id;

  -- Update rollen status
  UPDATE rollen SET status = 'in_snijplan'
  WHERE id IN (
    SELECT DISTINCT rol_id FROM snijvoorstel_plaatsingen
    WHERE voorstel_id = p_voorstel_id
  );

  -- Markeer voorstel als goedgekeurd
  UPDATE snijvoorstellen SET
    status = 'goedgekeurd',
    updated_at = NOW()
  WHERE id = p_voorstel_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Frontend wijzigingen

### Groep-header uitbreiding

In `groep-accordion.tsx`: "Snijplan genereren" knop per kwaliteit+kleur groep (alleen zichtbaar als er 'Wacht'-stukken zijn).

### Nieuwe pagina: Snijvoorstel review

**Route:** `/snijplanning/voorstel/:voorstelId`

**Inhoud:**
- Samenvattingsbalk: X stukken → Y rollen, Z% afval
- Per rol een kaart:
  - `RolHeaderCard` (hergebruik) met rolinfo
  - `SnijVisualisatie` (hergebruik) met SVG van plaatsingen — leest `geroteerd` om oriëntatie te bepalen
  - Afval%, restlengte, geplaatste stukken
  - Individuele "Goedkeuren" knop per rol
- Sectie "Niet-geplaatste stukken" onderaan (als van toepassing)
  - Tabel met stuk, reden, klant, order
- Acties: "Alles goedkeuren" of "Verwerpen"

### Nieuwe queries/hooks

- `useSnijvoorstel(voorstelId)` — haalt voorstel + plaatsingen op
- `useGenereerSnijvoorstel()` — mutation die Edge Function aanroept
- `useKeurSnijvoorstelGoed()` — mutation die goedkeuringsfunctie aanroept
- `useVerwerpSnijvoorstel()` — mutation die voorstel op 'verworpen' zet

---

## Niet-geplaatste stukken

Als er onvoldoende rollen zijn voor alle stukken:
- Het voorstel toont welke stukken niet geplaatst konden worden
- Reden wordt meegegeven: "Geen rol met voldoende ruimte" of "Geen rollen beschikbaar"
- Deze stukken blijven op status 'Wacht'
- Informatief — gebruiker kan rollen bestellen of handmatig toewijzen

---

## Scope buiten dit design

- `in_snijplan` rollen meenemen (bestaande plaatsingen reconstructie) — V2
- Handmatig stukken verplaatsen tussen rollen (drag & drop)
- Handmatig rollen toevoegen/verwijderen uit voorstel
- Batch-optimalisatie over meerdere kwaliteiten tegelijk
- Confectie-integratie na snijden
