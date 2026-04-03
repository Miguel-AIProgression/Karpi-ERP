# Klant Logo's — Import & Weergave Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload 1.800+ klantlogo's naar Supabase Storage, koppel ze aan debiteuren via `logo_path`, en toon ze op de klant-detailpagina.

**Architecture:** Python upload-script leest logo's uit `brondata/logos/`, matcht op `debiteur_nr` (bestandsnaam), uploadt naar Supabase Storage bucket `logos`, en zet `logo_path` in de database. Frontend toont het logo prominent op de klant-detailpagina (al werkend op klant-cards).

**Tech Stack:** Python 3 (supabase-py, Pillow optioneel), Supabase Storage, React/TypeScript frontend

---

## Uitgangssituatie

- **1.931 bestanden** in `brondata/logos/` (geëxtraheerd uit `brondata/wetransfer_klantlogo_2026-04-01_0635.zip`)
- **~1.799** bestanden met debiteur_nr in bestandsnaam (bijv. `100000.jpg`, `682800 limex.jpg`)
- **~132** bestanden met naam/landcode (niet koppelbaar, worden geskipt)
- **79** numerieke bestanden met extra tekst — debiteur_nr wordt uit begin van bestandsnaam geparsed
- DB kolom `debiteuren.logo_path` bestaat al
- Storage bucket `logos` is gepland in schema docs maar moet mogelijk nog aangemaakt worden
- `klant-card.tsx` rendert al logo's via `{SUPABASE_URL}/storage/v1/object/public/logos/{debiteur_nr}.jpg`
- `klant-detail.tsx` toont nog GEEN logo

## Bestandsstructuur

```
import/
  upload_logos.py          ← CREATE: upload script
  config.py                ← MODIFY: LOGOS_DIR al gedefinieerd, geen wijziging nodig

supabase/migrations/
  024_storage_logos_bucket.sql  ← CREATE: bucket + RLS policies

frontend/src/
  pages/klanten/klant-detail.tsx  ← MODIFY: logo toevoegen aan header card
```

---

### Task 1: Supabase Storage bucket + policies migratie

**Files:**
- Create: `supabase/migrations/024_storage_logos_bucket.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- 024: Storage bucket voor klantlogo's
-- Publiek leesbaar, alleen authenticated users mogen uploaden/verwijderen.

-- Bucket aanmaken (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  5242880, -- 5MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Publiek lezen
CREATE POLICY "Logos publiek leesbaar"
ON storage.objects FOR SELECT
USING (bucket_id = 'logos');

-- Auth upload
CREATE POLICY "Auth gebruikers mogen logos uploaden"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos');

-- Auth delete
CREATE POLICY "Auth gebruikers mogen logos verwijderen"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'logos');

-- Auth update (overschrijven)
CREATE POLICY "Auth gebruikers mogen logos updaten"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'logos');
```

- [ ] **Step 2: Pas migratie toe op Supabase**

Als MCP beschikbaar is: `apply_migration`. Anders handmatig via Supabase dashboard SQL editor.

- [ ] **Step 3: Verifieer bucket bestaat**

Check in Supabase dashboard: Storage > Buckets > `logos` moet zichtbaar zijn.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/024_storage_logos_bucket.sql
git commit -m "feat: add storage bucket and policies for client logos"
```

---

### Task 2: Python upload script

**Files:**
- Create: `import/upload_logos.py`

- [ ] **Step 1: Schrijf het upload script**

```python
"""Upload klantlogo's naar Supabase Storage en zet logo_path in debiteuren."""
import re
import sys
from pathlib import Path
from config import SUPABASE_URL, SUPABASE_KEY, LOGOS_DIR
from supabase import create_client

SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
MIME_MAP = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}

def parse_debiteur_nr(filename: str) -> int | None:
    """Extract debiteur_nr from filename. Returns None if not numeric."""
    match = re.match(r'^(\d+)', filename)
    return int(match.group(1)) if match else None

def collect_best_logos(logo_files: list[Path]) -> dict[int, Path]:
    """Deduplicate: als meerdere bestanden dezelfde debiteur_nr hebben,
    prefer het bestand waarvan de stem exact het nummer is (bijv. 101002.jpg > 101002c.JPG)."""
    candidates: dict[int, list[Path]] = {}
    for f in logo_files:
        deb_nr = parse_debiteur_nr(f.stem)
        if deb_nr is None:
            continue
        candidates.setdefault(deb_nr, []).append(f)

    best: dict[int, Path] = {}
    for deb_nr, files in candidates.items():
        # Prefer exact match (stem == str(deb_nr)), then first alphabetically
        exact = [f for f in files if f.stem == str(deb_nr)]
        best[deb_nr] = exact[0] if exact else sorted(files)[0]
    return best

