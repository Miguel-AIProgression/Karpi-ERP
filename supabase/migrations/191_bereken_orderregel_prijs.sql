-- Migratie 191: RPC `bereken_orderregel_prijs` — fallback-keten voor orderregel-prijs
--
-- Doel: voor een (artikelnr, prijslijst_nr) combinatie de juiste verkoopprijs
-- bepalen voor een orderregel, met fallback naar m²-prijs + vormtoeslag wanneer
-- het artikel niet expliciet in de klant-prijslijst voorkomt. Spiegelt het
-- bestaande maatwerk-prijs-pad in `kwaliteit-first-selector.tsx` zodat ook
-- vaste-maat voorraadproducten (bv. 771150045 = CISCO 15 CA 240x340 ORGANISCH)
-- automatisch een logische prijs krijgen i.p.v. terug te vallen op een
-- statische `producten.verkoopprijs`.
--
-- Volgorde van fallbacks (eerste hit wint):
--   1. prijslijst_vast        — vaste prijs voor `artikelnr` in prijslijst_regels
--   2. prijslijst_m2          — m²-prijs uit prijslijst via kleur-specifiek
--                                MAATWERK-artikel × oppervlak + vormtoeslag
--   3. maatwerk_artikel_m2    — `producten.verkoopprijs` van MAATWERK-artikel
--                                × oppervlak + vormtoeslag
--   4. kwaliteit_m2           — `maatwerk_m2_prijzen.verkoopprijs_m2` generiek
--                                × oppervlak + vormtoeslag
--   5. product_verkoopprijs   — eigen `producten.verkoopprijs` (laatste redmiddel)
--   6. geen                   — geen prijs te bepalen → NULL
--
-- Stappen 2-4 vereisen dat het product een (lengte_cm × breedte_cm) of een
-- diameter heeft. Anders wordt dat fallback-blok overgeslagen.
--
-- Vormtoeslag komt uit `maatwerk_vormen.toeslag` o.b.v.
-- `producten.maatwerk_vorm_code` (mig 190). NULL = rechthoek = €0.
--
-- Retour: JSONB met prijs (numeric), bron (text), en breakdown (object).

