-- Migratie 603: boek_inkooporder_ontvangst_rollen — locatie per rol +
-- over-leveringsgrens 110% (besluit 2026-07-02).
--
-- Superset van mig 281 (in_magazijn_sinds) → 271 → 136/135/133/127.
-- Nieuw: (1) optioneel 'locatie' per rol in p_rollen → create_or_get_magazijn_locatie
-- (mig 169) → rollen.locatie_id; (2) pre-pass die de totale payload-m² telt en
-- >110% van besteld weigert tenzij p_sta_overlevering_toe=TRUE (over-levering
-- is normaal in tapijt — meters zijn nooit exact — maar een tikfout van 10×
-- de bestelling mag niet stil doorglippen).
-- Signature wijzigt (4e param) → DROP vereist; de deprecated wrapper
-- boek_ontvangst (mig 271) resolvet zijn 3-arg-call daarna op de DEFAULT.

DROP FUNCTION IF EXISTS boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL,
  p_sta_overlevering_toe BOOLEAN DEFAULT FALSE
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
  v_locatie_code TEXT;
  v_locatie_id BIGINT;
  v_payload_m2 NUMERIC := 0;
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

  -- Pre-pass (mig 603): valideer maten + tel de payload-m² VÓÓR er iets
  -- geïnsert wordt, zodat de over-leveringsgrens atomair kan weigeren.
  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    IF v_lengte_cm IS NULL OR v_lengte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige lengte_cm in rol: %', v_rol;
    END IF;
    IF v_breedte_cm IS NULL OR v_breedte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige breedte_cm in rol: %', v_rol;
    END IF;
    v_payload_m2 := v_payload_m2 + ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);
  END LOOP;

  IF NOT p_sta_overlevering_toe
     AND v_regel.besteld_m > 0
     AND v_regel.geleverd_m + v_payload_m2 > v_regel.besteld_m * 1.10 THEN
    RAISE EXCEPTION 'Over-levering: totaal geleverd wordt % m² op % m² besteld (meer dan 110%%). Bevestig expliciet als de levering echt zo groot is.',
      ROUND(v_regel.geleverd_m + v_payload_m2, 2), v_regel.besteld_m;
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

    -- Locatie (mig 603): optioneel per rol; vindt-of-maakt de magazijnlocatie.
    v_locatie_code := NULLIF(TRIM(COALESCE(v_rol->>'locatie', '')), '');
    v_locatie_id := NULL;
    IF v_locatie_code IS NOT NULL THEN
      v_locatie_id := create_or_get_magazijn_locatie(v_locatie_code);
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
      status, inkooporder_regel_id, reststuk_datum, in_magazijn_sinds, locatie_id
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW(), CURRENT_DATE, v_locatie_id
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

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT, BOOLEAN) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Superset-keten '
  '281→603: mig 603 voegt per-rol ''locatie'' (→ rollen.locatie_id via '
  'create_or_get_magazijn_locatie) en de 110%%-over-leveringsgrens toe '
  '(p_sta_overlevering_toe). Geen claim-consume (claims zijn alleen op eenheid=stuks).';

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 603 toegepast: ontvangst met locatie + over-leveringsgrens.';
END $$;
