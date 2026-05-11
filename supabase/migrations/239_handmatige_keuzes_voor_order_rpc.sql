-- Migratie 239: handmatige_keuzes_voor_order RPC
--
-- Vervangt de drie sequentiële queries in
-- frontend/src/lib/supabase/queries/reserveringen.ts (fetchHandmatigeKeuzesVoorOrder)
-- door één JOIN. Filter `is_handmatig=true AND status='actief'` leeft nu op
-- één plek (SQL) ipv mengeling van .eq()-clauses + JS-filter. Spiegelt het
-- patroon van mig 236 (`claims_voor_product`).
--
-- Concept: alle actieve, handmatige uitwisselbaar-claims voor een order,
-- met de omschrijving van het fysieke (omgestickerd geleverde) artikel
-- erbij gejoined.

CREATE OR REPLACE FUNCTION handmatige_keuzes_voor_order(p_order_id BIGINT)
RETURNS TABLE (
  order_regel_id BIGINT,
  artikelnr      TEXT,
  aantal         INTEGER,
  omschrijving   TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.order_regel_id        AS order_regel_id,
    r.fysiek_artikelnr      AS artikelnr,
    r.aantal                AS aantal,
    COALESCE(p.omschrijving, r.fysiek_artikelnr) AS omschrijving
  FROM order_reserveringen r
  JOIN order_regels reg ON reg.id = r.order_regel_id
  LEFT JOIN producten p ON p.artikelnr = r.fysiek_artikelnr
  WHERE reg.order_id = p_order_id
    AND r.status = 'actief'
    AND r.is_handmatig = TRUE
    AND r.fysiek_artikelnr IS NOT NULL
  ORDER BY r.order_regel_id, r.fysiek_artikelnr;
$$;

COMMENT ON FUNCTION handmatige_keuzes_voor_order(BIGINT) IS
  'Alle actieve, handmatige uitwisselbaar-claims voor een order, met fysiek '
  'product-omschrijving erbij. Gebruikt om edit-mode te hydrateren met de '
  'bestaande gebruikerskeuzes. Mig 239.';
