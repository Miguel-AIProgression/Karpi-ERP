# Uitvoeringsdraaiboek — Productie-only Fase A (mig 327-331 + import)

**Datum:** 2026-06-08
**Branch:** `feat/productie-only-import`
**Voor:** Miguel (de agent heeft GEEN Karpi-DB-toegang → migraties + import draai jij handmatig)

Dit draaiboek dekt **Task 0** (pre-flight), **A10** (import → auto-plan → verifiëren) en **A11** (cutover).
De code (A1–A9) staat gecommit op de branch. Draai de stappen hieronder in volgorde.

---

## ⚠️ Vooraf — twee coördinatie-aandachtspunten

1. **Vreemde commit op de branch (`61d1860`):** tijdens het bouwen heeft een *parallelle* Claude-sessie in dezelfde working tree de commit `feat(import): vaste-maten voorraad uit kolom D` (`import/update_voorraad.py`) op deze branch geplaatst — precies het gedeelde-working-tree-risico uit CLAUDE.md. De agent heeft die commit **niet** aangeraakt (history herschrijven = riskant). Beslis bij merge: laten staan (het is je eigen voorraad-werk) of via `git rebase -i main` eruit lichten/verplaatsen naar een eigen branch.

2. **Mig 323 is (nog) ongecommit / mogelijk niet toegepast.** `supabase/migrations/323_snijplan_gat_maatwerk_flip.sql` is werk van een andere sessie (self-healing snijplan-creatie + eenmalige backfill). Onze **mig 328** neemt de volledige `auto_sync_snijplan_maten`-body uit 323 over (+ standaardmaat-vlag) en draait ná 323 → de functie komt hoe dan ook in de juiste eindstaat. Maar de **eenmalige backfill** uit 323 (voor ORD-2026-0098 e.a.) zit NIET in 328. Aanbeveling: **draai mig 323 eerst** (krijgt backfill + functie), dáárna 327→331. Commit/deel 323 zoals je dat met de andere sessie afspreekt.

---

## TASK 0 — Pre-flight (draai in de Supabase SQL-editor)

De `order_status`-enum is al bevestigd (`Maatwerk afgerond` ontbrak ✓ → mig 327 voegt toe). Draai de rest:

```sql
-- (a) Welke afwerking-codes bestaan? Verwacht ⊇ {B, FE, LO, ON, SB, SF, VO, ZO}.
--     De mapper produceert ALLEEN deze 8. Mist er één → meld het (FK-RESTRICT-risico).
SELECT code, type_bewerking FROM afwerking_types ORDER BY code;

-- (b) Bestaat de groepen-RPC al? (legacy mig 045, off-disk) — voor Fase B/forecasting.
SELECT to_regprocedure('snijplanning_groepen_gefilterd(date,date)');

-- (c) Hoeveel actieve migratie_blokkering-rijen? BEPAALT of A11 (cutover) nodig is.
SELECT count(*) FROM migratie_blokkering WHERE status = 'actief';

-- (e) Verplichte (NOT NULL, geen default) kolommen op debiteuren — de verzameldebiteur-
--     insert (mig 327) vult debiteur_nr/naam/plaats/land/status. Statisch geverifieerd
--     dat de overige NOT NULL-kolommen defaults hebben; bevestig live:
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'debiteuren' AND is_nullable = 'NO'
ORDER BY ordinal_position;

-- (f) Bestond er al een UNIQUE op orders.oud_order_nr? (de tabel heeft al `oud_order_nr UNIQUE`;
--     mig 327 voegt een partiële index toe — redundant maar onschadelijk/idempotent.)
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'orders' AND indexdef ILIKE '%oud_order_nr%';

-- (g) ⚠️ NOT-NULL-LANDMIJN-CHECK (toegevoegd na de status-fout op mig 327).
--     De schema-doc bleek onbetrouwbaar voor NOT NULL (debiteuren.status stond als
--     gewone TEXT maar is NOT NULL). Deze query toont ELKE NOT-NULL-zonder-default
--     kolom op de drie tabellen die mig 327/329 INSERTen. Bekend afgedekt:
--       debiteuren.status (→ 'Inactief' in mig 327), order_regels.korting_pct (→ 0 in mig 329).
--     Verschijnt hier een kolom die NIET door mig 327/329 wordt gezet (en die de
--     verzameldebiteur-INSERT of de RPC-INSERT raakt) → meld 'm, dan patch ik de migratie
--     vóór je 329 draait.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('debiteuren', 'orders', 'order_regels')
  AND is_nullable = 'NO'
  AND column_default IS NULL
ORDER BY table_name, ordinal_position;
```

