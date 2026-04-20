-- Migration 096: TAM-kwaliteit harmoniseren naar TAMA (vervanger failliete leverancier)
--
-- Context: de oorspronkelijke leverancier (BALTA) voor TAMAR is failliet.
-- Een vervangende leverancier levert functioneel dezelfde kwaliteit onder
-- prefix 'TAM1' ipv 'TAMA'. Voorbeelden:
--   TAMA134000NG  kwaliteit_code='TAMA' kleur_code='13'  (oud)
--   TAM113400ONG  kwaliteit_code='TAM'  kleur_code='11'  (nieuw — fout!)
-- Beide leveren fysiek kleur 13. Voor de snijplanning moet dit één voorraadgroep zijn.
--
-- Twee problemen in de huidige data voor TAM1-producten:
--   1. kwaliteit_code = 'TAM' ipv 'TAMA'
--   2. kleur_code is afgeleid als "eerste 2 cijfers uit karpi_code" → pakt de '1' uit
--      prefix 'TAM1' en is daardoor fout. De werkelijke kleur staat op positie 5-6
--      van de karpi_code (TAM1{kleur:2}{breedte:3}{suffix}).
--
-- Fix (per user-directive 2026-04-20): beide velden repareren op de TAM1-producten,
-- zoeksleutel herberekenen, rollen synchroniseren. Geen uitwisselgroepen-infra.

BEGIN;

DO $$
DECLARE
  v_voor_tam_producten   INT;
  v_voor_tam_rollen      INT;
  v_voor_tama_producten  INT;
  v_tama_bestaat         BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_voor_tam_producten  FROM producten WHERE kwaliteit_code = 'TAM';
  SELECT COUNT(*) INTO v_voor_tam_rollen     FROM rollen    WHERE kwaliteit_code = 'TAM';
  SELECT COUNT(*) INTO v_voor_tama_producten FROM producten WHERE kwaliteit_code = 'TAMA';
  SELECT EXISTS(SELECT 1 FROM kwaliteiten WHERE code = 'TAMA') INTO v_tama_bestaat;

  RAISE NOTICE '[VOOR] producten TAM: %, rollen TAM: %, producten TAMA: %, kwaliteit TAMA bestaat: %',
    v_voor_tam_producten, v_voor_tam_rollen, v_voor_tama_producten, v_tama_bestaat;

  IF NOT v_tama_bestaat THEN
    RAISE EXCEPTION 'Kwaliteit TAMA bestaat niet in `kwaliteiten` — eerst aanmaken.';
  END IF;
END $$;

-- 1) Producten: kleur_code repareren + kwaliteit_code + zoeksleutel
--    Alleen voor TAM-kwaliteit met TAM1-prefix waarvan positie 5-6 twee cijfers zijn.
UPDATE producten
SET kleur_code     = SUBSTRING(karpi_code FROM 5 FOR 2),
    kwaliteit_code = 'TAMA',
    zoeksleutel    = 'TAMA_' || SUBSTRING(karpi_code FROM 5 FOR 2)
WHERE kwaliteit_code = 'TAM'
  AND karpi_code LIKE 'TAM1%'
  AND SUBSTRING(karpi_code FROM 5 FOR 2) ~ '^[0-9]{2}$';

-- 2) Rollen: gedenormaliseerde velden synchroniseren via producten-join
UPDATE rollen r
SET kwaliteit_code = p.kwaliteit_code,
    kleur_code     = p.kleur_code,
    zoeksleutel    = p.zoeksleutel
FROM producten p
WHERE r.artikelnr = p.artikelnr
  AND p.karpi_code LIKE 'TAM1%'
  AND p.kwaliteit_code = 'TAMA'
  AND r.kwaliteit_code = 'TAM';

DO $$
DECLARE
  v_na_tam_producten  INT;
  v_na_tam_rollen     INT;
  v_na_tama_producten INT;
  v_na_tama_rollen    INT;
BEGIN
  SELECT COUNT(*) INTO v_na_tam_producten  FROM producten WHERE kwaliteit_code = 'TAM';
  SELECT COUNT(*) INTO v_na_tam_rollen     FROM rollen    WHERE kwaliteit_code = 'TAM';
  SELECT COUNT(*) INTO v_na_tama_producten FROM producten WHERE kwaliteit_code = 'TAMA';
  SELECT COUNT(*) INTO v_na_tama_rollen    FROM rollen    WHERE kwaliteit_code = 'TAMA';

  RAISE NOTICE '[NA]   producten TAM: %, rollen TAM: %, producten TAMA: %, rollen TAMA: %',
    v_na_tam_producten, v_na_tam_rollen, v_na_tama_producten, v_na_tama_rollen;
END $$;

COMMIT;
