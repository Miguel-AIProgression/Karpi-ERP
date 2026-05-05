-- Migratie 0182: verzendkosten-routing bij gesplitste orders (T007)
--
-- Doel: verankert de business-rule "verzendkosten gaan naar het duurste sub-order"
-- in de codebase. Huidig gedrag blijft ongewijzigd (was_split altijd false in T006),
-- maar de infrastructuur is klaar voor activering bij order-splitsing.
--
-- Wijzigingen:
--   1. Nieuwe helper-functie kies_duurste_suborder(p_suborders jsonb) → INTEGER
--   2. commit_order_voorstel uitgebreid met verzendkosten_routing in result JSON

-- ─────────────────────────────────────────────────────────────
-- Helper: kies_duurste_suborder
-- ─────────────────────────────────────────────────────────────
--
-- Gegeven een jsonb-array van sub-order objecten (elk met een 'regels'-array
-- waarvan elke regel 'prijs_per_stuk', 'aantal' en optioneel 'korting_pct' heeft),
-- retourneert de 0-gebaseerde index van het sub-order met de hoogste totale
-- regelwaarde: SUM(prijs_per_stuk * aantal * (1 - korting_pct / 100)).
--
-- Retourneert 0 als:
--   - p_suborders NULL is
--   - p_suborders leeg is of slechts 1 element bevat
--   - alle totalen gelijk zijn (tie → eerste sub-order wint)
--
-- Voorbeeld input:
-- '[
--   {"regels": [{"prijs_per_stuk": 24.00, "aantal": 5, "korting_pct": 0}]},
--   {"regels": [{"prijs_per_stuk": 90.00, "aantal": 5, "korting_pct": 0}]}
-- ]'
-- → retourneert 1 (tweede sub-order, totaal €450 > €120)

