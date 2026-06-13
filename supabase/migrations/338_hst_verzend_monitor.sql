-- Migratie 338: observability-views voor HST-verzending
--
-- hst_verzend_monitor: één rij met vandaag-tellingen per status + de leeftijd
-- van de oudste Wachtrij/Bezig-rij. Die leeftijden zijn het cron-health-signaal:
-- loopt oudste_wachtrij_minuten op boven de drempel (UI: 5 min) → cron staat stil.
--
-- orders_zonder_vervoerder: niet-afhaal-orders met >=1 regel zonder vervoerder
-- (bron='geen', buiten HST-bereik). Voedt de "handmatig kiezen"-teller.
--
-- Idempotent.

CREATE OR REPLACE VIEW hst_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::INT AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::INT                                       AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::INT                                   AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::INT                                      AS bezig,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60,
    0)::INT                                                                          AS oudste_wachtrij_minuten,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig'))) / 60,
    0)::INT                                                                          AS oudste_bezig_minuten
FROM hst_transportorders;

COMMENT ON VIEW hst_verzend_monitor IS
  'Mig 338: aggregaat-observability voor HST-verzending. oudste_wachtrij_minuten = '
  'cron-health-signaal (hoog = cron staat stil). Eén rij, geen state.';

GRANT SELECT ON hst_verzend_monitor TO authenticated;

CREATE OR REPLACE VIEW orders_zonder_vervoerder AS
SELECT DISTINCT o.id AS order_id, o.order_nr, o.debiteur_nr, o.afl_land, o.afl_plaats
  FROM orders o
 WHERE COALESCE(o.afhalen, FALSE) = FALSE
   AND o.status NOT IN ('Geannuleerd', 'Verzonden', 'Concept')
   AND EXISTS (
     SELECT 1
       FROM effectieve_vervoerder_per_orderregel(o.id) e
      WHERE e.bron = 'geen'
   );

COMMENT ON VIEW orders_zonder_vervoerder IS
  'Mig 338: niet-afhaal-orders met >=1 regel zonder vervoerder (buiten HST-bereik). '
  'Voedt de "handmatig vervoerder kiezen"-teller/banner.';

GRANT SELECT ON orders_zonder_vervoerder TO authenticated;

NOTIFY pgrst, 'reload schema';
