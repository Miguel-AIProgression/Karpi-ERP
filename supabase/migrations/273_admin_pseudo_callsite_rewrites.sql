-- Migratie 273: alle hardcoded admin-pseudo-string-lijsten → is_admin_pseudo()
--
-- Pure refactor van mig 263, 266, 269+270. Geen gedragsverandering;
-- ADR-0018 + mig 272 leverde het predikaat is_admin_pseudo() en de
-- bron-van-waarheid producten.is_pseudo.
--
-- Vervangt in vier definities:
--   1. herwaardeer_claims_voor_order  (was mig 263, regel 30)
--   2. trg_orderregel_herallocateer   (was mig 266, regel 33)
--   3. herbereken_wacht_status        (was mig 269, regel 72)
--   4. view order_regel_levertijd     (was mig 269+270, regel 115)
--
-- Overige hardcoded callsites in mig 206, 211, 217, 218, 219, 221, 225, 227,
-- 229, 232, 234, 256, 260-265, 268 zijn TOE-VOEG-context (de RPC construeert
-- VERZEND/BUNDELKORTING/DREMPELKORTING-regels — daar is een vaste artikelnr
-- juist de bedoeling). Die blijven hardcoded met scope-comment in een latere
-- pass (zie plan Step 2.6, optioneel).
--
-- Idempotent: alle CREATE OR REPLACE + DROP/CREATE VIEW (conform mig 269/270).
-- VOORWAARDE: mig 272 toegepast (is_admin_pseudo()-functie + producten.is_pseudo).

-- ============================================================================
-- 1. herwaardeer_claims_voor_order — was mig 263
-- ============================================================================

CREATE OR REPLACE FUNCTION herwaardeer_claims_voor_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_regel_id IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND NOT is_admin_pseudo(artikelnr)  -- Mig 273 (ADR-0018, was IN-lijst mig 263)
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_claims_voor_order(BIGINT) IS
  'ADR-0015 / Mig 254 + Mig 263 + Mig 273 (ADR-0018): Reservering-Module eigendom. '
  'Loopt orderregels van de order (excl. admin-pseudo-artikelnrs via '
  'is_admin_pseudo()) en triggert per regel herallocateer_orderregel. '
  'Schrijft GEEN orders.status en GEEN orders.afleverdatum — callers chainen '
  'expliciet herbereken_wacht_status (Order-lifecycle, mig 218) en '
  'sync_order_afleverdatum_met_claims (Levertijd-TODO, mig 153). Het admin-filter '
  '(sinds mig 263) is strikt redundant sinds mig 267 (wrapper-revert) — de cyclus '
  'die hier werd doorbroken bestaat niet meer. Filter blijft staan als defensieve '
  'guard mocht een latere caller herwaardeer_claims_voor_order weer vanuit een '
  'triggerketen aanroepen.';

-- ============================================================================
-- 2. trg_orderregel_herallocateer — was mig 266
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_orderregel_herallocateer()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Alle claims worden vanzelf cascade-deleted door FK ON DELETE CASCADE.
    -- Producten.gereserveerd resync gebeurt via trigger C.
    RETURN OLD;
  END IF;

  -- Mig 273 (ADR-0018, was hardcoded IN-lijst in mig 266): admin-pseudo-
  -- producten kennen geen voorraad/IO-allocatie. Skip om N²-recursie via
  -- herallocateer_orderregel → herwaardeer_order_status → herwaardeer_claims_voor_order
  -- → herallocateer_orderregel te voorkomen.
  IF is_admin_pseudo(NEW.artikelnr) THEN
    RETURN NEW;
  END IF;

  -- Trigger op zowel artikelnr- als te_leveren-wijziging
  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_orderregel_herallocateer() IS
  'Mig 146 + Mig 266 + Mig 273 (ADR-0018): order_regels INSERT/UPDATE/DELETE '
  'trigger-handler. Roept herallocateer_orderregel aan bij claim-relevante '
  'mutaties. Admin-pseudo-producten (via is_admin_pseudo()) worden overgeslagen '
  'omdat die geen voorraad/IO-allocatie hebben. Sinds mig 267 (wrapper-revert) '
  'bestaat de oorspronkelijke N²-recursie niet meer; deze filter blijft als '
  'defensieve guard én scheelt onnodig werk in herallocateer_orderregel voor '
  'admin-regels. Symmetrisch met mig 263+273 (filter binnen herwaardeer_claims_voor_order).';

