-- Datafix: zet kwaliteit+kleur op de 85 productie-only order_regels die bij de
-- eerste import LEEG bleven (artikelcode-formaat zonder MAATWERK-suffix, bv.
-- HARM16XX160230). Bron-van-waarheid identiek aan de parser-fallback
-- parse_kwal_kleur_lenient() in import_productie_only.py.
--
-- Idempotent: raakt alleen productie-only regels waar de kwaliteit nu nog leeg is.
-- snijplanning_overzicht leest kwaliteit via COALESCE(..., oreg.maatwerk_kwaliteit_code)
-- (mig 331) -- geen snijplannen-update nodig; de view volgt direct.

WITH fix(oud_order_nr, regelnummer, kwal, kleur) AS (
  VALUES
    (26513630, 2, 'HARM', '16'),
    (26513630, 3, 'HARM', '16'),
    (26513630, 4, 'HARM', '16'),
    (26513630, 5, 'HARM', '16'),
    (26540970, 1, 'GOLD', '14'),
    (26549910, 1, 'BIRM', '17'),
    (26550930, 1, 'GOLD', '12'),
    (26551930, 1, 'HARM', '16'),
    (26553480, 1, 'BIRM', '17'),
    (26555830, 4, 'SEAO', '13'),
    (26558010, 1, 'GOLD', '14'),
    (26563230, 1, 'HARM', '16'),
    (26563880, 35, 'HYGG', '14'),
    (26565060, 1, 'HARM', '11'),
    (26566160, 11, 'HARM', '14'),
    (26566400, 1, 'SETI', '21'),
    (26566420, 1, 'GOKI', '13'),
    (26566760, 1, 'HARM', '14'),
    (26569190, 2, 'HARM', '11'),
    (26569720, 1, 'HARM', '16'),
    (26569730, 1, 'OFFG', '18'),
    (26570730, 1, 'HARM', '21'),
    (26570860, 1, 'HARM', '16'),
    (26571420, 2, 'HARM', '16'),
    (26572220, 1, 'HARM', '16'),
    (26573430, 1, 'HARM', '16'),
    (26574390, 1, 'LOOP', '22'),
    (26574470, 10, 'HARM', '14'),
    (26574470, 11, 'HARM', '14'),
    (26574470, 12, 'HARM', '16'),
    (26574470, 13, 'HARM', '16'),
    (26574470, 14, 'HARM', '16'),
    (26574470, 15, 'HARM', '21'),
    (26574470, 16, 'HARM', '21'),
    (26574480, 12, 'HARM', '11'),
    (26574480, 15, 'HARM', '14'),
    (26574480, 17, 'HARM', '14'),
    (26574480, 18, 'HARM', '16'),
    (26574480, 19, 'HARM', '16'),
    (26574480, 20, 'HARM', '21'),
    (26574780, 1, 'HARM', '11'),
    (26575450, 2, 'HARM', '20'),
    (26575640, 1, 'HARM', '13'),
    (26575640, 2, 'HARM', '15'),
    (26575640, 3, 'HARM', '51'),
    (26575640, 4, 'HARM', '46'),
    (26575810, 1, 'HARM', '11'),
    (26575980, 1, 'HARM', '16'),
    (26576170, 23, 'HYGG', '11'),
    (26576170, 24, 'HYGG', '11'),
    (26576170, 25, 'HYGG', '11'),
    (26576170, 26, 'HYGG', '11'),
    (26576170, 27, 'HYGG', '14'),
    (26576170, 28, 'HYGG', '14'),
    (26576170, 29, 'HYGG', '14'),
    (26576170, 30, 'HYGG', '14'),
    (26576170, 31, 'HYGG', '14'),
    (26576170, 32, 'HYGG', '14'),
    (26576170, 33, 'HYGG', '16'),
    (26576170, 34, 'HYGG', '16'),
    (26576170, 35, 'HYGG', '16'),
    (26576170, 36, 'HYGG', '16'),
    (26576170, 37, 'HYGG', '16'),
    (26576170, 38, 'HYGG', '16'),
    (26576170, 39, 'HYGG', '21'),
    (26576170, 40, 'HYGG', '21'),
    (26576170, 41, 'HYGG', '21'),
    (26576170, 42, 'HYGG', '21'),
    (26576170, 43, 'HYGG', '21'),
    (26576170, 71, 'GOHA', '12'),
    (26576170, 72, 'GOHA', '12'),
    (26576170, 73, 'GOHA', '13'),
    (26576170, 74, 'GOHA', '18'),
    (26576170, 75, 'GOHA', '24'),
    (26576290, 1, 'EDGB', '21'),
    (26576430, 1, 'HARM', '16'),
    (26577140, 1, 'HARM', '11'),
    (26579480, 1, 'HARM', '16'),
    (26580000, 1, 'SETI', '21'),
    (26580120, 1, 'LUNA', '41'),
    (26580200, 2, 'HARM', '14'),
    (26580630, 2, 'OFFG', '18'),
    (26580780, 1, 'HARM', '14'),
    (26581100, 1, 'LOOP', '22'),
    (26581390, 1, 'HARM', '16')
)
UPDATE order_regels oreg
   SET maatwerk_kwaliteit_code = f.kwal,
       maatwerk_kleur_code     = f.kleur
  FROM fix f
  JOIN orders o ON o.oud_order_nr = f.oud_order_nr
 WHERE oreg.order_id    = o.id
   AND oreg.regelnummer = f.regelnummer
   AND o.alleen_productie = TRUE
   AND COALESCE(oreg.maatwerk_kwaliteit_code, '') = '';

NOTIFY pgrst, 'reload schema';
