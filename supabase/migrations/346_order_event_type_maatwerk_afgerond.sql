-- Migratie 346: enum-waarde 'maatwerk_afgerond' op order_event_type
--
-- Voorbereiding voor mig 347: voltooi_confectie gaat de terminale transitie
-- naar 'Maatwerk afgerond' (productie-only orders, mig 330) via _apply_transitie
-- schrijven i.p.v. een directe UPDATE — daar hoort een eigen event-type bij
-- zodat de audit-trail compleet is en toekomstige listeners (ADR-0006/0015-
-- patroon) erop kunnen aanhaken.
--
-- BEWUST een eigen migratie: een nieuwe enum-waarde mag in PostgreSQL niet
-- in dezelfde transactie GEBRUIKT worden als waarin hij is toegevoegd.
-- Mig 347 (de functie-wijziging) dus apart draaien, ná deze.
--
-- Idempotent: ADD VALUE IF NOT EXISTS.

ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'maatwerk_afgerond';

-- Zelf-test: catalogus-check (géén gebruik van de waarde — dat mag niet in
-- dezelfde transactie).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'order_event_type'::regtype
       AND enumlabel = 'maatwerk_afgerond'
  ) THEN
    RAISE EXCEPTION 'Mig 346: enum-waarde maatwerk_afgerond ontbreekt op order_event_type';
  END IF;
  RAISE NOTICE 'Mig 346: order_event_type bevat maatwerk_afgerond';
END $$;
