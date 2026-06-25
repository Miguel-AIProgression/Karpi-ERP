-- Migratie 514: leverancier_id op kwaliteiten (single source of truth)
--
-- Leverancier is een kwaliteit-niveau-eigenschap (DREAM = altijd HENAN),
-- niet een per-artikel eigenschap. Door leverancier_id op kwaliteiten te
-- zetten geldt een wijziging automatisch voor alle kleuren en afmetingen.
--
-- producten.leverancier_id blijft als legacy-kolom staan maar wordt niet
-- meer beschreven door de UI — de backorder_per_artikel view prefereert
-- kwaliteiten.leverancier_id.

ALTER TABLE kwaliteiten
  ADD COLUMN IF NOT EXISTS leverancier_id BIGINT REFERENCES leveranciers(id);

-- Backfill: meest voorkomende leverancier per kwaliteit vanuit producten
UPDATE kwaliteiten k
SET leverancier_id = sub.leverancier_id
FROM (
  SELECT DISTINCT ON (kwaliteit_code)
    kwaliteit_code, leverancier_id
  FROM (
    SELECT kwaliteit_code, leverancier_id, COUNT(*) AS cnt
    FROM producten
    WHERE leverancier_id IS NOT NULL AND kwaliteit_code IS NOT NULL
    GROUP BY kwaliteit_code, leverancier_id
  ) counts
  ORDER BY kwaliteit_code, cnt DESC, leverancier_id
) sub
WHERE k.code = sub.kwaliteit_code
  AND k.leverancier_id IS NULL;

-- Update backorder_per_artikel: lees leverancier van kwaliteiten
-- (met fallback naar producten.leverancier_id voor producten zonder kwaliteit)
DROP VIEW IF EXISTS backorder_per_artikel;
CREATE VIEW backorder_per_artikel AS
SELECT
  p.artikelnr,
  p.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving,
  p.lengte_cm,
  p.breedte_cm,
  p.maatwerk_vorm_code,
  p.voorraad,
  p.vrije_voorraad,
  p.besteld_inkoop,
  p.backorder                                                              AS totaal_backorder,
  COALESCE(SUM(orr.te_leveren) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS totaal_te_leveren,
  COALESCE(COUNT(DISTINCT o.id) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS aantal_orders,
  COALESCE(lk.naam, lp.naam)                                              AS leverancier_naam
FROM producten p
LEFT JOIN order_regels orr  ON orr.artikelnr = p.artikelnr
LEFT JOIN orders o          ON o.id          = orr.order_id
LEFT JOIN kwaliteiten kw    ON kw.code       = p.kwaliteit_code
LEFT JOIN leveranciers lk   ON lk.id         = kw.leverancier_id
LEFT JOIN leveranciers lp   ON lp.id         = p.leverancier_id
WHERE p.backorder > 0
  AND COALESCE(p.is_pseudo, FALSE) = FALSE
  AND COALESCE(p.product_type, 'overig') != 'rol'
GROUP BY
  p.artikelnr, p.karpi_code, p.kwaliteit_code, p.kleur_code,
  p.omschrijving, p.lengte_cm, p.breedte_cm, p.maatwerk_vorm_code,
  p.voorraad, p.vrije_voorraad, p.besteld_inkoop, p.backorder,
  lk.naam, lp.naam;

COMMENT ON COLUMN kwaliteiten.leverancier_id IS
  'Leverancier voor ALLE producten van deze kwaliteit. Single source of truth — '
  'wijzigen hier propageert automatisch naar alle kleurnummers en afmetingen. '
  'Voedt backorder_per_artikel en product-detail via kwaliteitInfo (mig 514).';

NOTIFY pgrst, 'reload schema';
