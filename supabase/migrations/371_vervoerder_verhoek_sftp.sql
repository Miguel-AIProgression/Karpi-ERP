-- Migratie 371: vervoerder verhoek_sftp + type 'sftp' + app_config 'verhoek'
-- Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md
-- ADR-0031: Verhoek via eigen AA2.0-XML over SFTP (niet Transus-EDI).
--
-- Idempotent.

-- 1. CHECK-constraint uitbreiden met 'sftp' (mig 170: api/edi; mig 207: +print)
ALTER TABLE vervoerders DROP CONSTRAINT IF EXISTS vervoerders_type_check;
ALTER TABLE vervoerders ADD CONSTRAINT vervoerders_type_check
  CHECK (type IN ('api', 'edi', 'print', 'sftp'));

-- 2. Nieuwe vervoerder. actief=FALSE tot de rondreis-test met Verhoek slaagt.
INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
  ('verhoek_sftp', 'Verhoek', 'sftp', FALSE,
   'Verhoek Europe — AA2.0-XML via SFTP (ADR-0031). actief pas na geslaagde rondreis-test. '
   'Pilot: alleen handmatige override per orderregel, geen selectie-regels. '
   'Config: app_config sleutel ''verhoek''; secrets VERHOEK_SFTP_* + VERHOEK_DRY_RUN.')
ON CONFLICT (code) DO NOTHING;

-- 3. Placeholder edi_partner_b ('Verhoek', type edi, mig 170) opruimen.
--    Guarded tegen NO ACTION-FK's (zendingen, edi_handelspartner_config);
--    let op: selectie-regels cascaden en orderregel-overrides worden NULL —
--    acceptabel voor deze altijd-inactieve placeholder.
DO $$
BEGIN
  BEGIN
    DELETE FROM vervoerders WHERE code = 'edi_partner_b';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'edi_partner_b wordt nog gerefereerd - blijft staan';
  END;
END $$;

-- 4. Runtime-config voor de XML-builder (ADR-0031: antwoorden van Verhoek =
--    SQL-UPDATE hier, géén redeploy — verhoek-send leest dit record per run).
--    opdrachtgever_nummer '' = nog onbekend; verhoek-send weigert echte
--    (niet-dry-run) verzending zolang dit leeg is.
INSERT INTO app_config (sleutel, waarde)
VALUES ('verhoek', jsonb_build_object(
  'opdrachtgever_nummer',   '',
  'scancode_met_00_prefix', TRUE,
  'verpakkingseenheid',     'Rol',
  'levering',               '1',
  'soort_levering',         '1'
))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
