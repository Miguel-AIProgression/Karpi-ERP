# Rollenvoorraad Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchroniseer de `rollen`-tabel in Supabase met de actuele fysieke voorraad uit `Rollenvoorraad per 15042026.xlsx` zonder workflow-state (snijplannen, reststukken, in_snijplan) te verliezen.

**Architecture:** Standalone Python-script (`import/sync_rollen_voorraad.py`) dat het Excel-bestand inleest, een diff maakt tegen de huidige `rollen`-tabel, en drie buckets uitvoert: **toevoegen** (nieuwe rolnummers), **updaten** (bestaande rolnummers — alleen dimensies/waarde, geen workflow-status), **markeren als afgevoerd** (rolnummers niet meer in bronbestand én status=`beschikbaar`/`reststuk`). Rollen met een actieve workflow-status (`in_snijplan`, `gereserveerd`, `gesneden`) worden overgeslagen met waarschuwing. Script draait eerst in **dry-run**-modus en print een rapport; pas na bevestiging wordt geschreven.

**Tech Stack:** Python 3, pandas, openpyxl, supabase-py, bestaande `import/config.py` voor credentials.

---

## Context & risico's

**Bronbestand (project-root):** `Rollenvoorraad per 15042026.xlsx` — 1470 regels, kolommen:
`Artikelnr, Karpi-code, Omschrijving, VVP m2, Rolnummer, Volgnr., Lengte (m), Breedte (m), Ltste Wijz, Oppervlak, Waarde`.