CREATE OR REPLACE FUNCTION kies_duurste_suborder(p_suborders JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_best_index   INTEGER := 0;
  v_best_totaal  NUMERIC := -1;
  v_idx          INTEGER := 0;
  v_suborder     JSONB;
  v_regels       JSONB;
  v_regel        JSONB;
  v_subtotaal    NUMERIC;
BEGIN
  -- Geen splitsing of lege input → altijd index 0
  IF p_suborders IS NULL
     OR jsonb_array_length(p_suborders) <= 1
  THEN
    RETURN 0;
  END IF;

  FOR v_suborder IN SELECT * FROM jsonb_array_elements(p_suborders)
  LOOP
    v_regels    := COALESCE(v_suborder -> 'regels', '[]'::JSONB);
    v_subtotaal := 0;

    FOR v_regel IN SELECT * FROM jsonb_array_elements(v_regels)
    LOOP
      v_subtotaal := v_subtotaal
        + COALESCE((v_regel ->> 'prijs_per_stuk')::NUMERIC, 0)
        * COALESCE((v_regel ->> 'aantal')::NUMERIC, 0)
        * (1 - COALESCE((v_regel ->> 'korting_pct')::NUMERIC, 0) / 100.0);
    END LOOP;

    -- Strict greater-than: bij gelijke totalen wint het eerste sub-order (index 0)
    IF v_subtotaal > v_best_totaal THEN
      v_best_totaal := v_subtotaal;
      v_best_index  := v_idx;
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_best_index;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: commit_order_voorstel (CREATE OR REPLACE)
-- ─────────────────────────────────────────────────────────────
--
-- Wijziging t.o.v. mig 0181:
--   - result JSON bevat nu altijd 'verzendkosten_routing': 'duurste_suborder'
--   - Verzendkosten-routing logica staat klaar als commentaar voor activering
--     bij order-splitsing (T006 activering: was_split altijd false).
--
-- Input/output-contract: gelijk aan mig 0181 plus nieuw veld in output.

CREATE OR REPLACE FUNCTION commit_order_voorstel(
  p_voorstel    JSONB,
  p_voorstel_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cached             JSONB;
  v_create_result      JSONB;
  v_order_id           BIGINT;
  v_debiteur_nr        INTEGER;
  v_lever_modus        TEXT;
  v_regels             JSONB;
  v_uitwisselbaar      JSONB;
  v_regel              JSONB;
  v_regel_id           TEXT;
  v_db_regel_id        BIGINT;
  v_gevraagd           INTEGER;

  -- claim-summary aggregaten
  v_totaal             INTEGER := 0;
  v_voorraad_sum       INTEGER := 0;
  v_op_inkoop_sum      INTEGER := 0;
  v_uitwisselbaar_sum  INTEGER := 0;
  v_wacht_sum          INTEGER := 0;

  -- per-regel claim tellingen
  v_claim_voorraad     INTEGER;
  v_claim_io           INTEGER;
  v_claim_uitw         INTEGER;
  v_gedekt             INTEGER;

  -- afwijking
  v_afwijkingen        JSONB  := '[]'::JSONB;

  -- p_regels voor create_order_with_lines
  v_p_order            JSONB;
  v_p_regels           JSONB  := '[]'::JSONB;
  v_regel_obj          JSONB;
  v_regelnummer        INTEGER := 0;

  -- uitwisselbaar keuzes per regel_id
  v_keuzes_voor_regel  JSONB;

  v_result             JSONB;

  -- Verzendkosten-routing (T007)
  -- v_was_split:    wordt true zodra order-splitsing actief is (T006 toekomstig)
  -- v_duurste_order_id: order_id van het duurste sub-order na splitsing
  v_was_split          BOOLEAN := false;
  -- v_duurste_order_id BIGINT; -- activeer bij splitsing
BEGIN
  -- ── 1. Idempotency-check ─────────────────────────────────
  SELECT result_json
  INTO   v_cached
  FROM   order_voorstel_commits
  WHERE  voorstel_id = p_voorstel_id;

  IF FOUND THEN
    RETURN v_cached;
  END IF;

  -- ── 2. Extracteer top-level velden ──────────────────────
  v_debiteur_nr := (p_voorstel ->> 'debiteur_nr')::INTEGER;
  v_lever_modus := NULLIF(p_voorstel ->> 'lever_modus', '');
  v_regels      := COALESCE(p_voorstel -> 'regels', '[]'::JSONB);
  v_uitwisselbaar := COALESCE(p_voorstel -> 'uitwisselbaar_keuzes', '[]'::JSONB);

  -- ── 3. Bouw p_order JSONB voor create_order_with_lines ──
  v_p_order := jsonb_build_object(
    'debiteur_nr', v_debiteur_nr,
    'orderdatum',  CURRENT_DATE::TEXT,
    'lever_modus', v_lever_modus
  );

  -- ── 4. Bouw p_regels array ───────────────────────────────
  FOR v_regel IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnummer := v_regelnummer + 1;

    v_regel_obj := jsonb_build_object(
      'regelnummer',         v_regelnummer,
      'artikelnr',           v_regel ->> 'artikelnr',
      'karpi_code',          NULL::TEXT,
      'omschrijving',        COALESCE(v_regel ->> 'omschrijving', v_regel ->> 'artikelnr'),
      'omschrijving_2',      NULL::TEXT,
      'orderaantal',         (v_regel ->> 'aantal')::INTEGER,
      'te_leveren',          (v_regel ->> 'aantal')::INTEGER,
      'prijs',               (v_regel ->> 'prijs_per_stuk')::NUMERIC,
      'korting_pct',         COALESCE((v_regel ->> 'korting_pct')::NUMERIC, 0),
      'bedrag',              NULL::NUMERIC,
      'gewicht_kg',          NULL::NUMERIC,
      'fysiek_artikelnr',    NULL::TEXT,
      'omstickeren',         false,
      'is_maatwerk',         COALESCE((v_regel ->> 'is_maatwerk')::BOOLEAN, false),
      'maatwerk_vorm',       NULL::TEXT,
      'maatwerk_lengte_cm',  (v_regel ->> 'lengte_cm')::INTEGER,
      'maatwerk_breedte_cm', (v_regel ->> 'breedte_cm')::INTEGER,
      'maatwerk_afwerking',  NULL::TEXT,
      'maatwerk_band_kleur', NULL::TEXT,
      'maatwerk_instructies', NULL::TEXT,
      'maatwerk_m2_prijs',   NULL::NUMERIC,
      'maatwerk_kostprijs_m2', NULL::NUMERIC,
      'maatwerk_oppervlak_m2', NULL::NUMERIC,
      'maatwerk_vorm_toeslag', NULL::NUMERIC,
      'maatwerk_afwerking_prijs', NULL::NUMERIC,
      'maatwerk_diameter_cm', NULL::INTEGER,
      'maatwerk_kwaliteit_code', NULL::TEXT,
      'maatwerk_kleur_code', NULL::TEXT
    );

    v_p_regels := v_p_regels || jsonb_build_array(v_regel_obj);
  END LOOP;

  -- ── 5. Maak order aan via bestaande RPC ──────────────────
  v_create_result := create_order_with_lines(v_p_order, v_p_regels);
  v_order_id      := (v_create_result ->> 'id')::BIGINT;

  -- ── 6. Per-regel: uitwisselbaar-claims + herallocatie ───
  v_regelnummer := 0;
  FOR v_regel IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnummer := v_regelnummer + 1;
    v_regel_id    := v_regel ->> 'regel_id';
    v_gevraagd    := (v_regel ->> 'aantal')::INTEGER;

    -- Zoek het zojuist aangemaakte order_regel_id op basis van regelnummer
    SELECT id INTO v_db_regel_id
    FROM   order_regels
    WHERE  order_id    = v_order_id
      AND  regelnummer = v_regelnummer
    LIMIT  1;

    -- 6a. Uitwisselbaar-claims (als aanwezig voor deze regel_id)
    SELECT jsonb_agg(
             jsonb_build_object(
               'artikelnr', keuze ->> 'artikelnr',
               'aantal',    (keuze ->> 'aantal')::INTEGER
             )
           )
    INTO   v_keuzes_voor_regel
    FROM   jsonb_array_elements(v_uitwisselbaar) AS keuze
    WHERE  keuze ->> 'regel_id' = v_regel_id;

    IF v_keuzes_voor_regel IS NOT NULL
       AND jsonb_array_length(v_keuzes_voor_regel) > 0
    THEN
      PERFORM set_uitwisselbaar_claims(v_db_regel_id, v_keuzes_voor_regel);
    END IF;

    -- 6b. Heralloceer (idempotent, verwerkt drift)
    PERFORM herallocateer_orderregel(v_db_regel_id);

    -- ── 7. Claim-telling per regel ───────────────────────
    SELECT
      COALESCE(SUM(CASE WHEN bron = 'voorraad'      THEN aantal ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN bron = 'inkoop'        THEN aantal ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN bron = 'uitwisselbaar' THEN aantal ELSE 0 END), 0)
    INTO v_claim_voorraad, v_claim_io, v_claim_uitw
    FROM order_reserveringen
    WHERE order_regel_id = v_db_regel_id
      AND actief = true;

    v_gedekt := v_claim_voorraad + v_claim_io + v_claim_uitw;

    -- Aggregeer naar claim_summary
    v_totaal            := v_totaal + 1;
    v_voorraad_sum      := v_voorraad_sum  + v_claim_voorraad;
    v_op_inkoop_sum     := v_op_inkoop_sum + v_claim_io;
    v_uitwisselbaar_sum := v_uitwisselbaar_sum + v_claim_uitw;
    v_wacht_sum         := v_wacht_sum + GREATEST(v_gevraagd - v_gedekt, 0);

    -- Afwijking registreren als niet volledig gedekt
    IF v_gedekt < v_gevraagd THEN
      v_afwijkingen := v_afwijkingen || jsonb_build_array(
        jsonb_build_object(
          'regel_id', v_regel_id,
          'gevraagd', v_gevraagd,
          'gekregen', v_gedekt
        )
      );
    END IF;
  END LOOP;

  -- ── 8. Verzendkosten-routing (T007) ──────────────────────
  --
  -- Business-rule: verzendkosten-regel gaat naar het duurste sub-order.
  -- Huidig gedrag (T006): was_split altijd false → er is maar één order,
  -- de routing is passief maar klaar voor activering.
  --
  -- Bij activering van splitsing: uncommenter onderstaand blok en
  -- zet v_was_split op true wanneer de order gesplitst wordt.
  --
  /*
  IF v_was_split THEN
    -- Bepaal het duurste sub-order via kies_duurste_suborder()
    -- v_duurste_order_id := ...; -- vul in vanuit splitsing-logica

    -- Verplaats verzendkosten-regel naar duurste sub-order
    UPDATE order_regels
    SET    order_id = v_duurste_order_id
    WHERE  order_id = v_order_id
      AND  (omschrijving ILIKE '%verzend%' OR artikelnr ILIKE '%VERZEND%');
  END IF;
  */

  -- ── 9. Bouw resultaat-JSON ────────────────────────────────
  v_result := jsonb_build_object(
    'order_id',     v_order_id,
    'was_split',    false,
    'split_reason', NULL,
    'verzendkosten_routing', 'duurste_suborder',
    'claim_summary', jsonb_build_object(
      'totaal',        v_totaal,
      'voorraad',      v_voorraad_sum,
      'op_inkoop',     v_op_inkoop_sum,
      'uitwisselbaar', v_uitwisselbaar_sum,
      'wacht',         v_wacht_sum
    ),
    'afwijking_t_o_v_voorstel', v_afwijkingen
  );

  -- ── 10. Sla op in order_voorstel_commits ──────────────────
  INSERT INTO order_voorstel_commits (voorstel_id, order_id, result_json)
  VALUES (p_voorstel_id, v_order_id, v_result);

  RETURN v_result;
END;
$$;
