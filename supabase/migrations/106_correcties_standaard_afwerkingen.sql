-- Correcties en aanvullingen kwaliteit_standaard_afwerking op basis van Art+aliassen 22-04-2026.
-- AEST/ESSE: waren B, zijn FS (smalfeston) per afwerkingsbestand.
-- DYST: was B, is SB per afwerkingsbestand.
-- SOLE: was B, is FS per afwerkingsbestand.
-- Nieuwe kwaliteiten: ANDE, CROW, CRUS, FPBO, FPTO, HIGH, LIMA, LOWL, SABE.

INSERT INTO kwaliteit_standaard_afwerking (kwaliteit_code, afwerking_code)
VALUES
  ('AEST', 'SF'),
  ('ANDE', 'FE'),
  ('CROW', 'B'),
  ('CRUS', 'SF'),
  ('DYST', 'SB'),
  ('ESSE', 'SF'),
  ('FPBO', 'ZO'),
  ('FPTO', 'ZO'),
  ('HIGH', 'SB'),
  ('LIMA', 'FE'),
  ('LOWL', 'SF'),
  ('SABE', 'ZO'),
  ('SOLE', 'SF')
ON CONFLICT (kwaliteit_code)
  DO UPDATE SET afwerking_code = EXCLUDED.afwerking_code;