**Doel-tabel:** `rollen` ([docs/database-schema.md:205](docs/database-schema.md#L205)). Relevante kolommen voor sync: `rolnummer` (UK), `artikelnr`, `karpi_code`, `omschrijving`, `lengte_cm`, `breedte_cm`, `oppervlak_m2`, `vvp_m2`, `waarde`, `kwaliteit_code`, `kleur_code`, `zoeksleutel`, `status`.

**Niet aanraken:** `rol_type` (auto-trigger), `oorsprong_rol_id`, `reststuk_datum`, `snijden_*`, `locatie_id`.

**Kritieke risico's:**
1. Rollen die in `snijplannen`/`snijvoorstel_plaatsingen` staan mogen niet verdwijnen of van status wisselen — anders breekt productie-workflow.
2. Eenheden: bronbestand in **meters** (Lengte/Breedte), database in **cm**. Conversie × 100, afronden op int.
3. `Karpi-code` → `kwaliteit_code` (eerste 3-4 letters) en `kleur_code` (eerste 2 cijfers na letters) afleiden; zie bestaande logica in `brondata/voorraad/karpi_import.py` of `import/supabase_import.py`.
4. Duplicate rolnummers in bron: eerste voorkomen behouden (consistent met bestaande importlogica).

---

## File Structure

- Create: `import/sync_rollen_voorraad.py` — orchestrator (laad, diff, rapport, schrijf)
- Reuse: `import/config.py` — Supabase credentials + pad naar `Rollenvoorraad per 15042026.xlsx` (nieuwe config-var `ROLLEN_SYNC_FILE`)
- Docs: `docs/changelog.md` — logregel met datum + aantallen

---

### Task 1: Config uitbreiden en Excel-verkenning

**Files:**
- Modify: `import/config.py`
- Create: `import/sync_rollen_voorraad.py` (skeleton met alleen inlezen + printen samenvatting)

- [ ] **Step 1: Voeg `ROLLEN_SYNC_FILE` toe aan `import/config.py`**

```python
# Pad naar het actuele voorraad-snapshot bestand voor sync
ROLLEN_SYNC_FILE = os.path.join(BASE_DIR, "..", "Rollenvoorraad per 15042026.xlsx")
```

(volg bestaande conventie in `config.py` — controleer eerst of die `BASE_DIR`/`os.path` gebruikt en pas aan)

- [ ] **Step 2: Maak skeleton `import/sync_rollen_voorraad.py`**

```python
"""
Sync rollen-tabel in Supabase met actuele fysieke voorraad uit Excel-snapshot.

Draai standaard in dry-run:  python sync_rollen_voorraad.py
Schrijf wijzigingen:          python sync_rollen_voorraad.py --apply
"""
import sys
import argparse
import pandas as pd
import numpy as np
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, ROLLEN_SYNC_FILE

def parse_karpi_code(code: str):
    """Karpi-code -> (kwaliteit_code, kleur_code, zoeksleutel)."""
    if not code:
        return None, None, None
    s = str(code).strip()
    # Eerste aaneengesloten letters = kwaliteit
    i = 0
    while i < len(s) and s[i].isalpha():
        i += 1
    kwaliteit = s[:i] or None
    # Eerste 2 cijfers daarna = kleur
    rest = s[i:]
    j = 0
    while j < len(rest) and rest[j].isdigit():
        j += 1
    kleur = rest[:min(2, j)] if j >= 2 else None
    zoek = f"{kwaliteit}_{kleur}" if kwaliteit and kleur else None
    return kwaliteit, kleur, zoek


def load_bron(path: str) -> pd.DataFrame:
    df = pd.read_excel(path)
    df = df.rename(columns={
        'Artikelnr': 'artikelnr',
        'Karpi-code': 'karpi_code',
        'Omschrijving': 'omschrijving',
        'VVP m2': 'vvp_m2',
        'Rolnummer': 'rolnummer',
        'Lengte (m)': 'lengte_m',
        'Breedte (m)': 'breedte_m',
        'Oppervlak': 'oppervlak_m2',
        'Waarde': 'waarde',
    })
    df['rolnummer'] = df['rolnummer'].astype(str).str.strip()
    df['artikelnr'] = df['artikelnr'].apply(lambda v: str(int(v)) if pd.notna(v) else None)
    df['lengte_cm'] = (df['lengte_m'] * 100).round().astype('Int64')
    df['breedte_cm'] = (df['breedte_m'] * 100).round().astype('Int64')
    kw_kl_zk = df['karpi_code'].apply(parse_karpi_code)
    df['kwaliteit_code'] = kw_kl_zk.apply(lambda t: t[0])
    df['kleur_code'] = kw_kl_zk.apply(lambda t: t[1])
    df['zoeksleutel'] = kw_kl_zk.apply(lambda t: t[2])
    # Dedup op rolnummer, eerste houdt
    df = df.drop_duplicates(subset=['rolnummer'], keep='first')
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Daadwerkelijk schrijven (default: dry-run)')
    args = ap.parse_args()

    print(f"Laden: {ROLLEN_SYNC_FILE}")
    df = load_bron(ROLLEN_SYNC_FILE)
    print(f"  {len(df)} unieke rollen in bron")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("Huidige rollen ophalen uit Supabase...")
    # paginated fetch (supabase-py default limit 1000)
    huidige = []
    page = 0
    while True:
        resp = sb.table('rollen').select(
            'id,rolnummer,artikelnr,lengte_cm,breedte_cm,oppervlak_m2,vvp_m2,waarde,status'
        ).range(page*1000, (page+1)*1000 - 1).execute()
        huidige.extend(resp.data)
        if len(resp.data) < 1000:
            break
        page += 1
    print(f"  {len(huidige)} rollen in database")

    # TODO: diff + rapport + apply
    print("(nog geen diff geïmplementeerd)")


if __name__ == '__main__':
    main()
```

- [ ] **Step 3: Verifieer inlezen**

Run: `cd import && python sync_rollen_voorraad.py`
Expected output: `1470 unieke rollen in bron` (of iets in die buurt na dedup) + aantal huidige rollen uit database.

- [ ] **Step 4: Commit**

```bash
git add import/config.py import/sync_rollen_voorraad.py
git commit -m "feat(import): skeleton voor rollen-voorraad sync (dry-run inlezen)"
```

---

### Task 2: Diff-logica + rapport

**Files:**
- Modify: `import/sync_rollen_voorraad.py`

- [ ] **Step 1: Voeg diff-functie toe (plak vóór `main()`)**

```python
PROTECTED_STATUSSEN = {'in_snijplan', 'gereserveerd', 'gesneden'}
AFVOEREN_STATUSSEN = {'beschikbaar', 'reststuk'}  # mag status=verkocht krijgen als niet meer in bron


def diff(df_bron: pd.DataFrame, huidige: list[dict]):
    bron_map = {r['rolnummer']: r for _, r in df_bron.iterrows()}
    huidig_map = {h['rolnummer']: h for h in huidige}

    nieuw = []          # insert
    update = []         # update dims/waarde
    afvoeren = []       # status -> 'geen_voorraad'
    beschermd_weg = []  # NIET in bron, maar workflow-status -> waarschuwing, niets doen

    for rolnr, bron in bron_map.items():
        if rolnr not in huidig_map:
            nieuw.append(bron)
            continue
        db = huidig_map[rolnr]
        veranderd = (
            _neq_int(bron['lengte_cm'], db.get('lengte_cm')) or
            _neq_int(bron['breedte_cm'], db.get('breedte_cm')) or
            _neq_float(bron['oppervlak_m2'], db.get('oppervlak_m2')) or
            _neq_float(bron['vvp_m2'], db.get('vvp_m2')) or
            _neq_float(bron['waarde'], db.get('waarde'))
        )
        if veranderd:
            update.append((db['id'], bron))

    for rolnr, db in huidig_map.items():
        if rolnr in bron_map:
            continue
        status = (db.get('status') or '').lower()
        if status in PROTECTED_STATUSSEN:
            beschermd_weg.append(db)
        elif status in AFVOEREN_STATUSSEN or status == '':
            afvoeren.append(db)
        else:
            # onbekende status - log en negeer
            beschermd_weg.append(db)

    return nieuw, update, afvoeren, beschermd_weg


def _neq_int(a, b):
    if pd.isna(a) and b is None: return False
    if pd.isna(a) or b is None: return True
    return int(a) != int(b)

def _neq_float(a, b, tol=0.01):
    if pd.isna(a) and b is None: return False
    if pd.isna(a) or b is None: return True
    return abs(float(a) - float(b)) > tol
```

- [ ] **Step 2: Roep diff aan in `main()` en print rapport**

Vervang de `# TODO: diff` regel door:

```python
    nieuw, update, afvoeren, beschermd_weg = diff(df, huidige)
    print("\n=== DIFF RAPPORT ===")
    print(f"  Toevoegen:                    {len(nieuw)}")
    print(f"  Updaten (dims/waarde):        {len(update)}")
    print(f"  Afvoeren (status=verkocht):   {len(afvoeren)}")
    print(f"  Beschermd (workflow-actief):  {len(beschermd_weg)}")
    if beschermd_weg:
        print("    Eerste 10 beschermde rollen (niet in bron, workflow-status):")
        for d in beschermd_weg[:10]:
            print(f"      {d['rolnummer']} status={d.get('status')}")
```

- [ ] **Step 3: Dry-run en review met gebruiker**

Run: `cd import && python sync_rollen_voorraad.py`
Stop hier. Toon de gebruiker het rapport. Alleen doorgaan met Task 3 na bevestiging dat de aantallen kloppen.

- [ ] **Step 4: Commit**

```bash
git add import/sync_rollen_voorraad.py
git commit -m "feat(import): diff-rapport voor rollen-voorraad sync"
```

---

### Task 3: Apply-logica (schrijven)

**Files:**
- Modify: `import/sync_rollen_voorraad.py`

- [ ] **Step 1: Helper-functies voor schrijven**

Voeg toe boven `main()`:

```python
def _clean(v):
    if v is None: return None
    if isinstance(v, float) and np.isnan(v): return None
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.floating,)): return float(v)
    return v


def bouw_insert_record(r) -> dict:
    return {
        'rolnummer': str(r['rolnummer']),
        'artikelnr': _clean(r['artikelnr']),
        'karpi_code': _clean(r['karpi_code']),
        'omschrijving': _clean(r['omschrijving']),
        'lengte_cm': int(r['lengte_cm']) if pd.notna(r['lengte_cm']) else None,
        'breedte_cm': int(r['breedte_cm']) if pd.notna(r['breedte_cm']) else None,
        'oppervlak_m2': _clean(r['oppervlak_m2']),
        'vvp_m2': _clean(r['vvp_m2']),
        'waarde': _clean(r['waarde']),
        'kwaliteit_code': _clean(r['kwaliteit_code']),
        'kleur_code': _clean(r['kleur_code']),
        'zoeksleutel': _clean(r['zoeksleutel']),
        'status': 'beschikbaar',
    }


def bouw_update_record(r) -> dict:
    return {
        'lengte_cm': int(r['lengte_cm']) if pd.notna(r['lengte_cm']) else None,
        'breedte_cm': int(r['breedte_cm']) if pd.notna(r['breedte_cm']) else None,
        'oppervlak_m2': _clean(r['oppervlak_m2']),
        'vvp_m2': _clean(r['vvp_m2']),
        'waarde': _clean(r['waarde']),
    }
```

- [ ] **Step 2: Apply-blok in `main()`**

Na het rapport:

```python
    if not args.apply:
        print("\nDry-run. Draai opnieuw met --apply om te schrijven.")
        return

    print("\n>>> Schrijven naar Supabase...")

    # Insert in batches
    if nieuw:
        records = [bouw_insert_record(r) for _, r in pd.DataFrame(nieuw).iterrows()] \
            if isinstance(nieuw[0], pd.Series) else [bouw_insert_record(r) for r in nieuw]
        # Eenvoudiger: gebruik direct de Series-list
        records = [bouw_insert_record(r) for r in nieuw]
        for i in range(0, len(records), 500):
            batch = records[i:i+500]
            sb.table('rollen').insert(batch).execute()
            print(f"  insert: {min(i+500, len(records))}/{len(records)}")

    # Update per rij (kleine aantallen; indien groot: switch naar RPC)
    for idx, (rol_id, r) in enumerate(update, 1):
        sb.table('rollen').update(bouw_update_record(r)).eq('id', rol_id).execute()
        if idx % 100 == 0:
            print(f"  update: {idx}/{len(update)}")
    if update:
        print(f"  update: {len(update)}/{len(update)}")

    # Afvoeren: status -> verkocht
    if afvoeren:
        ids = [d['id'] for d in afvoeren]
        for i in range(0, len(ids), 500):
            batch = ids[i:i+500]
            sb.table('rollen').update({'status': 'geen_voorraad'}).in_('id', batch).execute()
            print(f"  afvoeren: {min(i+500, len(ids))}/{len(ids)}")

    print("\n Klaar.")
```

- [ ] **Step 3: Dry-run opnieuw, bevestig rapport, dan apply**

```bash
cd import
python sync_rollen_voorraad.py           # review
python sync_rollen_voorraad.py --apply   # pas na akkoord
```

- [ ] **Step 4: Verifieer in Supabase**

```sql
SELECT status, COUNT(*) FROM rollen GROUP BY status ORDER BY 2 DESC;
SELECT COUNT(*) FROM rollen WHERE status='beschikbaar';
```

Vergelijk `beschikbaar`-aantal met ±1470 (bron). Check steekproef: `SELECT * FROM rollen WHERE rolnummer='S0375-1CBON';` → lengte_cm=900, breedte_cm=148.

- [ ] **Step 5: Changelog + commit**

Voeg regel toe aan `docs/changelog.md`:

```markdown
## 2026-04-15 — Rollenvoorraad gesynchroniseerd
- Script: `import/sync_rollen_voorraad.py`
- Bron: `Rollenvoorraad per 15042026.xlsx`
- Nieuw: <N>, geüpdatet: <N>, afgevoerd (verkocht): <N>, beschermd overgeslagen: <N>
```

```bash
git add import/sync_rollen_voorraad.py docs/changelog.md
git commit -m "feat(import): rollen-voorraad sync met diff + apply-modus"
```

---

## Beslissingen (vastgelegd 2026-04-15)

1. **Afvoer-status = `'geen_voorraad'`** (niet `'geen_voorraad'`, want we weten niet of ze verkocht zijn).
2. **Beschermde rollen niet in bron:** alleen waarschuwen, niets aanraken. Workflow-actieve rollen zijn fysiek nog in huis (mid-snijden/gereserveerd); bron-snapshot kan mismatchen.
3. **`Ltste Wijz` / `Volgnr.`:** negeren.
