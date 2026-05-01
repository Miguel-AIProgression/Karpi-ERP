# Handmatige verificatie — Organische vormen voor maatwerk

> Deze tests zijn niet geautomatiseerd in deze branch (geen lokale Supabase + geen browser-runtime in de implementatie-omgeving). Voer ze door vóór merge naar main.

## 1. Migraties toepassen

In Supabase Studio (project Karpi) → SQL editor:

1. Open en run `supabase/migrations/179_maatwerk_vormen_uitbreiding.sql`.
2. Open en run `supabase/migrations/180_maatwerk_vorm_maten.sql`.
3. Open en run `supabase/migrations/181_snij_marge_vormen_uitbreiding.sql`.
4. Open en run `supabase/migrations/182_beach_life_kwaliteit_flag.sql`.
5. Open en run `supabase/migrations/183_app_config_vormwerk_levertijd.sql`.

Alle 5 zijn idempotent — herhaalbaar zonder fouten.

## 2. SQL-verificatie post-migratie

```sql
-- 1. Vormen-tabel: 8 actieve rijen
SELECT code, naam, afmeting_type, toeslag, kan_afwijkende_maten, volgorde
FROM maatwerk_vormen WHERE actief = true ORDER BY volgorde;
-- Verwacht:
-- rechthoek(0, true), rond(0, true), ovaal(75, true),
-- organisch_a/Organic(75, false), organisch_b_sp/Organic Gespiegeld(75, false),
-- pebble(75, false), ellips(75, false), afgeronde_hoeken(75, true)

-- 2. Vorm-maten: 24 rijen verdeeld over 6 lb-vormen × 4 maten
SELECT vorm_code, lengte_cm, breedte_cm, diameter_cm, volgorde
FROM maatwerk_vorm_maten ORDER BY vorm_code, volgorde;

-- 3. BEAC heeft alleen_recht_maatwerk=true
SELECT code, omschrijving, alleen_recht_maatwerk FROM kwaliteiten WHERE code = 'BEAC';

-- 4. Snij-marge functie levert juiste waarden
SELECT vorm,
       stuk_snij_marge_cm(NULL, vorm) AS marge_zonder_zo,
       stuk_snij_marge_cm('ZO',  vorm) AS marge_met_zo
FROM unnest(ARRAY[
  'rechthoek','rond','ovaal','organisch_a','organisch_b_sp',
  'pebble','ellips','afgeronde_hoeken'
]) AS vorm;
-- Verwacht: rechthoek 0/6, alle overige 5/6.

-- 5. app_config heeft de nieuwe buffer-key
SELECT waarde->'inkoop_buffer_weken_vormwerk' AS vormwerk_buffer,
       waarde->'inkoop_buffer_weken_maatwerk' AS maatwerk_buffer
FROM app_config WHERE sleutel = 'order_config';
-- Verwacht: vormwerk=6, maatwerk=2 (of bestaande waarde).
```

## 3. Frontend smoke-test (in dev-server)

```powershell
cd frontend
npm run dev
```

### 3.1 Order met Cisco 11 in Organic 200×290 (rekenvoorbeeld uit prijslijst)

1. Open een nieuwe order voor een willekeurige debiteur.
2. Klik "Op maat".
3. Kies kwaliteit "CISC", kleur "11" (verwachte m²-prijs: €51).
4. Kies vorm "Organic" (klik tegel).
5. Klik chip 200×290.
6. **Verwacht:** prijs = 5,8 m² × €51 + €75 = €295,80 + €75 = **€370,80**.

Als de werkelijk getoonde prijs afwijkt — controleer m²-prijs:
```sql
SELECT verkoopprijs_m2 FROM maatwerk_m2_prijzen
WHERE kwaliteit_code='CISC' AND kleur_code IN ('11','11.0');
```

### 3.2 Order opslaan en heropenen

Sla de order op. Open opnieuw. Verwacht:
- Omschrijving: "Cisco 11 - Op maat Organic" (of vergelijkbaar).
- maatwerk_vorm = `organisch_a` in DB.
- maatwerk_vorm_toeslag = 75.
- maatwerk_oppervlak_m2 = 5.8.
- Bedrag = €370,80.

```sql
SELECT regel_volgorde, omschrijving, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
       maatwerk_oppervlak_m2, maatwerk_m2_prijs, maatwerk_vorm_toeslag, bedrag
FROM order_regels WHERE order_nummer = '<test-order>';
```

### 3.3 Snijplanning + diameter-mapping (Rond)

Maak tweede testorder met vorm `Rond` Ø200. Verifieer:
```sql
SELECT maatwerk_vorm, maatwerk_diameter_cm, maatwerk_lengte_cm, maatwerk_breedte_cm,
       maatwerk_oppervlak_m2, maatwerk_vorm_toeslag
FROM order_regels WHERE id = <rond-test-id>;
-- Verwacht: vorm='rond', diameter=200, lengte=200, breedte=200,
-- oppervlak=4.0, toeslag=0 (rond zit niet in €75-set).
```

Bekijk `snijplanning_overzicht`:
```sql
SELECT order_regel_id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, maatwerk_afwerking,
       stuk_snij_marge_cm(maatwerk_afwerking, maatwerk_vorm) AS marge
FROM snijplanning_overzicht WHERE order_regel_id IN (<organic-id>, <rond-id>);
-- Verwacht voor beide: marge=5 (rond + organic_a beide in vorm-set).
```

### 3.4 Beach Life-blokkade

Nieuwe order. Kies kwaliteit BEAC. Verwacht:
- Alleen tegel "Rechthoek" zichtbaar in vorm-grid.
- Waarschuwingsbox: "Deze kwaliteit kan alleen in recht maatwerk geproduceerd worden."

### 3.5 Levertijd-hint (vormwerk vs. maatwerk)

Kies kwaliteit + kleur die geen voorraad heeft maar wel een openstaande inkooporder met `verwacht_datum` over ~4 weken.

- Kies vorm Rechthoek → hint toont week +2 (= maatwerk-buffer).
- Wissel naar Organic → hint toont week +6 (= vormwerk-buffer).

## 4. Edge functions

```powershell
supabase functions deploy --no-verify-jwt
```

Alleen nodig als de relevante edge functions live in productie draaien (bevestig met Miguel).

## 5. Rollback (indien nodig)

Migraties kunnen niet eenvoudig terug omdat ze data muteren. Bij issues:
- 179: zet toeslagen handmatig terug op 20 (organisch_a/_b_sp) en 0 (ovaal).
- 180: `DROP TABLE maatwerk_vorm_maten;` (CASCADE niet nodig — geen FK's wijzen erheen).
- 181: revert `stuk_snij_marge_cm()` naar definitie uit mig 126.
- 182: `ALTER TABLE kwaliteiten DROP COLUMN alleen_recht_maatwerk;` (UPDATE BEAC=false eerst niet nodig).
- 183: `UPDATE app_config SET waarde = waarde - 'inkoop_buffer_weken_vormwerk' WHERE sleutel = 'order_config';`

## Bevindingen

(Vul aan tijdens verificatie.)