-- ============================================================================
-- 3. herbereken_wacht_status — was mig 269
-- ============================================================================

CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort BOOLEAN;
  v_doel order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + actieve productie/picking niet aanraken (mig 218-gedrag).
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken'
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      -- Mig 273 (ADR-0018, was hardcoded IN-lijst in mig 269): admin-pseudo's
      -- hebben geen claim-allocatie (mig 263/266 + 273), en mogen daarom
      -- niet als tekort gelden in de status-bepaling.
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad') THEN
    v_doel := 'Nieuw';
  ELSE
    RETURN; -- niets te doen
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218 (ADR-0006) + Mig 269 + Mig 273 (ADR-0018): leest claim-state, kiest '
  'Wacht op X / Nieuw, schrijft via _apply_transitie. Eindstatussen + actieve '
  'productie/picking-statussen worden niet aangeraakt. Admin-pseudo-orderregels '
  '(via is_admin_pseudo()) tellen NIET mee voor tekort-detectie — consistent '
  'met de allocator (mig 263/266 + 273) die ze ook overslaat.';

-- ============================================================================
-- 4. view order_regel_levertijd — was mig 269 + mig 270
-- ============================================================================
--
-- Conform mig 269/270-conventie DROP + CREATE i.p.v. CREATE OR REPLACE
-- (live productie-state heeft afwijkende kolomvolgorde door eerdere
-- hand-edits; CREATE OR REPLACE faalt dan met 42P16).

DROP VIEW IF EXISTS order_regel_levertijd;

CREATE VIEW order_regel_levertijd AS
WITH config AS (
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) AS buffer_vast
  FROM app_config WHERE sleutel = 'order_config'
),
io_per_claim AS (
  SELECT
    r.order_regel_id,
    io.id AS inkooporder_id,
    io.inkooporder_nr,
    io.verwacht_datum,
    r.aantal
  FROM order_reserveringen r
  JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  JOIN inkooporders io        ON io.id = ir.inkooporder_id
  WHERE r.status = 'actief' AND r.bron = 'inkooporder_regel'
),
claim_per_regel AS (
  SELECT
    r.order_regel_id,
    SUM(CASE WHEN r.bron='voorraad'         THEN r.aantal ELSE 0 END) AS aantal_voorraad,
    SUM(CASE WHEN r.bron='inkooporder_regel' THEN r.aantal ELSE 0 END) AS aantal_io
  FROM order_reserveringen r
  WHERE r.status = 'actief'
  GROUP BY r.order_regel_id
),
io_aggregaten AS (
  SELECT
    order_regel_id,
    MIN(verwacht_datum) AS eerste_io_datum,
    MAX(verwacht_datum) AS laatste_io_datum,
    (ARRAY_AGG(inkooporder_nr ORDER BY verwacht_datum NULLS LAST, inkooporder_id ASC))[1] AS eerste_io_nr,
    (ARRAY_AGG(inkooporder_nr ORDER BY verwacht_datum DESC NULLS LAST, inkooporder_id DESC))[1] AS laatste_io_nr,
    COUNT(DISTINCT inkooporder_id) AS aantal_io_orders
  FROM io_per_claim
  GROUP BY order_regel_id
)
SELECT
  oreg.id AS order_regel_id,
  oreg.order_id,
  oreg.te_leveren,
  COALESCE(oreg.is_maatwerk, false) AS is_maatwerk,
  o.lever_modus,
  COALESCE(c.aantal_voorraad, 0) AS aantal_voorraad,
  COALESCE(c.aantal_io, 0)       AS aantal_io,
  GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad, 0) - COALESCE(c.aantal_io, 0)) AS aantal_tekort,
  ia.eerste_io_datum,
  ia.laatste_io_datum,
  ia.eerste_io_nr,
  ia.laatste_io_nr,
  COALESCE(ia.aantal_io_orders, 0) AS aantal_io_orders,
  CASE
    WHEN COALESCE(oreg.is_maatwerk, false) THEN NULL
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad, 0) - COALESCE(c.aantal_io, 0)) > 0
      THEN NULL
    WHEN COALESCE(c.aantal_io, 0) = 0
      THEN 'voorraad'
    WHEN o.lever_modus = 'in_een_keer'
      THEN iso_week_plus(ia.laatste_io_datum, (SELECT buffer_vast FROM config))
    ELSE
      iso_week_plus(ia.eerste_io_datum, (SELECT buffer_vast FROM config))
  END AS verwachte_leverweek,
  CASE
    WHEN COALESCE(oreg.is_maatwerk, false) THEN 'maatwerk'
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad, 0) - COALESCE(c.aantal_io, 0)) > 0 THEN 'wacht_op_nieuwe_inkoop'
    WHEN COALESCE(c.aantal_io, 0) > 0 THEN 'op_inkoop'
    ELSE 'voorraad'
  END AS levertijd_status
