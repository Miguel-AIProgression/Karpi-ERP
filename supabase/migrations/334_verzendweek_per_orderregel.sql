-- Migratie 334: verzendweek per orderregel
--
-- Voegt een handmatig instelbare verzendweek toe aan order_regels zodat
-- operators per regel kunnen vastleggen wanneer dit artikel de deur uitgaat.
--
-- Logica in de frontend:
--   - voorraad-regel, geen override → "week na orderdatum" (auto-computed)
--   - niet-voorradig, geen override → leeg (operator moet handmatig invullen)
--   - override ingevuld → toon die week (bold)
--
-- Format: ISO-weekstring 'YYYY-Www', bijv. '2026-W25' — consistent met
-- verzendweek_voor_datum() en bundel-sleutel (mig 228).

ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS verzendweek TEXT;

COMMENT ON COLUMN order_regels.verzendweek IS
  'Handmatige verzendweek-override per regel (''YYYY-Www''). NULL = auto-computed '
  'in frontend (voorraad → week na orderdatum, inkoop → verwachte IO-leverweek).';

-- RPC om verzendweek per regel in te stellen (of te wissen bij NULL)
CREATE OR REPLACE FUNCTION set_regel_verzendweek(
  p_regel_id  BIGINT,
  p_verzendweek TEXT   -- NULL = reset naar auto
)
RETURNS VOID AS $$
BEGIN
  UPDATE order_regels
     SET verzendweek = p_verzendweek
   WHERE id = p_regel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_regel_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION set_regel_verzendweek(BIGINT, TEXT) IS
  'Stel handmatige verzendweek in voor een orderregel (mig 334). '
  'NULL-aanroep reset naar auto-berekening in de frontend.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 334 toegepast: order_regels.verzendweek + set_regel_verzendweek RPC.';
END $$;
