-- Migratie 308: Backfill EDI-orderregelprijzen na klant(her)koppeling
--
-- Context:
--   Inkomende EDI-orders werden aangemaakt vóór de juiste debiteur gekoppeld was
--   (koppeling ging eerder mis op het factuur-GLN/e-mail). create_edi_order (mig 166)
--   prijst regels via debiteuren.prijslijst_nr → prijslijst_regels, met fallback op
--   producten.verkoopprijs. Omdat de debiteur — en dus de prijslijst — toen onbekend
--   was, bleven de orderregels van die orders zonder (juiste) prijs:
--     • Ketens zonder product-verkoopprijs (bv. Hornbach-artikelen) → prijs NULL/0.
--     • Ketens mét prijslijst (bv. BDSK/XXXLutz, Möbel) → prijslijstprijs niet toegepast.
--
--   De klantkoppeling staat inmiddels live (mig 306 afleveradres-route + mig 307
--   debiteur-GLN-alias). orders.debiteur_nr wijst nu naar de juiste debiteur, dus de
--   prijslijst-JOIN matcht alsnog. Dit is dezelfde backfill als onderaan mig 166,
--   nu herhaald zodat de net-gekoppelde orders worden meegenomen.
--
-- Scope:
--   Alleen EDI-orders (bron_systeem='edi') waarvan de debiteur een prijslijst heeft
--   ÉN waarvoor in die prijslijst een regel bestaat voor het artikel. De prijslijst-
--   prijs is leidend: lege regels worden gevuld en een afwijkende (fallback-)prijs
--   wordt gecorrigeerd. Regels zonder prijslijstprijs blijven ongemoeid (geen JOIN-
--   match → niet geraakt). Maatwerk-/ongematchte/pseudo-regels matchen niet op exact
--   artikelnr in prijslijst_regels en blijven dus ook ongemoeid.
--
--   korting_pct wordt meegezet uit debiteuren.korting_pct en bedrag wordt herberekend,
--   exact zoals create_edi_order dat doet.

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
    AND orr.artikelnr IS NOT NULL
    AND d.prijslijst_nr IS NOT NULL
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
