-- Migratie 365: verstuurde_emails — e-mailtijdlijn per order
--
-- Eén rij per daadwerkelijk verstuurde e-mail per order (facturen +
-- orderbevestigingen). Gevuld door edge functions `factuur-verzenden` en
-- `stuur-orderbevestiging` ná een geslaagde Microsoft Graph-send (best-effort,
-- mailen blokkeert nooit op logging). Frontend leest dit voor de sectie
-- "E-mails" op order-detail; mail-body wordt in een sandboxed iframe getoond.
--
-- Een bundel-factuur die meerdere orders dekt krijgt een rij per order zodat
-- elke order z'n eigen complete tijdlijn heeft. De betaler-kopie is een eigen
-- rij (eigen onderwerp "... (kopie voor betaler)").
--
-- `html IS NULL` betekent: inhoud niet bewaard (backfill van mails die vóór
-- deze migratie verstuurd zijn — alleen onderwerp/ontvanger/datum bekend).
--
-- Zie spec: docs/superpowers/specs/2026-06-11-order-email-tijdlijn-design.md

CREATE TABLE verstuurde_emails (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  factuur_id    BIGINT REFERENCES facturen(id) ON DELETE SET NULL,
  soort         TEXT NOT NULL CHECK (soort IN ('factuur', 'orderbevestiging')),
  onderwerp     TEXT NOT NULL,
  verzonden_aan TEXT NOT NULL,
  verzonden_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
  html          TEXT,
  bijlagen      JSONB NOT NULL DEFAULT '[]'::jsonb
);

COMMENT ON TABLE verstuurde_emails IS
  'Log van daadwerkelijk verstuurde e-mails per order (mig 365). '
  'Geschreven door edge functions factuur-verzenden en stuur-orderbevestiging '
  'na een geslaagde Graph-send. Voedt de e-mailtijdlijn op order-detail.';
COMMENT ON COLUMN verstuurde_emails.html IS
  'Volledige mail-body (HTML). NULL = inhoud niet bewaard (backfill van vóór mig 365).';
COMMENT ON COLUMN verstuurde_emails.bijlagen IS
  'Array van {filename, bucket, path} — verwijzingen naar Supabase storage voor klikbare bijlagen.';

CREATE INDEX idx_verstuurde_emails_order ON verstuurde_emails(order_id);

-- RLS: frontend leest alleen; schrijven gebeurt uitsluitend via service-role
-- (edge functions bypassen RLS) — bewust géén insert/update/delete-policies.
ALTER TABLE verstuurde_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY verstuurde_emails_select
  ON verstuurde_emails FOR SELECT
  TO authenticated
  USING (true);

-- ── Storage-bucket voor orderbevestiging-PDF's ───────────────────────────────
-- stuur-orderbevestiging genereerde de PDF tot nu toe alleen in-memory als
-- mailbijlage; voortaan wordt hij ook bewaard zodat de tijdlijn-dialog hem
-- via een signed URL kan openen. Spiegelt bucket `facturen` (mig 123).
-- Pad: {order_id}/Orderbevestiging-{order_nr}.pdf (upsert bij hersturen).

INSERT INTO storage.buckets (id, name, public)
VALUES ('orderbevestigingen', 'orderbevestigingen', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Authenticated leest orderbevestigingen-bucket"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'orderbevestigingen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Globale guard: alleen vullen als de tabel leeg is (vers aangemaakt hierboven,
-- maar zo blijft her-draaien van deze migratie idempotent).

-- 1. Verstuurde facturen → rij per gekoppelde order. EDI-only facturen
--    (verstuurd_naar zonder '@', bv. 'EDI Transus') slaan we over — dat was
--    geen e-mail. De factuur-PDF bestaat al in storage en is dus klikbaar;
--    de mail-body van destijds is niet bewaard (html NULL).
INSERT INTO verstuurde_emails (order_id, factuur_id, soort, onderwerp, verzonden_aan, verzonden_op, html, bijlagen)
SELECT DISTINCT
  fr.order_id,
  f.id,
  'factuur',
  'Factuur ' || f.factuur_nr,
  f.verstuurd_naar,
  f.verstuurd_op,
  NULL,
  jsonb_build_array(
    jsonb_build_object('filename', f.factuur_nr || '.pdf', 'bucket', 'facturen', 'path', f.pdf_storage_path),
    jsonb_build_object('filename', 'Algemene voorwaarden KARPI BV.pdf', 'bucket', 'documenten', 'path', 'algemene-voorwaarden-karpi-bv.pdf')
  )
FROM facturen f
JOIN factuur_regels fr ON fr.factuur_id = f.id
WHERE f.verstuurd_op IS NOT NULL
  AND f.verstuurd_naar LIKE '%@%'
  AND f.pdf_storage_path IS NOT NULL
  AND fr.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM verstuurde_emails);

-- 2. Eerder verstuurde orderbevestigingen → rij uit orders.bevestigd_at.
--    Onderwerp is een NL-reconstructie (de taal van destijds is niet bewaard);
--    body en PDF werden vóór mig 365 niet bewaard.
INSERT INTO verstuurde_emails (order_id, soort, onderwerp, verzonden_aan, verzonden_op, html, bijlagen)
SELECT
  o.id,
  'orderbevestiging',
  'Orderbevestiging ' || COALESCE(d.naam, o.fact_naam, 'Klant') || ' ' || o.order_nr,
  o.bevestiging_email,
  o.bevestigd_at,
  NULL,
  '[]'::jsonb
FROM orders o
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
WHERE o.bevestigd_at IS NOT NULL
  AND o.bevestiging_email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM verstuurde_emails WHERE soort = 'orderbevestiging');

NOTIFY pgrst, 'reload schema';
