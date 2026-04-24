-- Opruim-script: inkooporders met datafout
--
-- Verwijdert alle inkooporders waarbij:
--   (a) besteldatum < 2025-01-01, OF
--   (b) leverweek een jaar vóór 2026 bevat (bv "35/2024", "13/2025")
--
-- Leverweek is opgeslagen als TEXT in format "WW/YYYY" — we parsen het jaar
-- via SPLIT_PART. Orders met NULL/onleesbare leverweek worden alleen op
-- besteldatum beoordeeld.
--
-- FK-gedrag:
--   - inkooporder_regels.inkooporder_id heeft ON DELETE CASCADE
--     → regels worden automatisch verwijderd.
--   - rollen.inkooporder_regel_id heeft ON DELETE SET NULL
--     → reeds ontvangen rollen blijven in voorraad, verliezen alleen de
--       koppeling naar de inkooporder.
--   - trg_sync_besteld_inkoop werkt `producten.besteld_inkoop` automatisch
--     bij na delete.
--
-- DRAAI STAP 1 eerst (preview). Check of de lijst klopt.
-- DRAAI STAP 2 pas als het klopt (in transactie, zodat je kunt
-- ROLLBACK'en als de regels-tabelcheck niet klopt).

-- ============================================================================
-- STAP 1 — PREVIEW
-- ============================================================================
SELECT
  io.id,
  io.inkooporder_nr,
  io.oud_inkooporder_nr,
  io.besteldatum,
  io.leverweek,
  io.status,
  l.naam AS leverancier,
  (SELECT COUNT(*) FROM inkooporder_regels r WHERE r.inkooporder_id = io.id) AS aantal_regels,
  CASE
    WHEN io.besteldatum < DATE '2025-01-01' THEN 'besteldatum < 2025'
    WHEN io.leverweek ~ '^\d+/\d{4}$' AND CAST(SPLIT_PART(io.leverweek, '/', 2) AS INT) < 2026 THEN 'leverweek < 2026'
    ELSE '?'
  END AS reden
FROM inkooporders io
LEFT JOIN leveranciers l ON l.id = io.leverancier_id
WHERE
  io.besteldatum < DATE '2025-01-01'
  OR (
    io.leverweek ~ '^\d+/\d{4}$'
    AND CAST(SPLIT_PART(io.leverweek, '/', 2) AS INT) < 2026
  )
ORDER BY io.besteldatum;

-- ============================================================================
-- STAP 2 — DELETE (één statement, RETURNING toont wat weg is)
-- ============================================================================
-- Supabase SQL Editor splitst op ';' en draait elk statement apart, dus
-- temp tables / BEGIN..COMMIT-blokken werken daar niet betrouwbaar. Dit is
-- één atomair DELETE-statement: CASCADE ruimt de regels op, SET NULL
-- behoudt eventueel al ontvangen rollen, en RETURNING geeft direct zicht
-- op wat verwijderd is.
DELETE FROM inkooporders
WHERE
  besteldatum < DATE '2025-01-01'
  OR (
    leverweek ~ '^\d+/\d{4}$'
    AND CAST(SPLIT_PART(leverweek, '/', 2) AS INT) < 2026
  )
RETURNING id, inkooporder_nr, besteldatum, leverweek, status;
