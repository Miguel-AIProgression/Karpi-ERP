-- Migration 143: snijplanning_overzicht uitbreiden met marge_cm
--
-- Context: de rol-uitvoer modal toont de snij-volgorde voor de operator.
-- Daarvoor moet de UI weten:
--   * marge_cm — hoeveel cm de breedte- en lengte-mes verder moeten dan de
--     bestelde maat (rond/ovaal +5, ZO +6, max van beide). Snijplannen-tabel
--     slaat de bestelde maat op (sp.lengte_cm/breedte_cm), de packer rekent
--     met opgehoogde maat. Voor de operator-tekst "Mes 325 breed (snij vierkant
--     325×325, daarna 320×320 rond met hand)" hebben we beide nodig.
--
-- `geroteerd` (sp.geroteerd) staat al in de live view (positie 14), dus wordt
-- niet opnieuw toegevoegd — alleen in de nieuwe definitie expliciet behouden.
--
-- Bron-van-waarheid voor marge: SQL-functie `stuk_snij_marge_cm()` (migratie 126).
-- Geen TS-duplicaat meer nodig in `frontend/src/lib/snij-volgorde/derive.ts`.
--
-- Backward compat: posities 1–40 matchen de live view exact (gebaseerd op
-- `information_schema.columns` query van 2026-04-29). `marge_cm` wordt op
-- positie 41 APPENDED zodat `CREATE OR REPLACE VIEW` kolommen niet hoeft te
-- droppen of herordenen.
--
-- COALESCE op kwaliteit_code/kleur_code matcht het bestaande gedrag dat
-- `snijplanning_tekort_analyse()` aanneemt: rol_id IS NULL (nog geen rol
-- toegewezen) → kwaliteit_code valt terug op `order_regels.maatwerk_kwaliteit_code`.

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
  sp.afleverdatum,                                                             -- 11
  sp.positie_x_cm,                                                             -- 12
  sp.positie_y_cm,                                                             -- 13
  sp.geroteerd,                                                                -- 14
  sp.gesneden_datum,                                                           -- 15
  sp.gesneden_op,                                                              -- 16
  sp.gesneden_door,                                                            -- 17
  -- Rol info
  r.rolnummer,                                                                 -- 18
  r.breedte_cm    AS rol_breedte_cm,                                           -- 19
  r.lengte_cm     AS rol_lengte_cm,                                            -- 20
  r.oppervlak_m2  AS rol_oppervlak_m2,                                         -- 21
  r.status        AS rol_status,                                               -- 22
  p.locatie       AS locatie,                                                  -- 23
  -- Product/kwaliteit info (COALESCE: rollen → producten → maatwerk)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,  -- 24
  COALESCE(r.kleur_code,     p.kleur_code,     oreg.maatwerk_kleur_code)     AS kleur_code,      -- 25
  oreg.artikelnr,                                                              -- 26
  p.omschrijving  AS product_omschrijving,                                     -- 27
  p.karpi_code,                                                                -- 28
  -- Maatwerk specs
  oreg.maatwerk_vorm,                                                          -- 29
  oreg.maatwerk_lengte_cm,                                                     -- 30
  oreg.maatwerk_breedte_cm,                                                    -- 31
  oreg.maatwerk_afwerking,                                                     -- 32
  oreg.maatwerk_band_kleur,                                                    -- 33
  oreg.maatwerk_instructies,                                                   -- 34
  oreg.orderaantal,                                                            -- 35
  -- Order info
  oreg.id         AS order_regel_id,                                           -- 36
  o.id            AS order_id,                                                 -- 37
  o.order_nr,                                                                  -- 38
  o.debiteur_nr,                                                               -- 39
  d.naam          AS klant_naam,                                               -- 40
  -- NIEUW (migratie 143): single-source snij-marge per (vorm, afwerking)
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm  -- 41
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id;

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'Migratie 143 voegt marge_cm toe (single-source via stuk_snij_marge_cm() '
  'migratie 126; ZO +6, rond/ovaal +5, max bij combi) voor de SnijVolgorde '
  'transformer in de rol-uitvoer modal. snij_lengte_cm/snij_breedte_cm zijn '
  'de bestelde maat; fysieke snij-maat = bestelde + marge_cm.';
