-- Migratie 178: Documenten-bijlagen voor orders en inkooporders
--
-- Use case:
--   - Bij een verkooporder wil de gebruiker de PO-PDF van de klant kunnen
--     uploaden ("inkooporder vanuit de klant") + eventuele andere bijlagen
--     (bevestigingsmail, scan, foto, etc.).
--   - Bij een inkooporder wil de gebruiker de orderbevestiging van de
--     leverancier, pakbon of factuur kunnen uploaden.
--
-- Eén gedeelde private bucket `order-documenten` met aparte paden:
--   orders/{order_id}/{uuid}-{filename}
--   inkooporders/{inkooporder_id}/{uuid}-{filename}
--
-- Twee aparte tabellen voor schone FK-integriteit (CASCADE bij delete order /
-- inkooporder ruimt automatisch de DB-rijen op; storage-objects worden door de
-- frontend opgeruimd in de delete-mutation).
--
-- RLS: SELECT/INSERT/UPDATE/DELETE voor authenticated, conform andere V1-tabellen.

-- ============================================================================
-- Storage bucket
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-documenten',
  'order-documenten',
  false,
  26214400,  -- 25 MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = EXCLUDED.public;

-- Storage policies: authenticated mag alles op deze bucket.
DO $$ BEGIN
  CREATE POLICY "order-docs select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'order-documenten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "order-docs insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'order-documenten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "order-docs update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'order-documenten')
    WITH CHECK (bucket_id = 'order-documenten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "order-docs delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'order-documenten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Tabel: order_documenten (verkooporder-bijlagen)
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_documenten (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bestandsnaam    TEXT NOT NULL,
  storage_path    TEXT NOT NULL UNIQUE,
  mime_type       TEXT,
  grootte_bytes   BIGINT,
  omschrijving    TEXT,
  geupload_door   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  geupload_op     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_documenten_order_id_idx
  ON order_documenten(order_id);

ALTER TABLE order_documenten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_documenten_select ON order_documenten;
CREATE POLICY order_documenten_select
  ON order_documenten FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS order_documenten_insert ON order_documenten;
CREATE POLICY order_documenten_insert
  ON order_documenten FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS order_documenten_update ON order_documenten;
CREATE POLICY order_documenten_update
  ON order_documenten FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS order_documenten_delete ON order_documenten;
CREATE POLICY order_documenten_delete
  ON order_documenten FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE order_documenten IS
  'PDF/Excel/afbeelding-bijlagen bij een verkooporder (klant-PO, bevestiging, etc.). Migratie 178.';

-- ============================================================================
-- Tabel: inkooporder_documenten (inkooporder-bijlagen)
-- ============================================================================
CREATE TABLE IF NOT EXISTS inkooporder_documenten (
  id               BIGSERIAL PRIMARY KEY,
  inkooporder_id   BIGINT NOT NULL REFERENCES inkooporders(id) ON DELETE CASCADE,
  bestandsnaam     TEXT NOT NULL,
  storage_path     TEXT NOT NULL UNIQUE,
  mime_type        TEXT,
  grootte_bytes    BIGINT,
  omschrijving     TEXT,
  geupload_door    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  geupload_op      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inkooporder_documenten_inkooporder_id_idx
  ON inkooporder_documenten(inkooporder_id);

ALTER TABLE inkooporder_documenten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inkooporder_documenten_select ON inkooporder_documenten;
CREATE POLICY inkooporder_documenten_select
  ON inkooporder_documenten FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS inkooporder_documenten_insert ON inkooporder_documenten;
CREATE POLICY inkooporder_documenten_insert
  ON inkooporder_documenten FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS inkooporder_documenten_update ON inkooporder_documenten;
CREATE POLICY inkooporder_documenten_update
  ON inkooporder_documenten FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS inkooporder_documenten_delete ON inkooporder_documenten;
CREATE POLICY inkooporder_documenten_delete
  ON inkooporder_documenten FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE inkooporder_documenten IS
  'PDF/Excel/afbeelding-bijlagen bij een inkooporder (orderbevestiging leverancier, pakbon, factuur). Migratie 178.';
