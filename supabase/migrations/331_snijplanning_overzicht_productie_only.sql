-- Migratie 331: snijplanning_overzicht — 3 extra kolommen voor productie-only orders
--
-- Identiek aan mig 316 + 3 kolommen (alleen_productie, oud_order_nr,
-- snijden_uit_standaardmaat). Geen filterwijziging. Nieuwe kolommen aan het eind
-- (CREATE OR REPLACE VIEW-regel).
--
-- Achtergrond (feat/productie-only-import, task A7):
--   - orders.alleen_productie (mig 327): vlag voor Basta-importorders die alleen
--     de snijplanning raken, niet het magazijn/verzending.
--   - orders.oud_order_nr (mig 327): oud bestelnummer uit brondata, voor traceerbaarheid.
--   - order_regels.snijden_uit_standaardmaat (mig 327): aanwijzing dat het snijstuk
--     uit een standaardmaat (voorraadrol) gesneden moet worden, niet uit een aparte rol.
--
-- De WHERE-clausule (o.status <> 'Geannuleerd') blijft ongewijzigd — productie-only
-- orders met status 'In productie' of 'Maatwerk afgerond' zijn dus zichtbaar (gewenst).
--
-- Idempotent: CREATE OR REPLACE VIEW.

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
  sp.lengte_cm  + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_lengte_cm,   -- 43
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm,  -- 44
  o.alleen_productie,                                                          -- 45
  o.oud_order_nr,                                                              -- 46
  oreg.snijden_uit_standaardmaat                                               -- 47
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id
WHERE o.status <> 'Geannuleerd';

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'marge_cm (mig 143), placed_*_cm (mig 233), snijplan_locatie (mig 168). '
  'Mig 290: WHERE o.status <> ''Geannuleerd''. Mig 316: de EDI-bevestigingsgate '
  'van mig 310 is weer verwijderd — een onbevestigde EDI-leverweek blokkeert de '
  'productie-intake NIET (bevestiging is administratief, niet operationeel). '
  'Mig 331: alleen_productie (orders), oud_order_nr (orders), '
  'snijden_uit_standaardmaat (order_regels) toegevoegd voor productie-only import.';

NOTIFY pgrst, 'reload schema';
