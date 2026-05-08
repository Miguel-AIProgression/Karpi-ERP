-- Migratie 233: snijplanning_overzicht — placed_lengte_cm + placed_breedte_cm
--
-- Achtergrond
-- -----------
-- Snij-marge had drie implementaties: SQL `stuk_snij_marge_cm()` (mig 126),
-- edge-shared `_shared/snij-marges.ts` (gebruikt door packer in fetchStukken)
-- en frontend `lib/utils/snij-marges.ts` (geen callers meer — werd vervangen
-- door view-kolom `marge_cm` uit mig 143). De TS-spiegels waren een open
-- divergentie-risico ("houd synchroon met SQL"-comments zonder vangnet).
--
-- Deze migratie trekt de marge-toepassing volledig naar SQL door de view uit
-- te breiden met twee gederiveerde kolommen op posities 43-44:
--
--   placed_lengte_cm  = snij_lengte_cm  + stuk_snij_marge_cm(afwerking, vorm)
--   placed_breedte_cm = snij_breedte_cm + stuk_snij_marge_cm(afwerking, vorm)
--
-- De packer (`_shared/db-helpers.fetchStukken`) leest die direct, hoeft de
-- TS-functie `snijMargeCm` niet meer aan te roepen, en het bestand inclusief
-- z'n Deno-test mag weg. Frontend `lib/utils/snij-marges.ts` was al dode code
-- en wordt in dezelfde commit verwijderd.
--
-- Twee verschillende interface-concepten, twee kolommen:
--   - `marge_cm`         → operator-semantiek: "hoeveel cm bijsnijden",
--                          gebruikt door rol-uitvoer-modal en derive.ts.
--   - `placed_*`         → packer-semantiek: "welke afmeting plaatsen",
--                          gebruikt door FFDH/Guillotine.
-- Beide afgeleid van dezelfde SQL-functie zodat een edit op marge-regels
-- één plek raakt.
--
-- Eindstaat: SQL is enige bron-van-waarheid voor de Snij-marge.
-- Geen TS-spiegels meer, geen sync-comments meer.

------------------------------------------------------------------------
-- 1. View herbouwen met placed-kolommen
------------------------------------------------------------------------
CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,                                                                       -- 1
  sp.snijplan_nr,                                                              -- 2
  sp.scancode,                                                                 -- 3
  sp.status,                                                                   -- 4
  sp.rol_id,                                                                   -- 5
  sp.lengte_cm    AS snij_lengte_cm,                                           -- 6
  sp.breedte_cm   AS snij_breedte_cm,                                          -- 7
  sp.prioriteit,                                                               -- 8
  sp.planning_week,                                                            -- 9
  sp.planning_jaar,                                                            -- 10
  o.afleverdatum,                                                              -- 11
  sp.positie_x_cm,                                                             -- 12
  sp.positie_y_cm,                                                             -- 13
  sp.geroteerd,                                                                -- 14
  sp.gesneden_datum,                                                           -- 15
  sp.gesneden_op,                                                              -- 16
  sp.gesneden_door,                                                            -- 17
  r.rolnummer,                                                                 -- 18
  r.breedte_cm    AS rol_breedte_cm,                                           -- 19
  r.lengte_cm     AS rol_lengte_cm,                                            -- 20
  r.oppervlak_m2  AS rol_oppervlak_m2,                                         -- 21
  r.status        AS rol_status,                                               -- 22
  p.locatie       AS locatie,                                                  -- 23 (producten.locatie -- voorraad)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,  -- 24
  COALESCE(r.kleur_code,     p.kleur_code,     oreg.maatwerk_kleur_code)     AS kleur_code,      -- 25
  oreg.artikelnr,                                                              -- 26
  p.omschrijving  AS product_omschrijving,                                     -- 27
  p.karpi_code,                                                                -- 28
  oreg.maatwerk_vorm,                                                          -- 29
  oreg.maatwerk_lengte_cm,                                                     -- 30
  oreg.maatwerk_breedte_cm,                                                    -- 31
  oreg.maatwerk_afwerking,                                                     -- 32
  oreg.maatwerk_band_kleur,                                                    -- 33
  oreg.maatwerk_instructies,                                                   -- 34
  oreg.orderaantal,                                                            -- 35
  oreg.id         AS order_regel_id,                                           -- 36
  o.id            AS order_id,                                                 -- 37
  o.order_nr,                                                                  -- 38
  o.debiteur_nr,                                                               -- 39
  d.naam          AS klant_naam,                                               -- 40
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm, -- 41
  sp.locatie      AS snijplan_locatie,                                         -- 42
  sp.lengte_cm  + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_lengte_cm,   -- 43 NIEUW
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm   -- 44 NIEUW
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id;

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'marge_cm (mig 143) = operator-semantiek (hoeveel bijsnijden). '
  'placed_lengte_cm/placed_breedte_cm (mig 233) = packer-semantiek '
  '(snij-maat na marge-ophoging). snijplan_locatie (mig 168) = '
  'sp.locatie magazijn-locatie van ingepakt stuk; los van locatie = '
  'producten.locatie voor voorraad.';

