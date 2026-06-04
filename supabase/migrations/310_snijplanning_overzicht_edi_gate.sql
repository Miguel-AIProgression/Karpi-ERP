-- Migratie 310: snijplanning_overzicht sluit onbevestigde EDI-orders uit
--
-- Een EDI-order met onbevestigde leverweek (bron_systeem='edi' AND
-- edi_bevestigd_op IS NULL, mig 309) mag de productie-intake niet in: de
-- meegestuurde leverweek is een klantwens, nog niet getoetst op
-- voorraad/inkoop/capaciteit. Net als mig 290 ('Geannuleerd') is dit een
-- defense-in-depth-filter op de view die de planning-pool voedt.
--
-- Volledig identiek aan mig 290 op de WHERE-clause na. Bewust NIET ook
-- 'Verzonden' — deze view voedt óók de fysieke rol-uitvoer + packer.
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
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm   -- 44
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id
WHERE o.status <> 'Geannuleerd'
  -- Sluit alleen ONBEVESTIGDE EDI-orders uit. NB: positieve formulering met
  -- IS DISTINCT FROM i.p.v. NOT (bron_systeem='edi' AND ...) — dat laatste valt
  -- voor handmatige orders (bron_systeem IS NULL) door SQL three-valued logic
  -- terug op UNKNOWN en zou die orders onterecht uit de planning-pool kippen.
  AND (o.bron_systeem IS DISTINCT FROM 'edi' OR o.edi_bevestigd_op IS NOT NULL);

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'marge_cm (mig 143), placed_*_cm (mig 233), snijplan_locatie (mig 168). '
  'Mig 290: WHERE o.status <> ''Geannuleerd''. Mig 310: ook onbevestigde '
  'EDI-orders uitgesloten (bron_systeem=''edi'' AND edi_bevestigd_op IS NULL) — '
  'hun leverweek is nog niet getoetst.';

NOTIFY pgrst, 'reload schema';
