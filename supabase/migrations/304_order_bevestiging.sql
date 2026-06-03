-- Migratie 304: orderbevestiging per order
--
-- Voegt drie kolommen toe aan `orders`:
--   bevestigd_at     TIMESTAMPTZ  — wanneer de orderbevestiging is verstuurd
--   bevestigd_door   TEXT         — naam/email van de medewerker die bevestigde
--   bevestiging_email TEXT        — naar welk e-mailadres verstuurd

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bevestigd_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bevestigd_door  TEXT,
  ADD COLUMN IF NOT EXISTS bevestiging_email TEXT;

COMMENT ON COLUMN orders.bevestigd_at     IS 'Tijdstip waarop de orderbevestiging per e-mail is verstuurd.';
COMMENT ON COLUMN orders.bevestigd_door   IS 'Naam of e-mail van de medewerker die de orderbevestiging heeft verstuurd.';
COMMENT ON COLUMN orders.bevestiging_email IS 'E-mailadres waarnaar de bevestiging is gestuurd (snapshot).';
