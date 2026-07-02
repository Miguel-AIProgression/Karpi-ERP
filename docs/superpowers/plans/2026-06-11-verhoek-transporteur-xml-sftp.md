# Verhoek als transporteur (XML via SFTP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verhoek Europe als tweede actieve vervoerder: per zending een Verhoek AA2.0-XML genereren en via SFTP afleveren. **Fase 1 (nu, geen Verhoek-input nodig)** bouwt en deployt de volledige keten met een dry-run-upload; **Fase 2 (na antwoorden)** is alleen nog: secrets zetten + één config-UPDATE + vervoerder activeren — géén redeploy.

**Architectuur:** Maximaal hergebruik van de HST-koppeling (zie hergebruik-tabel). Nieuwe vervoerder `verhoek_sftp` (type `'sftp'`) in `vervoerders`, eigen adapter-tabel `verhoek_transportorders` (mig 171-patroon), edge function `verhoek-send` met pure `xml-builder.ts` (unit-getest), dispatch via nieuwe `WHEN 'sftp'`-tak in `enqueue_zending_naar_vervoerder`. **Alle Verhoek-onbekenden zijn runtime-config** (`app_config` sleutel `'verhoek'` + secrets), zodat antwoorden van Verhoek géén code-wijziging vragen. XML-formaat: `XMLstandardVerhoekEuropeAA20.xml` (voorbeeld in repo-root) + eisen-mail Gerrit Altena; ons testbestand `Karpi_20260611195317_ZEND-2026-0042.xml` + mailconcept `Verhoek-testmail-concept.md` staan al klaar in de repo-root.

**Tech Stack:** Supabase (PostgreSQL, pg_cron, Edge Functions/Deno), `npm:ssh2-sftp-client`, TypeScript, bestaande `_shared`-seams.

---

## Hergebruik uit de HST-koppeling

| Bestaand (HST) | Hergebruik voor Verhoek |
|---|---|
| `splitAdres` + `normalizeCountry` ([hst-send/payload-builder.ts](supabase/functions/hst-send/payload-builder.ts)) | **Geëxtraheerd naar `_shared/adres-split.ts`** (Taak 4) — beide vervoerders willen straat/huisnummer apart |
| `valideerVoorVervoerder`-seam ([_shared/vervoerder-eisen.ts](supabase/functions/_shared/vervoerder-eisen.ts) + frontend-spiegel) | **Uitgebreid** met `verhoek_sftp`-tak (Taak 8) — zelfde preflight-poort, zelfde UI-waarschuwingsvlag |
| `enqueue_zending_naar_vervoerder` switch-RPC (mig 210) | **Nieuwe `WHEN 'sftp'`-tak** — trigger, selector, override-ladder (mig 219/225) allemaal ongewijzigd |
| Orderregel-vervoerder-override (UI + resolver) | **Ongewijzigd** — Verhoek is na mig 371 direct kiesbaar als override; pilot draait hier volledig op |
| `zending_colli` + SSCC's + `genereer_zending_colli` (mig 209/248) | **Ongewijzigd** — zelfde colli's, zelfde barcode (`00`+SSCC) als op het label |
| `app_config.bedrijfsgegevens` | **Zelfde record** voor Opdrachtgever/Afzender-blokken |
| `externe_payloads` + `log_externe_payload` (mig 324/325) | **Zelfde audit-RPC**, kanaal `'verhoek'`, richting `'out'`, één rij per poging |
| Storage-bucket `order-documenten` | **Zelfde bucket**, pad `verhoek-xml/` (naast `hst-vrachtbrieven/`) |
| Queue-patroon mig 171 (claim/markeer/retry) + reaper mig 337 + monitor mig 338 | **Gespiegeld** als `verhoek_transportorders` — bewust eigen tabel (adapter-tabellen zijn vervoerder-specifiek, zie mig 171-comment), maar identieke RPC-vormen |
| Cron-patroon mig 173 + vault-secret `cron_token` + `CRON_TOKEN`-auth | **Zelfde vault-secret en auth-patroon**, nieuwe job `verhoek-send-elke-minuut` |
| `vervoerder_stats`-view + `/logistiek/vervoerders`-pagina | **Ongewijzigd** — Verhoek verschijnt automatisch zodra de rij bestaat |

Niet gedeeld (bewust): de orchestrator-loop van `hst-send/index.ts` wordt gespiegeld, niet geëxtraheerd — HST is live en stabiel; een gedeelde abstractie nu = risico zonder winst. Derde vervoerder = moment om te generaliseren.

## Config-gedreven onbekenden (kern van het twee-fasen-ontwerp)

Alles wat Verhoek nog moet beantwoorden landt in **config, niet code**:

| Onbekende (vraag in mail) | Waar het landt | Go-live-actie |
|---|---|---|
| Opdrachtgevernummer (vraag 1) | `app_config.verhoek.opdrachtgever_nummer` (nu `''`) | SQL-UPDATE |
| ScanCode mét/zonder `00`-prefix (mail-vraag) | `app_config.verhoek.scancode_met_00_prefix` (nu `true`) | SQL-UPDATE |
| Levering / SoortLevering-codes (vraag 2) | `app_config.verhoek.levering` / `.soort_levering` (nu `'1'`/`'1'`) | SQL-UPDATE |
| Verpakkingseenheid (vraag 4) | `app_config.verhoek.verpakkingseenheid` (nu `'Rol'`) | SQL-UPDATE |
| SFTP host/poort/user/wachtwoord/map (vraag 6) | Secrets `VERHOEK_SFTP_*` | `supabase secrets set` |
| Dry-run vs. echt uploaden | Secret `VERHOEK_DRY_RUN` (default **true** — veilig) | `supabase secrets set VERHOEK_DRY_RUN=false` |
| Lege tags weglaten? (vraag 5) | Builder stuurt nu lege tags (= het voorbeeldbestand zelf, veiligste default) | alleen bij afwijkend antwoord een kleine builder-tweak |
| VerzendNummer/ArtikelID-verwachting (vraag 3) | Builder: ArtikelID=artikelnr, VerzendNummer leeg | alleen bij afwijkend antwoord een kleine builder-tweak |

De edge function leest `app_config.verhoek` **per run** — een config-UPDATE werkt dus direct, zonder redeploy.

### Menselijke acties / afhankelijkheden

1. **Miguel**: mailconcept `Verhoek-testmail-concept.md` + testbestand versturen (staat klaar; vragen 1-7 zitten erin).
2. **Verhoek**: antwoorden op vragen 1-7, m.n. SFTP-gegevens → start Fase 2.
3. Fase 1 (Taken 1-13) heeft **geen** van beide nodig.

### Scope-afbakening (bewust NIET in dit plan)

- Monitor-UI-paneel (spiegel `hst-monitor-panel.tsx`) + aandacht-banner: follow-up ná de pilot; de SQL-monitor-view bestaat wél (Taak 7).
- Automatische selectie-regels / `is_default`-omzetting: pilot = handmatige override; regels zijn een apart besluit ná de pilot.
- Statusterugkoppeling van Verhoek (T&T/Orderstatus via hun SFTP-out): V2-backlog, afhankelijk van antwoord vraag 7.

### Werkafspraken voor de uitvoerder

- **Eigen worktree + branch `feat/verhoek-transporteur`** vanaf de start (collisie-incident 8 juni). `.env`-bestanden ontbreken in een verse worktree — kopieer ze (Taak 1).
- **Migratienummers 371-373 zijn aannames** (max op main = 370). Her-verifieer vlak vóór elke apply én vóór merge (collisie-incident 10 juni). Migraties handmatig applyen (MCP `apply_migration` / SQL-editor) — **géén `supabase db push`**.
- Tekstbestanden via Write/Edit-tool (PS 5.1 verminkt BOM-loos UTF-8).
- Edge functions: `supabase functions deploy <naam> --project-ref wqzeevfobwauxkalagtn --no-verify-jwt`.
- Merge naar `main` pas op expliciet commando van Miguel; merge via push van `branch:main` naar origin (merge-race-les 11 juni).

---

## File-structuur (overzicht)

```
docs/adr/0031-verhoek-xml-sftp-adapter.md                  ← nieuw (Taak 2)
supabase/migrations/371_vervoerder_verhoek_sftp.sql        ← nieuw (Taak 3, incl. app_config-seed)
supabase/migrations/372_verhoek_transportorders.sql        ← nieuw (Taak 7)
supabase/migrations/373_verhoek_send_cron.sql              ← nieuw (Taak 12)
supabase/functions/_shared/adres-split.ts(.test.ts)        ← nieuw (Taak 4, extractie uit hst-send)
supabase/functions/hst-send/payload-builder.ts             ← wijzigen (Taak 4: import uit _shared)
supabase/functions/_shared/vervoerder-eisen.ts(.test.ts)   ← wijzigen (Taak 8)
frontend/src/lib/orders/vervoerder-eisen.ts                ← wijzigen (Taak 8, spiegel)
supabase/functions/verhoek-send/types.ts                   ← nieuw (Taak 5)
supabase/functions/verhoek-send/xml-builder.ts(.test.ts)   ← nieuw (Taak 5)
supabase/functions/verhoek-send/genereer-proef-xml.ts      ← nieuw (Taak 6, lokaal script)
supabase/functions/verhoek-send/sftp-client.ts             ← nieuw (Taak 9)
supabase/functions/verhoek-sftp-spike/index.ts             ← nieuw (Taak 9, wegwerpfunctie)
supabase/functions/verhoek-send/index.ts + deno.json       ← nieuw (Taak 10-11)
docs/changelog.md, docs/database-schema.md,
docs/architectuur.md, CLAUDE.md                            ← bijwerken (Taak 13)
```

---

# FASE 1 — Nu bouwen (geen Verhoek-input nodig)

### Taak 1: Worktree + branch

- [ ] **Stap 1: Worktree aanmaken** (REQUIRED SUB-SKILL: superpowers:using-git-worktrees)

```powershell
git worktree add ../Karpi-ERP-verhoek -b feat/verhoek-transporteur
Copy-Item ".env" "..\Karpi-ERP-verhoek\.env" -ErrorAction SilentlyContinue
Copy-Item "frontend\.env" "..\Karpi-ERP-verhoek\frontend\.env" -ErrorAction SilentlyContinue
Copy-Item "supabase\functions\.env" "..\Karpi-ERP-verhoek\supabase\functions\.env" -ErrorAction SilentlyContinue
```

- [ ] **Stap 2: Verifieer**

Run: `git rev-parse --abbrev-ref HEAD` → verwacht `feat/verhoek-transporteur`.

---

### Taak 2: ADR-0031 — Verhoek via eigen XML over SFTP

**Files:**
- Create: `docs/adr/0031-verhoek-xml-sftp-adapter.md`

