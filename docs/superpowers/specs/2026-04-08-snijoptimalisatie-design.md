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
| Ronde stukken | Behandeld als vierkant (Ø200 = 200×200 cm op de rol) |
| Berekening | Server-side via Supabase Edge Function |
| Rolvolgorde | Reststukken → kleinste rollen → grootste rollen |
| Workflow | Automatisch voorstel → gebruiker keurt goed per rol of volledig |

---

## Architectuur

### Edge Function: `optimaliseer-snijplan`

**Endpoint:** `POST /optimaliseer-snijplan`
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

### Algoritme: FFDH Strip-Packing

```
1. OPHALEN
   - Snijplannen: status='Wacht', matching kwaliteit_code + kleur_code
   - Rollen: status IN ('reststuk','in_snijplan','beschikbaar'), matching kwaliteit_code + kleur_code

2. SORTEREN
   Stukken: aflopend op oppervlak (grootste eerst)
   Rollen:
     a) reststuk — oplopend op oppervlak (kleinste eerst)
     b) in_snijplan — oplopend op resterende ruimte
     c) beschikbaar — oplopend op oppervlak (kleinste eerst)

3. PLAATSEN (per rol)
   shelves = []  // horizontale stroken over de rolbreedte

   Voor elk ongeplaatst stuk:
     Probeer oriëntatie A (L×B) en B (B×L)
     Voor elke oriëntatie:
       a) Zoek bestaande shelf waar stuk past (hoogte ≤ shelf_hoogte, restbreedte ≥ stuk_breedte)
       b) Zo niet: maak nieuwe shelf als restlengte ≥ stuk hoogte
       c) Kies oriëntatie+shelf met minste verspilde ruimte
     Plaats stuk, update shelf, registreer positie_x, positie_y

   Bereken: gebruikte_lengte, afval%, restlengte

4. HERHAAL voor volgende rol als er ongeplaatste stukken zijn

5. OPSLAAN
   - Insert snijvoorstellen record
   - Insert snijvoorstel_plaatsingen per geplaatst stuk
   - Return voorstel_id + volledige plaatsingsdata
```

**Shelf-logica detail:**
- Een shelf is een horizontale strook met vaste hoogte (= hoogte van het eerste stuk dat erin geplaatst wordt)
- Stukken worden links-naar-rechts in een shelf geplaatst
- De shelf-hoogte bepaalt hoeveel lengte van de rol die strook kost
- Nieuwe shelves worden onder de vorige geplaatst (Y neemt toe)

---

## Database wijzigingen

### Nieuwe tabel: `snijvoorstellen`

```sql
CREATE TABLE snijvoorstellen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voorstel_nr TEXT UNIQUE NOT NULL,
  kwaliteit_code TEXT NOT NULL,
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
```

### Goedkeuringsfunctie

```sql
CREATE FUNCTION keur_snijvoorstel_goed(p_voorstel_id BIGINT)
RETURNS void AS $$
BEGIN
  -- Update snijplannen met plaatsingsdata
  UPDATE snijplannen sp SET
    rol_id = svp.rol_id,
    positie_x_cm = svp.positie_x_cm,
    positie_y_cm = svp.positie_y_cm,
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
  - `SnijVisualisatie` (hergebruik) met SVG van plaatsingen
  - Afval%, restlengte, geplaatste stukken
  - Individuele "Goedkeuren" knop per rol
- Sectie "Niet-geplaatste stukken" onderaan (als van toepassing)
  - Tabel met stuk, reden, klant, order
- Acties: "Alles goedkeuren" of "Verwerpen"

### Nieuwe queries/hooks

- `useSnijvoorstel(voorstelId)` — haalt voorstel + plaatsingen op
- `useGenereerSnijvoorstel()` — mutation die Edge Function aanroept
- `useKeurSnijvoorstelGoed()` — mutation die goedkeuringsfunctie aanroept

---

## Niet-geplaatste stukken

Als er onvoldoende rollen zijn voor alle stukken:
- Het voorstel toont welke stukken niet geplaatst konden worden
- Reden wordt meegegeven: "Geen rol met voldoende ruimte" of "Geen rollen beschikbaar"
- Deze stukken blijven op status 'Wacht'
- Informatief — gebruiker kan rollen bestellen of handmatig toewijzen

---

## Scope buiten dit design

- Handmatig stukken verplaatsen tussen rollen (drag & drop)
- Handmatig rollen toevoegen/verwijderen uit voorstel
- Batch-optimalisatie over meerdere kwaliteiten tegelijk
- Confectie-integratie na snijden
