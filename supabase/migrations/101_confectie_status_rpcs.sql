-- 101_confectie_status_rpcs.sql
-- Idempotente status-transities voor confectie-workflow.

CREATE OR REPLACE FUNCTION start_confectie(p_snijplan_id BIGINT)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
BEGIN
  UPDATE snijplannen
     SET status = 'In confectie'
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie (of bestaat niet)', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION start_confectie(BIGINT) IS
  'Zet snijplan-status op ''In confectie''. Idempotent: accepteert ook wanneer al In confectie.';

CREATE OR REPLACE FUNCTION voltooi_confectie(
  p_snijplan_id BIGINT,
  p_afgerond    BOOLEAN DEFAULT true,
  p_ingepakt    BOOLEAN DEFAULT false,
  p_locatie     TEXT    DEFAULT NULL
)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
  v_nu  TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN := p_afgerond OR p_ingepakt;  -- ingepakt impliceert afgerond
BEGIN
  UPDATE snijplannen
     SET confectie_afgerond_op = CASE WHEN v_eff_afgerond THEN v_nu ELSE NULL END,
         ingepakt_op           = CASE WHEN p_ingepakt THEN v_nu ELSE NULL END,
         locatie               = CASE
                                   WHEN p_locatie IS NULL THEN locatie
                                   WHEN trim(p_locatie) = '' THEN NULL
                                   ELSE trim(p_locatie)
                                 END,
         status                = CASE
                                   WHEN p_ingepakt THEN 'Gereed'
                                   WHEN v_eff_afgerond THEN 'In confectie'
                                   ELSE 'Gesneden'
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie', 'Gereed')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af of draait af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Gereed + ingepakt_op=NOW() (impliceert afgerond). p_locatie="" → clear locatie; NULL → ongemoeid laten. Idempotent.';
