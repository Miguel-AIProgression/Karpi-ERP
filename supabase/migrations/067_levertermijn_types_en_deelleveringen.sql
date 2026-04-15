-- Migration 067: levertermijn per type + deelleveringen toggle
--
-- Vervangt `standaard_levertermijn_weken` door twee aparte velden:
--   - standaard_maat_werkdagen: levertermijn voor standaard-maat karpetten (uit voorraad)
--   - maatwerk_weken: levertermijn voor maatwerk karpetten (gesneden + geconfectioneerd)
-- Voegt `deelleveringen_toegestaan` boolean toe: als TRUE wordt een gemengde
-- order bij aanmaak gesplitst in 2 orders (standaard + maatwerk).

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS standaard_maat_werkdagen INTEGER,
  ADD COLUMN IF NOT EXISTS maatwerk_weken INTEGER,
  ADD COLUMN IF NOT EXISTS deelleveringen_toegestaan BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.standaard_maat_werkdagen IS
  'Override levertermijn voor standaard-maat (kalenderdagen). NULL = globale default uit app_config.order_config.';
COMMENT ON COLUMN debiteuren.maatwerk_weken IS
  'Override levertermijn voor maatwerk (weken). NULL = globale default uit app_config.order_config.';
COMMENT ON COLUMN debiteuren.deelleveringen_toegestaan IS
  'Als TRUE: gemengde orders worden bij aanmaak gesplitst in standaard + maatwerk deelorder.';

-- Migreer eventuele bestaande klant-overrides naar het nieuwe maatwerk-veld
UPDATE debiteuren SET maatwerk_weken = standaard_levertermijn_weken
 WHERE standaard_levertermijn_weken IS NOT NULL;

ALTER TABLE debiteuren DROP COLUMN IF EXISTS standaard_levertermijn_weken;

-- Update globale config (vervang oude single-value structuur)
UPDATE app_config
   SET waarde = jsonb_build_object('standaard_maat_werkdagen', 5, 'maatwerk_weken', 4)
 WHERE sleutel = 'order_config';

INSERT INTO app_config (sleutel, waarde)
VALUES ('order_config', jsonb_build_object('standaard_maat_werkdagen', 5, 'maatwerk_weken', 4))
ON CONFLICT (sleutel) DO NOTHING;
