-- ============================================================
-- Zelf-test voor match_klant_po (mig 294).
-- Draai in de Supabase SQL-editor (of psql).
-- Alle wijzigingen worden aan het eind via ROLLBACK weggegooid.
--
-- Bewezen gedrag:
--   T1 btw-normalisatie + unieke hit → zeker=true
--   T2 e-maildomein-match → debiteur 999001
--   T3 duplicate-btw-gate → zeker=false + debiteur_nr NULL (uniqueness gate)
--   T4 volledig onbekende afzender → zeker=false, debiteur_nr NULL
--   T5 klant_artikelnr-lookup → artikelnr=ZZTESTPROD1, zeker=true
--   T6 klanteigen-naam-reverse + catalogus-hit → ZZTESTPROD1, zeker=true
--   T7 kwaliteit-omschrijving-reverse + maatwerk-fallback → is_maatwerk=true
--   T8 onoplosbare kwaliteit → zeker=false
-- ============================================================

BEGIN;

-- ============================================================
-- SEED — deterministische schoonmaak vóór insert
-- Volgorde: kwaliteiten → producten → debiteuren → kinderen
-- ============================================================

-- Verwijder eventuele resten van een eerdere (gefaalde) run.
-- CASCADE op klanteigen_namen/klant_artikelnummers via FK DELETE CASCADE
-- op debiteuren; producten en kwaliteiten hebben geen cascade maar
-- klant_artikelnummers heeft FK op producten → eerst kind-rijen deleten.
DELETE FROM klant_artikelnummers
  WHERE debiteur_nr IN (999001, 999002, 999003);

DELETE FROM klanteigen_namen
  WHERE debiteur_nr IN (999001, 999002, 999003);

DELETE FROM debiteuren
  WHERE debiteur_nr IN (999001, 999002, 999003);

-- klant_artikelnummers FK → producten: ook die rij nog weg als die er al was.
DELETE FROM producten WHERE artikelnr = 'ZZTESTPROD1';

-- kwaliteiten: geen FK-kinderen in het test-domein (producten verwijderd hierboven).
DELETE FROM kwaliteiten WHERE code = 'ZZTT';

