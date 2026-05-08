-- Migratie 227: vervoerder-keuze — drop klant-fallback-kolom + bulk-override-RPC
--
-- ADR-0008. Volgt op mig 224 (data-migratie) en mig 225 (ladder versimpelen).
-- (Mig 226 is bezet door facturatie-drain-hotfix; dit wordt mig 227.)
-- Pas op DIT moment is het veilig om de kolom te droppen — alle leeskanten
-- gebruiken sinds mig 225 geen edi_handelspartner_config.vervoerder_code meer.
--
-- LOCK-WAARSCHUWING: ALTER TABLE … DROP COLUMN pakt een AccessExclusiveLock op
-- edi_handelspartner_config voor de duur van de operatie. De tabel is klein
-- (39 partner-rijen) dus de DROP zelf is sub-seconde, maar tijdens busy hours
-- (EDI-poll-cycli) kan een korte wachtrij ontstaan. Veiligheidsklep:
-- `SET LOCAL lock_timeout = '3s'` — mig faalt liever dan te hangen als een
-- andere transactie de tabel al langdurig lockt. Herprobeeer in dat geval
-- tijdens een rustig moment.
--
-- Stappen:
--   1. DROP de oude index + kolom edi_handelspartner_config.vervoerder_code
--      (met SET LOCAL lock_timeout = '3s' vóór de DROP)
--   2. DROP function preview_vervoerder_voor_order (mig 215) — vervangen door
--      frontend-aggregatie van effectieve_vervoerder_per_orderregel
--   3. CREATE function set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT)
--      — bulk-override met respect voor lock-trigger uit mig 219; returnt typed
--      info over geblokkeerde regels (geen thrown exception).

-- ============================================================================
-- 1. Drop kolom + index — met lock_timeout-veiligheidsklep
-- ============================================================================
SET LOCAL lock_timeout = '3s';

DROP INDEX IF EXISTS idx_edi_handelspartner_vervoerder;

ALTER TABLE edi_handelspartner_config
  DROP COLUMN IF EXISTS vervoerder_code;

-- ============================================================================
-- 2. Drop preview-RPC (mig 215) — vervangen door frontend-aggregatie
-- ============================================================================
DROP FUNCTION IF EXISTS preview_vervoerder_voor_order(BIGINT);

-- ============================================================================
-- 3. Bulk-override-RPC voor de inline-pill op order-niveau
-- ============================================================================
CREATE OR REPLACE FUNCTION set_orderregel_vervoerder_override_voor_order(
  p_order_id        BIGINT,
  p_vervoerder_code TEXT
)
RETURNS TABLE (
  orderregel_id BIGINT,
  resultaat     TEXT,  -- 'gezet' | 'geblokkeerd_door_zending' | 'overgeslagen_afhalen'
  reden         TEXT
) AS $$
DECLARE
  v_afhalen      BOOLEAN;
  v_regel        RECORD;
BEGIN
  -- Validatie: order bestaat.
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Validatie: vervoerder bestaat (als niet-NULL).
  IF p_vervoerder_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE code = p_vervoerder_code) THEN
    RAISE EXCEPTION 'Vervoerder % bestaat niet', p_vervoerder_code;
  END IF;

  -- Afhalen-orders: geen vervoerder zetten — retourneer één informatierij.
  SELECT o.afhalen INTO v_afhalen FROM orders o WHERE o.id = p_order_id;
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY SELECT
      NULL::BIGINT,
      'overgeslagen_afhalen'::TEXT,
      'Order is afhalen — geen vervoerder zetten'::TEXT;
    RETURN;
  END IF;

  -- Per-regel: probeer override te zetten.
  -- De lock-trigger uit mig 219 (trg_lock_orderregel_vervoerder) blokkeert
  -- UPDATE als de regel al in een open zending zit via een restrict_violation.
  -- We vangen die exception per-regel op zodat geblokkeerde regels als typed
  -- resultaat terugkomen in plaats van de hele transactie te falen.
  FOR v_regel IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    BEGIN
      UPDATE order_regels
         SET vervoerder_code = p_vervoerder_code
       WHERE id = v_regel.id;
      orderregel_id := v_regel.id;
      resultaat     := 'gezet';
      reden         := NULL;
      RETURN NEXT;
    EXCEPTION
      WHEN restrict_violation THEN
        orderregel_id := v_regel.id;
        resultaat     := 'geblokkeerd_door_zending';
        reden         := SQLERRM;
        RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) IS
  'Mig 227 (ADR-0008): bulk-override van vervoerder voor alle regels van een '
  'order in één transactie. Respecteert lock-trigger uit mig 219 '
  '(trg_lock_orderregel_vervoerder) — geblokkeerde regels worden teruggegeven '
  'met resultaat=''geblokkeerd_door_zending'', niet als exception. UI gebruikt '
  'dit om de operator te tonen welke regels niet konden (al in een open zending). '
  'NULL als p_vervoerder_code wist de override (terug naar regel-evaluator). '
  'Afhalen-orders: één rij met resultaat=''overgeslagen_afhalen''.';

NOTIFY pgrst, 'reload schema';
