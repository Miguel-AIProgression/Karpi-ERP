-- Migratie 0181: commit_order_voorstel RPC + order_voorstel_commits tabel (T006)
--
-- Doel: concept-voorstel uit bouw_order_voorstel omzetten naar een echte order,
-- inclusief:
--   - uitwisselbaar-claims via set_uitwisselbaar_claims
--   - herallocatie via herallocateer_orderregel
--   - idempotency via order_voorstel_commits (zelfde voorstel_id → zelfde order_id)
--   - afwijking-detectie (gesimuleerd vs werkelijk gedekt)
--
-- GEEN order-splitting in T006 (was_split altijd false).

-- ─────────────────────────────────────────────────────────────
-- Tabel: order_voorstel_commits
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_voorstel_commits (
  voorstel_id UUID        PRIMARY KEY,
  order_id    BIGINT      REFERENCES orders(id) ON DELETE SET NULL,
  result_json JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index voor snelle opzoek op order_id (bijv. bij cascade-delete)
CREATE INDEX IF NOT EXISTS idx_order_voorstel_commits_order_id
  ON order_voorstel_commits (order_id);

-- ─────────────────────────────────────────────────────────────
-- RPC: commit_order_voorstel
-- ─────────────────────────────────────────────────────────────
--
-- Input p_voorstel jsonb shape:
-- {
--   "debiteur_nr": 12345,
--   "lever_modus": "deelleveringen" | "in_een_keer" | null,
--   "uitwisselbaar_keuzes": [
--     { "regel_id": "r1", "artikelnr": "ALT", "aantal": 2 }
--   ],
--   "regels": [{
--     "regel_id":        "r1",
--     "artikelnr":       "FREZ50-200X140",
--     "omschrijving":    "...",
--     "aantal":          5,
--     "prijs_per_stuk":  12.50,
--     "korting_pct":     0,
--     "lengte_cm":       null,
--     "breedte_cm":      null,
--     "is_maatwerk":     false
--   }]
-- }
--
-- Output jsonb:
-- {
--   "order_id":   <bigint>,
--   "was_split":  false,
--   "split_reason": null,
--   "claim_summary": { totaal, voorraad, op_inkoop, uitwisselbaar, wacht },
--   "afwijking_t_o_v_voorstel": []   -- leeg of [{ regel_id, gevraagd, gekregen }]
-- }

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

  -- ── 8. Bouw resultaat-JSON ────────────────────────────────
  v_result := jsonb_build_object(
    'order_id',     v_order_id,
    'was_split',    false,
    'split_reason', NULL,
    'claim_summary', jsonb_build_object(
      'totaal',        v_totaal,
      'voorraad',      v_voorraad_sum,
      'op_inkoop',     v_op_inkoop_sum,
      'uitwisselbaar', v_uitwisselbaar_sum,
      'wacht',         v_wacht_sum
    ),
    'afwijking_t_o_v_voorstel', v_afwijkingen
  );

  -- ── 9. Sla op in order_voorstel_commits ──────────────────
  INSERT INTO order_voorstel_commits (voorstel_id, order_id, result_json)
  VALUES (p_voorstel_id, v_order_id, v_result);

  RETURN v_result;
END;
$$;