**Blokkerend:** (a) als een mapper-code mist → meld het, mapper-output aanpassen vóór import. (g) als een onafgedekte NOT-NULL-kolom verschijnt → meld het vóór je mig 329 draait.

> **Reeds gefixt na jouw eerste run (commit `f878b03`):** mig 327 zette `debiteuren.status` op NULL → faalde (kolom is NOT NULL). Nu `status='Inactief'` (semantisch juist: verzameldebiteur mag geen match-target zijn; de debiteur-matcher sluit 'Inactief' uit). Ook mig 329's RPC zet nu `korting_pct=0` (vermoedelijk NOT NULL — de productie-RPC `create_webshop_order` COALESCEt 'm ook). **Her-run mig 327** (idempotent: kolommen/enum/indexen worden via `IF NOT EXISTS` overgeslagen, alleen de gefixte debiteur-insert + assertie draaien alsnog).

---

## A10 — Migraties toepassen → import → auto-plan → verifiëren

### Stap 1 — Migraties draaien (in deze volgorde, verwacht een `NOTICE … OK` per stuk)

> Volgorde is kritisch: 327 maakt de kolommen/enum die 328-331 gebruiken.
> (Overweeg eerst mig 323 — zie coördinatie-noot 2 hierboven.)

| # | Bestand | Verwachte NOTICE / effect |
|---|---------|---------------------------|
| 327 | `327_productie_only_schema.sql` | `Mig 327 OK: alleen_productie + Maatwerk afgerond + standaardmaat-vlaggen aanwezig.` |
| 328 | `328_auto_maak_snijplan_standaardmaat.sql` | (geen assert; functies herdefiniëerd) |
| 329 | `329_import_productie_only_order_rpc.sql` | `Mig 329 OK: idempotente import + snijplan-creatie geverifieerd.` ← de ingebouwde smoke-test valideert het volledige INSERT-pad (incl. triggers) en ruimt zichzelf op |
| 330 | `330_voltooi_confectie_maatwerk_afgerond.sql` | (geen assert; functie herdefiniëerd) |
| 331 | `331_snijplanning_overzicht_productie_only.sql` | (geen assert; view herdefiniëerd) |

> **Als 329 faalt** in het smoke-test-DO-blok met een trigger-/status-fout: dat is het gewenste vangnet (een onverwachte INSERT-trigger op `orders` die de directe `status='In productie'` weigert). Meld de exacte fout — dan herzien we de status-keuze.

Snelle rooktest na 327:
```sql
SELECT alleen_productie FROM orders LIMIT 1;                 -- geen fout
SELECT 'Maatwerk afgerond'::order_status;                    -- geen fout
SELECT debiteur_nr, naam FROM debiteuren WHERE debiteur_nr = 900000;
```

### Stap 2 — Import dry-run (lokaal, Python)

```powershell
cd "c:\Users\migue\Documents\Karpi ERP\import"
python -m pip install openpyxl supabase   # eenmalig, indien nog niet aanwezig
python import_productie_only.py --bestand "..\totaalplanning_cleaned_v2.xlsx"
```
Verwacht (al geverifieerd in de bouw): `Regels: 1275 | Orders: 1066 | uit-standaardmaat: 21 | afwerking-default-gebruikt: 10`.
**Bekijk de "Niet-herkende afwerking"-lijst** (krijgt veilig `'B'`) en leg die kort voor aan Piet-hein. Akkoord → door naar Stap 3.

### Stap 3 — Echte import (`--commit`)

Zet eerst de service-key (NIET de publishable key — de RPC is `SECURITY DEFINER`, maar de client schrijft orders):
```powershell
$env:SUPABASE_URL = "https://<project>.supabase.co"
$env:SUPABASE_SERVICE_KEY = "<service-role-key>"
python import_productie_only.py --bestand "..\totaalplanning_cleaned_v2.xlsx" --commit
```
Verwacht: `Klaar: ~1066 nieuw, 0 bestaand`. (Her-run = `0 nieuw, 1066 bestaand` — idempotent op `oud_order_nr`.)

