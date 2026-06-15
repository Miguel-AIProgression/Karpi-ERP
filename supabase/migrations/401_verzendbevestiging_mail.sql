-- Migratie 401: verzendbevestiging-mail met pakbon
--
-- Karpi stuurt zélf een verzendbevestiging mét pakbon-PDF voor elke verzonden
-- zending (de track & trace-mail komt van de vervoerder; die kunnen we geen
-- pakbon meegeven). Eén mail per fysieke zending naar het afleveradres
-- (zendingen.afl_email, mig 365); een bundel-zending (meerdere orders, zelfde
-- debiteur+adres) krijgt dus één mail met één pakbon.
--
-- Drie schema-aanpassingen:
--   1. zendingen.verzendbevestiging_verstuurd_op — nullable-timestamp-gate voor
--      idempotentie (zelfde patroon als edi_bevestigd_op): NULL = nog te sturen.
--   2. verstuurde_emails.soort — 'verzendbevestiging' toegevoegd zodat de mail
--      in de bestaande e-mailtijdlijn op order-detail verschijnt (loggen onder
--      de order). Per betrokken order één rij (zoals bundel-facturen, mig 366).
--   3. storage-bucket 'verzendbevestigingen' voor de pakbon-PDF (spiegelt
--      'orderbevestigingen', mig 366) zodat de tijdlijn de bijlage kan openen.
--
-- Edge function: stuur-verzendbevestiging (sweep via cron, zie mig 402).

-- ── 1. Idempotentie-gate op zendingen ────────────────────────────────────────
ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS verzendbevestiging_verstuurd_op TIMESTAMPTZ;

COMMENT ON COLUMN zendingen.verzendbevestiging_verstuurd_op IS
  'Tijdstip waarop de Karpi-verzendbevestiging+pakbon-mail voor deze zending is '
  'verstuurd (edge function stuur-verzendbevestiging). NULL = nog te versturen; '
  'de sweep slaat gevulde rijen over (idempotentie).';

-- ── 2. verstuurde_emails.soort uitbreiden ────────────────────────────────────
ALTER TABLE verstuurde_emails DROP CONSTRAINT IF EXISTS verstuurde_emails_soort_check;
ALTER TABLE verstuurde_emails
  ADD CONSTRAINT verstuurde_emails_soort_check
  CHECK (soort IN ('factuur', 'orderbevestiging', 'verzendbevestiging'));

-- ── 3. Storage-bucket voor de verzendbevestiging-pakbon-PDF ───────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('verzendbevestigingen', 'verzendbevestigingen', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Authenticated leest verzendbevestigingen-bucket"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'verzendbevestigingen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
