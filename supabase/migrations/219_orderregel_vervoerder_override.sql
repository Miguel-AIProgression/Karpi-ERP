-- Migratie 219: order_regels.vervoerder_code (per-regel override)
--
-- Achtergrond
-- -----------
-- Tot nu toe werd de vervoerder per **order** gekozen (verzendregel-evaluator
-- in mig 210 + 214 + 215). Voor combinaties als "kleine matjes via DPD + grote
-- rol via HST in dezelfde order" is dat te grof. Deze migratie introduceert
-- een per-orderregel-override; de splitsing in N zendingen volgt in mig 220.
--
-- Wijzigingen
-- -----------
--   1. `order_regels.vervoerder_code` (NULL = gebruik order-default)
--   2. Helper `effectieve_vervoerder_per_orderregel(p_order_id)` — returnt per
--      regel: override, evaluator-keuze, klant-fallback, en de effectieve keuze
--      met bron-uitleg.
--   3. Lock-trigger: override mag niet meer wijzigen zodra een zending
--      (status NOT IN 'Geannuleerd','Afgeleverd') voor de orderregel bestaat.
--      Dit dwingt de "Alleen vóór Verzendset"-keuze van de gebruiker af op DB-
--      niveau, zodat de UI of een buggy caller de invariant niet kan breken.
--
-- Idempotent.

------------------------------------------------------------------------
-- 1. Schema-additie
------------------------------------------------------------------------
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS vervoerder_code TEXT
    REFERENCES vervoerders(code) ON DELETE SET NULL;

COMMENT ON COLUMN order_regels.vervoerder_code IS
  'Mig 219: per-regel override van de order-default vervoerder. NULL = gebruik '
  'effectieve_vervoerder_per_orderregel-fallback (verzendregel-evaluator → '
  'klant-fallback). Wijzigen geblokkeerd zodra een zending_regel naar deze '
  'orderregel verwijst (trigger trg_lock_orderregel_vervoerder).';

CREATE INDEX IF NOT EXISTS order_regels_vervoerder_code_idx
  ON order_regels(vervoerder_code)
  WHERE vervoerder_code IS NOT NULL;

------------------------------------------------------------------------
-- 2. Lock-trigger: override locked zodra zending bestaat
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_orderregel_vervoerder() RETURNS TRIGGER AS $$
BEGIN
  -- Alleen handhaven bij wijziging van vervoerder_code zelf.
  IF NEW.vervoerder_code IS NOT DISTINCT FROM OLD.vervoerder_code THEN
    RETURN NEW;
  END IF;

  -- Lock zodra ÉNIGE zending_regel naar deze orderregel verwijst — de
  -- gebruiker koos "alleen vóór Verzendset wijzigbaar" (geen status-uitzonderingen).
  -- Bewust GEEN status-filter: de `zending_status` enum kent geen 'Geannuleerd',
  -- en zelfs Afgeleverd-zendingen blokkeren we voor audit-eenvoud (de override
  -- na levering veranderen is sowieso betekenisloos).
  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
     WHERE zr.order_regel_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'Vervoerder van orderregel % kan niet meer worden gewijzigd: er bestaat al een zending voor deze regel',
      NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_orderregel_vervoerder ON order_regels;
CREATE TRIGGER trg_lock_orderregel_vervoerder
  BEFORE UPDATE OF vervoerder_code ON order_regels
  FOR EACH ROW
  EXECUTE FUNCTION lock_orderregel_vervoerder();

COMMENT ON FUNCTION lock_orderregel_vervoerder IS
  'Mig 219: voorkomt dat order_regels.vervoerder_code wijzigt zodra er een '
  'zending_regel naar deze orderregel verwijst. Wie de override toch wil '
  'aanpassen moet eerst de zending verwijderen/annuleren.';

------------------------------------------------------------------------
-- 3. Helper: per-orderregel-attributen voor regel-evaluator
--
-- Symmetrisch met evalueer_zending_attributes (mig 210), maar:
--   • kleinste_zijde_cm en gewicht_kg zijn PER regel (niet MAX/SUM over
--     alle regels). Dat laat de evaluator per regel een passende vervoerder
--     kiezen.
--   • land/debiteur/inkoopgroep blijven order-niveau.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evalueer_orderregel_attributes(p_orderregel_id BIGINT)
RETURNS TABLE (
  afl_land           TEXT,
  kleinste_zijde_cm  INTEGER,
  totaal_gewicht_kg  NUMERIC,
  debiteur_nr        INTEGER,
  inkoopgroep_code   TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.afl_land,
    LEAST(
      COALESCE(ore.maatwerk_lengte_cm,  p.lengte_cm),
      COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
    )::INTEGER AS kleinste_zijde_cm,
    (COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)
       * GREATEST(COALESCE(ore.orderaantal, 0), 0))::NUMERIC AS totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM order_regels ore
  JOIN orders o          ON o.id = ore.order_id
  LEFT JOIN producten p  ON p.artikelnr = ore.artikelnr
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE ore.id = p_orderregel_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION evalueer_orderregel_attributes(BIGINT) TO authenticated;

COMMENT ON FUNCTION evalueer_orderregel_attributes(BIGINT) IS
  'Mig 219: per-orderregel attributen voor regel-evaluator (matcht_regel). '
  'Symmetrisch met evalueer_zending_attributes, maar kleinste_zijde + gewicht '
  'zijn per regel zodat de evaluator per regel kan beslissen.';

