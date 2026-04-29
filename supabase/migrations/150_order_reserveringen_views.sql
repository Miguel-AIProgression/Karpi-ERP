-- Migratie 150: views order_regel_levertijd, inkooporder_regel_claim_zicht

-- ============================================================================
-- View: order_regel_levertijd
--   Per orderregel: levertijd-status (voorraad / op_inkoop / wacht_op_nieuwe_inkoop / maatwerk)
--   en de leverweek waarop de regel volledig leverbaar is.
-- ============================================================================
CREATE OR REPLACE VIEW order_regel_levertijd AS
WITH config AS (
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) AS buffer_vast
  FROM app_config WHERE sleutel = 'order_config'
),
claim_per_regel AS (
  SELECT
    r.order_regel_id,
    SUM(CASE WHEN r.bron='voorraad'         THEN r.aantal ELSE 0 END) AS aantal_voorraad,
    SUM(CASE WHEN r.bron='inkooporder_regel' THEN r.aantal ELSE 0 END) AS aantal_io,
    MAX(io.verwacht_datum) FILTER (WHERE r.bron='inkooporder_regel') AS laatste_io_datum,
    MIN(io.verwacht_datum) FILTER (WHERE r.bron='inkooporder_regel') AS eerste_io_datum
  FROM order_reserveringen r
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io        ON io.id = ir.inkooporder_id
  WHERE r.status = 'actief'
  GROUP BY r.order_regel_id
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
  c.eerste_io_datum,
  c.laatste_io_datum,
  CASE
    WHEN COALESCE(oreg.is_maatwerk, false) THEN NULL
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad, 0) - COALESCE(c.aantal_io, 0)) > 0
      THEN NULL  -- onbekend (wacht op nieuwe inkoop)
    WHEN COALESCE(c.aantal_io, 0) = 0
      THEN 'voorraad'
    WHEN o.lever_modus = 'in_een_keer'
      THEN iso_week_plus(c.laatste_io_datum, (SELECT buffer_vast FROM config))
    ELSE
      iso_week_plus(c.eerste_io_datum, (SELECT buffer_vast FROM config))
  END AS verwachte_leverweek,
  CASE
    WHEN COALESCE(oreg.is_maatwerk, false) THEN 'maatwerk'
    WHEN GREATEST(0, oreg.te_leveren - COALESCE(c.aantal_voorraad, 0) - COALESCE(c.aantal_io, 0)) > 0 THEN 'wacht_op_nieuwe_inkoop'
    WHEN COALESCE(c.aantal_io, 0) > 0 THEN 'op_inkoop'
    ELSE 'voorraad'
  END AS levertijd_status
FROM order_regels oreg
JOIN orders o ON o.id = oreg.order_id
LEFT JOIN claim_per_regel c ON c.order_regel_id = oreg.id;

COMMENT ON VIEW order_regel_levertijd IS
  'Per orderregel: levertijd-status, claim-aantallen en berekende ISO-leverweek. '
  'levertijd_status: voorraad | op_inkoop | wacht_op_nieuwe_inkoop | maatwerk. Migratie 150.';

-- ============================================================================
-- View: inkooporder_regel_claim_zicht
--   Per IO-regel: hoeveel stuks zijn geclaimd, hoeveel nog vrij,
--   plus aantal orderregels voor drilldown.
-- ============================================================================
CREATE OR REPLACE VIEW inkooporder_regel_claim_zicht AS
SELECT
  ir.id AS inkooporder_regel_id,
  ir.inkooporder_id,
  ir.artikelnr,
  ir.te_leveren_m,
  ir.eenheid,
  COALESCE(SUM(r.aantal) FILTER (WHERE r.status = 'actief'), 0) AS aantal_geclaimd,
  GREATEST(
    0,
    FLOOR(COALESCE(ir.te_leveren_m, 0))::INTEGER
      - COALESCE(SUM(r.aantal) FILTER (WHERE r.status = 'actief'), 0)
  ) AS aantal_vrij,
  COUNT(DISTINCT r.order_regel_id) FILTER (WHERE r.status = 'actief') AS aantal_orderregels
FROM inkooporder_regels ir
LEFT JOIN order_reserveringen r
       ON r.inkooporder_regel_id = ir.id AND r.bron = 'inkooporder_regel'
GROUP BY ir.id;

COMMENT ON VIEW inkooporder_regel_claim_zicht IS
  'Per IO-regel: aantal_geclaimd / aantal_vrij + aantal orderregels dat erop wacht. Migratie 150.';
