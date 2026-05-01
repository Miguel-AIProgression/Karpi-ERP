-- Migration 170: orderregel_pickbaarheid view
--
-- Per orderregel: kan deze nu uit het magazijn? Waar ligt 'ie? Anders: waarop wachten we?
-- Bron-van-waarheid voor Pick & Ship-pagina (V2). Toekomstig ook voor 'Wacht op picken'-
-- auto-derivation in herwaardeer_order_status (kandidaat 2, niet in dit plan).
--
-- Logica (zie plan 2026-05-01-pickbaarheid-mvi.md):
--   Maatwerk: pickbaar als ALLE snijplannen.status='Ingepakt'. wacht_op afgeleid van
--             slechtst-presterende snijplan. Locatie = MIN(snijplannen.locatie) over
--             Ingepakt-rijen.
--   Standaard: pickbaar als orderregel >=1 actieve voorraad-claim heeft. Anders
--              wacht_op='inkoop'. Locatie = COALESCE(rol-met-locatie.code, producten.locatie).

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT
    sp.order_regel_id,
    COUNT(*)                                          AS totaal_stuks,
    COUNT(*) FILTER (WHERE sp.status = 'Ingepakt')    AS pickbaar_stuks,
    MIN(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt') AS locatie,
    MIN(
      CASE sp.status
        WHEN 'Wacht'        THEN 1
        WHEN 'Gepland'      THEN 2
        WHEN 'Gesneden'     THEN 3
        WHEN 'In confectie' THEN 4
        WHEN 'In productie' THEN 5
        WHEN 'Gereed'       THEN 6
        WHEN 'Ingepakt'     THEN 7
        ELSE NULL
      END
    ) AS slechtste_rang
  FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'
  GROUP BY sp.order_regel_id
),
voorraad_claim AS (
  SELECT
    rsv.order_regel_id,
    COUNT(*) AS aantal_actief
  FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad' AND rsv.status = 'actief'
  GROUP BY rsv.order_regel_id
),
rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr)
    r.artikelnr,
    ml.code AS code
  FROM rollen r
  JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar' AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id ASC
)
SELECT
  oreg.id            AS order_regel_id,
  oreg.order_id,
  oreg.regelnummer,
  oreg.artikelnr,
  oreg.is_maatwerk,
  oreg.orderaantal,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.omschrijving,
  oreg.maatwerk_kwaliteit_code,
  oreg.maatwerk_kleur_code,
  ma.totaal_stuks,
  ma.pickbaar_stuks,
  CASE
    WHEN oreg.is_maatwerk THEN
      COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
    ELSE
      COALESCE(vc.aantal_actief > 0, false)
  END AS is_pickbaar,
  CASE
    WHEN oreg.is_maatwerk         THEN 'snijplan'
    WHEN rl.code IS NOT NULL      THEN 'rol'
    WHEN p.locatie IS NOT NULL    THEN 'producten_default'
    ELSE NULL
  END AS bron,
  CASE
    WHEN oreg.is_maatwerk THEN ma.locatie
    ELSE COALESCE(rl.code, p.locatie)
  END AS fysieke_locatie,
  CASE
    WHEN oreg.is_maatwerk THEN
      CASE
        WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'
        WHEN ma.slechtste_rang <= 2 THEN 'snijden'
        WHEN ma.slechtste_rang <= 4 THEN 'confectie'
        WHEN ma.slechtste_rang <= 6 THEN 'inpak'
        ELSE NULL
      END
    ELSE
      CASE WHEN COALESCE(vc.aantal_actief, 0) = 0 THEN 'inkoop' ELSE NULL END
  END AS wacht_op
FROM order_regels oreg
JOIN orders o            ON o.id = oreg.order_id
LEFT JOIN producten p    ON p.artikelnr = oreg.artikelnr
LEFT JOIN maatwerk_aggr ma   ON ma.order_regel_id = oreg.id
LEFT JOIN voorraad_claim vc  ON vc.order_regel_id = oreg.id
LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd');

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron (snijplan|rol|producten_default), '
  'wacht_op (snijden|confectie|inpak|inkoop|null). Verenigt maatwerk- en standaard-paden. '
  'Migratie 170.';
