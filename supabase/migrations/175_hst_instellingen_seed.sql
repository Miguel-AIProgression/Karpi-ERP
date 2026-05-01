-- Migratie 175: HST-instellingen seed (acceptatie-omgeving)
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md (Fase A — data-seed)
--
-- Bron: e-mailcorrespondentie 2026-02-26 t/m 2026-03-02
--   - Niek Zandvoort (HST Groep) → Wilfred Brink (Array1), 2026-03-02 13:31
--   - Thom ten Brinke (Karpi) → Niek/Wilfred, 2026-02-26 17:53
--   Bestand: docs/logistiek/hst-api/ (te archiveren in Fase 0)
--
-- Vult de bekende velden op de bestaande hst_api-rij (toegevoegd in mig 170).
-- LET OP: API-credentials (username/wachtwoord) staan NIET in deze tabel —
-- die horen in Supabase Vault als HST_API_USERNAME / HST_API_WACHTWOORD.
--
-- `actief` blijft bewust FALSE — pas TRUE zetten na succesvolle cutover-test
-- volgens Fase 4 van het logistiek-hst-plan.
--
-- Idempotent: UPDATE-statement, geen INSERT (rij bestaat al sinds mig 170).

UPDATE vervoerders
   SET api_endpoint     = 'https://accp.hstonline.nl/rest/api/v1',
       api_customer_id  = '038267',
       account_nummer   = NULL,                       -- nog niet bevestigd of klant-/account-nr afwijkt van API CustomerID; checken bij eerstvolgend contact
       kontakt_naam     = 'Niek Zandvoort',
       kontakt_email    = 'n.zandvoort@hst.nl',
       kontakt_telefoon = NULL,                       -- intern toestel 237; HST hoofdnummer nog te achterhalen
       tarief_notities  = NULL,                       -- nog niet ontvangen; tijdens eerste maand Fase A verzamelen en hier invullen
       notities         = concat_ws(E'\n\n',
         'OMGEVING: dit zijn ACCEPTATIE-credentials (api_endpoint accp.hstonline.nl). Productie-credentials volgen pas NA succesvolle cutover-test — dan ook api_endpoint omzetten naar productie-host en `actief = TRUE` zetten.',
         'CONTACT HST: Niek Zandvoort, HST Groep, intern toestel 237. E-mail: n.zandvoort@hst.nl. HST-hoofdnummer telefonisch nog op te vragen.',
         'INTEGRATIE-CONTACT (extern): Wilfred Brink (Array1) <wilfred@array1.nl>, +31 6 8359 9005 — projectmanager voor de koppelinginrichting.',
         'WEB-PORTAAL voor zending-monitoring: https://accp.hstonline.nl (login: wilfred@array1.nl). API-doc: https://accp.hstonline.nl/restdoc/rest/api/v1#/',
         'VERZENDETIKET-EIS: HST scant de SSCC-barcode op het etiket dat Karpi zelf print en plakt. Etiket moet depotnummer rechtsboven in de hoek hebben. Voorbeeld-etiket en SSCC-format in mailbijlage 2026-02-26.',
         'GLN Karpi (afzender op etiket): 8715954999998. CustomerID HST voor Karpi: 038267.'
       )
 WHERE code = 'hst_api';

-- Verificatie:
--   SELECT code, api_endpoint, api_customer_id, kontakt_naam, kontakt_email, actief
--     FROM vervoerders WHERE code = 'hst_api';
--
--   SELECT notities FROM vervoerders WHERE code = 'hst_api';
