-- Migration 095: orders_list view uitbreiden met heeft_unmatched_regels + bron_*.
--
-- Context: frontend `OrdersTable` gebruikt de view `orders_list` voor de
-- orderlijst. Views hebben een bevroren kolomlijst op creation-moment,
-- dus nieuwe kolommen op `orders` (migratie 092 + 094) verschijnen niet
-- automatisch. We herbouwen de view om deze velden te exposen voor de
-- "Actie vereist"-badge in de UI.
--
-- Huidige surfacen kolommen (empirisch):
--   id, order_nr, oud_order_nr, debiteur_nr, klant_referentie,
--   orderdatum, afleverdatum, status, aantal_regels, totaal_bedrag,
--   totaal_gewicht, vertegenw_code, klant_naam
--
-- Toegevoegd: heeft_unmatched_regels, bron_systeem, bron_shop
--
-- DROP + CREATE i.p.v. CREATE OR REPLACE: bij kolom-toevoeging eist
-- Postgres dat alle bestaande kolommen met identiek type/volgorde
-- blijven — bij afwijking geeft REPLACE een 42P16 fout.

DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop
FROM orders o
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. heeft_unmatched_regels + bron_* voor webshop-herkenning en actie-vereist-badge (migratie 095).';
