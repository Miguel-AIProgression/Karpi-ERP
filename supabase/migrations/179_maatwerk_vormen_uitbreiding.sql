-- supabase/migrations/179_maatwerk_vormen_uitbreiding.sql
-- Voegt 3 nieuwe vormen toe (pebble, ellips, afgeronde_hoeken) en verhoogt
-- toeslag op de bestaande organische + ovaal naar €75 conform Karpi-prijslijst
-- 2026-05-01 (zes "aparte vormen"). Rond krijgt GEEN toeslag — ronde tapijten
-- worden via voorraadproducten verkocht (bv. artikelnr 771110031). Cloud wordt
-- om dezelfde reden NIET als maatwerk-vorm gemodelleerd.

-- 1. Kolom voor "kan deze vorm afwijkende maten hebben?"
ALTER TABLE maatwerk_vormen
  ADD COLUMN IF NOT EXISTS kan_afwijkende_maten BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN maatwerk_vormen.kan_afwijkende_maten IS
  'Of de gebruiker een eigen lengte/breedte/diameter mag invullen die niet in maatwerk_vorm_maten staat. '
  'Zie de tabel voor actuele waarden per vorm-code.';

-- 2. Update bestaande organische toeslagen 20€ → 75€
UPDATE maatwerk_vormen SET toeslag = 75 WHERE code IN ('organisch_a','organisch_b_sp');

-- 3. Update kan_afwijkende_maten op bestaande
-- 'rond' blijft vrij invoerbaar (= bestaand gedrag).
UPDATE maatwerk_vormen SET kan_afwijkende_maten = true  WHERE code IN ('rechthoek','rond','ovaal');
UPDATE maatwerk_vormen SET kan_afwijkende_maten = false WHERE code IN ('organisch_a','organisch_b_sp');

-- 4. Hernoem display-namen om aan te sluiten op prijslijst
UPDATE maatwerk_vormen SET naam = 'Organic'             WHERE code = 'organisch_a';
UPDATE maatwerk_vormen SET naam = 'Organic Gespiegeld'  WHERE code = 'organisch_b_sp';

-- 5. Insert 3 nieuwe vormen (Cloud is bewust weggelaten — zie comment bovenaan)
INSERT INTO maatwerk_vormen (code, naam, afmeting_type, toeslag, kan_afwijkende_maten, actief, volgorde)
VALUES
  ('pebble',           'Pebble',            'lengte_breedte', 75, false, true, 60),
  ('ellips',           'Ellips',            'lengte_breedte', 75, false, true, 65),
  ('afgeronde_hoeken', 'Afgeronde Hoeken',  'lengte_breedte', 75, true,  true, 70)
ON CONFLICT (code) DO UPDATE
  SET naam = EXCLUDED.naam,
      afmeting_type = EXCLUDED.afmeting_type,
      toeslag = EXCLUDED.toeslag,
      kan_afwijkende_maten = EXCLUDED.kan_afwijkende_maten,
      actief = EXCLUDED.actief,
      volgorde = EXCLUDED.volgorde;

-- 6. Ovaal krijgt €75 toeslag (was 0); rond blijft op 0.
UPDATE maatwerk_vormen SET toeslag = 75 WHERE code = 'ovaal';
UPDATE maatwerk_vormen SET toeslag = 0  WHERE code = 'rond';