------------------------------------------------------------------------
-- 2. Comment van stuk_snij_marge_cm vernieuwen — geen TS-spiegels meer
------------------------------------------------------------------------
COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT) IS
  'Snij-marge in cm op elke dimensie. ZO-afwerking: +6 cm (rondom afwerking). '
  'Rond/ovaal: +5 cm speling voor handmatig uitzagen. Combi: grootste wint, '
  'niet cumulatief. Bron-van-waarheid; toegepast in view '
  'snijplanning_overzicht (kolommen marge_cm + placed_lengte_cm/'
  'placed_breedte_cm) en in snijplanning_tekort_analyse. Geen TS-spiegels '
  'meer sinds mig 233.';

------------------------------------------------------------------------
-- 3. Regressie-vangnet — assertions vervangen de oude Deno-test
------------------------------------------------------------------------
DO $$
BEGIN
  -- Geen marge: NULL/empty inputs en niet-marge afwerkingen/vormen
  ASSERT stuk_snij_marge_cm(NULL,  NULL)         = 0, 'NULL/NULL moet 0 zijn';
  ASSERT stuk_snij_marge_cm('',    '')           = 0, 'lege strings moeten 0 zijn';
  ASSERT stuk_snij_marge_cm('B',   NULL)         = 0, 'afwerking B (breedband) heeft geen marge';
  ASSERT stuk_snij_marge_cm('FE',  NULL)         = 0, 'afwerking FE (feston) heeft geen marge';
  ASSERT stuk_snij_marge_cm('LO',  NULL)         = 0, 'afwerking LO (locken) heeft geen marge';
  ASSERT stuk_snij_marge_cm('ON',  NULL)         = 0, 'afwerking ON heeft geen marge';
  ASSERT stuk_snij_marge_cm('SB',  NULL)         = 0, 'afwerking SB (smalband) heeft geen marge';
  ASSERT stuk_snij_marge_cm('SF',  NULL)         = 0, 'afwerking SF (smalfeston) heeft geen marge';
  ASSERT stuk_snij_marge_cm('VO',  NULL)         = 0, 'afwerking VO (volume) heeft geen marge';
  ASSERT stuk_snij_marge_cm(NULL,  'vierkant')   = 0, 'vorm vierkant heeft geen marge';
  ASSERT stuk_snij_marge_cm(NULL,  'rechthoek')  = 0, 'vorm rechthoek heeft geen marge';

  -- ZO-afwerking: +6 cm, ongeacht vorm
  ASSERT stuk_snij_marge_cm('ZO',  NULL)         = 6, 'ZO geeft +6 ongeacht vorm';
  ASSERT stuk_snij_marge_cm('ZO',  'vierkant')   = 6, 'ZO + vierkant geeft +6';

  -- Rond/ovaal: +5 cm, case-insensitive
  ASSERT stuk_snij_marge_cm(NULL,  'rond')       = 5, 'rond geeft +5';
  ASSERT stuk_snij_marge_cm(NULL,  'Rond')       = 5, 'rond is case-insensitive';
  ASSERT stuk_snij_marge_cm(NULL,  'OVAAL')      = 5, 'ovaal is case-insensitive';
  ASSERT stuk_snij_marge_cm('',    'ovaal')      = 5, 'lege afwerking + ovaal geeft +5';

  -- Combi: grootste wint, niet cumulatief
  ASSERT stuk_snij_marge_cm('ZO',  'rond')       = 6, 'ZO + rond: grootste wint (6)';
  ASSERT stuk_snij_marge_cm('ZO',  'ovaal')      = 6, 'ZO + ovaal: grootste wint (6)';
END $$;

NOTIFY pgrst, 'reload schema';
