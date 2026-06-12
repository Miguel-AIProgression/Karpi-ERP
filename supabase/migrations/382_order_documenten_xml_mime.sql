-- Migratie 382: application/xml + text/xml toestaan in bucket order-documenten
-- Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
-- NB hernummering 12-06: in de live DB gedraaid onder de naam 381_*.
--
-- Gevonden tijdens de Rhenus-dry-run-rondreis (12-06): de XML-kopie naar
-- storage (rhenus-xml/ en verhoek-xml/, best-effort in rhenus-send en
-- verhoek-send) faalde met 415 invalid_mime_type — de allowlist van mig 178
-- kende alleen PDF/afbeeldingen/Office/text. De keten zelf werkte gewoon
-- door (kopie is bewust best-effort), maar de storage-audit ontbrak.
--
-- Idempotent: voegt alleen toe wat nog ontbreekt.

UPDATE storage.buckets
   SET allowed_mime_types = (
     SELECT ARRAY(
       SELECT DISTINCT t FROM unnest(
         allowed_mime_types || ARRAY['application/xml', 'text/xml']
       ) AS t
     )
   )
 WHERE id = 'order-documenten';
