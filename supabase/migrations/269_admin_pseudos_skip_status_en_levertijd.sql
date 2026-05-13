-- Migratie 269: herbereken_wacht_status + order_regel_levertijd skippen admin-pseudo's
--
-- Probleem (gevonden 2026-05-13 op ORD-2026-2063):
--   Order toonde status 'Wacht op voorraad' terwijl de enige product-regel (1×
--   771160006 / CISCO) ruim uit voorraad geclaimd was. De UI toonde tegelijk
--   op de VERZEND-orderregel een rode "Wacht op nieuwe inkoop"-badge.
--
-- Root-cause: admin-pseudo-product asymmetrie.
--   ✅ Mig 263 — herwaardeer_claims_voor_order skipt VERZEND/BUNDELKORTING/
--      DREMPELKORTING (claim-keten loopt niet door op admin-regels).
--   ✅ Mig 266 — trg_orderregel_herallocateer skipt dezelfde set bij INSERT/
--      UPDATE (geen allocator-pass op admin-regels).
--   ❌ Mig 218 — herbereken_wacht_status filtert admin-pseudo's NIET. De
--      VERZEND-orderregel heeft te_leveren=1 én geen claim (terecht — admin-
--      regels krijgen geen voorraad/IO-allocatie), waardoor v_heeft_tekort=TRUE
--      en de order via _apply_transitie op 'Wacht op voorraad' wordt gezet.
--   ❌ Mig 156 — view order_regel_levertijd telt VERZEND mee in zijn aantal_-
--      tekort-rekensom, waardoor de regel-badge 'wacht_op_nieuwe_inkoop' toont.
--
-- Fix: één migratie die beide plekken in lijn brengt met het mig-263/266-
-- filterpatroon. Admin-pseudo's hebben geen voorraad/IO-allocatie en horen
-- daarom ook niet mee te wegen in:
--   · tekort-detectie voor order-status-bepaling
--   · levertijd-aggregaten per orderregel
--
-- Retroactief: na deploy moeten alle non-eind-orders opnieuw worden
-- doorgerekend zodat de orders die nu ten onrechte op 'Wacht op voorraad' of
-- 'Wacht op inkoop' staan terug naar 'Nieuw' kunnen vallen. Zie het
-- script `scripts/retroactief-mig-269-herbereken-wacht-status.sql`.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + CREATE OR REPLACE VIEW.
-- VOORWAARDE: mig 218, mig 156, mig 263, mig 265 aanwezig.

-- ============================================================================
-- 1. herbereken_wacht_status — admin-pseudo's uit v_heeft_tekort-check
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
      -- Mig 269: admin-pseudo's hebben geen claim-allocatie (mig 263/266),
      -- en mogen daarom niet als tekort gelden in de status-bepaling.
      AND COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
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
  'Mig 218 (ADR-0006) + Mig 269: leest claim-state, kiest Wacht op X / Nieuw, '
  'schrijft via _apply_transitie. Eindstatussen + actieve productie/picking-'
  'statussen worden niet aangeraakt. Admin-pseudo-orderregels (VERZEND/'
  'BUNDELKORTING/DREMPELKORTING) tellen NIET mee voor tekort-detectie — '
  'consistent met de allocator (mig 263/266) die ze ook overslaat.';

-- ============================================================================
-- 2. order_regel_levertijd — admin-pseudo's uit de view filteren
-- ============================================================================
--
-- Admin-pseudo's hebben geen leverbare voorraad/IO-relatie. De view dient
-- alleen voor de levertijd-badge per leverbare regel; filtering hier zorgt
-- dat de UI op zo'n regel '—' toont in plaats van een misleidende rode
-- "wacht op inkoop"-badge. Frontend rendert nullable levertijd al als '—'
-- (zie order-regels-table.tsx).
--
-- DROP + CREATE i.p.v. CREATE OR REPLACE: bij eerste deploy bleek de live
-- view een afwijkende kolomvolgorde te hebben (PG-foutmelding 42P16
-- "cannot change name of view column verwachte_leverweek to eerste_io_nr").
-- Dat duidt op een productie-state die niet 1-op-1 mig 156 reflecteert
-- (mogelijk mig 150 nooit door 156 overschreven, of hand-edit). DROP is
-- veilig: geen andere views/functies/RLS-policies in deze repo referencen
-- order_regel_levertijd, frontend leest via `from(...).select('*')` en
-- pickt elke geldige kolom-set op (interface in reserveringen.ts).

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
-- Mig 269: admin-pseudo's (VERZEND/BUNDELKORTING/DREMPELKORTING) hebben geen
-- leverbare voorraad/IO-keten en horen daarom niet thuis in deze view. UI
-- toont '—' op zo'n regel (order-regels-table.tsx: nullable levertijd).
WHERE COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

-- DROP wist alle grants — herstel SELECT voor de PostgREST-rollen, zelfde
-- gedrag als bij CREATE OR REPLACE (mig 156).
GRANT SELECT ON order_regel_levertijd TO authenticated, anon;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen, ISO-leverweek + IO-nummers. '
  'Mig 156 (was 150) + Mig 269: admin-pseudo-orderregels (VERZEND/BUNDELKORTING/'
  'DREMPELKORTING) zijn uitgesloten — die hebben geen voorraad/IO-allocatie '
  '(consistent met mig 263/266) en zouden anders een misleidende '
  '"wacht_op_nieuwe_inkoop"-status krijgen.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Mig 269 toegepast: herbereken_wacht_status + order_regel_levertijd skippen admin-pseudo''s.';
  RAISE NOTICE 'Run scripts/retroactief-mig-269-herbereken-wacht-status.sql om bestaande orders bij te trekken.';
END $$;
