-- 024: Storage bucket voor klantlogo's
-- Publiek leesbaar, alleen authenticated users mogen uploaden/verwijderen.

-- Bucket aanmaken (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  5242880, -- 5MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Publiek lezen
CREATE POLICY "Logos publiek leesbaar"
ON storage.objects FOR SELECT
USING (bucket_id = 'logos');

-- Auth upload
CREATE POLICY "Auth gebruikers mogen logos uploaden"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos');

-- Auth delete
CREATE POLICY "Auth gebruikers mogen logos verwijderen"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'logos');

-- Auth update (overschrijven)
CREATE POLICY "Auth gebruikers mogen logos updaten"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'logos');
