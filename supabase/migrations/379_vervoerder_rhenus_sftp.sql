-- Migratie 379: vervoerder rhenus_sftp + selectie-regel-omhang + app_config 'rhenus'
-- Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
-- ADR-0032: Rhenus via GS1 TransportInstruction-XML over SFTP (niet Transus-EDI).
--
-- NB hernummering 12-06: in de live DB gedraaid onder de naam 378_* (vóór de
-- merge bleek origin/main een eigen 378 te hebben — klant_omzet_ytd).
--
-- Idempotent. Vereist mig 374 (vervoerders_type_check kent 'sftp').

-- 1. Nieuwe vervoerder. actief=FALSE tot de rondreis-test met Rhenus slaagt —
--    activeren IS de week 24-cutover: de omgehangen selectie-regels (stap 2)
--    routeren DE-zendingen dan direct via Rhenus.
INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
  ('rhenus_sftp', 'Rhenus', 'sftp', FALSE,
   'Rhenus — GS1 TransportInstruction-XML (RHE 3.1) via SFTP sedi.de.rhenus.com, /in-map (ADR-0032). '
   'actief pas na geslaagde rondreis-test (= week 24-cutover). '
   'Config: app_config sleutel ''rhenus''; secrets RHENUS_SFTP_* + RHENUS_DRY_RUN.')
ON CONFLICT (code) DO NOTHING;

-- 2. Live selectie-regels omhangen vóór de placeholder-delete (zelfde reden
--    als het mig 374-amendement: de FK op vervoerder_selectie_regels
--    cascadeert bij DELETE en deze regels zijn productie-data):
--    DE + <=30 kg + kleinste zijde >=131 -> Rhenus, plus de debiteur-pins.
UPDATE vervoerder_selectie_regels
   SET vervoerder_code = 'rhenus_sftp'
 WHERE vervoerder_code = 'edi_partner_a';

-- 3. Placeholder edi_partner_a ('Rhenus', type edi, mig 170) opruimen.
--    Guarded: blijft staan als er tóch ergens een NO ACTION-FK naar wijst.
DO $$
BEGIN
  BEGIN
    DELETE FROM vervoerders WHERE code = 'edi_partner_a';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'edi_partner_a wordt nog gerefereerd - blijft staan';
  END;
END $$;

-- 4. Runtime-config voor de XML-builder (rhenus-send leest dit record per
--    run — wijziging = SQL-UPDATE, geen redeploy).
--    sscc_met_00_prefix: <sscc> = AI(00)+SSCC (20 cijfers, zoals legacy én label).
--    package_type_code:  default verpakkingscode (legacy: RLEN/COLL/PLTS/HPLT).
--    bestandsnaam_prefix: eerste segment van de bestandsnaam op de SFTP.
INSERT INTO app_config (sleutel, waarde)
VALUES ('rhenus', jsonb_build_object(
  'sscc_met_00_prefix',  TRUE,
  'package_type_code',   'RLEN',
  'bestandsnaam_prefix', 'RHE'
))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
