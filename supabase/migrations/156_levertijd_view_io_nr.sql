-- Migratie 156: view order_regel_levertijd uitbreiden met IO-nummers
--
-- Probleem (gevonden 2026-04-29 bij ORD-2026-2013):
--   Levertijd-badge toont alleen "wk 21" maar de gebruiker wil weten WELKE IO
--   eraan vasthangt. De `RegelClaimDetail`-popover toont dat al, maar het is
--   niet zichtbaar zonder klik. Klanten / gebruikers verwachten in één oogopslag
--   te zien via welke IO de levering loopt — vooral als er meerdere openstaande
--   IO's zijn voor hetzelfde artikel met verschillende leverdata.
--
-- Oplossing:
--   View levert ook eerste_io_nr / laatste_io_nr (de IO-ordernummers achter
--   eerste_io_datum / laatste_io_datum). De UI kan dan "via INK-2025-6085"
--   inline onder de levertijd-badge tonen.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE VIEW order_regel_levertijd AS
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
    -- IO-nummer behorend bij MIN(verwacht_datum)
    (ARRAY_AGG(inkooporder_nr ORDER BY verwacht_datum NULLS LAST, inkooporder_id ASC))[1] AS eerste_io_nr,
    -- IO-nummer behorend bij MAX(verwacht_datum)
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
LEFT JOIN io_aggregaten   ia ON ia.order_regel_id = oreg.id;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen, ISO-leverweek + IO-nummers '
  '(eerste_io_nr / laatste_io_nr / aantal_io_orders) zodat de UI direct kan tonen '
  'via welke inkooporder de levering loopt. Migratie 156 (was 150).';
