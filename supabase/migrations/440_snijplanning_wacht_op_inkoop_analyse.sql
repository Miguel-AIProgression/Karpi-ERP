-- Migratie 440: RPC snijplanning_wacht_op_inkoop_analyse()
--
-- Voedt de nieuwe "Wacht op inkoop"-sectie op de Snijplanning-pagina: per
-- (kwaliteit, kleur, inkooporder_regel) hoeveel stukken er geclaimd zijn
-- (mig 438) en hoeveel van de (nog niet ontvangen) rol nog over is.
--
-- Bewust NIET via `snijplanning_overzicht` (die view kent de nieuwe kolom
-- `verwacht_inkooporder_regel_id` niet en wordt door veel andere consumers
-- gedeeld) — rechtstreekse join op `snijplannen`/`order_regels`, zelfde
-- kwaliteit/kleur-bron als `release_gepland_stukken`/`release_wacht_op_inkoop_stukken`.

CREATE OR REPLACE FUNCTION snijplanning_wacht_op_inkoop_analyse()
RETURNS TABLE (
  kwaliteit_code        TEXT,
  kleur_code             TEXT,
  inkooporder_regel_id   BIGINT,
  inkooporder_nr         TEXT,
  leverancier_naam       TEXT,
  verwacht_datum         DATE,
  te_leveren_m           NUMERIC,
  te_leveren_m2          NUMERIC,
  gebruikte_lengte_cm    INTEGER,
  resterend_lengte_cm    INTEGER,
  resterend_m2           NUMERIC,
  aantal_stukken         INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT
    orr.maatwerk_kwaliteit_code AS kwaliteit_code,
    orr.maatwerk_kleur_code     AS kleur_code,
    ir.id                       AS inkooporder_regel_id,
    io.inkooporder_nr,
    l.naam                      AS leverancier_naam,
    COALESCE(ir.verwacht_datum, io.verwacht_datum) AS verwacht_datum,
    ir.te_leveren_m,
    CASE WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
      THEN ir.te_leveren_m * k.standaard_breedte_cm / 100.0
      ELSE 0
    END AS te_leveren_m2,
    ir.snijplan_gebruikte_lengte_cm AS gebruikte_lengte_cm,
    GREATEST((ir.te_leveren_m * 100)::INTEGER - ir.snijplan_gebruikte_lengte_cm, 0) AS resterend_lengte_cm,
    CASE WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
      THEN GREATEST((ir.te_leveren_m * 100)::INTEGER - ir.snijplan_gebruikte_lengte_cm, 0)
             * k.standaard_breedte_cm / 10000.0
      ELSE 0
    END AS resterend_m2,
    COUNT(sn.id)::INTEGER AS aantal_stukken
  FROM snijplannen sn
  JOIN order_regels orr        ON orr.id = sn.order_regel_id
  JOIN inkooporder_regels ir   ON ir.id  = sn.verwacht_inkooporder_regel_id
  JOIN inkooporders io         ON io.id  = ir.inkooporder_id
  LEFT JOIN leveranciers l     ON l.id   = io.leverancier_id
  LEFT JOIN kwaliteiten k      ON k.code = orr.maatwerk_kwaliteit_code
  WHERE sn.status = 'Wacht op inkoop'
  GROUP BY orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code, ir.id, io.inkooporder_nr,
           l.naam, COALESCE(ir.verwacht_datum, io.verwacht_datum), ir.te_leveren_m,
           k.standaard_breedte_cm, ir.snijplan_gebruikte_lengte_cm;
$$;

COMMENT ON FUNCTION snijplanning_wacht_op_inkoop_analyse() IS
  'Mig 440: per (kwaliteit, kleur, inkooporder_regel) de "Wacht op inkoop"-'
  'claim-status — gebruikt/resterend op de nog niet ontvangen rol (mig 437/438).';

GRANT EXECUTE ON FUNCTION snijplanning_wacht_op_inkoop_analyse() TO anon, authenticated;
