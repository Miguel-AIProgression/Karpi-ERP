-- Migration 136: boek_ontvangst() — juiste voorraad_mutaties-kolommen
--
-- CONTEXT
-- Migratie 127/133/135 schreef INSERT INTO voorraad_mutaties met kolommen
-- lengte_voor_cm / lengte_na_cm / reden / medewerker en type='ontvangst',
-- maar de werkelijke tabel (aangemaakt in commit ece9ecd) heeft:
--   - lengte_cm (NUMERIC, NOT NULL)
--   - breedte_cm (NUMERIC, nullable)
--   - notitie (TEXT)
--   - aangemaakt_door (TEXT)
--   - referentie_id BIGINT / referentie_type TEXT (voor herleiden bron)
-- En het type-CHECK staat alleen 'inkoop','snij','reststuk','correctie',
-- 'afgekeurd' toe — 'ontvangst' bestaat niet.
--
-- Productie-error bevestigde dit: `column "lengte_voor_cm" of relation
-- "voorraad_mutaties" does not exist`. De docs in database-schema.md
-- waren verouderd/verzonnen; de git-history toont de echte shape.
--
-- FIX
-- Herschrijft boek_ontvangst zodat hij de werkelijke kolommen gebruikt:
--   - type='inkoop' (bestaande toegestane waarde — semantisch de juiste)
--   - lengte_cm = nieuwe rol-lengte (0 -> lengte_cm zou misleidend zijn,
--     dus we loggen de nieuwe rol-lengte direct)
--   - breedte_cm = nieuwe rol-breedte
--   - notitie = vrije tekst met inkoop-herkomst
--   - aangemaakt_door = p_medewerker
--   - referentie_id = inkooporder_regel_id (voor traceerbaarheid)
--   - referentie_type = 'inkooporder_regel'
--
-- Behoudt:
--   - m²-boeking fix uit migratie 133
--   - auto-rolnummer (R-YYYY-NNNN) uit migratie 135
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION boek_ontvangst(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT) AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_product RECORD;
  v_rol JSONB;
  v_lengte_cm INTEGER;
  v_breedte_cm INTEGER;
  v_oppervlak_m2 NUMERIC;
  v_rolnummer TEXT;
  v_nieuw_id BIGINT;
  v_totaal_geleverd_m2 NUMERIC := 0;
  v_open_regels INTEGER;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  IF v_regel.eenheid <> 'm' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rol-ontvangst is alleen voor eenheid ''m''. Gebruik de voorraad-ontvangst-flow voor vaste producten.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  IF v_regel.artikelnr IS NOT NULL THEN
    SELECT p.karpi_code, p.kwaliteit_code, p.kleur_code, p.zoeksleutel, p.omschrijving,
           p.verkoopprijs AS vvp_m2
      INTO v_product
    FROM producten p
    WHERE p.artikelnr = v_regel.artikelnr;
  END IF;

  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    v_rolnummer := NULLIF(TRIM(COALESCE(v_rol->>'rolnummer', '')), '');

    IF v_lengte_cm IS NULL OR v_lengte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige lengte_cm in rol: %', v_rol;
    END IF;
    IF v_breedte_cm IS NULL OR v_breedte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige breedte_cm in rol: %', v_rol;
    END IF;

    IF v_rolnummer IS NULL THEN
      LOOP
        v_rolnummer := volgend_nummer('R');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnummer);
      END LOOP;
    END IF;

    v_oppervlak_m2 := ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, inkooporder_regel_id, reststuk_datum
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW()
    )
    RETURNING id INTO v_nieuw_id;

    INSERT INTO voorraad_mutaties (
      rol_id, type, lengte_cm, breedte_cm,
      referentie_id, referentie_type, notitie, aangemaakt_door
    )
    VALUES (
      v_nieuw_id, 'inkoop', v_lengte_cm, v_breedte_cm,
      p_regel_id, 'inkooporder_regel',
      'Ontvangst inkooporder ' || v_order.inkooporder_nr || ' regel ' || v_regel.regelnummer,
      p_medewerker
    );

    v_totaal_geleverd_m2 := v_totaal_geleverd_m2 + v_oppervlak_m2;
    rol_id := v_nieuw_id;
    rolnummer := v_rolnummer;
    RETURN NEXT;
  END LOOP;

  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + v_totaal_geleverd_m2,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + v_totaal_geleverd_m2), 0)
  WHERE id = p_regel_id;

  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_ontvangst(BIGINT, JSONB, TEXT) IS
  'Boekt ontvangst van een inkooporder-regel met eenheid=m (rollen). '
  'Gebruikt de WERKELIJKE voorraad_mutaties-kolommen (lengte_cm, breedte_cm, '
  'notitie, aangemaakt_door, referentie_id/type) en type=''inkoop'' — niet de '
  'verzonnen namen uit docs (migratie 136). Maakt rollen aan, boekt '
  'oppervlak_m2 op geleverd_m (m²-fix mig 133), genereert rolnummer '
  'auto (R-YYYY-NNNN, mig 135). Returns TABLE(rol_id, rolnummer).';
