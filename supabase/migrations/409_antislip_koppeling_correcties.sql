-- Migratie 409: Antislip koppeling correcties (follow-up mig 408)
--
-- (a) 900000015 (DOOS 4ST 300×400) koppelen aan 900000016 (bestaand stuks-artikel)
--     i.p.v. 900000025 (was een fout: 900000025 is zelf een doos-artikel).
-- (b) Prijzen instellen op 900000016 (stuks 300×400): €50,00 vvp / €40,00 ink.
-- (c) Prijs instellen op 900000018 (stuks 60×110, stuks-only): €3,72 vvp.
-- (d) Backfill doos-vrije_voorraad voor 900000015 na de koppelings-correctie.
--
-- Idempotent: alle statements zijn UPDATE/SET die dezelfde waarden zetten.

-- (a) Correcte koppeling 900000015 → 900000016
UPDATE producten
  SET stuks_artikelnr = '900000016', stuks_per_doos = 4
WHERE artikelnr = '900000015';

-- (b) Prijs stuks 300×400 cm (€160/4 × 1.25 = €50,00)
UPDATE producten
  SET verkoopprijs = 50.00, inkoopprijs = 40.00
WHERE artikelnr = '900000016';

-- (c) Prijs stuks 60×110 cm (stuks-only, geen doos-equivalent)
UPDATE producten
  SET verkoopprijs = 3.72
WHERE artikelnr = '900000018';

-- (d) Backfill: sync doos-vrije_voorraad voor 900000015 vanuit 900000016
UPDATE producten doos
SET
  voorraad       = FLOOR(COALESCE(stuks.voorraad, 0)::NUMERIC / doos.stuks_per_doos)::INTEGER,
  vrije_voorraad = FLOOR(COALESCE(stuks.vrije_voorraad, 0)::NUMERIC / doos.stuks_per_doos)::INTEGER,
  gereserveerd   = 0,
  backorder      = 0
FROM producten stuks
WHERE doos.stuks_artikelnr = stuks.artikelnr
  AND doos.artikelnr = '900000015';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Mig 409: antislip koppeling correcties toegepast.';
  RAISE NOTICE '  + 900000015 → 900000016 (4 st/doos, 300×400 cm)';
  RAISE NOTICE '  + 900000016 vvp=50.00, ink=40.00';
  RAISE NOTICE '  + 900000018 vvp=3.72 (60×110 cm stuks-only)';
END $$;
