-- Migratie 253: bereken_orderregel_prijs — eigen verkoopprijs vóór m²-fallback
-- voor vaste-maat (niet-maatwerk) producten
--
-- Probleem (geobserveerd in ORD-2026-2056 / artikel 771110006 DUTCHZ 3601 SEINE):
-- vaste-maat voorraadartikelen vielen door de fallback-volgorde van mig 191
-- in route 3 (`maatwerk_artikel_m2`) zodra hun klant-prijslijst géén regel
-- voor het exacte artikelnr had: het systeem pakte dan de m²-prijs van het
-- generieke MAATWERK-artikel (€34,99/m²) × oppervlak (5,80 m²) = €202,94 —
-- ook al had het vaste-maat product zelf een nette eigen `verkoopprijs`.
--
-- Dat is logisch voor échte maatwerk-producten (unieke afmeting → m²-prijs is
-- de juiste belofte), maar onhandig voor vaste maten waar de eigen verkoopprijs
-- de bedoelde "gewone" prijs is.
--
-- Aanpak: nieuwe route **1b `product_vaste_verkoopprijs`** direct na route 1
-- (`prijslijst_vast`) en vóór de m²-fallbacks. Wordt alleen geactiveerd voor
-- producten die zelf GEEN maatwerk-artikel zijn én een `verkoopprijs > 0`
-- hebben. Maatwerk-producten zelf doorlopen onveranderd routes 2-6 (hun eigen
-- `verkoopprijs` is dan typisch de m²-prijs en moet via oppervlak vermenigvuldigd).
--
-- Detectie "is maatwerk" spiegelt route 3 in mig 191: `omschrijving` of
-- `karpi_code` bevat 'MAATWERK' (case-insensitive). v_prod laadt nu ook deze
-- twee velden — eerder waren ze niet nodig.
--
-- Nieuwe fallback-volgorde:
--   1.  prijslijst_vast              (ongewijzigd)
--   1b. product_vaste_verkoopprijs   NIEUW — vaste-maat product, eigen verkoopprijs
--   2.  prijslijst_m2                (ongewijzigd, alleen bereikt voor maatwerk-prod)
--   3.  maatwerk_artikel_m2          (ongewijzigd, alleen bereikt voor maatwerk-prod)
--   4.  kwaliteit_m2                 (ongewijzigd, alleen bereikt voor maatwerk-prod)
--   5.  product_verkoopprijs         (ongewijzigd — laatste redmiddel)
--   6.  geen                         (ongewijzigd)
--
-- Idempotent: CREATE OR REPLACE.
-- Backward-compatible: bestaande orderregel-prijzen veranderen niet (zijn al
-- opgeslagen); deze RPC bepaalt enkel nieuwe orderregel-prijzen bij aanmaken/
-- artikel-wissel. Hetzelfde geldt voor bestaande klant-prijslijst-vast-entries:
-- die blijven onveranderd voorrang houden via route 1.

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
  v_is_maatwerk_prod  BOOLEAN;