------------------------------------------------------------------------
-- 4. Hoofd-RPC: effectieve_vervoerder_per_orderregel(order_id)
--
-- Returnt voor élke regel van de order welke vervoerder uiteindelijk geldt en
-- waarom. Bron-precedentie (hoogste wint):
--   1. override          — order_regels.vervoerder_code expliciet gezet
--   2. regel             — verzendregel-evaluator op per-regel attributen
--   3. klant_fallback    — edi_handelspartner_config.vervoerder_code
--   4. (NULL)            — frontend kan dan globaal-actief tonen
--
-- Bewust GEEN globaal-actief in DB: dat is een UI-fallback. De DB houdt het
-- bij wat expliciet ingesteld is, zodat audit-trail eenduidig blijft.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION effectieve_vervoerder_per_orderregel(p_order_id BIGINT)
RETURNS TABLE (
  orderregel_id        BIGINT,
  override_code        TEXT,
  evaluator_code       TEXT,
  evaluator_service    TEXT,
  klant_fallback_code  TEXT,
  effectief_code       TEXT,
  effectief_service    TEXT,
  bron                 TEXT,
  uitleg               JSONB
) AS $$
DECLARE
  v_afhalen          BOOLEAN;
  v_klant_fallback   TEXT;
  v_debiteur_nr      INTEGER;
  v_regel            RECORD;
  v_attr             RECORD;
  v_match_regel      RECORD;
  v_eval_uitleg      JSONB;
  v_eval_code        TEXT;
  v_eval_service     TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  SELECT o.afhalen, o.debiteur_nr
    INTO v_afhalen, v_debiteur_nr
    FROM orders o WHERE o.id = p_order_id;

  -- Klant-fallback éénmaal ophalen (zelfde voor alle regels van deze order).
  SELECT ehc.vervoerder_code INTO v_klant_fallback
    FROM edi_handelspartner_config ehc
   WHERE ehc.debiteur_nr = v_debiteur_nr;

  -- Afhalen-orders: geen vervoerder, ongeacht override of evaluator.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY
    SELECT
      ore.id,
      ore.vervoerder_code,
      NULL::TEXT, NULL::TEXT,
      v_klant_fallback,
      NULL::TEXT, NULL::TEXT,
      'afhalen'::TEXT,
      jsonb_build_object('reden', 'afhalen')
    FROM order_regels ore
    WHERE ore.order_id = p_order_id
      AND COALESCE(ore.orderaantal, 0) > 0
      AND COALESCE(ore.artikelnr, '') <> 'VERZEND';
    RETURN;
  END IF;

  FOR v_regel IN
    SELECT id, vervoerder_code
      FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    -- 1. Per-regel evaluator-keuze
    SELECT * INTO v_attr
      FROM evalueer_orderregel_attributes(v_regel.id);

    v_eval_code := NULL;
    v_eval_service := NULL;
    v_eval_uitleg := jsonb_build_object(
      'strategie',         'regels_v1_per_orderregel',
      'orderregel_id',     v_regel.id,
      'land',              v_attr.afl_land,
      'kleinste_zijde_cm', v_attr.kleinste_zijde_cm,
      'totaal_gewicht_kg', v_attr.totaal_gewicht_kg,
      'debiteur_nr',       v_attr.debiteur_nr,
      'inkoopgroep',       v_attr.inkoopgroep_code
    );

    FOR v_match_regel IN
      SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie,
             vsr.service_code, vsr.notitie
        FROM vervoerder_selectie_regels vsr
        JOIN vervoerders v ON v.code = vsr.vervoerder_code
       WHERE vsr.actief = TRUE
         AND v.actief    = TRUE
       ORDER BY vsr.prio ASC, vsr.id ASC
    LOOP
      IF matcht_regel(
           v_match_regel.conditie,
           v_attr.afl_land,
           v_attr.kleinste_zijde_cm,
           v_attr.totaal_gewicht_kg,
           v_attr.debiteur_nr,
           v_attr.inkoopgroep_code
         )
      THEN
        v_eval_code := v_match_regel.vervoerder_code;
        v_eval_service := v_match_regel.service_code;
        v_eval_uitleg := v_eval_uitleg || jsonb_build_object(
          'match_regel_id', v_match_regel.id,
          'match_prio',     v_match_regel.prio,
          'match_conditie', v_match_regel.conditie,
          'match_notitie',  v_match_regel.notitie
        );
        EXIT;
      END IF;
    END LOOP;

    IF v_eval_code IS NULL THEN
      v_eval_uitleg := v_eval_uitleg || jsonb_build_object('reden', 'geen_matchende_regel');
    END IF;

    -- 2. Effectieve keuze + bron-bepaling
    IF v_regel.vervoerder_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_regel.vervoerder_code, NULL::TEXT,
        'override'::TEXT,
        v_eval_uitleg || jsonb_build_object('bron', 'override');
    ELSIF v_eval_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_eval_code, v_eval_service,
        'regel'::TEXT,
        v_eval_uitleg || jsonb_build_object('bron', 'regel');
    ELSIF v_klant_fallback IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_klant_fallback, NULL::TEXT,
        'klant_fallback'::TEXT,
        v_eval_uitleg || jsonb_build_object('bron', 'klant_fallback');
    ELSE
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        NULL::TEXT, NULL::TEXT,
        'geen'::TEXT,
        v_eval_uitleg || jsonb_build_object('bron', 'geen');
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) TO authenticated;

COMMENT ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) IS
  'Mig 219: per-orderregel-resolver. Returnt voor elke regel: override, '
  'evaluator-keuze, klant-fallback, en de effectieve keuze + bron-uitleg. '
  'Bron-precedentie: override > regel > klant_fallback > geen. Globaal-actief '
  'is een UI-fallback en zit niet in deze RPC. STABLE: cachebaar via TanStack '
  'Query.';

NOTIFY pgrst, 'reload schema';
