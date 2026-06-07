-- Migratie 311: Backfill EDI-orderregelprijzen voor Hornbach (prijslijst 0251)
--
-- Context:
--   Hornbach-artikelen hadden geen verkoopprijs in producten en er was nog géén
--   debiteur-prijslijst gekoppeld. Inkomende EDI-orders van Hornbach (debiteur
--   361208, HORNBACH BOUWMARKT (NEDERLAND) B.V.) kregen daardoor orderregels
--   zonder prijs (prijs NULL / bedrag 0) — create_edi_order (mig 159/166) vond
--   noch een prijslijstprijs noch een fallback-verkoopprijs.
--
--   Op 2026-06-04 is de Hornbach-prijslijst lokaal aangeleverd
--   ("prijslijst0251_a hornbach.xlsx", nieuw formaat mét EAN-kolom) en via
--   import/import_prijslijst_hornbach.py geladen:
--     • prijslijst_headers: nr='0251', naam='HORNBACH PER 1-4-2026'
--     • prijslijst_regels:  1053 artikelprijzen (17 artikelnrs overgeslagen — niet
--       in producten, staan op geen enkele order)
--     • debiteuren.prijslijst_nr='0251' gekoppeld op 361208 (de enige ACTIEVE
--       Hornbach; 361206/207/209/210/213/214 zijn Inactief)
--
--   De prijslijst-JOIN matcht nu, dus dezelfde backfill als mig 308 — hier
--   gescoped op prijslijst 0251 — vult de openstaande Hornbach-orderregels.
--   order_regels.artikelnr = producten.artikelnr (9-cijferig), gezet door
--   match_edi_artikel; prijslijst_regels.artikelnr volgt hetzelfde formaat, dus
--   de JOIN op artikelnr is geldig.
--
-- Idempotent:
--   Het bovenstaande import-script heeft de 6 betrokken regels al bijgewerkt;
--   deze migratie raakt dezelfde rijen en is daardoor bij (her)uitvoer een no-op
--   (de WHERE-clausule selecteert niets meer als prijs == prijslijstprijs).
--
-- Scope:
--   Alleen EDI-orders (bron_systeem='edi') van debiteuren die aan prijslijst 0251
--   hangen én waarvoor in die prijslijst een regel voor het artikel bestaat.
--   korting_pct uit debiteuren.korting_pct; bedrag herberekend zoals create_edi_order.

WITH prijsbron AS (
  SELECT
    orr.id,
    pr.prijs                                                                          AS nieuwe_prijs,
    COALESCE(d.korting_pct, 0)                                                         AS korting_pct,
    ROUND(pr.prijs * COALESCE(orr.orderaantal, 1)
          * (1 - COALESCE(d.korting_pct, 0) / 100), 2)                                 AS bedrag
  FROM order_regels orr
  JOIN orders o            ON o.id = orr.order_id
  JOIN debiteuren d        ON d.debiteur_nr = o.debiteur_nr
  JOIN prijslijst_regels pr
    ON pr.prijslijst_nr = d.prijslijst_nr
   AND pr.artikelnr     = orr.artikelnr
  WHERE o.bron_systeem = 'edi'
    AND d.prijslijst_nr = '0251'
    AND orr.artikelnr IS NOT NULL
    AND (
      orr.prijs IS NULL
      OR orr.prijs = 0
      OR orr.bedrag IS NULL
      OR orr.bedrag = 0
      OR orr.prijs IS DISTINCT FROM pr.prijs      -- corrigeer afwijkende fallback-prijs
    )
)
UPDATE order_regels orr
   SET prijs       = p.nieuwe_prijs,
       korting_pct = p.korting_pct,
       bedrag      = p.bedrag
  FROM prijsbron p
 WHERE p.id = orr.id;
