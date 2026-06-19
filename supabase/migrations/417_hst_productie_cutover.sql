-- Migratie 417: HST acceptatie -> productie cutover (UI-referentie)
-- Datum: 2026-06-17
--
-- Context: HST is sinds mig 336-339 de actieve NL-default vervoerder
-- (vervoerders.actief=TRUE, is_default=TRUE; catch-all selectie-regel id 13).
-- De koppeling draaide echter nog tegen de ACCEPTATIE-omgeving (accp.hstonline.nl).
-- HST heeft de productie-koppeling vrijgegeven (2026-06-17); we zetten het
-- effectieve endpoint + wachtwoord om naar productie.
--
-- BELANGRIJK: het EFFECTIEVE endpoint dat `hst-send` gebruikt komt uit de
-- Supabase secret HST_API_BASE_URL (zie database-schema.md: api_endpoint is
-- read-only UI-referentie). De echte cutover bestaat dus uit twee secrets die
-- BUITEN git in het Supabase-dashboard gezet zijn (NIET hier committen):
--   HST_API_BASE_URL   = https://portal.hstonline.nl/rest/api/v1
--   HST_API_WACHTWOORD = <productie-wachtwoord>
-- HST_API_USERNAME (karpi_array1_api_user) en HST_API_CUSTOMER_ID (038267)
-- blijven ongewijzigd t.o.v. acceptatie (digest-bevestigd).
--
-- Deze migratie houdt alleen de UI-referentiekolom + de OMGEVING-notitie in sync
-- met de live productie-staat. Idempotent: UPDATE op de bestaande hst_api-rij.

UPDATE vervoerders
   SET api_endpoint = 'https://portal.hstonline.nl/rest/api/v1',
       notities = regexp_replace(
         notities,
         '^OMGEVING:.*?\n\n',
         E'OMGEVING: PRODUCTIE sinds 2026-06-17 (api_endpoint portal.hstonline.nl). Effectieve endpoint + wachtwoord staan als Supabase secrets HST_API_BASE_URL / HST_API_WACHTWOORD; username en CustomerID ongewijzigd t.o.v. acceptatie.\n\n'
       )
 WHERE code = 'hst_api';

-- Verificatie:
--   SELECT code, api_endpoint, actief, is_default,
--          split_part(notities, E'\n\n', 1) AS omgeving
--     FROM vervoerders WHERE code = 'hst_api';
