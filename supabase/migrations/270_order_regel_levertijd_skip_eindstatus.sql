-- Migratie 270: order_regel_levertijd sluit orders in eindstatus uit
--
-- Probleem (gevonden 2026-05-13 op ORD-2026-2057):
--   Order toonde status 'Verzonden' (correct: pickronde voltooid, claims door
--   mig 259-trigger gereleased), maar op de orderregel verscheen tegelijk een
--   rode "Wacht op inkoop"-badge én een sub-rij "Wacht op nieuwe inkoop 5".
--   Logisch tegenstrijdig: een verzonden order kan niet "wacht op inkoop" zijn.
--
-- Root-cause: dezelfde klasse defect als de admin-pseudo-asymmetrie uit mig
-- 269, andere conditie. De view berekent:
--
--   levertijd_status = CASE
--     WHEN (te_leveren - aantal_voorraad - aantal_io) > 0
--       THEN 'wacht_op_nieuwe_inkoop'
--     WHEN aantal_io > 0 THEN 'op_inkoop'
--     ELSE 'voorraad'
--   END
--
-- Bij Verzonden/Geannuleerd zet mig 259 (`trg_order_events_reservering_release`)
-- alle actieve claims op 'released'. Dus aantal_voorraad=0 en aantal_io=0.
-- te_leveren blijft echter staan (semantiek: hoeveelheid van de klant-bestelling,
-- niet "nog te leveren"). Resultaat: tekort = te_leveren → de view rapporteert
-- 'wacht_op_nieuwe_inkoop' voor élke regel van élke verzonden of geannuleerde
-- order.
--
-- Fix: extra WHERE-filter dat orders in een eindstatus uitsluit. Frontend toont
-- dan '—' op de levertijd-kolom (LevertijdBadge rendert nullable als '—').
-- Symmetrisch met de admin-pseudo-filter die mig 269 al toevoegde.
--
-- Out-of-scope: een symmetrische frontend-fix in `order-regels-table.tsx`
-- (`buildSubRows`) is óók nodig om de synthetische "Wacht op nieuwe inkoop"-
-- sub-rij te onderdrukken bij eindstatus; die zit in dezelfde commit en is
-- niet via SQL te repareren.
--
-- Idempotent: DROP VIEW + CREATE VIEW (zie mig 269 voor dezelfde reden:
-- live productie-state had afwijkende kolomvolgorde, CREATE OR REPLACE faalt
-- dan met 42P16).

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
-- leverbare voorraad/IO-keten en horen daarom niet thuis in deze view.
WHERE COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
  -- Mig 270: orders in eindstatus zijn fysiek voltooid (Verzonden) of
  -- afgesloten (Geannuleerd). Claims zijn door mig 259 al gereleased; een
  -- levertijd-badge zou hier altijd misleidend zijn. UI toont '—'.
  AND o.status NOT IN ('Verzonden', 'Geannuleerd');

GRANT SELECT ON order_regel_levertijd TO authenticated, anon;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen, ISO-leverweek + IO-nummers. '
  'Mig 156 (was 150) + Mig 269 + Mig 270: uitgesloten zijn admin-pseudo-orderregels '
  '(VERZEND/BUNDELKORTING/DREMPELKORTING) én orders in eindstatus (Verzonden, '
  'Geannuleerd) — die hebben geen leverbare claim-state meer, de view zou anders '
  'een misleidende "wacht_op_nieuwe_inkoop"-status rapporteren.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Telt het aantal eindstatus-regels dat door dit filter wegvalt (puur info).
  SELECT COUNT(*) INTO v_count
    FROM order_regels oreg
    JOIN orders o ON o.id = oreg.order_id
   WHERE o.status IN ('Verzonden', 'Geannuleerd')
     AND COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');
  RAISE NOTICE 'Mig 270 toegepast: % orderregel(s) op eindstatus-orders worden niet meer in order_regel_levertijd opgenomen.', v_count;
END $$;