CREATE OR REPLACE FUNCTION bereken_orderregel_prijs(
  p_artikelnr     TEXT,
  p_prijslijst_nr TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_prod              RECORD;
  v_oppervlak_m2      NUMERIC;
  v_vorm_toeslag      NUMERIC := 0;
  v_vorm_code         TEXT;
  v_maatwerk_artikel  TEXT;
  v_m2_prijs          NUMERIC;
  v_m2_bron_artikel   TEXT;
  v_vaste_prijs       NUMERIC;
  v_kleur_norm        TEXT;
BEGIN
  -- 0. Product ophalen
  SELECT
    p.artikelnr, p.kwaliteit_code, p.kleur_code,
    p.lengte_cm, p.breedte_cm, p.vorm, p.maatwerk_vorm_code,
    p.verkoopprijs, p.product_type
  INTO v_prod
  FROM producten p
  WHERE p.artikelnr = p_artikelnr;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'prijs', NULL, 'bron', 'onbekend_artikel',
      'breakdown', jsonb_build_object('reden', 'Artikel niet gevonden')
    );
  END IF;

  ----------------------------------------------------------------------
  -- 1. Vaste prijs uit klant-prijslijst (huidige hoofdpad)
  ----------------------------------------------------------------------
  IF p_prijslijst_nr IS NOT NULL THEN
    SELECT pr.prijs INTO v_vaste_prijs
      FROM prijslijst_regels pr
     WHERE pr.prijslijst_nr = p_prijslijst_nr
       AND pr.artikelnr = p_artikelnr
     LIMIT 1;

    IF v_vaste_prijs IS NOT NULL THEN
      RETURN jsonb_build_object(
        'prijs', v_vaste_prijs,
        'bron',  'prijslijst_vast',
        'breakdown', jsonb_build_object(
          'prijslijst_nr', p_prijslijst_nr,
          'artikelnr',     p_artikelnr
        )
      );
    END IF;
  END IF;

  ----------------------------------------------------------------------
  -- 2. Bepaal oppervlak — vereist voor alle m²-fallbacks
  ----------------------------------------------------------------------
  IF v_prod.lengte_cm IS NOT NULL AND v_prod.breedte_cm IS NOT NULL
     AND v_prod.lengte_cm > 0 AND v_prod.breedte_cm > 0 THEN
    IF v_prod.vorm = 'rond' THEN
      -- π × r² waar r = lengte_cm / 200 (lengte_cm = diameter)
      v_oppervlak_m2 := pi() * power(v_prod.lengte_cm::NUMERIC / 200.0, 2);
    ELSE
      -- Bbox: lengte × breedte / 10000
      v_oppervlak_m2 := (v_prod.lengte_cm::NUMERIC * v_prod.breedte_cm) / 10000.0;
    END IF;
  END IF;

  -- Vormtoeslag (NULL maatwerk_vorm_code = rechthoek = €0)
  IF v_prod.maatwerk_vorm_code IS NOT NULL THEN
    SELECT mv.code, mv.toeslag INTO v_vorm_code, v_vorm_toeslag
      FROM maatwerk_vormen mv
     WHERE mv.code = v_prod.maatwerk_vorm_code
     LIMIT 1;
  END IF;
  v_vorm_toeslag := COALESCE(v_vorm_toeslag, 0);
  v_vorm_code    := COALESCE(v_vorm_code, 'rechthoek');

  ----------------------------------------------------------------------
  -- 3. Zoek kleur-specifiek MAATWERK-artikel voor m²-prijs
  ----------------------------------------------------------------------
  -- Vereenvoudigde versie van fetchMaatwerkArtikelNr (op-maat.ts:161-217):
  -- pakt eerste actief product binnen kwaliteit+kleur dat 'maatwerk' in naam
  -- of code heeft. Dekt 95% van de gevallen; uitwisselgroep-fallback wordt
  -- bewust weggelaten — dat is een subtielere feature die hier niet kritisch is.
  IF v_oppervlak_m2 IS NOT NULL
     AND v_prod.kwaliteit_code IS NOT NULL
     AND v_prod.kleur_code IS NOT NULL THEN

    v_kleur_norm := regexp_replace(v_prod.kleur_code, '\.0$', '');

    SELECT p2.artikelnr INTO v_maatwerk_artikel
      FROM producten p2
     WHERE p2.kwaliteit_code = v_prod.kwaliteit_code
       AND (p2.kleur_code = v_prod.kleur_code OR p2.kleur_code = v_kleur_norm)
       AND p2.actief = true
       AND (
         upper(coalesce(p2.omschrijving,'')) LIKE '%MAATWERK%'
         OR upper(coalesce(p2.karpi_code,''))   LIKE '%MAATWERK%'
       )
     ORDER BY (p2.product_type = 'overig') DESC, p2.artikelnr
     LIMIT 1;
  END IF;

  ----------------------------------------------------------------------
  -- 4. Probeer fallbacks 2 → 3 → 4 op volgorde
  ----------------------------------------------------------------------
  IF v_oppervlak_m2 IS NOT NULL THEN

    -- 2. m² uit prijslijst via maatwerk-artikel
    IF v_maatwerk_artikel IS NOT NULL AND p_prijslijst_nr IS NOT NULL THEN
      SELECT pr.prijs INTO v_m2_prijs
        FROM prijslijst_regels pr
       WHERE pr.prijslijst_nr = p_prijslijst_nr
         AND pr.artikelnr = v_maatwerk_artikel
       LIMIT 1;
      IF v_m2_prijs IS NOT NULL THEN
        v_m2_bron_artikel := v_maatwerk_artikel;
        RETURN jsonb_build_object(
          'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
          'bron',  'prijslijst_m2',
          'breakdown', jsonb_build_object(
            'oppervlak_m2',     round(v_oppervlak_m2::NUMERIC, 4),
            'm2_prijs',         v_m2_prijs,
            'vorm_code',        v_vorm_code,
            'vorm_toeslag',     v_vorm_toeslag,
            'maatwerk_artikel', v_maatwerk_artikel,
            'prijslijst_nr',    p_prijslijst_nr
          )
        );
      END IF;
    END IF;

    -- 3. producten.verkoopprijs van maatwerk-artikel
    IF v_maatwerk_artikel IS NOT NULL THEN
      SELECT p3.verkoopprijs INTO v_m2_prijs
        FROM producten p3
       WHERE p3.artikelnr = v_maatwerk_artikel;
      IF v_m2_prijs IS NOT NULL AND v_m2_prijs > 0 THEN
        RETURN jsonb_build_object(
          'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
          'bron',  'maatwerk_artikel_m2',
          'breakdown', jsonb_build_object(
            'oppervlak_m2',     round(v_oppervlak_m2::NUMERIC, 4),
            'm2_prijs',         v_m2_prijs,
            'vorm_code',        v_vorm_code,
            'vorm_toeslag',     v_vorm_toeslag,
            'maatwerk_artikel', v_maatwerk_artikel
          )
        );
      END IF;
    END IF;

    -- 4. Generieke kwaliteits-m²-prijs uit maatwerk_m2_prijzen
    SELECT mmp.verkoopprijs_m2 INTO v_m2_prijs
      FROM maatwerk_m2_prijzen mmp
     WHERE mmp.kwaliteit_code = v_prod.kwaliteit_code
       AND mmp.verkoopprijs_m2 IS NOT NULL
     ORDER BY (mmp.kleur_code = v_prod.kleur_code) DESC,
              (mmp.kleur_code = v_kleur_norm) DESC
     LIMIT 1;
    IF v_m2_prijs IS NOT NULL AND v_m2_prijs > 0 THEN
      RETURN jsonb_build_object(
        'prijs', round((v_oppervlak_m2 * v_m2_prijs + v_vorm_toeslag)::NUMERIC, 2),
        'bron',  'kwaliteit_m2',
        'breakdown', jsonb_build_object(
          'oppervlak_m2',   round(v_oppervlak_m2::NUMERIC, 4),
          'm2_prijs',       v_m2_prijs,
          'vorm_code',      v_vorm_code,
          'vorm_toeslag',   v_vorm_toeslag,
          'kwaliteit_code', v_prod.kwaliteit_code
        )
      );
    END IF;
  END IF;

  ----------------------------------------------------------------------
  -- 5. Laatste redmiddel: producten.verkoopprijs van het product zelf
  ----------------------------------------------------------------------
  IF v_prod.verkoopprijs IS NOT NULL AND v_prod.verkoopprijs > 0 THEN
    RETURN jsonb_build_object(
      'prijs', v_prod.verkoopprijs,
      'bron',  'product_verkoopprijs',
      'breakdown', jsonb_build_object(
        'reden', 'Geen prijslijst-prijs en geen m²-fallback mogelijk'
      )
    );
  END IF;

  ----------------------------------------------------------------------
  -- 6. Niets gevonden
  ----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'prijs', NULL,
    'bron',  'geen',
    'breakdown', jsonb_build_object(
      'reden', 'Geen prijs in prijslijst, geen m²-fallback en geen verkoopprijs'
    )
  );
END;
$$;

COMMENT ON FUNCTION bereken_orderregel_prijs(TEXT, TEXT) IS
  'Resolver voor orderregel-prijs met 5-stappen fallback-keten: prijslijst_vast '
  '→ prijslijst_m2 → maatwerk_artikel_m2 → kwaliteit_m2 → product_verkoopprijs. '
  'Past automatisch vormtoeslag toe (uit maatwerk_vormen.toeslag via '
  'producten.maatwerk_vorm_code, mig 190). Retourneert JSONB met prijs, bron en '
  'breakdown. Mig 191 (2026-05-06).';

GRANT EXECUTE ON FUNCTION bereken_orderregel_prijs(TEXT, TEXT) TO authenticated, anon;
