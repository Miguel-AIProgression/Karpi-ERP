-- Mig 403: Fix set_uitwisselbaar_claims — release niet-handmatige claims vóór insert
--
-- Root cause: update_order_with_lines doet DELETE + re-INSERT van alle order_regels
-- (nieuwe IDs). De INSERT-trigger vuurt herallocateer_orderregel op de nieuwe IDs,
-- wat auto-alias-claims (is_handmatig=false) aanmaakt voor stap 1.5-aliassen.
-- Vervolgens roept persistUitwisselbaarKeuzes set_uitwisselbaar_claims aan, die
-- handmatige claims (is_handmatig=true) voor diezelfde aliassen probeert in te voegen.
-- Beide hebben bron='voorraad', status='actief', zelfde (order_regel_id, fysiek_artikelnr)
-- → idx_order_reserveringen_voorraad_uniek constraint-fout.
--
-- Fix: release in set_uitwisselbaar_claims vóór de handmatige-claims-INSERT-loop
-- ook alle niet-handmatige claims. herallocateer_orderregel aan het einde maakt
-- de benodigde auto-claims opnieuw aan voor het resterende deel (na aftrek handmatig).
-- Mig 402 (NOT EXISTS-guard in herallocateer stap 1.5) blijft als defense-in-depth.

CREATE OR REPLACE FUNCTION set_uitwisselbaar_claims(
  p_order_regel_id BIGINT,
  p_keuzes JSONB  -- [{"artikelnr": "...", "aantal": N}, ...]
)
RETURNS VOID AS $$
DECLARE
  v_keuze JSONB;
  v_artikelnr TEXT;
  v_aantal INTEGER;
  v_orderregel_artikelnr TEXT;
BEGIN
  SELECT artikelnr INTO v_orderregel_artikelnr
  FROM order_regels WHERE id = p_order_regel_id;

  -- Release alle bestaande HANDMATIGE claims voor deze orderregel
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND is_handmatig = true;

  -- Release ook alle NIET-handmatige claims zodat de INSERT van handmatige claims
  -- hieronder niet botst met auto-alias-claims die de INSERT-trigger op order_regels
  -- al heeft aangemaakt (mig 403). herallocateer_orderregel aan het einde herplaatst
  -- ze voor het deel dat niet door handmatige claims gedekt wordt.
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  -- Maak nieuwe handmatige claims aan
  IF p_keuzes IS NOT NULL THEN
    FOR v_keuze IN SELECT * FROM jsonb_array_elements(p_keuzes) LOOP
      v_artikelnr := v_keuze->>'artikelnr';
      v_aantal := (v_keuze->>'aantal')::INTEGER;

      -- Skip eigen artikelnr (gebruik gewone allocator) en lege/0-aantallen
      IF v_artikelnr IS NULL OR v_aantal IS NULL OR v_aantal <= 0
         OR v_artikelnr = v_orderregel_artikelnr THEN
        CONTINUE;
      END IF;

      INSERT INTO order_reserveringen
        (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
      VALUES
        (p_order_regel_id, 'voorraad', v_aantal, v_artikelnr, true);
    END LOOP;
  END IF;

  -- Triggert allocator voor het resterende (eigen voorraad + IO, na aftrek handmatig)
  PERFORM herallocateer_orderregel(p_order_regel_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_uitwisselbaar_claims IS
  'Vervangt de handmatige uitwisselbaar-claims voor een orderregel met de in '
  'p_keuzes opgegeven {artikelnr, aantal}-lijst. Roept daarna herallocateer_orderregel '
  'aan om voorraad eigen artikel + IO eigen artikel aan te vullen voor het '
  'resterende deel. Migraties 154, 403.';
