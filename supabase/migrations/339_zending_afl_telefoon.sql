-- Migratie 339: zendingen.afl_telefoon (leveringscontact voor HST) + vul-trigger
-- (hernummerd van 335 → 339 bij merge naar main: origin/main nam parallel ook 335
--  in beslag met 335_orders_list_bevestigd_at.sql)
--
-- HST eist een telefoonnummer voor "bellen voor aflevering". De payload-builder
-- stuurde dit veld altijd leeg → ACCP-afkeuring 2026-06-09. We snapshotten het
-- leveringstelefoonnummer op de zending zodat hst-send het meestuurt.
--
-- Bron-ladder: orders.afl_telefoon (leveringscontact, mig 084) → fallback
-- debiteuren.telefoon. Via BEFORE INSERT-trigger zodat élke zending-aanmaakroute
-- (start_pickronden, create_zending_voor_order, bundel) hem vult zonder die
-- functies te herschrijven.
--
-- Idempotent.

ALTER TABLE zendingen ADD COLUMN IF NOT EXISTS afl_telefoon TEXT;

COMMENT ON COLUMN zendingen.afl_telefoon IS
  'Snapshot leveringstelefoonnummer voor de vervoerder (HST belt vóór aflevering). '
  'Gevuld door trg_zending_fill_telefoon: orders.afl_telefoon → fallback debiteuren.telefoon.';

CREATE OR REPLACE FUNCTION fn_zending_fill_telefoon() RETURNS TRIGGER AS $$
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_telefoon, '')), '')
    INTO NEW.afl_telefoon
    FROM orders o
   WHERE o.id = NEW.order_id;

  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NULL THEN
    SELECT NULLIF(TRIM(COALESCE(d.telefoon, '')), '')
      INTO NEW.afl_telefoon
      FROM orders o
      JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     WHERE o.id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zending_fill_telefoon ON zendingen;
CREATE TRIGGER trg_zending_fill_telefoon
  BEFORE INSERT ON zendingen
  FOR EACH ROW EXECUTE FUNCTION fn_zending_fill_telefoon();

-- Backfill: bestaande zendingen die nog niet verstuurd zijn, alsnog vullen.
UPDATE zendingen z
   SET afl_telefoon = COALESCE(
         NULLIF(TRIM(COALESCE(o.afl_telefoon, '')), ''),
         NULLIF(TRIM(COALESCE(d.telefoon, '')), '')
       )
  FROM orders o
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
 WHERE o.id = z.order_id
   AND NULLIF(TRIM(COALESCE(z.afl_telefoon, '')), '') IS NULL
   AND z.status NOT IN ('Onderweg', 'Afgeleverd');

NOTIFY pgrst, 'reload schema';
