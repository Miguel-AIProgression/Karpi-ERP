-- Migratie 556: Combi-levering — twee nieuwe booleans (ADR-0039)
-- (hernummerd van 485 — collisie met de al-gemergde HST-colli-bundeling-pallet
-- feature op origin/main, zelfde nummer. Alleen bestandsnaam + interne
-- commentaren bijgewerkt; al toegepast op de live DB onder het oude nummer,
-- zie CLAUDE.md-conventie "Migratienummer-collisie bij merge".)
--
-- `debiteuren.combi_levering`: klant-instelling — wacht met verzenden tot de
-- gecombineerde openstaande orders naar hetzelfde adres de vrachtvrije-drempel
-- (verzend_drempel) bereiken, i.p.v. direct verzendkosten te rekenen op een
-- individuele order onder de drempel.
-- `orders.combi_levering_override`: order-niveau escape — klant wil dít
-- exemplaar toch los verzonden, met verzendkosten, ongeacht de klant-instelling.
--
-- Zie ADR-0039 (docs/adr/0039-combi-levering-als-startbaarheid-gate.md).

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS combi_levering BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.combi_levering IS
  'Mig 556 (ADR-0039): klant wil wachten met verzenden tot de gecombineerde '
  'openstaande orders naar hetzelfde adres de vrachtvrije-drempel '
  '(verzend_drempel) bereiken. No-op als gratis_verzending al TRUE is.';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS combi_levering_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.combi_levering_override IS
  'Mig 556 (ADR-0039): klant wil dít exemplaar toch los verzonden, met '
  'verzendkosten, ongeacht debiteuren.combi_levering. Analoog aan afhalen '
  '(mig 204) — instelbaar in het order-form.';

NOTIFY pgrst, 'reload schema';
