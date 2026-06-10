-- Migratie 347: voltooi_confectie — 'Maatwerk afgerond' via _apply_transitie
--
-- PROBLEEM (bevinding B2, docs/order-lifecycle.md §11): mig 330 schreef de
-- terminale transitie naar 'Maatwerk afgerond' met een directe status-UPDATE
-- op orders — buiten het ene schrijfpad (_apply_transitie, ADR-0006).
-- Gevolg: géén order_events-rij voor de belangrijkste transitie
-- van een productie-only order, en toekomstige listeners op deze transitie
-- zouden hem missen. De lint (scripts/lint-no-direct-orders-status-update.sh)
-- ving dit niet omdat hij alleen migrations/2*.sql scande — ook gefixt.
--
-- FIX: body byte-voor-byte mig 330, behalve de na-stap: de directe UPDATE
-- wordt `PERFORM _apply_transitie(..., 'maatwerk_afgerond', 'Maatwerk
-- afgerond', ...)`. _apply_transitie is idempotent (no-op bij gelijke status)
-- en SECURITY DEFINER (218_z), dus de werkvloer-rol hoeft geen rechten op
-- order_events te hebben. voltooi_confectie zelf blijft INVOKER (zoals mig 330).
--
-- VEREIST: mig 346 (enum-waarde 'maatwerk_afgerond') is al — in een eerdere,
-- eigen transactie — toegepast.
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
  -- Mig 347: via _apply_transitie (ADR-0006) zodat de transitie een
  -- order_events-rij krijgt; was directe UPDATE (mig 330).
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
        PERFORM _apply_transitie(
          v_order_id,
          'maatwerk_afgerond'::order_event_type,
          'Maatwerk afgerond'::order_status,
          p_reden => 'Alle snijplannen confectie-afgerond (productie-only, afhandelen in Basta)'
        );
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Ingepakt + ingepakt_op=NOW() (impliceert afgerond, maakt direct pickbaar via mig 170). p_locatie="" → clear locatie; NULL → ongemoeid. Mig 247: ingepakt-pad zet Ingepakt i.p.v. Gereed. Mig 250: expliciete ::snijplan_status casts op CASE-takken zodat de UPDATE niet faalt op type-coercie. Idempotent. Mig 330: na-stap flipt productie-only orders (alleen_productie=true) naar terminale status ''Maatwerk afgerond'' zodra alle snijplannen van de order confectie-afgerond zijn. Mig 347: die flip loopt via _apply_transitie (ADR-0006) → order_events-rij ''maatwerk_afgerond''. Strikt geguard: gewone orders ongemoeid.';

-- Zelf-test: de definitie gebruikt _apply_transitie en bevat geen directe
-- UPDATE op orders meer.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%_apply_transitie%' THEN
    RAISE EXCEPTION 'Mig 347: voltooi_confectie roept _apply_transitie niet aan';
  END IF;
  IF v_def NOT LIKE '%maatwerk_afgerond%' THEN
    RAISE EXCEPTION 'Mig 347: voltooi_confectie gebruikt event-type maatwerk_afgerond niet';
  END IF;
  IF v_def ~* 'UPDATE\s+orders\s+SET' THEN
    RAISE EXCEPTION 'Mig 347: voltooi_confectie bevat nog een directe UPDATE orders SET';
  END IF;
  RAISE NOTICE 'Mig 347: alle asserties geslaagd — Maatwerk afgerond loopt via _apply_transitie';
END $$;

NOTIFY pgrst, 'reload schema';
