-- Migration 091: Verzameldebiteur "Floorpassion" voor webshop-integratie
--
-- Context: Karpi heeft twee Lightspeed eCom webshops (NL + DE, beide
-- floorpassion.*). Alle webshop-orders landen onder één verzameldebiteur
-- in RugFlow. De particuliere eindkoper wordt alléén als leveradres-
-- snapshot op de order vastgelegd — conform de bestaande snapshot-
-- architectuur (orders hebben geen FK naar afleveradressen).
--
-- Keuze debiteur_nr = 99001: hoog genoeg om niet te botsen met legacy-
-- nummers uit het oude systeem. Idempotent via ON CONFLICT zodat
-- herhaaldelijk toepassen veilig is.
--
-- Gebruik:
--   - Edge function `sync-webshop-order` (fase 1) leest FLOORPASSION_DEBITEUR_NR
--     uit env en zet deze waarde in orders.debiteur_nr bij elke
--     webshop-order. Vul dus 99001 in als waarde in supabase/functions/.env.

INSERT INTO debiteuren (
  debiteur_nr,
  naam,
  status,
  adres,
  postcode,
  plaats,
  land,
  email_factuur,
  afleverwijze,
  deelleveringen_toegestaan
) VALUES (
  99001,
  'FLOORPASSION WEBSHOP',
  'Actief',
  NULL,
  NULL,
  NULL,
  'NL',
  NULL,
  'Bezorgen',
  FALSE
)
ON CONFLICT (debiteur_nr) DO NOTHING;

COMMENT ON TABLE debiteuren IS
  'Klanten/afnemers. PK = debiteur_nr uit oud systeem. Synthetische rij 99001 = FLOORPASSION WEBSHOP verzameldebiteur voor Lightspeed eCom integratie (zie migratie 091).';
