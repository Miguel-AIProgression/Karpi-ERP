-- Migration 428: SELECT-policy op de `documenten`-bucket voor authenticated
--
-- Probleem: de e-mailtijdlijn-dialog (OrderEmailDialog) opent élke bijlage uniform
-- via supabase.storage.createSignedUrl(). Dat endpoint (/object/sign/...) checkt RLS
-- op storage.objects — óók voor publieke buckets (alleen getPublicUrl omzeilt RLS).
--
-- De `documenten`-bucket (mig 123) is wel `public=true` maar kreeg nooit een
-- expliciete SELECT-policy, in de aanname dat public-bucket-leesbaarheid volstond.
-- Daardoor faalt createSignedUrl op 'Algemene voorwaarden KARPI BV.pdf' met
-- "bestand niet gevonden in storage", terwijl de factuur-PDF (bucket `facturen`,
-- mig 123-policy) wél opent. De e-mail zelf verstuurt prima: de edge function
-- downloadt de AV met service-role (bypassed RLS).
--
-- Fix: spiegel de facturen-policy op de documenten-bucket. Idempotent.

DO $$ BEGIN
  CREATE POLICY "Authenticated leest documenten-bucket"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'documenten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