BEGIN
  -- 0. Product ophalen — nu ook omschrijving + karpi_code voor maatwerk-detectie
  SELECT
    p.artikelnr, p.kwaliteit_code, p.kleur_code,
    p.lengte_cm, p.breedte_cm, p.vorm, p.maatwerk_vorm_code,
    p.verkoopprijs, p.product_type,
    p.omschrijving, p.karpi_code
  INTO v_prod
  FROM producten p
  WHERE p.artikelnr = p_artikelnr;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'prijs', NULL, 'bron', 'onbekend_artikel',
      'breakdown', jsonb_build_object('reden', 'Artikel niet gevonden')
    );
  END IF;

  -- Spiegelt detectie in route 3: een product is maatwerk wanneer
  -- omschrijving óf karpi_code 'MAATWERK' bevat (case-insensitive).
  v_is_maatwerk_prod := (
    upper(coalesce(v_prod.omschrijving,'')) LIKE '%MAATWERK%'
    OR upper(coalesce(v_prod.karpi_code,''))   LIKE '%MAATWERK%'
  );

  ----------------------------------------------------------------------
  -- 1. Vaste prijs uit klant-prijslijst (hoofdpad, ongewijzigd)
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
  -- 1b. NIEUW (mig 253): eigen verkoopprijs voor vaste-maat (niet-maatwerk)
  --     producten. Voorkomt dat ze in route 2-4 (m²-fallback) belanden.
  ----------------------------------------------------------------------
  IF NOT v_is_maatwerk_prod
     AND v_prod.verkoopprijs IS NOT NULL
     AND v_prod.verkoopprijs > 0 THEN
    RETURN jsonb_build_object(
      'prijs', v_prod.verkoopprijs,
      'bron',  'product_vaste_verkoopprijs',
      'breakdown', jsonb_build_object(
        'artikelnr', p_artikelnr,
        'reden',     'Vaste-maat artikel — eigen verkoopprijs heeft voorrang op m²-fallback'
      )
    );
  END IF;

  ----------------------------------------------------------------------
  -- 2. Bepaal oppervlak — vereist voor alle m²-fallbacks
  ----------------------------------------------------------------------
  IF v_prod.lengte_cm IS NOT NULL AND v_prod.breedte_cm IS NOT NULL
     AND v_prod.lengte_cm > 0 AND v_prod.breedte_cm > 0 THEN
    IF v_prod.vorm = 'rond' THEN
      v_oppervlak_m2 := pi() * power(v_prod.lengte_cm::NUMERIC / 200.0, 2);
    ELSE
      v_oppervlak_m2 := (v_prod.lengte_cm::NUMERIC * v_prod.breedte_cm) / 10000.0;
    END IF;
  END IF;

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
  --    (alleen nog bereikt voor maatwerk-producten zonder oppervlak,
  --    of vaste-maat producten zonder verkoopprijs die niet via m²-pad lopen)
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
  'Resolver voor orderregel-prijs met 6-stappen fallback-keten (mig 253): '
  'prijslijst_vast → product_vaste_verkoopprijs (niet-maatwerk + eigen prijs) '
  '→ prijslijst_m2 → maatwerk_artikel_m2 → kwaliteit_m2 → product_verkoopprijs. '
  'Past automatisch vormtoeslag toe (uit maatwerk_vormen.toeslag via '
  'producten.maatwerk_vorm_code, mig 190). Retourneert JSONB met prijs, bron en '
  'breakdown. Mig 253 voegt route 1b toe om te voorkomen dat vaste-maat artikelen '
  'onbedoeld via de m²-prijs van een generiek MAATWERK-broertje beprijst worden.';

GRANT EXECUTE ON FUNCTION bereken_orderregel_prijs(TEXT, TEXT) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------------
-- Verificatie (run in SQL Editor na deploy):
------------------------------------------------------------------------
-- 1. Het case-voorbeeld: 771110006 (DUTCHZ 3601 SEINE, vaste maat 200×290)
--    voor JANSEN TOTAAL WONEN. Verwacht: bron = 'product_vaste_verkoopprijs'
--    met de eigen producten.verkoopprijs (i.p.v. €202,94 m²-fallback).
--    SELECT bereken_orderregel_prijs('771110006',
--      (SELECT prijslijst_nr FROM debiteuren WHERE debiteur_nr = 403900));
--
-- 2. Sanity: het maatwerk-broertje 771119998 moet ZELF onveranderd via een
--    m²-pad lopen (oppervlak per orderregel uit lengte/breedte invoer, niet
--    uit het product). Met losse maatwerk-call zal dit normaal route 5 of
--    geen worden — dat is OK want maatwerk-prijs gaat via de maatwerk-flow,
--    niet via deze RPC.
--    SELECT bereken_orderregel_prijs('771119998', NULL);
--
-- 3. Bredere check: hoeveel artikelen lopen na deze migratie via route 1b?
--    Run scripts/check-impact-mig-253.sql blok 2 — verschuiving van
--    maatwerk_artikel_m2 / prijslijst_m2 naar product_vaste_verkoopprijs
--    voor niet-maatwerk producten.