- [ ] **Stap 1: Schrijf de ADR**

```markdown
# ADR-0031: Verhoek-koppeling via eigen AA2.0-XML over SFTP (niet Transus-EDI)

Datum: 2026-06-11
Status: Geaccepteerd

## Context

Mig 170 zaaide Verhoek als `edi_partner_b` (type `'edi'`) in de aanname dat
verzendberichten naar Verhoek via Transus zouden lopen. Mail Gerrit Altena
(Verhoek, juni 2026): hun voorkeursmethode is hun eigen XML-formaat
"XMLstandardVerhoekEuropeAA20" (AA2.0) aangeleverd via SFTP. Wij leveren hun
formaat 1-op-1 aan op hun server; Verhoek vertaalt niets.

## Beslissing

1. Verhoek wordt een **eigen adapter** naar het HST-patroon (mig 171-173):
   adapter-tabel `verhoek_transportorders`, cron-gedreven edge function
   `verhoek-send`, pure `xml-builder.ts`, preflight via de
   `vervoerder-eisen`-seam, audit via `externe_payloads` (kanaal `'verhoek'`)
   + XML-kopie in storage. Maximaal hergebruik: `splitAdres`/`normalizeCountry`
   verhuizen naar `_shared/adres-split.ts`; switch-RPC krijgt een
   `WHEN 'sftp'`-tak; cron hergebruikt het vault-secret `cron_token`.
2. Nieuwe vervoerder-rij `verhoek_sftp` met nieuw type `'sftp'`; de
   placeholder `edi_partner_b` wordt guarded verwijderd.
3. **Twee-fasen-uitrol**: alle Verhoek-onbekenden (opdrachtgevernummer,
   ScanCode-prefix, Levering/SoortLevering-codes, Verpakkingseenheid) leven in
   `app_config` sleutel `'verhoek'` (per run gelezen); SFTP-credentials +
   `VERHOEK_DRY_RUN` als secrets. Fase 1 deployt de hele keten met
   `VERHOEK_DRY_RUN=true` (geen upload, wél XML/audit/storage); go-live =
   secrets + config-UPDATE + `actief=TRUE` — géén redeploy.
4. **1 zending = 1 XML-bestand** (`Karpi_<timestamp>_<zending_nr>.xml`).
   `Referentie` = `zending_nr`, `ScanCode` = label-barcode (`'00'+SSCC`,
   prefix configureerbaar), `Gewicht` in decagram, `Lengte`/`Breedte` in hele
   cm — verplicht per Verhoek; ontbreken ⇒ rij op Fout mét reden, géén upload.
5. SFTP vanuit de edge runtime wordt vooraf bewezen met een spike tegen een
   publieke test-SFTP-server (geen Verhoek-credentials nodig). Faalt de
   runtime ⇒ fallback: n8n-SFTP-workflow of Python-worker leegt dezelfde
   wachtrij; alleen `sftp-client.ts`/de upload-stap verschuift.

## Gevolgen

- `vervoerders.type` krijgt waarde `'sftp'`; de `'edi'`-tak blijft voor evt.
  toekomstige échte EDI-vervoerders (Rhenus).
- hst-send importeert `splitAdres` voortaan uit `_shared` (gedrag identiek;
  gaat mee bij de eerstvolgende hst-deploy).
- Derde vervoerder = moment om de orchestrator-loop te generaliseren — nu
  bewust gespiegeld, niet geabstraheerd (HST is live en stabiel).
- Statusterugkoppeling van Verhoek: V2-backlog.
```

- [ ] **Stap 2: Commit**

```powershell
git add docs/adr/0031-verhoek-xml-sftp-adapter.md
git commit -m "docs(adr): ADR-0031 Verhoek via eigen AA2.0-XML over SFTP, twee-fasen-uitrol"
```

---

### Taak 3: Migratie 371 — vervoerder-rij + config-record

**Files:**
- Create: `supabase/migrations/371_vervoerder_verhoek_sftp.sql`

- [ ] **Stap 1: Verifieer het vrije migratienummer**

Run: `Get-ChildItem supabase\migrations -Filter *.sql | Sort-Object Name -Descending | Select-Object -First 3 -ExpandProperty Name`
Verwacht: hoogste = `370_...`. Zo niet: hernummer 371→volgend vrij nummer (en 372/373 idem) in alle taken.

- [ ] **Stap 2: Schrijf de migratie**

```sql
-- Migratie 371: vervoerder verhoek_sftp + type 'sftp' + app_config 'verhoek'
-- Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md
-- ADR-0031: Verhoek via eigen AA2.0-XML over SFTP (niet Transus-EDI).
--
-- Idempotent.

-- 1. CHECK-constraint uitbreiden met 'sftp' (mig 170: api/edi; mig 207: +print)
ALTER TABLE vervoerders DROP CONSTRAINT IF EXISTS vervoerders_type_check;
ALTER TABLE vervoerders ADD CONSTRAINT vervoerders_type_check
  CHECK (type IN ('api', 'edi', 'print', 'sftp'));

-- 2. Nieuwe vervoerder. actief=FALSE tot de rondreis-test met Verhoek slaagt.
INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
  ('verhoek_sftp', 'Verhoek', 'sftp', FALSE,
   'Verhoek Europe — AA2.0-XML via SFTP (ADR-0031). actief pas na geslaagde rondreis-test. '
   'Pilot: alleen handmatige override per orderregel, geen selectie-regels. '
   'Config: app_config sleutel ''verhoek''; secrets VERHOEK_SFTP_* + VERHOEK_DRY_RUN.')
ON CONFLICT (code) DO NOTHING;

-- 3. Placeholder edi_partner_b ('Verhoek', type edi, mig 170) opruimen.
--    Guarded: blijft staan als er tóch ergens een FK naar wijst.
DO $$
BEGIN
  BEGIN
    DELETE FROM vervoerders WHERE code = 'edi_partner_b';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'edi_partner_b wordt nog gerefereerd - blijft staan';
  END;
END $$;

-- 4. Runtime-config voor de XML-builder (ADR-0031: antwoorden van Verhoek =
--    SQL-UPDATE hier, géén redeploy — verhoek-send leest dit record per run).
--    opdrachtgever_nummer '' = nog onbekend; verhoek-send weigert echte
--    (niet-dry-run) verzending zolang dit leeg is.
INSERT INTO app_config (sleutel, waarde)
VALUES ('verhoek', jsonb_build_object(
  'opdrachtgever_nummer',   '',
  'scancode_met_00_prefix', TRUE,
  'verpakkingseenheid',     'Rol',
  'levering',               '1',
  'soort_levering',         '1'
))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Stap 3: Apply + verifieer**

Run (MCP `execute_sql`): `SELECT code, type, actief FROM vervoerders WHERE code IN ('verhoek_sftp','edi_partner_b'); SELECT waarde FROM app_config WHERE sleutel='verhoek';`
Verwacht: `verhoek_sftp | sftp | f`, geen `edi_partner_b`, config-JSONB met 5 sleutels.

- [ ] **Stap 4: Commit**

```powershell
git add supabase/migrations/371_vervoerder_verhoek_sftp.sql
git commit -m "feat(logistiek): vervoerder verhoek_sftp + app_config 'verhoek' (mig 371, ADR-0031)"
```

---

### Taak 4: `_shared/adres-split.ts` — hergebruik HST-adreslogica

Verhoek wil `OntvangerStraat` + `OntvangerHuisnummer` apart — exact wat `splitAdres` in [hst-send/payload-builder.ts:177](supabase/functions/hst-send/payload-builder.ts#L177) al doet (incl. de incident-fixes voor haakjes/komma's/vastgeplakte toevoegingen). Extractie naar de seam i.p.v. kopiëren.

**Files:**
- Create: `supabase/functions/_shared/adres-split.ts`
- Create: `supabase/functions/_shared/adres-split.test.ts`
- Modify: `supabase/functions/hst-send/payload-builder.ts`

- [ ] **Stap 1: Maak `_shared/adres-split.ts`** — verplaats `splitAdres` (payload-builder.ts regels 167-206) en `normalizeCountry` (regels 213-224) **letterlijk inclusief commentaarblokken**, met deze header en `export` op beide functies:

```typescript
// Gedeelde adres-helpers voor vervoerder-adapters (hst-send, verhoek-send).
// Puur — geen DB/secrets. Geëxtraheerd uit hst-send/payload-builder.ts
// (ADR-0031): beide vervoerders willen straat + huisnummer in aparte velden.

// [letterlijk hierheen: export function splitAdres(...) — body + commentaar
//  ongewijzigd uit hst-send/payload-builder.ts regels 167-206]

// [letterlijk hierheen: function normalizeCountry(...) uit regels 213-224,
//  mét toegevoegd `export`-keyword]
```

- [ ] **Stap 2: Pas `hst-send/payload-builder.ts` aan**
  - Bovenaan: `import { splitAdres, normalizeCountry } from '../_shared/adres-split.ts';`
  - Direct daaronder (houdt `payload-builder.test.ts` compilerend): `export { splitAdres };`
  - Verwijder de lokale definities van `splitAdres` en `normalizeCountry`. `verdeelToevoeging` en `normalizeZip` blijven (HST-specifiek).

- [ ] **Stap 3: Maak `_shared/adres-split.test.ts`**

```typescript
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeCountry, splitAdres } from './adres-split.ts';

Deno.test('splitAdres: standaard adres', () => {
  assertEquals(splitAdres('Tweede Broekdijk 10'), { street: 'Tweede Broekdijk', number: '10', addition: '' });
});

Deno.test('splitAdres: toevoeging vast aan nummer', () => {
  assertEquals(splitAdres('Raasdorperweg 181G'), { street: 'Raasdorperweg', number: '181', addition: 'G' });
});

Deno.test('splitAdres: haakjes worden toevoeging (incident ZEND-2026-0002)', () => {
  assertEquals(splitAdres('Saturnusstraat 60 (Unit 30)'), { street: 'Saturnusstraat', number: '60', addition: 'Unit 30' });
});

