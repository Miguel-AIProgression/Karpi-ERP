-- Migratie 412: per-orderregel vroegst_leverbaar
--
-- Doel: operator kan per orderregel zien wanneer die regel uiterlijk
-- beschikbaar is voor verzending, zodat hij een handmatige deelzending
-- kan starten voor regels die eerder klaar zijn dan de rest van de order.
--
-- Bedrijfsregel (afgesproken):
--   - Order-afleverdatum = MAX van alle regeldata (ongewijzigd)
--   - Deelzending is altijd HANDMATIG door operator (niet auto)
--   - vroegst_leverbaar = informatief, vult allocator via trigger
--
-- Idempotent.

-- ============================================================================
-- 1. Kolom op order_regels
-- ============================================================================
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS vroegst_leverbaar DATE;

COMMENT ON COLUMN order_regels.vroegst_leverbaar IS
  'Wanneer kan DEZE regel (onafhankelijk van de rest van de order) worden '
  'verzonden op basis van actieve claims. NULL = geen dekking (wacht op inkoop '
  'zonder IO). Gevuld door trigger trg_regel_vroegst_leverbaar na claim-mutaties. '
  'Eerder dan verzendweek_voor_datum(orders.afleverdatum) = kandidaat voor '
  'handmatige deelzending. Migratie 412.';

-- ============================================================================
-- 2. Bereken-functie: vroegst_leverbaar voor één orderregel
--
-- Logica:
--   a. Maatwerk-regel (is_maatwerk=TRUE) → NULL (snijplanning bepaalt timing)
--   b. Geen actieve claims → NULL (wacht op inkoop zonder IO)
--   c. Alleen voorraad-claims → CURRENT_DATE (nu leverbaar)
--   d. IO-claims aanwezig → MAX(io.verwacht_datum) + inkoop_buffer_weken_vast × 7
--      (de IO bepaalt het langste wachten, ook als er ook voorraad-claims zijn
--       voor een gedeelte — je kunt pas de hele regel verzenden als alles klaar is)
-- ============================================================================
CREATE OR REPLACE FUNCTION bereken_vroegst_leverbaar(p_order_regel_id BIGINT)
RETURNS DATE
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_is_maatwerk    BOOLEAN;
  v_heeft_voorraad BOOLEAN;
  v_max_io_datum   DATE;
  v_buffer_dagen   INTEGER;
BEGIN
  SELECT COALESCE(is_maatwerk, FALSE)
    INTO v_is_maatwerk
    FROM order_regels
   WHERE id = p_order_regel_id;

  -- Maatwerk: timing ligt bij snijplanning, niet bij IO-claims
  IF v_is_maatwerk OR v_is_maatwerk IS NULL THEN
    RETURN NULL;
  END IF;

  -- Inkoop-buffer (default 1 week = 7 dagen)
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
    INTO v_buffer_dagen
    FROM app_config
   WHERE sleutel = 'order_config';
  v_buffer_dagen := COALESCE(v_buffer_dagen, 7);

  -- IO-claims aanwezig?
  SELECT MAX(io.verwacht_datum)
    INTO v_max_io_datum
    FROM order_reserveringen rsv
    JOIN inkooporder_regels ior ON ior.id = rsv.inkooporder_regel_id
    JOIN inkooporders io ON io.id = ior.inkooporder_id
   WHERE rsv.order_regel_id = p_order_regel_id
     AND rsv.bron = 'inkooporder_regel'
     AND rsv.status = 'actief';

  IF v_max_io_datum IS NOT NULL THEN
    -- IO-datum inclusief buffer = vroegst leverbaar vanuit inkoop
    RETURN v_max_io_datum + v_buffer_dagen;
  END IF;

  -- Voorraad-claim aanwezig?
  SELECT EXISTS(
    SELECT 1 FROM order_reserveringen
     WHERE order_regel_id = p_order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
  ) INTO v_heeft_voorraad;

  IF v_heeft_voorraad THEN
    RETURN CURRENT_DATE;
  END IF;

  -- Geen dekking
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION bereken_vroegst_leverbaar(BIGINT) IS
  'Berekent de vroegste verzenddatum voor één orderregel op basis van actieve '
  'claims. NULL = geen dekking. CURRENT_DATE = voorraad. IO-datum+buffer = '
  'inkooporder. Maatwerk-regels geven altijd NULL. Migratie 412.';

-- ============================================================================
-- 3. Trigger: update vroegst_leverbaar na claim-mutaties
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_regel_vroegst_leverbaar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  v_regel_id := COALESCE(NEW.order_regel_id, OLD.order_regel_id);
  IF v_regel_id IS NOT NULL THEN
    UPDATE order_regels
       SET vroegst_leverbaar = bereken_vroegst_leverbaar(v_regel_id)
     WHERE id = v_regel_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_regel_vroegst_leverbaar ON order_reserveringen;
CREATE TRIGGER trg_regel_vroegst_leverbaar
  AFTER INSERT OR UPDATE OF status, bron, inkooporder_regel_id
       OR DELETE
  ON order_reserveringen
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_regel_vroegst_leverbaar();

-- ============================================================================
-- 4. Backfill: bereken voor alle actieve regelels (best-effort, grote orders
--    overgeslagen als te_leveren=0 of maatwerk)
-- ============================================================================
UPDATE order_regels ore
   SET vroegst_leverbaar = bereken_vroegst_leverbaar(ore.id)
 WHERE EXISTS (
   SELECT 1 FROM order_reserveringen rsv
    WHERE rsv.order_regel_id = ore.id
      AND rsv.status = 'actief'
 )
   AND COALESCE(ore.is_maatwerk, FALSE) = FALSE;

NOTIFY pgrst, 'reload schema';
