-- ============================================================================
-- GO-LIVE STAP 7 (2026-06-08): verificatie-spotchecks NA de import.
--   Draai deze ná stap 2-6 (wis + rollen --apply + vaste maten --commit +
--   herallocatie) in psql / Supabase SQL-editor. Read-only — wijzigt niets.
--   Documenteer de uitkomsten.
-- ============================================================================

-- A. Rollen-totaal moet matchen met de bron (dry-run 2026-06-08: ~1380 rollen).
SELECT COUNT(*) AS rollen, ROUND(SUM(oppervlak_m2), 1) AS m2
FROM rollen WHERE status NOT IN ('verkocht', 'gesneden');

-- B. Geen rol meer zonder in_magazijn_sinds onder de zojuist geladen set.
--    Verwacht: 0.
SELECT COUNT(*) AS rollen_zonder_datum FROM rollen
WHERE status = 'beschikbaar' AND in_magazijn_sinds IS NULL;

-- C. Vrije voorraad-formule klopt voor een steekproef vaste maten met orders.
--    Verwacht per rij: vrije_voorraad = voorraad - gereserveerd - backorder.
SELECT artikelnr, voorraad, gereserveerd, backorder, vrije_voorraad
FROM producten
WHERE product_type = 'vast' AND gereserveerd > 0
ORDER BY gereserveerd DESC LIMIT 10;

-- D. gereserveerd op producten == SUM actieve voorraad-claims (geen drift).
--    Verwacht: 0 rijen.
SELECT p.artikelnr, p.gereserveerd,
       COALESCE(SUM(r.aantal), 0) AS claim_som
FROM producten p
LEFT JOIN order_reserveringen r
  ON r.fysiek_artikelnr = p.artikelnr AND r.bron = 'voorraad' AND r.status = 'actief'
WHERE p.product_type = 'vast'
GROUP BY p.artikelnr, p.gereserveerd
HAVING p.gereserveerd <> COALESCE(SUM(r.aantal), 0)
LIMIT 20;
