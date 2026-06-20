-- Migratie 442: order-annulering geeft ook "Wacht op inkoop"-claims vrij
--
-- Uitbreiding van trg_order_events_snijplan_release() (mig 290). Een
-- geannuleerd snijplan-stuk met verwacht_inkooporder_regel_id (mig 437/438)
-- moet de inkoop-claim loslaten. In plaats van handmatig af te tellen op
-- `inkooporder_regels.snijplan_gebruikte_lengte_cm` (drift-gevoelig — een IO-
-- regel kan op elk moment meerdere stukken van dezelfde groep dragen),
-- her-triggeren we `auto-plan-groep` voor de betrokken (kwaliteit, kleur):
-- die release't via `release_wacht_op_inkoop_stukken` en herberekent vanaf
-- nul (zelfde "recompute i.p.v. optellen"-principe als de rest van dit plan).
--
-- CREATE OR REPLACE met de volledige mig 290-body + de nieuwe sectie. Eén
-- UPDATE...RETURNING CTE, twee aggregaties (rollen-array + kwaliteit/kleur-
-- groepen als JSONB) — geen temp table nodig.

CREATE OR REPLACE FUNCTION trg_order_events_snijplan_release()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_affected_rollen   BIGINT[] := ARRAY[]::BIGINT[];
  v_groepen_json      JSONB    := '[]'::jsonb;
  v_groep             RECORD;
  v_cfg               JSONB;
  v_url               TEXT;
  v_auth              TEXT;
BEGIN
  -- Defensief, ook al filtert de trigger-WHEN al.
  IF NEW.event_type <> 'geannuleerd' THEN
    RETURN NEW;
  END IF;

  -- Alle nog-levende snijplannen van de order → Geannuleerd. ONGEACHT
  -- voortgang (Wacht/Gepland/Snijden/Gesneden/…): een geannuleerde order is
  -- dood. rol_id/verwacht_inkooporder_regel_id blijven behouden als
  -- audit-spoor; de status-filter sluit ze overal correct uit.
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = NEW.order_id
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.rol_id, sp.verwacht_inkooporder_regel_id,
              oreg.maatwerk_kwaliteit_code, oreg.maatwerk_kleur_code
  )
  SELECT
    COALESCE(ARRAY_AGG(DISTINCT rol_id) FILTER (WHERE rol_id IS NOT NULL),
             ARRAY[]::BIGINT[]),
    COALESCE(
      jsonb_agg(DISTINCT jsonb_build_object(
        'kwaliteit_code', maatwerk_kwaliteit_code,
        'kleur_code',     maatwerk_kleur_code
      )) FILTER (
        WHERE verwacht_inkooporder_regel_id IS NOT NULL
          AND maatwerk_kwaliteit_code IS NOT NULL
          AND maatwerk_kleur_code     IS NOT NULL
      ),
      '[]'::jsonb
    )
    INTO v_affected_rollen, v_groepen_json
    FROM cancelled;

  -- Geraakte rollen die hun laatste actieve snijplan verloren → terug naar
  -- reststuk (afgeleide rol) of beschikbaar, met schone lei. De NOT EXISTS-
  -- guard beschermt rollen die nog een ander (niet-geannuleerd) order
  -- bedienen — patroon uit release_gepland_stukken (mig 133).
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END,
           snijden_gestart_op = NULL
     WHERE ro.id = ANY(v_affected_rollen)
       AND ro.status = 'in_snijplan'
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn
          WHERE sn.rol_id = ro.id
            AND sn.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  -- Mig 442: geannuleerde stukken die op een "Wacht op inkoop"-claim stonden
  -- → her-trigger auto-plan-groep voor hun (kwaliteit, kleur), zodat de claim
  -- + snijplan_gebruikte_lengte_cm-snapshot vanaf nul herberekend wordt.
  IF jsonb_array_length(v_groepen_json) > 0 THEN
    SELECT waarde INTO v_cfg FROM app_config WHERE sleutel = 'snijplanning.auto_planning';
    IF v_cfg IS NOT NULL AND COALESCE((v_cfg->>'enabled')::boolean, false) THEN
      v_url  := v_cfg->>'edge_url';
      v_auth := v_cfg->>'auth_header';
      IF v_url IS NOT NULL AND v_auth IS NOT NULL THEN
        FOR v_groep IN
          SELECT * FROM jsonb_to_recordset(v_groepen_json) AS x(kwaliteit_code TEXT, kleur_code TEXT)
        LOOP
          BEGIN
            PERFORM net.http_post(
              url     := v_url,
              headers := jsonb_build_object(
                           'Content-Type',  'application/json',
                           'Authorization', v_auth
                         ),
              body    := jsonb_build_object(
                           'kwaliteit_code', v_groep.kwaliteit_code,
                           'kleur_code',     v_groep.kleur_code
                         )
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Auto-plan trigger (order-annulering, wacht-op-inkoop) faalde voor %/%: %',
              v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
          END;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_order_events_snijplan_release() IS
  'Mig 290: annuleert alle levende snijplannen van een geannuleerde order en '
  'geeft hun rol vrij. Mig 442: her-triggert daarnaast auto-plan-groep voor '
  'groepen die een "Wacht op inkoop"-claim (mig 437/438) verloren, zodat de '
  'inkoop-claim-snapshot herberekend wordt i.p.v. drift-gevoelig af te tellen.';
