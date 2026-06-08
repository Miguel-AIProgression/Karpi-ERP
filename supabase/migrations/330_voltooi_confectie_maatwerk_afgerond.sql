-- Migratie 330: voltooi_confectie — geguarde flip naar 'Maatwerk afgerond'
--
-- DOEL: voeg een na-stap toe aan voltooi_confectie zodat een productie-only
-- order (alleen_productie=true) automatisch naar de terminale status
-- 'Maatwerk afgerond' flipped zodra ALLE snijplannen van die order
-- confectie-afgerond zijn (confectie_afgerond_op IS NOT NULL).
--
-- GOUDEN REGEL (ADR-0029): gewone orders (alleen_productie=false) worden
-- byte-voor-byte ongemoeid gelaten. De na-stap is strikt geguard op
-- alleen_productie=true — de EXISTS-check faalt direct voor gewone orders.
--
-- Done-criterium: confectie_afgerond_op IS NULL count = 0.
-- Bewust NIET de Ingepakt-stap — confectie_afgerond_op is het kantelpunt
-- dat aangeeft dat het snijwerk én de confectie klaar zijn. Ingepakt is
-- een extra logistieke actie die voor productie-only orders niet altijd
-- van toepassing is.
--
-- Directe UPDATE orders.status (geen trigger/event): zelfde patroon als
-- import_productie_only_order (mig 329). Eenvoudig, synchroon, traceerbaar.
--
-- Idempotent via CREATE OR REPLACE.

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
  v_row          snijplannen;
  v_nu           TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN     := p_afgerond OR p_ingepakt;  -- ingepakt impliceert afgerond
  v_order_id     BIGINT;
  v_open         INTEGER;
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
                                   WHEN p_ingepakt    THEN 'Ingepakt'::snijplan_status
                                   WHEN v_eff_afgerond THEN 'In confectie'::snijplan_status
                                   ELSE                    'Gesneden'::snijplan_status
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden'::snijplan_status,
                    'In confectie'::snijplan_status,
                    'Gereed'::snijplan_status,
                    'Ingepakt'::snijplan_status)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed/Ingepakt', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- NA-STAP (productie-only): order naar 'Maatwerk afgerond' als ALLE snijplannen
  -- van de order confectie-afgerond zijn. Strikt geguard op alleen_productie.
  IF v_eff_afgerond THEN
    SELECT orr.order_id INTO v_order_id
      FROM order_regels orr WHERE orr.id = v_row.order_regel_id;

    IF EXISTS (SELECT 1 FROM orders o
               WHERE o.id = v_order_id AND o.alleen_productie = true
                 AND o.status <> 'Maatwerk afgerond'::order_status) THEN
      SELECT count(*) INTO v_open
        FROM snijplannen sp
        JOIN order_regels orr ON orr.id = sp.order_regel_id
       WHERE orr.order_id = v_order_id
         AND sp.confectie_afgerond_op IS NULL;

      IF v_open = 0 THEN
        UPDATE orders SET status = 'Maatwerk afgerond'::order_status WHERE id = v_order_id;
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Ingepakt + ingepakt_op=NOW() (impliceert afgerond, maakt direct pickbaar via mig 170). p_locatie="" → clear locatie; NULL → ongemoeid. Mig 247: ingepakt-pad zet Ingepakt i.p.v. Gereed. Mig 250: expliciete ::snijplan_status casts op CASE-takken zodat de UPDATE niet faalt op type-coercie. Idempotent. Mig 330: na-stap flipt productie-only orders (alleen_productie=true) naar terminale status ''Maatwerk afgerond'' zodra alle snijplannen van de order confectie-afgerond zijn (confectie_afgerond_op IS NULL count = 0). Strikt geguard: gewone orders ongemoeid.';

NOTIFY pgrst, 'reload schema';
