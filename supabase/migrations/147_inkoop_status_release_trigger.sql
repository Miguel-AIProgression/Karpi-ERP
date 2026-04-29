-- Migratie 147: trigger op inkooporders bij Geannuleerd
--
-- Bij IO-status → 'Geannuleerd': release_claims_voor_io_regel voor elke regel
-- van die IO. Bij verwacht_datum-wijziging: niets (levertijd is afgeleid via view).
--
-- Status terug van Concept → Besteld: claims worden later weer aangemaakt
-- zodra een orderregel-mutatie de allocator opnieuw triggert. Géén proactieve
-- her-allocatie hier (te veel werk; we accepteren dat orders die al "Wacht op
-- nieuwe inkoop" zijn pas opnieuw alloceren als ze worden bewerkt).

CREATE OR REPLACE FUNCTION trg_inkooporder_status_release()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.status = 'Geannuleerd' AND OLD.status <> 'Geannuleerd' THEN
    FOR v_regel_id IN
      SELECT id FROM inkooporder_regels WHERE inkooporder_id = NEW.id
    LOOP
      PERFORM release_claims_voor_io_regel(v_regel_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inkooporder_status_release ON inkooporders;
CREATE TRIGGER trg_inkooporder_status_release
  AFTER UPDATE ON inkooporders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_inkooporder_status_release();

COMMENT ON FUNCTION trg_inkooporder_status_release IS
  'Release alle claims op IO-regels wanneer de IO naar Geannuleerd schuift. '
  'Getroffen orderregels worden opnieuw gealloceerd via herallocateer_orderregel. Migratie 147.';