Deno.test('normalizeCountry: NL/DE-varianten', () => {
  assertEquals(normalizeCountry('Nederland'), 'NL');
  assertEquals(normalizeCountry('nl'), 'NL');
  assertEquals(normalizeCountry('Duitsland'), 'DE');
});
```

- [ ] **Stap 4: Run beide testbestanden — extractie moet gedragsneutraal zijn**

Run: `deno test supabase/functions/_shared/adres-split.test.ts supabase/functions/hst-send/payload-builder.test.ts`
Verwacht: PASS.

- [ ] **Stap 5: Commit** (hst-send hoeft niet direct herdeployed — identiek gedrag; gaat mee met de eerstvolgende hst-deploy)

```powershell
git add supabase/functions/_shared/adres-split.ts supabase/functions/_shared/adres-split.test.ts supabase/functions/hst-send/payload-builder.ts
git commit -m "refactor(logistiek): splitAdres/normalizeCountry naar _shared/adres-split (ADR-0031)"
```

---

### Taak 5: Pure XML-builder met config-opties (TDD)

**Files:**
- Create: `supabase/functions/verhoek-send/types.ts`
- Create: `supabase/functions/verhoek-send/xml-builder.test.ts`
- Create: `supabase/functions/verhoek-send/xml-builder.ts`

- [ ] **Stap 1: Maak `types.ts`**

```typescript
// Verhoek-specifieke types voor de verhoek-send edge function.
// Bron-van-waarheid: XMLstandardVerhoekEuropeAA20.xml (voorbeeld Verhoek) +
// eisen-mail Gerrit Altena. Leeft bewust binnen de verticale slice.
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

export interface ZendingInput {
  zending_nr: string;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
  afl_land: string | null;
  afl_telefoon: string | null;
  afl_email: string | null;
  opmerkingen: string | null;
  verzenddatum: string | null; // ISO 'YYYY-MM-DD'
}

export interface OrderInput {
  order_nr: string;
}

export interface BedrijfInput {
  bedrijfsnaam: string;
  adres: string;
  postcode: string;
  plaats: string;
  land: string;
  telefoon: string;
  email: string;
}

// Eén colli mét afgeleide afmetingen (cm). lengte/breedte komen uit
// order_regels.maatwerk_*_cm → fallback producten.*_cm (orchestrator levert
// ze plat aan zodat de builder puur blijft).
export interface VerhoekColliInput {
  colli_nr: number;
  sscc: string;
  gewicht_kg: number | null;
  omschrijving_snapshot: string | null;
  artikelnr: string | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
}

export interface ColliProbleem {
  colli_nr: number;
  veld: 'lengte_cm' | 'breedte_cm' | 'gewicht_kg' | 'sscc';
  melding: string;
}

// Runtime-config uit app_config sleutel 'verhoek' (mig 371). Antwoorden van
// Verhoek = SQL-UPDATE op dat record, geen redeploy (ADR-0031).
export interface VerhoekOpties {
  /** Karpi's klantnummer bij Verhoek. '' = nog onbekend (vraag 1 testmail). */
  opdrachtgever_nummer: string;
  /** true = ScanCode is de volledige label-waarde 00+SSCC (20 cijfers);
   *  false = kale 18-cijferige SSCC. Open vraag in de testmail. */
  scancode_met_00_prefix: boolean;
  verpakkingseenheid: string; // vraag 4 testmail
  levering: string;           // vraag 2 testmail
  soort_levering: string;     // vraag 2 testmail
}

export const DEFAULT_VERHOEK_OPTIES: VerhoekOpties = {
  opdrachtgever_nummer: '',
  scancode_met_00_prefix: true,
  verpakkingseenheid: 'Rol',
  levering: '1',
  soort_levering: '1',
};

export interface BouwVerhoekXmlArgs {
  zending: ZendingInput;
  order: OrderInput;
  bedrijf: BedrijfInput;
  opties: VerhoekOpties;
  colli: VerhoekColliInput[];
}
```

- [ ] **Stap 2: Schrijf de failing tests** (`xml-builder.test.ts`)

```typescript
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  bouwVerhoekBestandsnaam,
  bouwVerhoekXml,
  naarDecagram,
  valideerVerhoekColli,
} from './xml-builder.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BouwVerhoekXmlArgs, VerhoekColliInput } from './types.ts';

function fixtureArgs(): BouwVerhoekXmlArgs {
  return {
    zending: {
      zending_nr: 'ZEND-2026-0042',
      afl_naam: 'Wonen & Co <Aalten>',
      afl_adres: 'Saturnusstraat 60 (Unit 30)',
      afl_postcode: '7891 AB',
      afl_plaats: 'Aalten',
      afl_land: 'Nederland',
      afl_telefoon: '0543123456',
      afl_email: 'klant@voorbeeld.nl',
      opmerkingen: 'Vragen naar dhr. Jansen',
      verzenddatum: '2026-06-12',
    },
    order: { order_nr: 'ORD-2026-0815' },
    bedrijf: {
      bedrijfsnaam: 'KARPI BV',
      adres: 'Tweede Broekdijk 10',
      postcode: '7122 LB',
      plaats: 'Aalten',
      land: 'NL',
      telefoon: '0543476116',
      email: 'info@karpi.nl',
    },
    opties: { ...DEFAULT_VERHOEK_OPTIES, opdrachtgever_nummer: 'OG9999' },
    colli: [
      {
        colli_nr: 1, sscc: '087159540000000014', gewicht_kg: 12.34,
        omschrijving_snapshot: 'MAATW. SISAL-GOLD 21 160x090 cm',
        artikelnr: 'SIGO21', lengte_cm: 160, breedte_cm: 90,
      },
      {
        colli_nr: 2, sscc: '087159540000000021', gewicht_kg: 25,
        omschrijving_snapshot: 'BERBER 400x300', artikelnr: 'BERB01',
        lengte_cm: 400, breedte_cm: 300,
      },
    ],
  };
}

Deno.test('naarDecagram: kg ×100, afgerond, minimaal 1', () => {
  assertEquals(naarDecagram(125), 12500);
  assertEquals(naarDecagram(12.34), 1234);
  assertEquals(naarDecagram(12.345), 1235);
  assertEquals(naarDecagram(0.001), 1);
});

Deno.test('bestandsnaam: Karpi_<timestamp>_<zending_nr>.xml', () => {
  const nu = new Date(2026, 5, 12, 13, 9, 20);
  assertEquals(bouwVerhoekBestandsnaam('ZEND-2026-0042', nu), 'Karpi_20260612130920_ZEND-2026-0042.xml');
});

Deno.test('valideerVerhoekColli: dims en gewicht verplicht', () => {
  const kapot: VerhoekColliInput[] = [
    { colli_nr: 1, sscc: '087159540000000014', gewicht_kg: null, omschrijving_snapshot: null, artikelnr: null, lengte_cm: null, breedte_cm: 90 },
  ];
  const problemen = valideerVerhoekColli(kapot);
  assertEquals(problemen.length, 2);
  assertEquals(problemen.map((p) => p.veld).sort(), ['gewicht_kg', 'lengte_cm']);
  assertEquals(valideerVerhoekColli(fixtureArgs().colli), []);
});

Deno.test('bouwVerhoekXml: structuur, escaping, kernvelden', () => {
  const xml = bouwVerhoekXml(fixtureArgs());
  assertStringIncludes(xml, '<?xml version="1.0" encoding="utf-8"?>');
  assertStringIncludes(xml, '<Versie>AA2.0</Versie>');
  assertStringIncludes(xml, '<OrderEntryID>001</OrderEntryID>');
  assertStringIncludes(xml, '<OpdrachtgeverNummer>OG9999</OpdrachtgeverNummer>');
  // Escaping: '&' en '<>' in ontvangernaam mogen de XML niet breken
  assertStringIncludes(xml, '<OntvangerNaam>Wonen &amp; Co &lt;Aalten&gt;</OntvangerNaam>');
  // Adres-splitsing: huisnummer apart, haakjes-toevoeging eraan vast
  assertStringIncludes(xml, '<OntvangerStraat>Saturnusstraat</OntvangerStraat>');
  assertStringIncludes(xml, '<OntvangerHuisnummer>60 Unit 30</OntvangerHuisnummer>');
  assertStringIncludes(xml, '<OntvangerLandCode>NL</OntvangerLandCode>');
  assertStringIncludes(xml, '<Referentie>ZEND-2026-0042</Referentie>');
  assertStringIncludes(xml, '<InfoVrachtbrief>Vragen naar dhr. Jansen</InfoVrachtbrief>');
  // T&T: e-mail aanwezig → TrackTraceID = zending_nr
  assertStringIncludes(xml, '<TrackTraceID>ZEND-2026-0042</TrackTraceID>');
  // Parts: 2 colli, ScanCode = 00+sscc, gewicht in decagram, dims in cm
  assertStringIncludes(xml, '<OrderEntryPartID>001</OrderEntryPartID>');
  assertStringIncludes(xml, '<OrderEntryPartID>002</OrderEntryPartID>');
  assertStringIncludes(xml, '<ScanCode>00087159540000000014</ScanCode>');
  assertStringIncludes(xml, '<Gewicht>1234</Gewicht>');
  assertStringIncludes(xml, '<Lengte>160</Lengte>');
  assertStringIncludes(xml, '<Breedte>90</Breedte>');
  assertStringIncludes(xml, '<ArtikelID>SIGO21</ArtikelID>');
  assertStringIncludes(xml, '<Verpakkingseenheid>Rol</Verpakkingseenheid>');
});

Deno.test('bouwVerhoekXml: opties sturen ScanCode-prefix en codes', () => {
  const args = fixtureArgs();
  args.opties = {
    ...args.opties,
    scancode_met_00_prefix: false,
    verpakkingseenheid: 'Doos',
    levering: '2',
    soort_levering: '3',
  };
  const xml = bouwVerhoekXml(args);
  assertStringIncludes(xml, '<ScanCode>087159540000000014</ScanCode>');
  assertStringIncludes(xml, '<Verpakkingseenheid>Doos</Verpakkingseenheid>');
  assertStringIncludes(xml, '<Levering>2</Levering>');
  assertStringIncludes(xml, '<SoortLevering>3</SoortLevering>');
});

Deno.test('bouwVerhoekXml: zonder afl_email géén TrackTraceID; leeg opdrachtgevernummer = lege tag', () => {
  const args = fixtureArgs();
  args.zending.afl_email = null;
  args.opties = { ...args.opties, opdrachtgever_nummer: '' };
  const xml = bouwVerhoekXml(args);
  assertStringIncludes(xml, '<TrackTraceID/>');
  assert(!xml.includes('<TrackTraceID>'));
  assertStringIncludes(xml, '<OpdrachtgeverNummer/>');
});
```

- [ ] **Stap 3: Run — moet falen**

Run: `deno test supabase/functions/verhoek-send/xml-builder.test.ts`
Verwacht: FAIL (`Module not found ... xml-builder.ts`).

- [ ] **Stap 4: Implementeer `xml-builder.ts`**

```typescript
// Pure XML-builder: ruwe Supabase-data → Verhoek AA2.0 XML-string.
// Géén DB-toegang, géén secrets — triviaal unit-testbaar.
//
// Bron-shape: XMLstandardVerhoekEuropeAA20.xml + eisen-mail Gerrit Altena:
// Lengte/Breedte in hele cm (verplicht), Gewicht in decagram (verplicht),
// ScanCode = exact de barcode op de eenheid, Referentie uniek (zending_nr),
// TrackTraceID historisch uniek en alleen gevuld mét OntvangerEmail.
// Tag-volgorde volgt het voorbeeldbestand exact; ongebruikte velden als lege
// tag (<Tag/>). Variabele keuzes (prefix, codes) komen uit VerhoekOpties
// (app_config 'verhoek') — antwoorden van Verhoek = config-UPDATE.
//
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { normalizeCountry, splitAdres } from '../_shared/adres-split.ts';
import type {
  BedrijfInput,
  BouwVerhoekXmlArgs,
  ColliProbleem,
  VerhoekColliInput,
  VerhoekOpties,
  ZendingInput,
} from './types.ts';