def main():
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Haal alle debiteur_nrs op (ook inactieve — logo moet beschikbaar blijven bij heractivering)
    result = client.table('debiteuren').select('debiteur_nr').execute()
    valid_nrs = {row['debiteur_nr'] for row in result.data}
    print(f"Debiteuren in DB: {len(valid_nrs)}")

    # Verzamel uploadbare logo's en deduplicate
    all_logo_files = [f for f in LOGOS_DIR.iterdir() if f.suffix.lower() in SUPPORTED_EXTENSIONS]
    best_logos = collect_best_logos(all_logo_files)
    print(f"Logo bestanden gevonden: {len(all_logo_files)}")
    print(f"Unieke debiteur_nrs met logo: {len(best_logos)}")

    uploaded = 0
    skipped_no_match = 0
    errors = 0

    for deb_nr, logo_file in sorted(best_logos.items()):
        if deb_nr not in valid_nrs:
            skipped_no_match += 1
            continue

        storage_path = f"{deb_nr}.jpg"
        mime = MIME_MAP.get(logo_file.suffix.lower(), 'image/jpeg')

        try:
            file_bytes = logo_file.read_bytes()
            # Upload (upsert) naar storage
            client.storage.from_('logos').upload(
                storage_path,
                file_bytes,
                file_options={"content-type": mime, "upsert": "true"},
            )
            # Update logo_path in debiteuren
            client.table('debiteuren').update(
                {'logo_path': storage_path}
            ).eq('debiteur_nr', deb_nr).execute()

            uploaded += 1
            if uploaded % 100 == 0:
                print(f"  ... {uploaded} geüpload")
        except Exception as e:
            print(f"  FOUT bij {logo_file.name}: {e}", file=sys.stderr)
            errors += 1

    skipped_no_nr = len(all_logo_files) - sum(len(v) for v in
        {parse_debiteur_nr(f.stem): f for f in all_logo_files if parse_debiteur_nr(f.stem) is not None}.values()
    )  # bestanden zonder numeriek begin

    print(f"\nResultaat:")
    print(f"  Geüpload:          {uploaded}")
    print(f"  Geen debiteur_nr:   {len(all_logo_files) - len(best_logos) - skipped_no_nr} (dubbel)")
    print(f"  Geen nummer:        {skipped_no_nr}")
    print(f"  Geen match in DB:   {skipped_no_match}")
    print(f"  Fouten:             {errors}")

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Dry-run test — controleer parsing en matching**

```bash
cd import && python3 -c "
from upload_logos import parse_debiteur_nr
# Test cases
assert parse_debiteur_nr('100000') == 100000
assert parse_debiteur_nr('682800 limex') == 682800
assert parse_debiteur_nr('911802a') == 911802
assert parse_debiteur_nr('551903B') == 551903
assert parse_debiteur_nr('Pronto') is None
assert parse_debiteur_nr('BY SAMM 521502') is None
assert parse_debiteur_nr('Thumbs') is None
print('Alle parse tests OK')
"
```

- [ ] **Step 3: Voer het upload script uit**

```bash
cd import && python3 upload_logos.py
```

Verwacht: ~1.700+ geüpload, ~130 geskipt (geen debiteur_nr), een handvol geen match.

- [ ] **Step 4: Verifieer in Supabase**

Check in Supabase dashboard: Storage > logos > bestanden zichtbaar.
Check met SQL: `SELECT COUNT(*) FROM debiteuren WHERE logo_path IS NOT NULL;`

- [ ] **Step 5: Commit**

```bash
git add import/upload_logos.py
git commit -m "feat: add logo upload script for Supabase Storage"
```

---

### Task 3: Logo tonen op klant-detailpagina

**Files:**
- Modify: `frontend/src/pages/klanten/klant-detail.tsx:59-84` (header card sectie)

- [ ] **Step 1: Voeg logo toe aan de header card**

In `klant-detail.tsx`, voeg het logo toe boven/naast de klantnaam in de header card. Hergebruik hetzelfde patroon als `klant-card.tsx`:

```tsx
// Bovenaan het bestand, na de imports:
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// In de header card, vervang het huidige <PageHeader> + header card blok:
// Voeg een logo-element toe links in de header card, met fallback naar initialen
```

Concrete wijziging in de header card `div`:

```tsx
<div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
  <div className="flex items-start gap-4 mb-4">
    {/* Logo / initialen */}
    {klant.logo_path ? (
      <img
        src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`}
        alt={klant.naam}
        className="w-16 h-16 rounded-[var(--radius-sm)] object-contain bg-slate-50 border border-slate-100"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    ) : (
      <div className="w-16 h-16 rounded-[var(--radius-sm)] bg-slate-100 flex items-center justify-center text-lg font-medium text-slate-400">
        {klant.naam.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
      </div>
    )}

    <div className="flex-1">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{klant.naam}</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
        <StatusBadge status={klant.status} type="order" />
        <StatusBadge status={klant.tier} type="tier" />
        {klant.vertegenwoordiger_naam && (
          <span className="text-sm text-slate-500">
            Verteg: <span className="font-medium text-slate-700">{klant.vertegenwoordiger_naam}</span>
          </span>
        )}
      </div>
    </div>
  </div>

  {/* Info grid — ongewijzigd */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
    ...bestaande InfoFields...
  </div>
</div>
```

- [ ] **Step 2: Verwijder de losse `<PageHeader title={klant.naam} />`**

Die wordt overbodig omdat de naam nu in de header card zelf zit naast het logo.

- [ ] **Step 3: Visueel testen**

Open een klant met logo (bijv. debiteur_nr 100000) en een zonder → logo of initialen worden correct getoond.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/klanten/klant-detail.tsx
git commit -m "feat: show client logo on klant detail page"
```

---

### Task 4: Docs bijwerken

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/database-schema.md` (alleen als storage sectie aanpassing nodig is)

- [ ] **Step 1: Update changelog.md**

Voeg toe:
```markdown
## 2026-04-03 — Klantlogo's import & weergave
- Storage bucket `logos` aangemaakt met publieke leestoegang
- 1.800+ klantlogo's geüpload naar Supabase Storage via Python script
- Logo zichtbaar op klant-detailpagina (met initialen-fallback)
- Upload script: `import/upload_logos.py`
```

- [ ] **Step 2: Commit**

```bash
git add docs/changelog.md
git commit -m "docs: add changelog entry for client logos feature"
```