### Stap 4 — Zichtbaarheid verifiëren

```sql
-- Productie-only snijplannen zichtbaar (incl. aantal>1-expansie → ≥ regels):
SELECT count(*) FROM snijplanning_overzicht WHERE alleen_productie;
-- Stukken staan in 'Wacht':
SELECT status, count(*) FROM snijplanning_overzicht WHERE alleen_productie GROUP BY status;
-- Uit-standaardmaat-stukken (verbruiken geen rollengte):
SELECT count(*) FROM snijplanning_overzicht WHERE alleen_productie AND snijden_uit_standaardmaat;  -- ~21
```
Open de snijplanning-UI: de stukken staan in `Wacht`, per (kwaliteit, kleur) groepeerbaar.

### Stap 5 — Auto-plan per (kwaliteit, kleur)-groep

Trigger `auto-plan-groep` voor de geraakte groepen (hergebruik het bestaande patroon / de edge function per (kwaliteit, kleur)). Doel: snijplannen krijgen een `rol_id` (de echte rolclaim die `migratie_blokkering` vervangt).

> **Let op (uit de adversariële review):** gebruik de **veilige** auto-plan/packer-route met positie-herpack. NIET de kale `assignRolToSnijplan()` (frontend dead code, `snijplanning-mutations.ts:75-82`) — die zet alleen `rol_id` zonder herpack en reproduceert het VERR130-overlap-incident. De veilige rol-toewijzing per stuk is Fase B (Task B2).

Verifieer:
```sql
SELECT count(*) FROM snijplanning_overzicht WHERE alleen_productie AND rol_id IS NOT NULL;
```
en controleer `voorraadposities` voor een paar (kwaliteit, kleur): vrije m² niet negatief, reflecteert de echte snijplan-consumptie.

### Stap 6 — Pick & Ship / zoeken verifiëren

- De productie-only orders verschijnen **NIET** in Pick & Ship.
- Order-detail (bv. `/orders/<id>` van een 'OUD-...'-order) toont het amberkleurige **Basta-afhandeling-paneel**.
- Zoeken op een Basta-ordernummer in het orders-overzicht vindt `OUD-<nr>`.

---

## A11 — Cutover: `migratie_blokkering` vrijgeven

**Alleen uitvoeren als Task 0(c) > 0 actieve blokkeringen toonde.** Anders overslaan (niets te vervangen).
Doe dit **ná** Stap 5 (de echte snijplannen zijn nu de claim op de rol):

```sql
UPDATE migratie_blokkering
   SET status = 'vrijgegeven', vrijgegeven_op = NOW()
 WHERE status = 'actief';
```

Verifieer daarna `voorraadposities` voor een paar (kwaliteit, kleur): geen dubbeltelling (blokkering + echt snijplan), vrije m² ≥ 0.
Noteer in `docs/changelog.md` dat ADR-0028's `migratie_blokkering` vervangen is door productie-only orders (ADR-0029).

---

## Wat er ná Fase A nog open staat (niet blokkerend)

- **ADR-0029** is geschreven (`docs/adr/0029-productie-only-orders-basta.md`); levende docs (changelog + schema-doc) zijn bijgewerkt.
- **Latent (eindreview Minor-1):** de view `orders_list` projecteert `alleen_productie` nog niet. Geen huidige consumer (order-detail leest het uit tabel `orders`). Voeg `o.alleen_productie` toe aan `orders_list` zodra je een productie-only-badge/-filter op het orders-overzicht wilt.
- ~~Minor-3: verzameldebiteur status~~ → **opgelost** (commit `f878b03`): 900000 krijgt `status='Inactief'` (was NULL, wat de NOT-NULL-constraint schond bij de eerste run).
- **Fase B** (planning-besturing: B1 dagplanning-pin, B2 veilige rol-toewijzing, B3 prioritering, B4 standaardmaat-UI, B5 FP-override, B6 forecasting) en **Fase C** (R8 dag-capaciteitsengine) staan in het hoofdplan en vereisen Piet-hein-besluiten.
