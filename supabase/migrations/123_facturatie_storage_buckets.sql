-- Migration 123: Storage buckets voor facturatie
-- Maakt de twee buckets aan die de edge function `factuur-verzenden` nodig heeft:
--   - `facturen`: privé. Eén bestand per factuur onder {debiteur_nr}/FACT-YYYY-NNNN.pdf.
--                Frontend leest via supabase.storage.createSignedUrl() (10min geldig).
--   - `documenten`: publiek leesbaar. Bevat algemene-voorwaarden-karpi-bv.pdf.
--                   Edge function downloadt hem als bijlage bij elke factuur-email.
--
-- AV-PDF zelf moet éénmalig via dashboard geüpload worden:
--   Supabase dashboard → Storage → documenten → Upload → algemene-voorwaarden-karpi-bv.pdf
--
-- Idempotent via ON CONFLICT.

INSERT INTO storage.buckets (id, name, public)
VALUES ('facturen', 'facturen', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('documenten', 'documenten', true)
ON CONFLICT (id) DO NOTHING;

-- RLS-policies op storage.objects.
-- Service role (edge function) bypassed RLS — geen policy nodig voor uploads.
-- Wel een SELECT-policy voor authenticated zodat frontend signed URL's kan genereren.

DO $$ BEGIN
  CREATE POLICY "Authenticated leest facturen-bucket"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'facturen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Public read op documenten gaat via bucket.public=true; geen expliciete policy nodig.
-- Uploads naar documenten alleen via service role (geen authenticated INSERT-policy).
