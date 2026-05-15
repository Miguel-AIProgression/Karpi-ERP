-- Migratie 281: boek_inkooporder_ontvangst_rollen — vul in_magazijn_sinds bij ontvangst
--
-- Context (ADR-0021): een bij IO-ontvangst aangemaakte volle rol moet zijn
-- magazijnleeftijd vanaf NU laten lopen. Body identiek aan mig 271; enige
-- wijziging: in_magazijn_sinds toegevoegd aan de rollen-INSERT met value
-- CURRENT_DATE. reststuk_datum blijft NOW() (traceability, ongewijzigd).
-- Deprecated wrappers (boek_ontvangst / boek_voorraad_ontvangst) ongemoeid —
-- die delegeren door naar deze functie.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
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
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rol-ontvangst is alleen voor eenheid ''m''. Gebruik boek_inkooporder_ontvangst_stuks voor vaste producten.',
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
      status, inkooporder_regel_id, reststuk_datum, in_magazijn_sinds
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW(), CURRENT_DATE
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

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Body '
  'identiek aan mig 271; mig 281 voegt in_magazijn_sinds=CURRENT_DATE toe aan '
  'de rollen-INSERT (FIFO-magazijnleeftijd, ADR-0021). reststuk_datum blijft '
  'NOW() voor traceability. Geen claim-consume (claims zijn alleen op '
  'eenheid=stuks). ADR-0017/0021.';

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 281 toegepast: boek_inkooporder_ontvangst_rollen vult in_magazijn_sinds=CURRENT_DATE (ADR-0021).';
END $$;