export function naarDecagram(kg: number): number {
  return Math.max(1, Math.round(kg * 100));
}

export function bouwVerhoekBestandsnaam(zendingNr: string, nu: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}` +
    `${p(nu.getHours())}${p(nu.getMinutes())}${p(nu.getSeconds())}`;
  return `Karpi_${ts}_${zendingNr}.xml`;
}

// Verhoek-verplichte velden per colli. Ontbreekt iets → de orchestrator zet
// de rij op Fout mét deze meldingen, zónder upload (kansloze-poging-principe
// uit ADR-0030).
export function valideerVerhoekColli(colli: VerhoekColliInput[]): ColliProbleem[] {
  const problemen: ColliProbleem[] = [];
  for (const c of colli) {
    if (!c.sscc || c.sscc.trim() === '') {
      problemen.push({ colli_nr: c.colli_nr, veld: 'sscc', melding: `Colli ${c.colli_nr}: SSCC ontbreekt (ScanCode is verplicht).` });
    }
    if (!c.lengte_cm || c.lengte_cm <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'lengte_cm', melding: `Colli ${c.colli_nr}: lengte (cm) ontbreekt — verplicht voor Verhoek-planning.` });
    }
    if (!c.breedte_cm || c.breedte_cm <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'breedte_cm', melding: `Colli ${c.colli_nr}: breedte (cm) ontbreekt — verplicht voor Verhoek-planning.` });
    }
    if (!c.gewicht_kg || c.gewicht_kg <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'gewicht_kg', melding: `Colli ${c.colli_nr}: gewicht (kg) ontbreekt — verplicht voor Verhoek-planning.` });
    }
  }
  return problemen;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Lege waarde → zelfsluitende tag, conform het voorbeeldbestand.
function tag(naam: string, waarde: string | number | boolean | null | undefined): string {
  if (waarde === null || waarde === undefined || waarde === '') return `<${naam}/>`;
  return `<${naam}>${esc(String(waarde))}</${naam}>`;
}

interface Partij {
  naam: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  land: string;
  telefoon: string;
  email: string;
}

function partijTags(prefix: string, p: Partij): string[] {
  return [
    tag(`${prefix}Naam`, p.naam),
    tag(`${prefix}Straat`, p.straat),
    tag(`${prefix}Huisnummer`, p.huisnummer),
    tag(`${prefix}Postcode`, p.postcode),
    tag(`${prefix}Woonplaats`, p.woonplaats),
    tag(`${prefix}LandCode`, p.land),
    tag(`${prefix}Telefoon`, p.telefoon),
    tag(`${prefix}Fax`, ''),
    tag(`${prefix}Email`, p.email),
  ];
}

function partijUitBedrijf(b: BedrijfInput): Partij {
  const { street, number, addition } = splitAdres(b.adres);
  return {
    naam: b.bedrijfsnaam,
    straat: street,
    huisnummer: [number, addition].filter(Boolean).join(' '),
    postcode: b.postcode,
    woonplaats: b.plaats,
    land: normalizeCountry(b.land),
    telefoon: b.telefoon,
    email: b.email,
  };
}

function partijUitZending(z: ZendingInput): Partij {
  const { street, number, addition } = splitAdres(z.afl_adres ?? '');
  return {
    naam: z.afl_naam ?? '',
    straat: street,
    huisnummer: [number, addition].filter(Boolean).join(' '),
    postcode: z.afl_postcode ?? '',
    woonplaats: z.afl_plaats ?? '',
    land: normalizeCountry(z.afl_land ?? ''),
    telefoon: z.afl_telefoon ?? '',
    email: z.afl_email ?? '',
  };
}

function bouwPart(c: VerhoekColliInput, volgnr: number, opties: VerhoekOpties): string {
  const id = String(volgnr).padStart(3, '0');
  const oppervlak = c.lengte_cm && c.breedte_cm
    ? Math.max(1, Math.round((c.lengte_cm * c.breedte_cm) / 10000))
    : '';
  const regels = [
    tag('OrderEntryPartID', id),
    tag('OrderEntryID', '001'),
    tag('VerzendNummer', ''),
    tag('Aantal', 1),
    tag('ArtikelID', c.artikelnr ?? ''),
    tag('Verpakkingseenheid', opties.verpakkingseenheid),
    tag('Omschrijving', c.omschrijving_snapshot ?? ''),
    // ScanCode MOET exact de barcode op de eenheid zijn. Onze labels dragen
    // AI(00)+SSCC (shipping-label.tsx: `00${sscc}`); of Verhoek de prefix
    // wil is een open vraag → configureerbaar.
    tag('ScanCode', opties.scancode_met_00_prefix ? `00${c.sscc}` : c.sscc),
    tag('RolNummer', c.colli_nr),
    // Decagram (eis Verhoek): 125 kg → 12500.
    tag('Gewicht', c.gewicht_kg ? naarDecagram(c.gewicht_kg) : ''),
    tag('Lengte', c.lengte_cm ?? ''),
    tag('Breedte', c.breedte_cm ?? ''),
    tag('Oppervlak', oppervlak),
    tag('NrItems', ''),
    tag('Barcode', ''),
    tag('Information', ''),
    tag('Kleur', ''),
    tag('Verfbad1', ''),
    tag('Verfbad2', ''),
    tag('Rug', ''),
    tag('Diameter', ''),
    tag('Inhoud', ''),
    tag('VolgNummer', ''),
    tag('SnijOpdracht', ''),
    tag('Emballage', 'false'),
    tag('ArtikelCode', ''),
    tag('ArtikelType', ''),
    tag('RolnummerSnijden', ''),
    tag('Valactiviteit', ''),
    tag('Hoogte', ''),
  ];
  return `\t\t<OrderEntryPart>\n${regels.map((r) => `\t\t\t${r}`).join('\n')}\n\t\t</OrderEntryPart>`;
}

export function bouwVerhoekXml(args: BouwVerhoekXmlArgs): string {
  const { zending, bedrijf, opties, colli } = args;
  const karpi = partijUitBedrijf(bedrijf);
  const ontvanger = partijUitZending(zending);
  const heeftEmail = (zending.afl_email ?? '').trim() !== '';

  const kop = [
    tag('OrderEntryID', '001'),
    tag('OpdrachtgeverNummer', opties.opdrachtgever_nummer),
    ...partijTags('Opdrachtgever', karpi),
    ...partijTags('Afzender', karpi),
    ...partijTags('AfwijkendeAfzender', karpi),
    tag('OntvangerNaam', ontvanger.naam),
    tag('OntvangerNaam2', ''),
    tag('OntvangerStraat', ontvanger.straat),
    tag('OntvangerHuisnummer', ontvanger.huisnummer),
    tag('OntvangerPostcode', ontvanger.postcode),
    tag('OntvangerWoonplaats', ontvanger.woonplaats),
    tag('OntvangerLandCode', ontvanger.land),
    tag('OntvangerTelefoon', ontvanger.telefoon),
    tag('OntvangerFax', ''),
    tag('OntvangerEmail', ontvanger.email),
    // Uniek + komt op CMR + zoeksleutel Verhoek customer service.
    tag('Referentie', zending.zending_nr),
    tag('TspNummerVerkoper', ''),
    tag('EoriNummerVerkoper', ''),
    tag('TspNummerKoper', ''),
    tag('EoriNummerKoper', ''),
    tag('OrderDatum', ''),
    tag('Rembours', 'false'),
    tag('RemboursBedrag', 0),
    tag('RemboursValuta', 'EUR'),
    tag('Levering', opties.levering),
    tag('SoortLevering', opties.soort_levering),
    tag('InfoPlanner', ''),
    tag('TelefonischAdvies', ''),
    tag('KooiAap', 'false'),
    tag('Saved', 'true'),
    tag('Binnenbak', 'false'),
    tag('Laadklep', 'false'),
    tag('SelectieCode', ''),
    tag('GewensteLevering', ''),
    tag('GewensteLeverDatumVan', ''),
    tag('GewensteLeverDatumTot', ''),
    // Contactpersoon/chauffeursinfo — komt op de vrachtbrief (eis-mail).
    tag('InfoVrachtbrief', zending.opmerkingen ?? ''),
    // Historisch uniek; alleen gevuld als er een ontvanger-e-mail is —
    // Verhoek stuurt de T&T-link naar OntvangerEmail.
    tag('TrackTraceID', heeftEmail ? zending.zending_nr : ''),
    tag('Orderstatus', ''),
    tag('Promotiecode', ''),
    tag('Promotiedatum', ''),
    tag('DebiteurnummerVerhoek', ''),
    tag('Bakwagen', 'false'),
    tag('Afhaaldatum', ''),
    tag('Ordergrootte', ''),
    tag('NummerLaadeenheid', ''),
    tag('Incoterm', ''),
    tag('Levertijd', ''),
    tag('BijzondereAdressen', ''),
    tag('Mailadvies', ''),
    tag('Vervoerderskeuze', ''),
  ];

  const parts = colli.map((c, i) => bouwPart(c, i + 1, opties)).join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<DATA>',
    '\t<Versie>AA2.0</Versie>',
    '\t<FileHash/>',
    '\t<OrderEntry>',
    kop.map((r) => `\t\t${r}`).join('\n'),
    parts,
    '\t</OrderEntry>',
    '</DATA>',
    '',
  ].join('\n');
}
```

- [ ] **Stap 5: Run — moet slagen**

Run: `deno test supabase/functions/verhoek-send/xml-builder.test.ts`
Verwacht: PASS (7 tests).

- [ ] **Stap 6: Vergelijk met het al verstuurde testbestand** — genereer in een snippet de fixture-XML en diff handmatig tegen `Karpi_20260611195317_ZEND-2026-0042.xml` (zelfde tag-volgorde/structuur; waarden verschillen uiteraard).

- [ ] **Stap 7: Commit**

