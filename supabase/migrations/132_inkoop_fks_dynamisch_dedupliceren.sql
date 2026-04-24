-- Migration 132: Dynamisch dedupliceren van FK-constraints (inkoop-module)
--
-- Migratie 131 droppte FK's op naam, maar blijkt de eerste FK niet (volledig)
-- te hebben verwijderd — PostgREST toont nog steeds PGRST201.
-- Deze migratie loopt over pg_constraint en verwijdert elke extra FK boven de
-- eerste voor elke (tabel, kolommen, doeltabel)-combi. Robuust ongeacht namen.
--
-- Idempotent.

DO $$
DECLARE
  rec RECORD;
  teller INTEGER;
BEGIN
  -- Voor elke (tabel, doeltabel, kolomvector) tel het aantal FK's; houd 1 over.
  FOR rec IN
    SELECT
      c.conrelid::regclass::text AS tabel,
      c.confrelid::regclass::text AS doeltabel,
      c.conkey AS kolommen,
      c.conname AS constraint_naam,
      c.oid
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid::regclass::text IN ('inkooporders', 'inkooporder_regels', 'rollen')
    ORDER BY c.conrelid, c.confrelid, c.conkey, c.oid
  LOOP
    -- Tel hoeveel FK's er al zijn op dezelfde (tabel, doeltabel, kolommen) MET EEN LAGERE oid
    SELECT COUNT(*)
      INTO teller
      FROM pg_constraint c2
     WHERE c2.contype = 'f'
       AND c2.conrelid = (SELECT conrelid FROM pg_constraint WHERE oid = rec.oid)
       AND c2.confrelid = (SELECT confrelid FROM pg_constraint WHERE oid = rec.oid)
       AND c2.conkey = rec.kolommen
       AND c2.oid < rec.oid;

    -- Als er al een FK met dezelfde definitie bestaat (lagere oid), drop deze.
    IF teller >= 1 THEN
      RAISE NOTICE 'DROP duplicaat FK: % op % -> %', rec.constraint_naam, rec.tabel, rec.doeltabel;
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', rec.tabel, rec.constraint_naam);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
