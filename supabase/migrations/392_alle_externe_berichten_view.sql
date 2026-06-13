-- Mig 392 — Unified diagnose-view over álle externe berichten (in + uit).
--
-- WAAROM: bij een bug ("waarom kreeg deze order geen adres?", "is dit EDI-bericht
-- verstuurd?") wil je in ÉÉN query het originele bericht vinden, ongeacht kanaal.
-- De rauwe payloads leven nu in twee tabellen:
--   * `externe_payloads` (mig 324/325) — niet-EDI: carriers (HST/Rhenus/Verhoek),
--     Shopify, Lightspeed, webshop, e-mail-orders, klant-PO, supplier-portal,
--     orderbevestiging-/factuur-e-mails.
--   * `edi_berichten`     (mig 157)     — alle EDI/Transus (order, orderbev,
--     factuur, verzendbericht), met zijn eigen rijke queue/audit.
--
-- Bewuste keuze (geen duplicatie): EDI blijft in `edi_berichten`; deze view
-- UNION't beide naar één genormaliseerd schema zodat één SELECT alles doorzoekt.
-- Read-only — geen opslag, herevalueert per query.

CREATE OR REPLACE VIEW alle_externe_berichten AS
SELECT
  'externe_payloads'::text AS audit_tabel,
  ep.id,
  ep.kanaal,
  ep.richting,                                  -- 'in' | 'out'
  NULL::text                AS berichttype,
  ep.bron,
  ep.externe_id,
  ep.status::text           AS status,
  ep.order_id,
  NULL::integer             AS debiteur_nr,
  ep.payload_raw,
  ep.payload_json,
  ep.fout,
  ep.ontvangen_op           AS aangemaakt_op,
  ep.verwerkt_op            AS afgerond_op
FROM externe_payloads ep
UNION ALL
SELECT
  'edi_berichten'::text     AS audit_tabel,
  eb.id,
  'edi'::text               AS kanaal,
  CASE eb.richting WHEN 'uit' THEN 'out' ELSE eb.richting END AS richting,
  eb.berichttype,
  NULL::text                AS bron,
  eb.transactie_id          AS externe_id,
  eb.status::text           AS status,
  eb.order_id,
  eb.debiteur_nr,
  eb.payload_raw,
  eb.payload_parsed         AS payload_json,
  eb.error_msg              AS fout,
  eb.created_at             AS aangemaakt_op,
  eb.sent_at                AS afgerond_op
FROM edi_berichten eb;

COMMENT ON VIEW alle_externe_berichten IS
  'Mig 392: unified diagnose-view over externe_payloads (niet-EDI) + edi_berichten '
  '(EDI). Eén bron om bij bugs het originele in-/uitgaande bericht te vinden. '
  'Filter op kanaal/richting/externe_id/order_id/status. Geen opslag — read-only.';

GRANT SELECT ON alle_externe_berichten TO authenticated, service_role;