```powershell
git add supabase/functions/verhoek-send/types.ts supabase/functions/verhoek-send/xml-builder.ts supabase/functions/verhoek-send/xml-builder.test.ts
git commit -m "feat(logistiek): Verhoek AA2.0 xml-builder met config-opties, puur + unit-getest"
```

---

### Taak 6: Proef-XML-script (echte zending → XML-bestand)

Voor het nasturen van een proefbestand uit het échte systeem (het al gemailde testbestand was handgemaakt) én om dims/gewicht-gaten in onze data vroeg te zien.

**Files:**
- Create: `supabase/functions/verhoek-send/genereer-proef-xml.ts`

- [ ] **Stap 1: Schrijf het script**

```typescript
// Lokaal hulpscript: genereer een Verhoek-proef-XML uit een bestaande zending.
// NIET deployen — alleen `deno run` vanaf de werkplek.
//
// Gebruik:
//   deno run --allow-net --allow-env --allow-write \
//     supabase/functions/verhoek-send/genereer-proef-xml.ts ZEND-2026-0042
//
// Vereist env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BedrijfInput, VerhoekColliInput, ZendingInput } from './types.ts';

const zendingNr = Deno.args[0];
if (!zendingNr) {
  console.error('Gebruik: deno run ... genereer-proef-xml.ts <ZEND-nummer>');
  Deno.exit(1);
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const { data: zending, error: zErr } = await supabase
  .from('zendingen')
  .select('id, zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, opmerkingen, verzenddatum')
  .eq('zending_nr', zendingNr)
  .single();
if (zErr || !zending) { console.error(`Zending ${zendingNr} niet gevonden: ${zErr?.message}`); Deno.exit(1); }

const { data: order } = await supabase.from('orders').select('order_nr').eq('id', zending.order_id).single();
const { data: bedrijfRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
const { data: cfgRow } = await supabase.from('app_config').select('waarde').eq('sleutel', 'verhoek').single();

const { data: colliRows, error: cErr } = await supabase
  .from('zending_colli')
  .select('colli_nr, sscc, gewicht_kg, omschrijving_snapshot, order_regels:order_regel_id ( artikelnr, maatwerk_lengte_cm, maatwerk_breedte_cm, producten ( lengte_cm, breedte_cm ) )')
  .eq('zending_id', zending.id)
  .order('colli_nr', { ascending: true });
if (cErr) { console.error(`Colli-query faalde: ${cErr.message}`); Deno.exit(1); }

// deno-lint-ignore no-explicit-any
const colli: VerhoekColliInput[] = (colliRows ?? []).map((r: any) => ({
  colli_nr: r.colli_nr,
  sscc: r.sscc,
  gewicht_kg: r.gewicht_kg,
  omschrijving_snapshot: r.omschrijving_snapshot,
  artikelnr: r.order_regels?.artikelnr ?? null,
  lengte_cm: r.order_regels?.maatwerk_lengte_cm ?? r.order_regels?.producten?.lengte_cm ?? null,
  breedte_cm: r.order_regels?.maatwerk_breedte_cm ?? r.order_regels?.producten?.breedte_cm ?? null,
}));

const problemen = valideerVerhoekColli(colli);
if (problemen.length > 0) {
  console.warn('LET OP — onvolledige colli-data (kies evt. een andere zending):');
  for (const p of problemen) console.warn(`  - ${p.melding}`);
}

const xml = bouwVerhoekXml({
  zending: zending as ZendingInput,
  order: { order_nr: order?.order_nr ?? '' },
  bedrijf: bedrijfRow!.waarde as BedrijfInput,
  opties: { ...DEFAULT_VERHOEK_OPTIES, ...(cfgRow?.waarde ?? {}) },
  colli,
});

const bestandsnaam = bouwVerhoekBestandsnaam(zending.zending_nr, new Date());
await Deno.writeTextFile(bestandsnaam, xml);
console.log(`Geschreven: ${bestandsnaam} (${colli.length} colli)`);
```

- [ ] **Stap 2: Genereer een proefbestand uit een echte zending**

Kies een recente zending mét colli's (MCP `execute_sql`): `SELECT z.zending_nr, COUNT(c.id) AS colli FROM zendingen z JOIN zending_colli c ON c.zending_id = z.id GROUP BY z.zending_nr ORDER BY z.zending_nr DESC LIMIT 5;`
Daarna: `deno run --allow-net --allow-env --allow-write supabase/functions/verhoek-send/genereer-proef-xml.ts <ZEND-nr>`
Verwacht: bestand geschreven; **let op de waarschuwingen** — dat zijn de zendingen die straks in preflight zouden falen (dims/gewicht-gaten in productdata).

- [ ] **Stap 3: Commit**

```powershell
git add supabase/functions/verhoek-send/genereer-proef-xml.ts
git commit -m "feat(logistiek): proef-XML-script Verhoek (echte zending, met colli-validatie)"
```

---

### Taak 7: Migratie 372 — adapter-tabel + RPC's + dispatch-tak + monitor-view

**Files:**
- Create: `supabase/migrations/372_verhoek_transportorders.sql`

- [ ] **Stap 1: Schrijf de migratie** (spiegel mig 171 + 337 + 338; dispatch = CREATE OR REPLACE van de mig 210-versie + `'sftp'`-tak)

```sql
-- Migratie 372: verhoek_transportorders + RPC's + sftp-dispatch + monitor
-- Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md
-- ADR-0031. Spiegelt het HST-adapterpatroon (mig 171/337/338).
--
-- Idempotent.

-- ============================================================================
-- 1. Status-enum + tabel
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE verhoek_transportorder_status AS ENUM (
    'Wachtrij', 'Bezig', 'Verstuurd', 'Fout', 'Geannuleerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS verhoek_transportorders (
  id               BIGSERIAL PRIMARY KEY,
  zending_id       BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  debiteur_nr      INTEGER REFERENCES debiteuren(debiteur_nr),
  status           verhoek_transportorder_status NOT NULL DEFAULT 'Wachtrij',
  -- Correlatie: de bestandsnaam ÍS de externe sleutel bij Verhoek (DataEntry
  -- verwerkt op bestandsnaam; Referentie=zending_nr is de CS-zoeksleutel).
  bestandsnaam     TEXT,
  xml_storage_path TEXT,            -- kopie in storage (order-documenten/verhoek-xml/)
  track_trace_id   TEXT,            -- door ons gegenereerd (= zending_nr), historisch uniek
  request_xml      TEXT,            -- laatste verstuurde XML (volledige historie: externe_payloads)
  retry_count      INTEGER NOT NULL DEFAULT 0,
  error_msg        TEXT,
  is_test          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verhoek_to_status  ON verhoek_transportorders (status);
CREATE INDEX IF NOT EXISTS idx_verhoek_to_zending ON verhoek_transportorders (zending_id);

-- Idempotentie: één actieve transportorder per zending (mig 171-patroon).
CREATE UNIQUE INDEX IF NOT EXISTS uk_verhoek_to_zending_actief
  ON verhoek_transportorders (zending_id)
  WHERE status NOT IN ('Fout', 'Geannuleerd');

COMMENT ON TABLE verhoek_transportorders IS
  'Verhoek-adapter: één rij per XML-bestand dat via SFTP naar Verhoek is/wordt '
  'verstuurd (ADR-0031). Spiegelt hst_transportorders. Historie van pogingen: '
  'externe_payloads kanaal=''verhoek''.';

CREATE OR REPLACE FUNCTION set_verhoek_to_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verhoek_to_updated_at ON verhoek_transportorders;
CREATE TRIGGER trg_verhoek_to_updated_at
  BEFORE UPDATE ON verhoek_transportorders
  FOR EACH ROW EXECUTE FUNCTION set_verhoek_to_updated_at();

ALTER TABLE verhoek_transportorders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verhoek_to_all ON verhoek_transportorders;
CREATE POLICY verhoek_to_all ON verhoek_transportorders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- 2. Adapter-RPC's (spiegel mig 171)
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_verhoek_transportorder(
  p_zending_id  BIGINT,
  p_debiteur_nr INTEGER,
  p_is_test     BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO verhoek_transportorders (zending_id, debiteur_nr, status, is_test)
       VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_verhoek_transportorder(BIGINT, INTEGER, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION claim_volgende_verhoek_transportorder()
RETURNS verhoek_transportorders AS $$
DECLARE
  v_row verhoek_transportorders;
BEGIN
  UPDATE verhoek_transportorders
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM verhoek_transportorders
      WHERE status = 'Wachtrij'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_verhoek_transportorder() TO authenticated;

CREATE OR REPLACE FUNCTION markeer_verhoek_verstuurd(
  p_id               BIGINT,
  p_bestandsnaam     TEXT,
  p_xml_storage_path TEXT,
  p_track_trace_id   TEXT,
  p_request_xml      TEXT
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE verhoek_transportorders
     SET status           = 'Verstuurd',
         bestandsnaam     = p_bestandsnaam,
         xml_storage_path = p_xml_storage_path,
         track_trace_id   = p_track_trace_id,
         request_xml      = p_request_xml,
         sent_at          = now(),
         error_msg        = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Track & trace + status doorzetten naar zending (mig 171-patroon).
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_track_trace_id, track_trace),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_verhoek_verstuurd(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION markeer_verhoek_fout(
  p_id          BIGINT,
  p_error       TEXT,
  p_request_xml TEXT DEFAULT NULL,
  p_max_retries INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
  v_huidige_retry INTEGER;
BEGIN
  SELECT retry_count INTO v_huidige_retry FROM verhoek_transportorders WHERE id = p_id;

  UPDATE verhoek_transportorders
     SET retry_count = retry_count + 1,
         error_msg   = p_error,
         request_xml = COALESCE(p_request_xml, request_xml),
         status = CASE
           WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::verhoek_transportorder_status
           ELSE 'Wachtrij'::verhoek_transportorder_status
         END
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_verhoek_fout(BIGINT, TEXT, TEXT, INTEGER) TO authenticated;

-- Self-healing reaper (spiegel mig 337).
CREATE OR REPLACE FUNCTION herstel_vastgelopen_verhoek(p_minuten INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE verhoek_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_verhoek(INTEGER) TO authenticated;

-- ============================================================================
-- 3. Dispatch: 'sftp'-tak in enqueue_zending_naar_vervoerder.
--    Volledige body = mig 210-versie + WHEN 'sftp'. Géén andere wijzigingen.
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type INTO v_actief, v_type
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'sftp' THEN
      CASE v_vervoerder_code
        WHEN 'verhoek_sftp' THEN
          PERFORM enqueue_verhoek_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_verhoek';
        ELSE
          RAISE NOTICE 'SFTP-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter van de gekozen vervoerder. '
  'Sinds mig 372: type=''sftp''-tak voor verhoek_sftp (ADR-0031). Verder identiek '
  'aan mig 210 (regel-evaluator, print-tak, afhalen-skip).';

-- ============================================================================
-- 4. Monitor-view (spiegel mig 338) — UI-paneel volgt in een later plan.
-- ============================================================================
CREATE OR REPLACE VIEW verhoek_verzend_monitor AS
SELECT
  (SELECT COUNT(*)::INT FROM verhoek_transportorders WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE) AS verstuurd_vandaag,
  (SELECT COUNT(*)::INT FROM verhoek_transportorders WHERE status = 'Fout')     AS fout_open,
  (SELECT COUNT(*)::INT FROM verhoek_transportorders WHERE status = 'Wachtrij') AS wachtrij,
  (SELECT COUNT(*)::INT FROM verhoek_transportorders WHERE status = 'Bezig')    AS bezig,
  (SELECT (EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60)::INT FROM verhoek_transportorders WHERE status = 'Wachtrij') AS oudste_wachtrij_minuten,
  (SELECT (EXTRACT(EPOCH FROM (now() - MIN(updated_at))) / 60)::INT FROM verhoek_transportorders WHERE status = 'Bezig')    AS oudste_bezig_minuten;

COMMENT ON VIEW verhoek_verzend_monitor IS
  'Cron-health Verhoek-verzending (spiegel hst_verzend_monitor, mig 338). '
  'oudste_wachtrij_minuten hoog = verzend-cron staat stil.';

GRANT SELECT ON verhoek_verzend_monitor TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Stap 2: Apply + verifieer**

Run (MCP `execute_sql`): `SELECT * FROM verhoek_verzend_monitor;` (1 rij, nullen) en `SELECT enqueue_zending_naar_vervoerder(id) FROM zendingen ORDER BY id DESC LIMIT 1;` (normale status-string, geen exception).

- [ ] **Stap 3: Commit**

```powershell
git add supabase/migrations/372_verhoek_transportorders.sql
git commit -m "feat(logistiek): verhoek_transportorders + RPC's + sftp-dispatch + monitor (mig 372)"
```

---

### Taak 8: Vervoerder-eisen uitbreiden (hergebruik seam, shared + frontend-spiegel)

**Files:**
- Modify: `supabase/functions/_shared/vervoerder-eisen.ts`
- Modify: `supabase/functions/_shared/vervoerder-eisen.test.ts`
- Modify: `frontend/src/lib/orders/vervoerder-eisen.ts` (identieke wijziging)

- [ ] **Stap 1: Failing tests toevoegen** aan `vervoerder-eisen.test.ts`:

```typescript
Deno.test('verhoek_sftp: lege adresvelden geven ADRESVELD_LEEG', () => {
  const r = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: 'NL', afl_telefoon: null,
    afl_naam: 'Klant', afl_adres: '', afl_postcode: '7122 LB', afl_plaats: 'Aalten',
  });
  assertEquals(r.ok, false);
  assertEquals(r.problemen[0].code, 'ADRESVELD_LEEG');
});