FROM order_regels oreg
JOIN orders o ON o.id = oreg.order_id
LEFT JOIN claim_per_regel c ON c.order_regel_id = oreg.id
LEFT JOIN io_aggregaten   ia ON ia.order_regel_id = oreg.id
-- Mig 273 (ADR-0018, was hardcoded IN-lijst in mig 269): admin-pseudo's hebben
-- geen leverbare voorraad/IO-keten en horen daarom niet thuis in deze view.
WHERE NOT is_admin_pseudo(oreg.artikelnr)
  -- Mig 270 behouden: orders in eindstatus zijn fysiek voltooid (Verzonden) of
  -- afgesloten (Geannuleerd). Claims zijn door mig 259 al gereleased; een
  -- levertijd-badge zou hier altijd misleidend zijn. UI toont '—'.
  AND o.status NOT IN ('Verzonden', 'Geannuleerd');

GRANT SELECT ON order_regel_levertijd TO authenticated, anon;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen, ISO-leverweek + IO-nummers. '
  'Mig 156 + Mig 269 + Mig 270 + Mig 273 (ADR-0018): uitgesloten zijn admin-pseudo-'
  'orderregels (via is_admin_pseudo()) én orders in eindstatus (Verzonden, '
  'Geannuleerd) — die hebben geen leverbare claim-state meer, de view zou anders '
  'een misleidende "wacht_op_nieuwe_inkoop"-status rapporteren.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 5. ASSERT-blok: gedrag identiek aan pre-mig-273
-- ============================================================================

DO $$
DECLARE
  v_pseudo_in_view INTEGER;
  v_eindstatus_in_view INTEGER;
  v_helper_klopt BOOLEAN;
BEGIN
  -- 1) Geen admin-pseudo-orderregel mag in de view voorkomen
  SELECT COUNT(*) INTO v_pseudo_in_view
    FROM order_regel_levertijd v
    JOIN order_regels oreg ON oreg.id = v.order_regel_id
   WHERE is_admin_pseudo(oreg.artikelnr);
  ASSERT v_pseudo_in_view = 0,
    format('Admin-pseudo lekt in order_regel_levertijd-view: %s rijen', v_pseudo_in_view);

  -- 2) Geen orderregel van Verzonden/Geannuleerd order mag in de view voorkomen
  -- (mig 270-filter blijft actief)
  SELECT COUNT(*) INTO v_eindstatus_in_view
    FROM order_regel_levertijd v
    JOIN orders o ON o.id = v.order_id
   WHERE o.status IN ('Verzonden', 'Geannuleerd');
  ASSERT v_eindstatus_in_view = 0,
    format('Eindstatus-order lekt in order_regel_levertijd-view: %s rijen', v_eindstatus_in_view);

  -- 3) is_admin_pseudo() returnt dezelfde TRUE-set als de oude hardcoded IN-check
  SELECT bool_and(is_admin_pseudo(artikelnr)) INTO v_helper_klopt
    FROM (VALUES ('VERZEND'), ('BUNDELKORTING'), ('DREMPELKORTING')) AS t(artikelnr);
  ASSERT v_helper_klopt = TRUE,
    'is_admin_pseudo() returnt FALSE voor een van de 3 bekende admin-pseudo-artikelnrs';

  RAISE NOTICE 'Mig 273 OK: 4 callsites omgezet naar is_admin_pseudo(); gedrag identiek geverifieerd.';
  RAISE NOTICE '  - herwaardeer_claims_voor_order (was mig 263)';
  RAISE NOTICE '  - trg_orderregel_herallocateer (was mig 266)';
  RAISE NOTICE '  - herbereken_wacht_status (was mig 269)';
  RAISE NOTICE '  - view order_regel_levertijd (was mig 269+270)';
END $$;
