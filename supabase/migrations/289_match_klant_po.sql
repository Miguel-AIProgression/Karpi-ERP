-- Migratie 289: match_klant_po
-- Deterministische koppel-laag voor klant-PO parsing (ADR-loze utility-RPC).
-- Input  = ruwe extractie (jsonb) zoals po-extract.ts die produceert.
-- Output = voorgestelde order-velden met per stuk een zekerheidslabel.
-- "zeker" = true betekent: frontend mag dit voorvullen.

CREATE OR REPLACE FUNCTION match_klant_po(p_extractie jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_btw             text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,btw_nummer}',''), '[^A-Za-z0-9]', '', 'g'));
  v_email           text  := lower(trim(coalesce(p_extractie#>>'{afzender,email}','')));
  v_email_domein    text;
  v_naam_norm       text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,naam}',''), '\s+', ' ', 'g'));
  v_debiteur_nr     integer;
  v_debiteur_zeker  boolean := false;
  v_cnt             integer;
  v_regel           jsonb;
  v_regels_out      jsonb := '[]'::jsonb;
  v_kwaliteit       text;
  v_kleur           text;
  v_artikelnr       text;
  v_is_maatwerk     boolean;
  v_regel_zeker     boolean;
BEGIN
  IF position('@' in v_email) > 0 THEN
    v_email_domein := split_part(v_email, '@', 2);
  END IF;

  -- ---- Debiteur: btw > e-maildomein > exacte naam, telkens precies 1 hit ----
  IF v_btw <> '' THEN
    SELECT debiteur_nr INTO v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(btw_nummer,''), '[^A-Za-z0-9]', '', 'g')) = v_btw
    LIMIT 2;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_email_domein IS NOT NULL AND v_email_domein <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE lower(coalesce(email_factuur,'')) LIKE '%@'||v_email_domein
       OR lower(coalesce(email_overig,''))  LIKE '%@'||v_email_domein
       OR lower(coalesce(email_2,''))       LIKE '%@'||v_email_domein;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_naam_norm <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(naam,''), '\s+', ' ', 'g')) = v_naam_norm;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  -- ---- Regels ----
  FOR v_regel IN SELECT * FROM jsonb_array_elements(coalesce(p_extractie->'regels','[]'::jsonb))
  LOOP
    v_kwaliteit := NULL; v_kleur := NULL; v_artikelnr := NULL;
    v_is_maatwerk := false; v_regel_zeker := false;

    -- Kleurcode = numeriek deel uit kleur_tekst ("Iron Grey 15" -> 15).
    v_kleur := nullif((regexp_match(coalesce(v_regel->>'kleur_tekst',''), '(\d{1,3})\s*$'))[1], '');

    -- 1. Klant-artikelnr (gescoped op debiteur).
    IF v_debiteur_zeker AND coalesce(v_regel->>'klant_artikelnr','') <> '' THEN
      SELECT artikelnr INTO v_artikelnr
      FROM klant_artikelnummers
      WHERE debiteur_nr = v_debiteur_nr
        AND lower(trim(klant_artikel)) = lower(trim(v_regel->>'klant_artikelnr'))
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN v_regel_zeker := true; END IF;
    END IF;

    -- 2. Kwaliteit via klanteigen naam (reverse lookup benaming -> code),
    --    debiteur- OF inkoopgroep-scoped (mig 200: XOR debiteur_nr/inkoopgroep_code).
    --    Precedentie volgt klanteigen_namen-resolutie: klant boven inkoopgroep,
    --    kleur-specifiek boven kleur-NULL-fallback. Daarna exacte kwaliteitsnaam.
    IF v_artikelnr IS NULL AND coalesce(v_regel->>'kwaliteit_tekst','') <> '' THEN
      IF v_debiteur_zeker THEN
        SELECT kn.kwaliteit_code INTO v_kwaliteit
        FROM klanteigen_namen kn
        WHERE (
              kn.debiteur_nr = v_debiteur_nr
           OR kn.inkoopgroep_code = (SELECT inkoopgroep_code FROM debiteuren WHERE debiteur_nr = v_debiteur_nr)
          )
          AND lower(trim(kn.benaming)) = lower(trim(v_regel->>'kwaliteit_tekst'))
          AND (kn.kleur_code IS NULL OR kn.kleur_code = v_kleur)
        ORDER BY (kn.debiteur_nr IS NOT NULL) DESC, kn.kleur_code NULLS LAST
        LIMIT 1;
      END IF;
      IF v_kwaliteit IS NULL THEN
        SELECT k.code INTO v_kwaliteit
        FROM kwaliteiten k
        WHERE lower(trim(k.omschrijving)) = lower(trim(v_regel->>'kwaliteit_tekst'))
        LIMIT 1;
      END IF;
    END IF;

    -- 3. Catalogus-product op (kwaliteit, kleur, maat) -> artikelnr; anders maatwerk.
    IF v_artikelnr IS NULL AND v_kwaliteit IS NOT NULL AND v_kleur IS NOT NULL THEN
      SELECT p.artikelnr INTO v_artikelnr
      FROM producten p
      WHERE p.kwaliteit_code = v_kwaliteit
        AND p.kleur_code = v_kleur
        AND p.actief = true
        AND p.lengte_cm = nullif(v_regel->>'lengte_cm','')::int
        AND p.breedte_cm = nullif(v_regel->>'breedte_cm','')::int
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN
        v_regel_zeker := true;
      ELSIF (v_regel->>'lengte_cm') IS NOT NULL AND (v_regel->>'breedte_cm') IS NOT NULL THEN
        v_is_maatwerk := true;
        v_regel_zeker := true;  -- maatwerk-specs zijn zeker (kw+kl+maat resolved)
      END IF;
    END IF;

    v_regels_out := v_regels_out || jsonb_build_object(
      'aantal',            v_regel->'aantal',
      'ruwe_omschrijving', v_regel->>'ruwe_omschrijving',
      'artikelnr',         v_artikelnr,
      'is_maatwerk',       v_is_maatwerk,
      'maatwerk_kwaliteit_code', CASE WHEN v_is_maatwerk THEN v_kwaliteit END,
      'maatwerk_kleur_code',     CASE WHEN v_is_maatwerk THEN v_kleur END,
      'lengte_cm',         v_regel->'lengte_cm',
      'breedte_cm',        v_regel->'breedte_cm',
      'vorm_tekst',        v_regel->>'vorm_tekst',
      'prijs',             v_regel->'prijs',
      'korting_pct',       v_regel->'korting_pct',
      'zeker',             v_regel_zeker
    );
  END LOOP;

  RETURN jsonb_build_object(
    'debiteur', jsonb_build_object('debiteur_nr', v_debiteur_nr, 'zeker', v_debiteur_zeker),
    'klant_referentie', p_extractie->>'klant_referentie',
    'leverdatum_tekst', p_extractie->>'leverdatum_tekst',
    'spoed', coalesce((p_extractie->>'spoed')::boolean, false),
    'afleveradres', p_extractie->'afleveradres',
    'factuuradres', p_extractie->'factuuradres',
    'regels', v_regels_out
  );
END;
$$;

GRANT EXECUTE ON FUNCTION match_klant_po(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION match_klant_po(jsonb) IS
  'Klant-PO parsing: deterministische koppel-laag. Input = ruwe extractie (po-extract.ts), output = order-velden met per stuk zekerheidslabel. Zie docs/superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md';

NOTIFY pgrst, 'reload schema';