Deno.test('verhoek_sftp: compleet adres is ok (telefoon niet verplicht)', () => {
  const r = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: 'DE', afl_telefoon: null,
    afl_naam: 'Klant', afl_adres: 'Hauptstr. 1', afl_postcode: '48683', afl_plaats: 'Ahaus',
  });
  assertEquals(r.ok, true);
});
```

- [ ] **Stap 2: Run** `deno test supabase/functions/_shared/vervoerder-eisen.test.ts` → verwacht FAIL (verhoek valt nu in de geen-eisen-tak).

- [ ] **Stap 3: Implementeer** — vervang in `_shared/vervoerder-eisen.ts` de early-return (regels 45-48) en voeg het Verhoek-blok toe:

```typescript
  // V1: HST en Verhoek hebben eisen. Andere vervoerders → geen pre-flight (ok).
  if (ctx.vervoerder_code !== 'hst_api' && ctx.vervoerder_code !== 'verhoek_sftp') {
    return { ok: true, problemen };
  }

  // Verhoek (ADR-0031): adresvelden verplicht (komen op de vrachtbrief/CMR).
  // Telefoon niet verplicht (geen TelefonischAdvies in V1); geen land-check —
  // pilot routeert uitsluitend via handmatige override. Colli-eisen
  // (lengte/breedte/gewicht) leven in verhoek-send/xml-builder.ts
  // (valideerVerhoekColli) — die kennen colli-data, deze seam niet.
  if (ctx.vervoerder_code === 'verhoek_sftp') {
    if (leeg(ctx.afl_naam) || leeg(ctx.afl_adres) || leeg(ctx.afl_postcode) || leeg(ctx.afl_plaats)) {
      problemen.push({
        code: 'ADRESVELD_LEEG',
        veld: 'afl_adres',
        melding: 'Naam, adres, postcode of plaats is leeg.',
      });
    }
    return { ok: problemen.length === 0, problemen };
  }
```

(De HST-checks daarna blijven ongewijzigd.)

- [ ] **Stap 4: Run** → PASS. **Stap 5:** breng exact dezelfde wijziging aan in `frontend/src/lib/orders/vervoerder-eisen.ts` en run `npm run typecheck` in `frontend/` → PASS.

- [ ] **Stap 6: Commit**

```powershell
git add supabase/functions/_shared/vervoerder-eisen.ts supabase/functions/_shared/vervoerder-eisen.test.ts frontend/src/lib/orders/vervoerder-eisen.ts
git commit -m "feat(logistiek): vervoerder-eisen voor verhoek_sftp (shared + frontend-spiegel)"
```

---

### Taak 9: SFTP-client + runtime-spike (NU testbaar, zonder Verhoek-credentials)

Grootste technische risico: draait `ssh2` in de Supabase Edge Runtime? Dat bewijzen we **nu** tegen de publieke test-SFTP-server `test.rebex.net` (user `demo` / pass `password`, read-only — connect + handshake + directory-listing volstaat als bewijs; uploaden testen we in Fase 2 op Verhoeks server).

**Files:**
- Create: `supabase/functions/verhoek-send/sftp-client.ts`
- Create: `supabase/functions/verhoek-sftp-spike/index.ts` (wegwerpfunctie)

- [ ] **Stap 1: Maak `sftp-client.ts`**

```typescript
// Dunne SFTP-wrapper voor verhoek-send. Bewust geïsoleerd: als de spike
// uitwijst dat ssh2 niet draait in de edge runtime, is dít de enige module
// die vervangen wordt (fallback: n8n-SFTP-workflow of Python-worker die
// dezelfde verhoek_transportorders-wachtrij leegt).
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md (Taak 9)

import { Buffer } from 'node:buffer';
import SftpClient from 'npm:ssh2-sftp-client@11';

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string; // upload-map op de server, bv. '/in'
}

export interface SftpUploadResult {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export async function uploadXmlViaSftp(
  cfg: SftpConfig,
  bestandsnaam: string,
  xml: string,
): Promise<SftpUploadResult> {
  const sftp = new SftpClient();
  const remotePad = `${cfg.remoteDir.replace(/\/+$/, '')}/${bestandsnaam}`;
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: 15_000,
    });
    await sftp.put(Buffer.from(xml, 'utf-8'), remotePad);
    return { ok: true, remotePad, errorMsg: null };
  } catch (err) {
    return { ok: false, remotePad: null, errorMsg: String(err) };
  } finally {
    try {
      await sftp.end();
    } catch (_) { /* verbinding was al weg */ }
  }
}

// Runtime-bewijs zonder schrijfrechten: connect + handshake + listing.
export async function testSftpVerbinding(
  cfg: Omit<SftpConfig, 'remoteDir'> & { listDir?: string },
): Promise<{ ok: boolean; entries: number; errorMsg: string | null }> {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: 15_000,
    });
    const lijst = await sftp.list(cfg.listDir ?? '/');
    return { ok: true, entries: lijst.length, errorMsg: null };
  } catch (err) {
    return { ok: false, entries: 0, errorMsg: String(err) };
  } finally {
    try {
      await sftp.end();
    } catch (_) { /* verbinding was al weg */ }
  }
}
```

- [ ] **Stap 2: Maak de spike-functie** (`verhoek-sftp-spike/index.ts`)

```typescript
// WEGWERP-spike: bewijst of npm:ssh2-sftp-client werkt in de Supabase Edge
// Runtime. Default: read-only connect+list tegen test.rebex.net (publieke
// demo-server) — geen Verhoek-credentials nodig. Met VERHOEK_SFTP_*-secrets
// gezet test hij Verhoeks server (Fase 2, incl. upload als ?upload=1).
// Verwijderen ná Fase 2. Auth: CRON_TOKEN-header.
import { testSftpVerbinding, uploadXmlViaSftp } from '../verhoek-send/sftp-client.ts';

