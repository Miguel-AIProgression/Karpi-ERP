-- Migratie 291: rol_handmatig_toevoegen — handmatige rol/reststuk-correctie
--
-- Voorraadcorrectie/inventarisatie. GEEN inkooporder-koppeling, GEEN
-- producten.voorraad-mutatie (pagina is live-correct via SUM(rollen)).
-- Gedenormaliseerde velden uit producten (zelfde bron als mig 281).
-- Schrijft een rol_mutaties-auditregel (verplichte reden).

CREATE OR REPLACE FUNCTION rol_handmatig_toevoegen(
  p_artikelnr         TEXT,
  p_rol_type          rol_type,
  p_lengte_cm         INTEGER,
  p_breedte_cm        INTEGER,
  p_locatie_id        BIGINT,
  p_in_magazijn_sinds DATE,
  p_rolnummer         TEXT,
  p_reden             TEXT,
  p_medewerker        TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product   RECORD;
  v_opp       NUMERIC;
  v_rolnr     TEXT;
  v_seq       INTEGER := 1;
  v_nieuw_id  BIGINT;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige lengte: %', p_lengte_cm;
  END IF;
  IF p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige breedte: %', p_breedte_cm;
  END IF;

  SELECT p.karpi_code, p.omschrijving, p.verkoopprijs AS vvp_m2,
         p.kwaliteit_code, p.kleur_code, p.zoeksleutel
    INTO v_product
  FROM producten p WHERE p.artikelnr = p_artikelnr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend artikelnr: %', p_artikelnr;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_rolnr := NULLIF(TRIM(COALESCE(p_rolnummer, '')), '');
  IF v_rolnr IS NULL THEN
    LOOP
      v_rolnr := 'CORR-' || p_artikelnr || '-' || v_seq;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr);
      v_seq := v_seq + 1;
    END LOOP;
  ELSIF EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr) THEN
    RAISE EXCEPTION 'Rolnummer % bestaat al.', v_rolnr;
  END IF;

  v_opp := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);

  INSERT INTO rollen (
    rolnummer, artikelnr, karpi_code, omschrijving,
    lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
    kwaliteit_code, kleur_code, zoeksleutel,
    status, rol_type, locatie_id, reststuk_datum, in_magazijn_sinds
  ) VALUES (
    v_rolnr, p_artikelnr, v_product.karpi_code, v_product.omschrijving,
    p_lengte_cm, p_breedte_cm, v_opp, v_product.vvp_m2,
    v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
    'beschikbaar', p_rol_type, p_locatie_id, NOW(),
    COALESCE(p_in_magazijn_sinds, CURRENT_DATE)
  )
  RETURNING id INTO v_nieuw_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    v_nieuw_id, v_rolnr, p_artikelnr, 'toevoegen', v_opp,
    NULL,
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp, 'rol_type', p_rol_type, 'status', 'beschikbaar',
      'in_magazijn_sinds', COALESCE(p_in_magazijn_sinds, CURRENT_DATE),
      'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );

  rol_id := v_nieuw_id;
  rolnummer := v_rolnr;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_handmatig_toevoegen(TEXT,rol_type,INTEGER,INTEGER,BIGINT,DATE,TEXT,TEXT,TEXT) IS
  'Handmatige rol/reststuk-correctie (voorraadcorrectie/inventarisatie). '
  'Geen IO-koppeling, geen producten.voorraad-mutatie. Audit in rol_mutaties. '
  'Mig 291. Spec 2026-05-15-handmatige-rol-crud.';

GRANT EXECUTE ON FUNCTION rol_handmatig_toevoegen(TEXT,rol_type,INTEGER,INTEGER,BIGINT,DATE,TEXT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 291 toegepast: rol_handmatig_toevoegen aangemaakt.';
END $$;
