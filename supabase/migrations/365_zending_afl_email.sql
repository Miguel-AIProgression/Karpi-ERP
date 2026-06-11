-- Migratie 365: zendingen.afl_email (track & trace-contact voor de vervoerder) + vul-trigger
-- (hernummerd van 362 → 365 vóór merge: origin/main nam parallel 362-364 in
--  beslag, waaronder 364_order_email_snapshots.sql dat orders.afl_email vult)
--
-- Aanleiding (mail Piet-Hein/Marjon 11-06-2026): het order-formulier vult sinds
-- mig 364 automatisch een apart e-mailadres voor factuur én aflevering. Het
-- aflever-e-mailadres (orders.afl_email, mig 084) is bedoeld voor track & trace
-- richting de klant — de vervoerder mag dáár naartoe mailen, NIET naar het
-- factuur-adres. We snapshotten het op de zending zodat hst-send (en toekomstige
-- vervoerder-koppelingen) het meesturen in ToAddress.Email.
--
-- Bron: uitsluitend orders.afl_email. Bewust GEEN fallback naar
-- debiteuren.email_factuur/email_overig — een factuur-adres mag nooit als
-- T&T-adres bij de vervoerder belanden (dat is precies de scheiding die
-- Sales Support vroeg). Leeg aflever-e-mailadres = geen T&T-mail, geen fout.
--
-- Zelfde patroon als mig 339 (afl_telefoon): BEFORE INSERT-trigger zodat élke
-- zending-aanmaakroute (start_pickronden, create_zending_voor_order, bundel)
-- hem vult zonder die functies te herschrijven.
--
-- Idempotent.

ALTER TABLE zendingen ADD COLUMN IF NOT EXISTS afl_email TEXT;

COMMENT ON COLUMN zendingen.afl_email IS
  'Snapshot aflever-e-mailadres voor de vervoerder (track & trace naar de klant). '
  'Gevuld door trg_zending_fill_email uit orders.afl_email. Bewust géén fallback '
  'naar factuur-e-mailadressen.';

CREATE OR REPLACE FUNCTION fn_zending_fill_email() RETURNS TRIGGER AS $$
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_email, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_email, '')), '')
    INTO NEW.afl_email
    FROM orders o
   WHERE o.id = NEW.order_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zending_fill_email ON zendingen;
CREATE TRIGGER trg_zending_fill_email
  BEFORE INSERT ON zendingen
  FOR EACH ROW EXECUTE FUNCTION fn_zending_fill_email();

-- Backfill: bestaande zendingen die nog niet verstuurd zijn, alsnog vullen.
UPDATE zendingen z
   SET afl_email = NULLIF(TRIM(COALESCE(o.afl_email, '')), '')
  FROM orders o
 WHERE o.id = z.order_id
   AND NULLIF(TRIM(COALESCE(z.afl_email, '')), '') IS NULL
   AND z.status NOT IN ('Onderweg', 'Afgeleverd');

NOTIFY pgrst, 'reload schema';
