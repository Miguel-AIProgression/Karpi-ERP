-- Mig 502: handmatige_keuzes_voor_order (mig 239) krijgt `bron` +
-- `inkooporder_regel_id` + `verwacht_datum` erbij.
--
-- Waarom: deze RPC voedt de edit-mode-hydratatie van `uitwisselbaar_keuzes`
-- (order-hydratie.ts). De functie zelf filterde altijd al op `is_handmatig
-- = TRUE` zonder op `bron` te filteren — een handmatige IO-claim (optie 2/3
-- van de nieuwe 3-optie-keuze, mig 499-500) kwam dus al mee, maar zonder de
-- `bron`/`inkooporder_regel_id` informatie kon de frontend zo'n keuze niet
-- onderscheiden van een 'voorraad'-keuze. Zonder fix: een order bewerken en
-- opnieuw opslaan zonder de allocatie-keuze aan te raken zou bij het opslaan
-- de oorspronkelijke IO-claim vervangen door een (foutieve) voorraad-claim op
-- hetzelfde artikelnr — stille datacorruptie van een net bevestigde keuze.
--
-- RETURNS TABLE-kolomwijziging → DROP + CREATE.

DROP FUNCTION IF EXISTS handmatige_keuzes_voor_order(BIGINT);

CREATE FUNCTION handmatige_keuzes_voor_order(p_order_id BIGINT)
RETURNS TABLE (
  order_regel_id        BIGINT,
  bron                  TEXT,
  artikelnr             TEXT,
  inkooporder_regel_id  BIGINT,
  aantal                INTEGER,
  omschrijving          TEXT,
  verwacht_datum        DATE
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.order_regel_id,
    r.bron,
    r.fysiek_artikelnr      AS artikelnr,
    r.inkooporder_regel_id,
    r.aantal,
    COALESCE(p.omschrijving, r.fysiek_artikelnr) AS omschrijving,
    io.verwacht_datum
  FROM order_reserveringen r
  JOIN order_regels reg ON reg.id = r.order_regel_id
  LEFT JOIN producten p ON p.artikelnr = r.fysiek_artikelnr
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ir.inkooporder_id
  WHERE reg.order_id = p_order_id
    AND r.status = 'actief'
    AND r.is_handmatig = TRUE
    AND r.fysiek_artikelnr IS NOT NULL
  ORDER BY r.order_regel_id, r.bron, r.fysiek_artikelnr;
$$;

COMMENT ON FUNCTION handmatige_keuzes_voor_order(BIGINT) IS
  'Alle actieve, handmatige allocatie-keuzes voor een order (uitwisselbaar-'
  'voorraad EN inkooporder-claims, mig 499-500), met fysiek product-'
  'omschrijving + IO-verwacht_datum erbij. Gebruikt om edit-mode te '
  'hydrateren met de bestaande gebruikerskeuzes. Mig 239, uitgebreid mig 502.';
