-- View that joins orders with debiteur naam (avoids PostgREST FK ambiguity)
CREATE OR REPLACE VIEW public.orders_list AS
SELECT
    o.id, o.order_nr, o.oud_order_nr, o.debiteur_nr, o.klant_referentie,
    o.orderdatum, o.afleverdatum, o.status, o.aantal_regels, o.totaal_bedrag,
    o.totaal_gewicht, o.vertegenw_code,
    d.naam AS klant_naam
FROM orders o
JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;