-- ---- kwaliteiten ----
-- Kolommen (docs/database-schema.md ### kwaliteiten + mig 184):
--   code TEXT PK (NOT NULL), omschrijving TEXT (nullable in schema, used in lookup),
--   collectie_id BIGINT FK nullable, standaard_breedte_cm INTEGER nullable,
--   gewicht_per_m2_kg NUMERIC(8,3) nullable, created_at TIMESTAMPTZ DEFAULT now()
INSERT INTO kwaliteiten (code, omschrijving)
VALUES ('ZZTT', 'ZZTESTKWAL');

-- ---- producten ----
-- Minimale NOT NULL velden bepaald via mig 265 (INSERT met enkel
-- artikelnr/omschrijving/product_type/actief); kwaliteit_code + kleur_code +
-- lengte_cm + breedte_cm zijn nullable maar vereist voor de catalogus-lookup
-- in match_klant_po step 3.
-- Gewicht-trigger (mig 185) vuurt alleen op UPDATE OF gewicht_per_m2_kg /
-- UPDATE OF gewicht_kg — NIET op INSERT — dus geen trigger-complicaties.
-- zoeksleutel is een denorm TEXT-veld; NULL is toegestaan (pseudo-producten
-- in mig 265 omit it). We vullen het expliciet voor consistentie.
INSERT INTO producten (
  artikelnr,
  omschrijving,
  product_type,
  kwaliteit_code,
  kleur_code,
  lengte_cm,
  breedte_cm,
  zoeksleutel,
  actief
) VALUES (
  'ZZTESTPROD1',
  'ZZ Test Product 240x330 kleur 15',
  'vast',
  'ZZTT',
  '15',
  240,
  330,
  'ZZTT_15',
  true
);

-- ---- debiteuren ----
-- Kolommen (docs/database-schema.md ### debiteuren + mig 091 insert als referentie):
--   debiteur_nr INTEGER PK, naam TEXT, status TEXT, btw_nummer TEXT (nullable),
--   email_overig TEXT (nullable), korting_pct NUMERIC(5,2) (nullable),
--   btw_percentage NUMERIC(5,2) (nullable), gratis_verzending BOOLEAN NOT NULL DEFAULT false,
--   default_lever_type lever_type NOT NULL DEFAULT 'week', afleverwijze TEXT DEFAULT 'Bezorgen'.
-- Alleen debiteur_nr + naam + status zijn bewezen NOT NULL; overige velden
-- zijn nullable of hebben defaults. We zetten korting_pct en btw_percentage
-- expliciet voor duidelijkheid.

-- Debiteur 999001: uniek btw + uniek e-maildomein
INSERT INTO debiteuren (
  debiteur_nr, naam, status,
  btw_nummer, email_overig,
  korting_pct, btw_percentage
) VALUES (
  999001, 'TESTKLANT PO BV', 'Actief',
  'NL999000001B01', 'orders@testklant-po.nl',
  0, 21
);

-- Debiteuren 999002 + 999003: zelfde btw → uniqueness gate (T3)
INSERT INTO debiteuren (
  debiteur_nr, naam, status,
  btw_nummer,
  korting_pct, btw_percentage
) VALUES
  (999002, 'TESTKLANT DUBBEL A', 'Actief', 'NL888000002B02', 0, 21),
  (999003, 'TESTKLANT DUBBEL B', 'Actief', 'NL888000002B02', 0, 21);

-- ---- klant_artikelnummers ----
-- Kolommen (docs/database-schema.md ### klant_artikelnummers):
--   id BIGSERIAL PK, debiteur_nr INTEGER FK NOT NULL, artikelnr TEXT FK NOT NULL,
--   klant_artikel TEXT, omschrijving TEXT nullable, vervolg TEXT nullable.
-- UK: (debiteur_nr, artikelnr).
INSERT INTO klant_artikelnummers (debiteur_nr, artikelnr, klant_artikel)
VALUES (999001, 'ZZTESTPROD1', 'KX-100');

-- ---- klanteigen_namen ----
-- Kolommen (docs/database-schema.md ### klanteigen_namen + mig 200):
--   id BIGSERIAL PK, debiteur_nr INTEGER FK (nullable, XOR inkoopgroep_code),
--   inkoopgroep_code TEXT FK (nullable, XOR debiteur_nr),
--   kwaliteit_code TEXT FK NOT NULL, kleur_code TEXT nullable (mig 199),
--   benaming TEXT, omschrijving TEXT nullable, leverancier TEXT nullable,
--   bron TEXT nullable, created_at/updated_at TIMESTAMPTZ DEFAULT now().
-- CHECK: (debiteur_nr IS NOT NULL AND inkoopgroep_code IS NULL) OR vice versa.
-- UK partial: (debiteur_nr, kwaliteit_code, COALESCE(kleur_code,'')) WHERE debiteur_nr IS NOT NULL.
-- kleur_code=NULL → fallback: geldt voor álle kleuren van ZZTT onder 999001.
INSERT INTO klanteigen_namen (
  debiteur_nr, inkoopgroep_code,
  kwaliteit_code, kleur_code,
  benaming, bron
) VALUES (
  999001, NULL,
  'ZZTT', NULL,
  'TestKwalNaam', 'test'
);

-- ============================================================
-- TESTS
-- ============================================================
DO $$
DECLARE
  r          jsonb;
  v_deb_nr   int;
  v_deb_zek  boolean;
BEGIN

  -- ----------------------------------------------------------
  -- T1: btw-normalisatie → debiteur 999001, zeker=true
  --
  -- Bewijs: 'NL 9990 0000 1B01' verwijdert spaties via
  -- regexp_replace(..., '[^A-Za-z0-9]', '', 'g') → 'NL999000001B01',
  -- komt overeen met debiteuren.btw_nummer='NL999000001B01'. Één hit → zeker.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       'TESTKLANT PO BV',
      'email',      NULL,
      'btw_nummer', 'NL 9990 0000 1B01',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', 'PO-T1',
    'leverdatum_tekst', '29-2026',
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels',           '[]'::jsonb
  ));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001,
    'T1 FAIL: verwacht debiteur_nr=999001 via btw-normalisatie';
  ASSERT (r#>>'{debiteur,zeker}')::boolean = true,
    'T1 FAIL: verwacht zeker=true bij unieke btw-hit';
  RAISE NOTICE 'T1 btw-normalisatie + unieke hit: OK';

  -- ----------------------------------------------------------
  -- T2: e-maildomein-match → debiteur 999001
  --
  -- Bewijs: email='iemand@testklant-po.nl' → domein='testklant-po.nl'.
  -- Query: email_overig LIKE '%@testklant-po.nl'. Seed heeft
  -- email_overig='orders@testklant-po.nl' → match. Één hit → zeker.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       'onbekend',
      'email',      'iemand@testklant-po.nl',
      'btw_nummer', NULL,
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', NULL,
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels',           '[]'::jsonb
  ));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001,
    'T2 FAIL: verwacht debiteur_nr=999001 via e-maildomein';
  ASSERT (r#>>'{debiteur,zeker}')::boolean = true,
    'T2 FAIL: verwacht zeker=true bij unieke e-maildomein-hit';
  RAISE NOTICE 'T2 e-maildomein-match: OK';

  -- ----------------------------------------------------------
  -- T3: duplicate-btw-gate → zeker=false EN debiteur_nr NULL
  --
  -- Bewijs: beide 999002 en 999003 hebben btw='NL888000002B02'.
  -- LIMIT 2 geeft 2 rijen → ROW_COUNT=2 → zeker blijft false EN de btw-branch
  -- nult v_debiteur_nr (consistent met de e-mail/naam-branches en de spec:
  -- 0 of >1 hits → geen debiteur).
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       NULL,
      'email',      NULL,
      'btw_nummer', 'NL888000002B02',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', NULL,
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels',           '[]'::jsonb
  ));
  ASSERT (r#>>'{debiteur,zeker}')::boolean = false,
    'T3 FAIL: duplicate-btw moet zeker=false opleveren';
  ASSERT (r#>>'{debiteur,debiteur_nr}') IS NULL,
    'T3 FAIL: duplicate-btw moet debiteur_nr NULL opleveren';
  RAISE NOTICE 'T3 duplicate-btw-gate (zeker=false, debiteur_nr NULL): OK';

  -- ----------------------------------------------------------
  -- T4: volledig onbekende afzender → zeker=false, debiteur_nr NULL
  --
  -- Bewijs: geen btw-hit, geen e-mail, naam='' (normalized) → btw-branch
  -- overgeslagen (v_btw=''), geen e-maildomein, naam-norm levert geen hit.
  -- v_debiteur_nr blijft NULL, v_debiteur_zeker=false.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       'VOLSTREKT ONBEKEND XYZ 999',
      'email',      NULL,
      'btw_nummer', NULL,
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', NULL,
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels',           '[]'::jsonb
  ));
  ASSERT (r#>>'{debiteur,zeker}')::boolean = false,
    'T4 FAIL: onbekende afzender moet zeker=false geven';
  ASSERT (r#>>'{debiteur,debiteur_nr}') IS NULL,
    'T4 FAIL: onbekende afzender moet debiteur_nr=NULL geven';
  RAISE NOTICE 'T4 onbekende afzender: OK';

  -- ----------------------------------------------------------
  -- T5: klant_artikelnr-lookup → artikelnr=ZZTESTPROD1, zeker=true
  --
  -- Bewijs:
  --   1. Afzender btw 'NL999000001B01' → debiteur 999001, zeker=true.
  --   2. Stap 1 in regelloop: v_debiteur_zeker=true, klant_artikelnr='KX-100'.
  --      SELECT artikelnr FROM klant_artikelnummers WHERE debiteur_nr=999001
  --        AND lower(trim('KX-100'))=lower(trim(klant_artikel))
  --      Seed heeft klant_artikel='KX-100' → artikelnr='ZZTESTPROD1'.
  --   3. v_artikelnr='ZZTESTPROD1', v_regel_zeker=true.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       NULL,
      'email',      NULL,
      'btw_nummer', 'NL999000001B01',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', 'PO-T5',
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',           1,
      'ruwe_omschrijving','ZZ Test 240x330',
      'kwaliteit_tekst',  NULL,
      'kleur_tekst',      NULL,
      'lengte_cm',        240,
      'breedte_cm',       330,
      'vorm_tekst',       NULL,
      'klant_artikelnr',  'KX-100',
      'prijs',            NULL,
      'korting_pct',      NULL
    ))
  ));
  ASSERT r#>>'{regels,0,artikelnr}' = 'ZZTESTPROD1',
    'T5 FAIL: verwacht artikelnr=ZZTESTPROD1 via klant_artikelnr-lookup';
  ASSERT (r#>>'{regels,0,zeker}')::boolean = true,
    'T5 FAIL: verwacht zeker=true bij klant_artikelnr-hit';
  RAISE NOTICE 'T5 klant_artikelnr-lookup: OK';

  -- ----------------------------------------------------------
  -- T6: klanteigen-naam-reverse + catalogus-hit → ZZTESTPROD1, zeker=true
  --
  -- Bewijs:
  --   1. Afzender btw → debiteur 999001, zeker=true.
  --   2. Geen klant_artikelnr → stap 1 overgeslagen.
  --   3. Kleurcode-extractie: regexp_match('Iron Grey 15', '(\d{1,3})\s*$')
  --      → ['15'] → v_kleur='15'.
  --   4. Stap 2 klanteigen-naam: debiteur_zeker=true →
  --      SELECT kwaliteit_code FROM klanteigen_namen
  --        WHERE debiteur_nr=999001
  --          AND lower(trim(benaming))=lower('TestKwalNaam')   -- 'testkwalnaam'
  --          AND (kleur_code IS NULL OR kleur_code='15')
  --        ORDER BY (debiteur_nr IS NOT NULL) DESC, kleur_code NULLS LAST
  --      Seed: debiteur_nr=999001, benaming='TestKwalNaam', kleur_code=NULL
  --        → IS NULL check slaagt → hit → kwaliteit_code='ZZTT'.
  --   5. Stap 3 catalogus: SELECT artikelnr FROM producten
  --        WHERE kwaliteit_code='ZZTT' AND kleur_code='15'
  --          AND actief=true AND lengte_cm=240 AND breedte_cm=330
  --      Seed ZZTESTPROD1 voldoet exact → v_artikelnr='ZZTESTPROD1', zeker=true.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       NULL,
      'email',      NULL,
      'btw_nummer', 'NL999000001B01',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', 'PO-T6',
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',           2,
      'ruwe_omschrijving','Iron Grey ZZ 240x330',
      'kwaliteit_tekst',  'TestKwalNaam',
      'kleur_tekst',      'Iron Grey 15',
      'lengte_cm',        240,
      'breedte_cm',       330,
      'vorm_tekst',       NULL,
      'klant_artikelnr',  NULL,
      'prijs',            NULL,
      'korting_pct',      NULL
    ))
  ));
  ASSERT r#>>'{regels,0,artikelnr}' = 'ZZTESTPROD1',
    'T6 FAIL: verwacht artikelnr=ZZTESTPROD1 via klanteigen-naam + catalogus';
  ASSERT (r#>>'{regels,0,zeker}')::boolean = true,
    'T6 FAIL: verwacht zeker=true bij catalogus-hit';
  RAISE NOTICE 'T6 klanteigen-naam-reverse + catalogus-hit: OK';

  -- ----------------------------------------------------------
  -- T7: kwaliteit-omschrijving-reverse + maatwerk-fallback
  --
  -- Bewijs:
  --   1. Afzender btw → debiteur 999001, zeker=true.
  --   2. kleur_tekst='15' → v_kleur='15' (regexp_match pakt trailing digits).
  --   3. Stap 2 klanteigen-naam: benaming='ZZTESTKWAL' → geen hit in
  --      klanteigen_namen (seed heeft benaming='TestKwalNaam').
  --      Fallback kwaliteiten: SELECT code FROM kwaliteiten
  --        WHERE lower(trim(omschrijving))='zztestkwal'  -- lower('ZZTESTKWAL')
  --      Seed: omschrijving='ZZTESTKWAL' → hit → v_kwaliteit='ZZTT'.
  --   4. Stap 3 catalogus: lengte=999, breedte=888 → geen product in seed.
  --      v_artikelnr=NULL. Beide maten zijn aanwezig (IS NOT NULL) →
  --      v_is_maatwerk=true, v_regel_zeker=true.
  --   5. Output: is_maatwerk=true, maatwerk_kwaliteit_code='ZZTT',
  --      maatwerk_kleur_code='15', zeker=true, artikelnr=NULL.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       NULL,
      'email',      NULL,
      'btw_nummer', 'NL999000001B01',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', 'PO-T7',
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',           1,
      'ruwe_omschrijving','ZZ maatwerk 999x888',
      'kwaliteit_tekst',  'ZZTESTKWAL',
      'kleur_tekst',      '15',
      'lengte_cm',        999,
      'breedte_cm',       888,
      'vorm_tekst',       NULL,
      'klant_artikelnr',  NULL,
      'prijs',            NULL,
      'korting_pct',      NULL
    ))
  ));
  ASSERT (r#>>'{regels,0,is_maatwerk}')::boolean = true,
    'T7 FAIL: verwacht is_maatwerk=true (geen catalogusproduct voor 999x888)';
  ASSERT (r#>>'{regels,0,zeker}')::boolean = true,
    'T7 FAIL: verwacht zeker=true (kw+kl+maat volledig resolved)';
  ASSERT r#>>'{regels,0,maatwerk_kwaliteit_code}' = 'ZZTT',
    'T7 FAIL: verwacht maatwerk_kwaliteit_code=ZZTT';
  ASSERT r#>>'{regels,0,maatwerk_kleur_code}' = '15',
    'T7 FAIL: verwacht maatwerk_kleur_code=15';
  ASSERT r#>>'{regels,0,artikelnr}' IS NULL,
    'T7 FAIL: maatwerk mag geen artikelnr hebben';
  RAISE NOTICE 'T7 kwaliteit-omschrijving-reverse + maatwerk-fallback: OK';

  -- ----------------------------------------------------------
  -- T8: onoplosbare kwaliteit → zeker=false
  --
  -- Bewijs: kwaliteit_tekst='ONBEKEND_KW' treft geen enkel
  -- klanteigen_namen-record en geen kwaliteiten.omschrijving.
  -- v_kwaliteit=NULL → stap 3 overgeslagen → v_regel_zeker=false.
  -- ----------------------------------------------------------
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object(
      'naam',       'TESTKLANT PO BV',
      'email',      NULL,
      'btw_nummer', 'NL999000001B01',
      'kvk',        NULL,
      'adres',      NULL
    ),
    'klant_referentie', NULL,
    'leverdatum_tekst', NULL,
    'spoed',            false,
    'afleveradres',     NULL,
    'factuuradres',     NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',           1,
      'ruwe_omschrijving','Onbekend 240x330',
      'kwaliteit_tekst',  'ONBEKEND_KW',
      'kleur_tekst',      'Iron Grey 15',
      'lengte_cm',        240,
      'breedte_cm',       330,
      'vorm_tekst',       NULL,
      'klant_artikelnr',  NULL,
      'prijs',            NULL,
      'korting_pct',      NULL
    ))
  ));
  ASSERT (r#>>'{regels,0,zeker}')::boolean = false,
    'T8 FAIL: onoplosbare kwaliteit moet zeker=false geven';
  RAISE NOTICE 'T8 onoplosbare kwaliteit: OK';

  RAISE NOTICE 'ALLE TESTS GESLAAGD';
END $$;

ROLLBACK;
