-- Migratie 510: view roltekort_per_artikel
--
-- Berekent per (kwaliteit, kleur) hoeveel meter rol-materiaal nodig is om
-- alle open maatwerk-snijplannen zonder rol-toewijzing te snijden.
--
-- Bron: snijplannen WHERE rol_id IS NULL AND verwacht_inkooporder_regel_id IS NULL
-- = stukken die technisch "tekort" zijn (ook status 'Wacht'/'Gepland' zónder rol).
--
-- Meter-berekening: SUM(stuk_m²) / standaard_breedte_m
-- = beste-geval-schatting (stukken 100% efficiënt naast elkaar).
-- Werkelijk benodigde lengte (incl. snijverlies) ligt altijd hoger.
-- Voor exacte waarden: Snijplanning → Tekort → "Bereken benodigde lengte".
--
-- Wanneer kwaliteiten.standaard_breedte_cm NULL is: alleen m² getoond.

CREATE OR REPLACE VIEW roltekort_per_artikel AS
WITH tekort_stukken AS (
  SELECT
    orr.maatwerk_kwaliteit_code                                   AS kwaliteit_code,
    orr.maatwerk_kleur_code                                       AS kleur_code,
    COUNT(sp.id)                                                  AS aantal_stukken,
    ROUND(
      SUM(sp.lengte_cm::numeric * sp.breedte_cm::numeric) / 10000.0, 2
    )                                                             AS benodigde_m2,
    COUNT(DISTINCT o.id)                                          AS aantal_orders
  FROM snijplannen sp
  JOIN order_regels orr ON orr.id = sp.order_regel_id
  JOIN orders o          ON o.id  = orr.order_id
  WHERE sp.rol_id IS NULL
    AND sp.verwacht_inkooporder_regel_id IS NULL
    AND sp.status NOT IN ('Gesneden', 'Geannuleerd')
    AND o.status  NOT IN ('Verzonden', 'Geannuleerd')
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
  GROUP BY orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
),
-- Één artikelnr per (kwaliteit, kleur) — gebruik het kleinste als er meerdere zijn
artikel_per_groep AS (
  SELECT DISTINCT ON (p.kwaliteit_code, p.kleur_code)
    p.kwaliteit_code,
    p.kleur_code,
    p.artikelnr,
    p.karpi_code,
    p.omschrijving
  FROM producten p
  WHERE p.product_type = 'rol'
    AND p.kwaliteit_code IS NOT NULL
    AND p.kleur_code IS NOT NULL
  ORDER BY p.kwaliteit_code, p.kleur_code, p.artikelnr
)
SELECT
  ts.kwaliteit_code,
  ts.kleur_code,
  ap.artikelnr,
  ap.karpi_code,
  ap.omschrijving,
  k.standaard_breedte_cm,
  ts.aantal_stukken::integer,
  ts.benodigde_m2,
  CASE WHEN k.standaard_breedte_cm IS NOT NULL
    THEN ROUND(
      ts.benodigde_m2 / (k.standaard_breedte_cm / 100.0), 1
    )
  END                                                             AS benodigde_meters,
  ts.aantal_orders::integer
FROM tekort_stukken ts
JOIN kwaliteiten k ON k.code = ts.kwaliteit_code
LEFT JOIN artikel_per_groep ap
       ON ap.kwaliteit_code = ts.kwaliteit_code
      AND ap.kleur_code     = ts.kleur_code
ORDER BY ts.benodigde_m2 DESC;

COMMENT ON VIEW roltekort_per_artikel IS
  'Maatwerk-snijplannen zonder rol-toewijzing, gegroepeerd per (kwaliteit, kleur). '
  'benodigde_meters = m² / standaard_breedte (onderschatting, geen snijverlies). '
  'Exacte waarden via Snijplanning → Tekort → Bereken benodigde lengte. '
  'Voedt de Backorders-pagina (/backorders) sectie Rol-materiaal tekort (mig 510).';

NOTIFY pgrst, 'reload schema';