Deno.serve(async (req) => {
  const expected = Deno.env.get('CRON_TOKEN');
  if (!expected || req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const cfg = {
    host: Deno.env.get('VERHOEK_SFTP_HOST') ?? 'test.rebex.net',
    port: Number(Deno.env.get('VERHOEK_SFTP_PORT') ?? '22'),
    username: Deno.env.get('VERHOEK_SFTP_USER') ?? 'demo',
    password: Deno.env.get('VERHOEK_SFTP_PASSWORD') ?? 'password',
  };

  const doUpload = new URL(req.url).searchParams.get('upload') === '1';
  const result = doUpload
    ? await uploadXmlViaSftp(
      { ...cfg, remoteDir: Deno.env.get('VERHOEK_SFTP_REMOTE_DIR') ?? '/' },
      `Karpi_SPIKE_${crypto.randomUUID().slice(0, 8)}.xml`,
      '<?xml version="1.0" encoding="utf-8"?><DATA><Versie>AA2.0</Versie></DATA>',
    )
    : await testSftpVerbinding(cfg);

  return new Response(JSON.stringify({ host: cfg.host, ...result }), {
    status: result.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Stap 3: Deploy + run de runtime-spike (NU)**

```powershell
supabase functions deploy verhoek-sftp-spike --project-ref wqzeevfobwauxkalagtn --no-verify-jwt
curl -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-sftp-spike" -H "Authorization: Bearer <CRON_TOKEN>"
```

Verwacht: `{"host":"test.rebex.net","ok":true,"entries":<N>,...}`.

- [ ] **Stap 4: BESLISPUNT**
  - **Slaagt** → ssh2 draait in de runtime; door naar Taak 10. Spike-functie laten staan tot Fase 2 (hergebruikt voor de échte Verhoek-server-test).
  - **Faalt op runtime-incompatibiliteit** (import-fout, node:net-fout — níét een credentials/netwerk-fout) → STOP en overleg met Miguel: fallback (a) n8n-workflow met SFTP-node die de `verhoek_transportorders`-wachtrij leegt (verhoek-send bouwt dan alleen de XML en zet hem klaar in storage), of (b) Python-worker (paramiko) als geplande taak. Queue, RPC's en builder blijven identiek — alleen de upload-stap verschuift.

- [ ] **Stap 5: Commit**

```powershell
git add supabase/functions/verhoek-send/sftp-client.ts supabase/functions/verhoek-sftp-spike/index.ts
git commit -m "feat(logistiek): sftp-client + runtime-spike (rebex-test, geen Verhoek-creds nodig)"
```

---

### Taak 10: Orchestrator `verhoek-send` met dry-run-modus

**Files:**
- Create: `supabase/functions/verhoek-send/deno.json`
- Create: `supabase/functions/verhoek-send/index.ts`

- [ ] **Stap 1: Maak `deno.json`**

```json
{
  "lock": false
}
```

- [ ] **Stap 2: Schrijf `index.ts`** (spiegel van hst-send/index.ts; verschillen: SFTP i.p.v. POST, app_config-opties per run, dry-run-modus)

```typescript
// Supabase Edge Function: verhoek-send
//
// Cron-driven sender voor Verhoek-XML's (ADR-0031). Claimt 'Wachtrij'-rijen
// uit `verhoek_transportorders`, bouwt per zending een AA2.0-XML en levert
// die via SFTP aan bij Verhoek. Audit: externe_payloads (kanaal 'verhoek',
// elke poging een rij) + XML-kopie in storage (order-documenten/verhoek-xml/).
//
// DRY-RUN (secret VERHOEK_DRY_RUN, default 'true'): hele keten draait —
// XML, preflight, storage, audit, markeer — maar de SFTP-upload wordt
// overgeslagen. Go-live = VERHOEK_DRY_RUN=false + SFTP-secrets + config.
//
// Auth: Bearer-CRON_TOKEN-header (zelfde patroon als hst-send).
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from './sftp-client.ts';
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BedrijfInput, VerhoekColliInput, VerhoekOpties, ZendingInput } from './types.ts';

const MAX_PER_RUN = 25;

interface VerhoekTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
}

interface SendSummary {
  processed: number;
  succeeded: number;
  failed: number;
  empty_queue: boolean;
  dry_run: boolean;
  details: Array<{ id: number; zending_id: number; status: 'sent' | 'error'; bestandsnaam?: string; error?: string }>;
}

Deno.serve(async (req) => {
  const expectedToken = Deno.env.get('CRON_TOKEN');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResp({ error: 'SUPABASE_URL / SERVICE_ROLE_KEY ontbreken' }, 500);
  }

  // Dry-run default AAN: zonder expliciete VERHOEK_DRY_RUN=false gaat er
  // niets de deur uit. Veilige standaard tot de go-live-checklist (Fase 2).
  const dryRun = (Deno.env.get('VERHOEK_DRY_RUN') ?? 'true').toLowerCase() !== 'false';

  let sftpConfig: SftpConfig | null = null;
  if (!dryRun) {
    const host = Deno.env.get('VERHOEK_SFTP_HOST');
    const user = Deno.env.get('VERHOEK_SFTP_USER');
    const password = Deno.env.get('VERHOEK_SFTP_PASSWORD');
    if (!host || !user || !password) {
      return jsonResp({ error: 'VERHOEK_DRY_RUN=false maar VERHOEK_SFTP_HOST / USER / PASSWORD ontbreken' }, 500);
    }
    sftpConfig = {
      host,
      port: Number(Deno.env.get('VERHOEK_SFTP_PORT') ?? '22'),
      username: user,
      password,
      remoteDir: Deno.env.get('VERHOEK_SFTP_REMOTE_DIR') ?? '/',
    };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Runtime-config (mig 371): antwoorden van Verhoek landen hier — per run
  // gelezen, dus een config-UPDATE werkt zonder redeploy.
  const { data: cfgRow } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'verhoek').single();
  const opties: VerhoekOpties = { ...DEFAULT_VERHOEK_OPTIES, ...((cfgRow?.waarde ?? {}) as Partial<VerhoekOpties>) };

  // Zelfhelend (mig 372-reaper): herstel rijen die vastliepen in 'Bezig'.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_verhoek', { p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[verhoek-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) terug naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[verhoek-send] reaper faalde: ${String(e)}`);
  }

  const summary: SendSummary = { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: dryRun, details: [] };

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_volgende_verhoek_transportorder');
    if (claimErr) return jsonResp({ error: `claim-rpc fout: ${claimErr.message}` }, 500);
    const row = claimed as VerhoekTransportOrderRow | null;
    if (!row || !row.id) {
      summary.empty_queue = true;
      break;
    }
    summary.processed += 1;

    try {
      await verwerkRow(supabase, row, { sftpConfig, opties, dryRun }, summary);
    } catch (err) {
      summary.failed += 1;
      summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: String(err) });
      await supabase.rpc('markeer_verhoek_fout', { p_id: row.id, p_error: `Onverwachte exception: ${String(err)}`, p_max_retries: 3 });
    }
  }

  return jsonResp(summary, 200);
});

interface VerwerkContext {
  sftpConfig: SftpConfig | null; // null in dry-run
  opties: VerhoekOpties;
  dryRun: boolean;
}

