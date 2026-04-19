-- Voeg consument-contactvelden toe aan orders (voor webshop-orders via Lightspeed).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS afl_email     TEXT,
  ADD COLUMN IF NOT EXISTS afl_telefoon  TEXT,
  ADD COLUMN IF NOT EXISTS opmerkingen   TEXT;
