-- Zelf-test voor match_klant_po. Draai in de Supabase SQL-editor.
-- Verwacht: alle RAISE NOTICE-regels eindigen op "OK". ROLLBACK aan het eind.
BEGIN;

-- Seed een testdebiteur met uniek BTW-nr.
INSERT INTO debiteuren (debiteur_nr, naam, status, btw_nummer, email_overig, korting_pct, btw_percentage)
VALUES (999001, 'TESTKLANT PO BV', 'Actief', 'NL999000001B01', 'orders@testklant-po.nl', 0, 21)
ON CONFLICT (debiteur_nr) DO NOTHING;

DO $$
DECLARE r jsonb;
BEGIN
  -- 1. Debiteur-match op btw -> zeker.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','TESTKLANT PO BV','email',NULL,'btw_nummer','NL 9990 0000 1B01','kvk',NULL,'adres',NULL),
    'klant_referentie','PO-1','leverdatum_tekst','29-2026','spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001, 'btw-match faalt';
  ASSERT (r#>>'{debiteur,zeker}')::boolean = true, 'btw-zeker faalt';
  RAISE NOTICE 'btw-match: OK';

  -- 2. Debiteur-match op e-maildomein -> zeker.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','onbekend','email','iemand@testklant-po.nl','btw_nummer',NULL,'kvk',NULL,'adres',NULL),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001, 'email-match faalt';
  RAISE NOTICE 'email-match: OK';

  -- 3. Onbekende afzender -> onzeker, geen debiteur.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','VOLSTREKT ONBEKEND XYZ','email',NULL,'btw_nummer',NULL,'kvk',NULL,'adres',NULL),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,zeker}')::boolean = false, 'onbekend-onzeker faalt';
  ASSERT (r#>>'{debiteur,debiteur_nr}') IS NULL, 'onbekend moet NULL debiteur geven';
  RAISE NOTICE 'onbekend-afzender: OK';

  -- 4. Kleurcode-extractie uit "Iron Grey 15".
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','TESTKLANT PO BV'),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',1,'ruwe_omschrijving','Cavaro 240x330','kwaliteit_tekst','ONBEKEND_KW',
      'kleur_tekst','Iron Grey 15','lengte_cm',240,'breedte_cm',330,'vorm_tekst',NULL,
      'klant_artikelnr',NULL,'prijs',NULL,'korting_pct',NULL))));
  ASSERT (r#>>'{regels,0,zeker}')::boolean = false, 'onresolvebare kwaliteit moet onzeker zijn';
  RAISE NOTICE 'kleur-extractie + onzeker-regel: OK';

  RAISE NOTICE 'ALLE TESTS GESLAAGD';
END $$;

ROLLBACK;