async function verwerkRow(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  // 1. Context-data ophalen.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select('zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, opmerkingen, verzenddatum')
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    return markFoutMetSummary(supabase, row, summary, `Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`);
  }

  const { data: order, error: oErr } = await supabase
    .from('orders').select('order_nr').eq('id', zending.order_id).single();
  if (oErr || !order) {
    return markFoutMetSummary(supabase, row, summary, `Order ${zending.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`);
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
  if (bErr || !bedrijfRow?.waarde) {
    return markFoutMetSummary(supabase, row, summary, `bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`);
  }

  // Colli's mét afmetingen: maatwerk-dims van de orderregel, anders product-dims.
  const { data: colliRows, error: colliErr } = await supabase
    .from('zending_colli')
    .select('colli_nr, sscc, gewicht_kg, omschrijving_snapshot, order_regels:order_regel_id ( artikelnr, maatwerk_lengte_cm, maatwerk_breedte_cm, producten ( lengte_cm, breedte_cm ) )')
    .eq('zending_id', row.zending_id)
    .order('colli_nr', { ascending: true });
  if (colliErr) {
    return markFoutMetSummary(supabase, row, summary, `zending_colli query fout: ${colliErr.message}`);
  }
  // deno-lint-ignore no-explicit-any
  const colli: VerhoekColliInput[] = ((colliRows ?? []) as any[]).map((r) => ({
    colli_nr: r.colli_nr,
    sscc: r.sscc,
    gewicht_kg: r.gewicht_kg,
    omschrijving_snapshot: r.omschrijving_snapshot,
    artikelnr: r.order_regels?.artikelnr ?? null,
    lengte_cm: r.order_regels?.maatwerk_lengte_cm ?? r.order_regels?.producten?.lengte_cm ?? null,
    breedte_cm: r.order_regels?.maatwerk_breedte_cm ?? r.order_regels?.producten?.breedte_cm ?? null,
  }));
  if (colli.length === 0) {
    return markFoutMetSummary(
      supabase, row, summary,
      `Geen zending_colli voor zending ${row.zending_id}. Pickronde moet genereer_zending_colli aanroepen — zonder ScanCode kan Verhoek ons label niet matchen.`,
    );
  }

  const z = zending as ZendingInput & { order_id: number };

  // 2. Pre-flight: adres (gedeelde seam) + Verhoek-verplichte colli-velden +
  //    go-live-guard. Faalt iets → direct Fout met heldere reden, géén
  //    kansloze upload (ADR-0030-principe).
  const preflight = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: z.afl_land,
    afl_telefoon: z.afl_telefoon,
    afl_naam: z.afl_naam,
    afl_adres: z.afl_adres,
    afl_postcode: z.afl_postcode,
    afl_plaats: z.afl_plaats,
  });
  const colliProblemen = valideerVerhoekColli(colli);
  const redenen = [
    ...preflight.problemen.map((p) => p.melding),
    ...colliProblemen.map((p) => p.melding),
  ];
  // Echte verzending vereist een bevestigd opdrachtgevernummer (vraag 1
  // testmail). In dry-run mag het leeg blijven (lege tag, zoals testbestand).
  if (!ctx.dryRun && ctx.opties.opdrachtgever_nummer.trim() === '') {
    redenen.push("opdrachtgever_nummer ontbreekt in app_config 'verhoek' — antwoord Verhoek (vraag 1) nog niet verwerkt.");
  }
  if (redenen.length > 0) {
    return markFoutMetSummary(supabase, row, summary, 'Pre-flight: ' + redenen.join(' | '));
  }

  // 3. XML bouwen + afleveren (of dry-run).
  const xml = bouwVerhoekXml({
    zending: z,
    order: { order_nr: order.order_nr },
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    opties: ctx.opties,
    colli,
  });
  const bestandsnaam = bouwVerhoekBestandsnaam(z.zending_nr, new Date());
  const result = ctx.dryRun
    ? { ok: true, remotePad: 'DRY_RUN — niet geüpload', errorMsg: null }
    : await uploadXmlViaSftp(ctx.sftpConfig!, bestandsnaam, xml);

  // 3b. Audit (mig 325-patroon): één externe_payloads-rij per poging,
  //     best-effort — mag het versturen nooit blokkeren.
  try {
    await supabase.rpc('log_externe_payload', {
      p_kanaal: 'verhoek',
      p_payload_raw: xml,
      p_bron: 'verhoek',
      p_externe_id: bestandsnaam,
      p_content_type: 'application/xml',
      p_headers: null,
      p_payload_json: { bestandsnaam, remote_pad: result.remotePad, ok: result.ok, dry_run: ctx.dryRun, error: result.errorMsg },
      p_richting: 'out',
      p_order_id: z.order_id ?? null,
      p_status: result.ok ? 'verwerkt' : 'fout',
      p_fout: result.ok ? null : (result.errorMsg ?? 'onbekende fout'),
    });
  } catch (e) {
    console.warn(`[verhoek-send] payload-audit faalde: ${String(e)}`);
  }

  // 4. Markeer succes/fout. Bij succes: XML-kopie naar storage (best-effort).
  if (result.ok) {
    let storagePath: string | null = null;
    try {
      const path = `verhoek-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (!upErr) storagePath = path;
      else console.error(`[verhoek-send] storage-upload faalde: ${upErr.message}`);
    } catch (e) {
      console.error(`[verhoek-send] storage-upload exception: ${String(e)}`);
    }

    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam });
    await supabase.rpc('markeer_verhoek_verstuurd', {
      p_id: row.id,
      p_bestandsnaam: bestandsnaam,
      p_xml_storage_path: storagePath,
      p_track_trace_id: (z.afl_email ?? '').trim() !== '' ? z.zending_nr : null,
      p_request_xml: xml,
    });
  } else {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: result.errorMsg ?? 'onbekende fout' });
    await supabase.rpc('markeer_verhoek_fout', {
      p_id: row.id,
      p_error: result.errorMsg ?? 'onbekende fout',
      p_request_xml: xml,
      p_max_retries: 3,
    });
  }
}

async function markFoutMetSummary(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  summary: SendSummary,
  error: string,
): Promise<void> {
  summary.failed += 1;
  summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error });
  await supabase.rpc('markeer_verhoek_fout', { p_id: row.id, p_error: error, p_max_retries: 3 });
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Stap 3: Run alle verhoek-tests** (regressie)

Run: `deno test supabase/functions/verhoek-send/ supabase/functions/_shared/vervoerder-eisen.test.ts supabase/functions/_shared/adres-split.test.ts`
Verwacht: PASS.

- [ ] **Stap 4: Commit**

```powershell
git add supabase/functions/verhoek-send/index.ts supabase/functions/verhoek-send/deno.json
git commit -m "feat(logistiek): verhoek-send edge function met dry-run-modus + config per run"
```

---

### Taak 11: Deploy + interne dry-run-rondreis

- [ ] **Stap 1: Deploy** (VERHOEK_DRY_RUN niet gezet = default dry-run aan)

```powershell
supabase functions deploy verhoek-send --project-ref wqzeevfobwauxkalagtn --no-verify-jwt
```

- [ ] **Stap 2: Interne rondreis met 1 test-rij** — kies een zending mét colli's waarvan de status `Onderweg` mag worden (of zet hem erna terug):

Run (MCP `execute_sql`): `SELECT enqueue_verhoek_transportorder(<zending_id>, <debiteur_nr>, TRUE);`
Dan: `curl -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-send" -H "Authorization: Bearer <CRON_TOKEN>"`

Verwacht (alles zonder Verhoek!):
1. Response: `{"processed":1,"succeeded":1,...,"dry_run":true}`.
2. `verhoek_transportorders`-rij op `Verstuurd` met `bestandsnaam` + `xml_storage_path` + `request_xml`.
3. `externe_payloads`-rij kanaal `verhoek`, `payload_json.dry_run=true`.
4. XML-bestand in storage onder `verhoek-xml/` — download en vergelijk met het voorbeeldbestand.

- [ ] **Stap 3: Test ook het fout-pad** — enqueue een zending zónder colli's of zonder dims → verwacht rij op `Fout` (na 3 retries) met heldere `Pre-flight:`-reden.

- [ ] **Stap 4: Commit evt. fixes; meld resultaat aan Miguel** (incl. de dims/gewicht-gaten die het fout-pad blootlegde).

---

### Taak 12: Migratie 373 — cron-schedule

**Files:**
- Create: `supabase/migrations/373_verhoek_send_cron.sql`

- [ ] **Stap 1: Schrijf de migratie** (spiegel mig 173; vault-secret `cron_token` bestaat al; veilig om nu al te draaien — wachtrij blijft leeg zolang `actief=FALSE`, en zelfs gevuld is het dry-run)

```sql
-- Migratie 373: pg_cron schedule voor de verhoek-send edge function
-- Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md
-- Spiegelt mig 173 (hst-send). Vault-secret 'cron_token' bestaat al.
--
-- Idempotent.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('verhoek-send-elke-minuut');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT cron.schedule(
  'verhoek-send-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Stap 2: Apply + verifieer**

Run (MCP `execute_sql`): `SELECT jobname, schedule FROM cron.job WHERE jobname = 'verhoek-send-elke-minuut';` → 1 rij. Na 2 min: `SELECT * FROM verhoek_verzend_monitor;` → wachtrij 0.

- [ ] **Stap 3: Commit**

```powershell
git add supabase/migrations/373_verhoek_send_cron.sql
git commit -m "feat(logistiek): cron verhoek-send-elke-minuut (mig 373)"
```

---

### Taak 13: Docs bijwerken + Fase 1 afronden

- [ ] **Stap 1: Docs**
  - `docs/changelog.md`: Verhoek-koppeling Fase 1 (ADR-0031, mig 371-373, verhoek-send dry-run-deployed).
  - `docs/database-schema.md`: `verhoek_transportorders` + enum + view + RPC's; `vervoerders.type` +`'sftp'`; `app_config` sleutel `'verhoek'`.
  - `docs/architectuur.md`: Verhoek-adapter naast HST (hergebruik-tabel uit dit plan kort samenvatten), `_shared/adres-split.ts`-seam, dry-run-mechanisme.
  - `CLAUDE.md`: bullet onder Bedrijfsregels — Verhoek (AA2.0-XML via SFTP, ADR-0031, mig 371-373): queue `verhoek_transportorders`, dispatch via `'sftp'`-tak, config in `app_config.verhoek` (antwoorden Verhoek = SQL-UPDATE, geen deploy), `VERHOEK_DRY_RUN` default aan, ScanCode=label-barcode, Gewicht decagram, Lengte/Breedte verplicht → preflight-Fout.

- [ ] **Stap 2: Volledige verificatie**

Run: `deno test supabase/functions/verhoek-send/ supabase/functions/_shared/ supabase/functions/hst-send/payload-builder.test.ts` en `npm run typecheck` in `frontend/`.
Verwacht: PASS (pre-existing failure `magazijn-pickbaarheid.contract.test.ts` staat hier los van).

- [ ] **Stap 3: Commit. NIET mergen** — merge naar `main` op commando van Miguel (her-verifieer migratienummers vlak vóór de merge).

```powershell
git add docs/ CLAUDE.md
git commit -m "docs: Verhoek-koppeling Fase 1 (ADR-0031) in changelog/schema/architectuur/CLAUDE.md"
```

**Eindstand Fase 1:** hele keten live in dry-run — override naar Verhoek mogelijk zodra `actief=TRUE`, cron draait, XML's worden gebouwd/geauditeerd/opgeslagen, runtime-bewijs voor SFTP geleverd. Wachten is alleen nog op Verhoeks antwoorden.

---

# FASE 2 — Go-live-checklist (zodra Verhoek antwoordt; ~1 uur, geen redeploy verwacht)

- [ ] **Stap 1: Config-UPDATE met de antwoorden** (vragen 1, 2, 4 + ScanCode-vraag uit de testmail):

```sql
UPDATE app_config
   SET waarde = waarde || jsonb_build_object(
     'opdrachtgever_nummer',   '<antwoord vraag 1>',
     'scancode_met_00_prefix', <true/false — antwoord ScanCode-vraag>,
     'verpakkingseenheid',     '<antwoord vraag 4>',
     'levering',               '<antwoord vraag 2>',
     'soort_levering',         '<antwoord vraag 2>'
   )
 WHERE sleutel = 'verhoek';
```

- [ ] **Stap 2: SFTP-secrets zetten** (antwoord vraag 6):

```powershell
supabase secrets set --project-ref wqzeevfobwauxkalagtn VERHOEK_SFTP_HOST=... VERHOEK_SFTP_PORT=22 VERHOEK_SFTP_USER=... VERHOEK_SFTP_PASSWORD=... VERHOEK_SFTP_REMOTE_DIR=...
```

- [ ] **Stap 3: Verbinding + upload testen op Verhoeks server** (hergebruik spike):

```powershell
curl -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-sftp-spike" -H "Authorization: Bearer <CRON_TOKEN>"          # connect+list
curl -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-sftp-spike?upload=1" -H "Authorization: Bearer <CRON_TOKEN>" # upload-test
```

Verwacht: beide `ok:true`; vraag Verhoek het spike-bestand te bevestigen (en of er een testmap is).

- [ ] **Stap 4: Dry-run uit + rondreis-test met Verhoek**

```powershell
supabase secrets set --project-ref wqzeevfobwauxkalagtn VERHOEK_DRY_RUN=false
```

Enqueue 1 echte test-zending (`is_test=TRUE`), laat de cron versturen, en laat Verhoek DataEntry bevestigen: adres correct gesplitst, dims/gewicht (decagram!) goed, ScanCode scant op hun systeem, Referentie zichtbaar voor CS. Bij afkeuring: feedback verwerken in `xml-builder.ts` mét nieuwe unit-test per geval (zoals HST's `verdeelToevoeging`-fix), opnieuw versturen via retry.

- [ ] **Stap 5: Activeren + pilot**

```sql
UPDATE vervoerders SET actief = TRUE WHERE code = 'verhoek_sftp';
```

Pilot-afspraak met Piet-Hein: welke orders via Verhoek (handmatige override per orderregel). Automatische selectie-regels + evt. `is_default` = apart besluit ná de pilot.

- [ ] **Stap 6: Opruimen + docs**
  - `supabase functions delete verhoek-sftp-spike --project-ref wqzeevfobwauxkalagtn` + map verwijderen + commit.
  - `docs/changelog.md`: go-live-datum + definitieve config-waarden documenteren.
  - V2-backlog-item aanmaken: statusterugkoppeling Verhoek (antwoord vraag 7) + monitor-UI-paneel.

---

## Zelf-review (uitgevoerd bij het schrijven)

- **Twee-fasen-doel gehaald:** elk Verhoek-antwoord mapt op een config-UPDATE of secret — de enige scenario's die alsnog code raken zijn "lege tags moeten weggelaten" en een afwijkende VerzendNummer/ArtikelID-verwachting (beide klein, builder + 1 test).
- **Hergebruik expliciet:** adres-split-extractie, vervoerder-eisen-seam, switch-RPC-tak, externe_payloads, storage-bucket, cron-vault-token, override-UI — alleen de adapter-tabel en de orchestrator-loop zijn gespiegeld (bewust, vastgelegd in ADR).
- **Risico-volgorde klopt:** de SFTP-runtime-vraag (grootste onbekende) wordt in Fase 1 beantwoord via de rebex-spike, niet pas bij go-live.
- **Type-consistentie:** `VerhoekOpties`/`VerhoekColliInput`/`BouwVerhoekXmlArgs` identiek in types.ts, builder, tests, proef-script en orchestrator; RPC-namen en signatures in mig 372 matchen de aanroepen in `index.ts` (`p_id/p_bestandsnaam/p_xml_storage_path/p_track_trace_id/p_request_xml` etc.).
- **Dry-run-veiligheid:** default `VERHOEK_DRY_RUN != 'false'` = dry-run; plus dubbele poort: vervoerder `actief=FALSE` voorkomt enqueue überhaupt. Echte verzending vereist daarnaast een gevuld `opdrachtgever_nummer` (preflight-guard).
