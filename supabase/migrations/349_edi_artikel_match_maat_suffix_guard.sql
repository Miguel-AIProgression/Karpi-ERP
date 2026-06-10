-- Migratie 349: match_edi_artikel — maat-/vorm-suffix-guard op de token-match
-- (NB: op 2026-06-10 toegepast als "mig 348", vóór hernummering wegens
--  collisie met 346_derive_wacht_status_single_source op main.)
--
-- PROBLEEM (bevinding B1, docs/order-lifecycle.md §11): het Transus fixed-width
-- formaat heeft géén maatwerk-velden; partners zetten maat-/vorm-informatie als
-- tekst in de artikelcode ("526650044 155x230", "526650046 rund 160"). Stap 3
-- van match_edi_artikel (eerste token → artikelnr, mig 159/162) matchte zo'n
-- regel stilzwijgend op het kale artikelnr en GOOIDE DE SUFFIX WEG — het
-- gevaarlijkste scenario: verkeerde maat gepickt en verzonden zonder dat
-- iemand het kon zien.
--
-- FIX (vangnet, geen auto-maatwerk): als de token-match zou slagen maar de
-- rest-tekst een maat-patroon (NNNxNNN) of vorm-woord (rund/rond/ovaal/oval)
-- bevat, weigert de matcher → de regel landt via het bestaande
-- ongematcht-pad ("[EDI ongematcht: …]", artikelnr NULL) en daarmee in de
-- 'Actie vereist'-flow op het orders-overzicht. De operator beoordeelt en
-- maakt er bewust een maatwerk- of juiste-variant-regel van.
--
-- BEWUST NIET: maatwerk-velden automatisch afleiden uit de suffix-tekst.
-- Te fragiel zonder corpus van echte partner-berichten; eerst bewijs
-- verzamelen via dit vangnet (de geweigerde regels zijn precies dat corpus).
-- Echte EDI-maatwerk-parsing = vervolgbeslissing (V2).
--
-- ONGEMOEID: stap 1a/1b (GTIN — exacte product-identificatie, suffix is daar
-- redundant) en stap 2 (volledige artikelcode incl. suffix matcht een echt
-- artikelnr). Alleen de lossy stap 3 krijgt de guard.
--
-- Let op: woordgrens in PostgreSQL-regex is \y (NIET \b — dat is backspace).
--
-- Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION match_edi_artikel(
  p_gtin        TEXT,
  p_artikelcode TEXT
) RETURNS TABLE(
  artikelnr     TEXT,
  omschrijving  TEXT,
  verkoopprijs  NUMERIC
) AS $$
DECLARE
  v_eerste_token TEXT;
  v_rest         TEXT;
BEGIN
  -- 1a. GTIN-match exact
  IF p_gtin IS NOT NULL AND p_gtin <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 1b. GTIN-match met ".0"-suffix tolerantie (defensief — trigger zou dit
    --     normaliter al hebben opgeruimd, maar als een rij ooit binnenkomt
    --     zonder de trigger te triggeren, hier nog een vangnet).
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin || '.0'
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Volledige artikelcode → artikelnr
  IF p_artikelcode IS NOT NULL AND p_artikelcode <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.artikelnr = p_artikelcode
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. Eerste token (vóór spatie) → artikelnr — mét maat-suffix-guard (mig 349):
    --    bevat de rest-tekst een maat-patroon of vorm-woord, dan zou een
    --    token-match die informatie stilzwijgend droppen → bewust géén match,
    --    zodat de regel als ongematcht ("Actie vereist") landt.
    v_eerste_token := split_part(p_artikelcode, ' ', 1);
    IF v_eerste_token <> '' AND v_eerste_token <> p_artikelcode THEN
      v_rest := trim(substr(p_artikelcode, length(v_eerste_token) + 1));
      IF v_rest ~* '\d+\s*[x×]\s*\d+'
         OR v_rest ~* '\y(rund|rond|ovaal|oval)\y' THEN
        RETURN;  -- maat-/vorm-suffix-guard: operator moet beoordelen
      END IF;

      RETURN QUERY
      SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
        FROM producten p
       WHERE p.artikelnr = v_eerste_token
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION match_edi_artikel IS
  'Drie-staps EDI-artikel-matching met defensieve ean_code-tolerantie. '
  '1a) GTIN exact → ean_code, 1b) GTIN+".0" (legacy Excel-import-residu), '
  '2) volledige artikelcode → artikelnr, 3) eerste token → artikelnr — '
  'mig 349: stap 3 weigert als de rest-tekst een maat-patroon (NNNxNNN) of '
  'vorm-woord (rund/rond/ovaal/oval) bevat, zodat maat-informatie nooit '
  'stilzwijgend gedropt wordt; de regel landt dan als ongematcht (Actie '
  'vereist). Migratie 159, defensief uitgebreid in 162, suffix-guard in 349.';

-- Zelf-test: guard-patronen + definitie-asserties.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('match_edi_artikel(TEXT, TEXT)'::regprocedure);
BEGIN
  -- De patronen die de guard moet vangen (verbatim de regexes uit de functie):
  IF NOT ('155x230'  ~* '\d+\s*[x×]\s*\d+') THEN RAISE EXCEPTION 'Mig 349: maat-patroon vangt 155x230 niet'; END IF;
  IF NOT ('155 x 230' ~* '\d+\s*[x×]\s*\d+') THEN RAISE EXCEPTION 'Mig 349: maat-patroon vangt "155 x 230" niet'; END IF;
  IF NOT ('rund 160' ~* '\y(rund|rond|ovaal|oval)\y') THEN RAISE EXCEPTION 'Mig 349: vorm-patroon vangt "rund 160" niet'; END IF;
  -- En wat hij NIET mag vangen (kleur-/tekst-suffix blijft token-matchen):
  IF 'GRIJS' ~* '\d+\s*[x×]\s*\d+' OR 'GRIJS' ~* '\y(rund|rond|ovaal|oval)\y' THEN
    RAISE EXCEPTION 'Mig 349: guard vangt onterecht een kleur-suffix';
  END IF;
  -- Geen substring-false-positives op vorm-woorden (woordgrens \y werkt):
  IF 'rondje' ~* '\y(rund|rond|ovaal|oval)\y' THEN
    RAISE EXCEPTION 'Mig 349: vorm-patroon matcht binnen een woord (woordgrens kapot)';
  END IF;
  -- Definitie-asserties:
  IF v_def NOT LIKE '%suffix-guard%' THEN
    RAISE EXCEPTION 'Mig 349: definitie bevat de suffix-guard niet';
  END IF;
  RAISE NOTICE 'Mig 349: alle asserties geslaagd — maat-suffix-guard actief op stap 3';
END $$;

NOTIFY pgrst, 'reload schema';
