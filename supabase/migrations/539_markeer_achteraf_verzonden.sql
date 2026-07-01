-- Mig 539: markeer_achteraf_verzonden
-- ---------------------------------------------------------------------------
-- Uitbreiding van het "Al afgehandeld"-pad (mig 524, registreer_achteraf_order)
-- naar BESTAANDE orders. Waar mig 524 een nieuwe order direct als Verzonden
-- aanmaakt, zet deze functie een al-ingevoerde order alsnog om naar Verzonden —
-- net alsof hij via de normale pick-en-verzend-flow was afgehandeld.
--
-- Toepasselijk scenario: order is buiten het systeem al verzonden of afgehaald
-- (telefoon, balie, oud-systeem-moment) en de operator wil dit achteraf correct
-- registreren zonder alle normale workflow-stappen te doorlopen.
--
-- Wat de functie doet (atomair):
--   §A  Validatie + row-lock (blokkeert bij eindstatus of actieve uitvoering)
--   §B  Snijplannen annuleren (Wacht/Gepland/Wacht op inkoop → Geannuleerd)
--       + rollen vrijgeven + IO-claim-snapshots wissen
--   §C  Actieve order_reserveringen verwijderen (voorraad + IO) en herberekenen,
--       daarna nieuwe verzonden-claims aanmaken (mirrort §C mig 524)
--   §D  Gepland-deelzendingen verwijderen (zijn nog niet fysiek gestart)
--   §E  Phantom-zending aanmaken (voor factuur-linkage, zoals mig 524 §D)
--   §F  Order bijwerken: status='Verzonden', is_achteraf=TRUE, verzonden_at
--   §G  order_events 'pickronde_voltooid' → triggert factuur_queue automatisch
--
-- Hard blocks (RAISE EXCEPTION):
--   - status IN ('Verzonden', 'Geannuleerd', 'Deels verzonden')
--   - Snijplan met status 'Snijden' of 'Gesneden' (machine fysiek bezig)
--   - Zending met status 'Picken' of 'Klaar voor verzending' (labels geprint,
--     carrier mogelijk al genotificeerd)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.markeer_achteraf_verzonden(
  p_order_id     BIGINT,
  p_verzenddatum DATE    DEFAULT CURRENT_DATE,
  p_afhalen      BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status              order_status;
  v_order_nr            TEXT;
  v_zending_id          BIGINT;
  v_zending_nr          TEXT;
  v_affected_rollen     BIGINT[];
  v_io_regel_ids        BIGINT[];
  v_herbereken_ids      TEXT[];
  v_artikel             TEXT;
  v_zend_id             BIGINT;
  -- voor de verzonden-claims-loop
  v_regel_id            BIGINT;
  v_artikelnr           TEXT;
  v_te_leveren          INTEGER;
  v_stuks_artikelnr     TEXT;
  v_stuks_per_doos      INTEGER;
  v_reserveer_artikelnr TEXT;
  v_reserveer_aantal    INTEGER;
BEGIN
  -- ── §A: Validatie + row-lock ───────────────────────────────────────────────
  SELECT o.status, o.order_nr
    INTO v_status, v_order_nr
    FROM orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % niet gevonden', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status IN ('Verzonden', 'Geannuleerd', 'Deels verzonden') THEN
    RAISE EXCEPTION
      'Order % heeft status "%" en kan niet als afgehandeld worden gemarkeerd.',
      v_order_nr, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hard block: snijmachine is fysiek bezig
  IF EXISTS (
    SELECT 1
      FROM snijplannen sp
      JOIN order_regels oreg ON oreg.id = sp.order_regel_id
     WHERE oreg.order_id = p_order_id
       AND sp.status IN ('Snijden', 'Gesneden')
  ) THEN
    RAISE EXCEPTION
      'Order % heeft snijplannen in uitvoering (status "Snijden" of "Gesneden"). '
      'Stop de snijplanning eerst voordat je de order als afgehandeld markeert.',
      v_order_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hard block: actieve pickronde (labels geprint, carrier genotificeerd)
  IF EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = p_order_id
       AND z.status IN ('Picken', 'Klaar voor verzending')
  ) THEN
    RAISE EXCEPTION
      'Order % heeft een actieve pickronde (status "Picken" of "Klaar voor verzending"). '
      'Annuleer eerst de pickronde voordat je de order als afgehandeld markeert.',
      v_order_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── §B: Snijplannen annuleren + rollen vrijgeven + IO-snapshots wissen ─────
  -- Spiegelt trg_order_events_snijplan_release (mig 290/442) maar direct,
  -- zonder een 'geannuleerd'-event_type te schieten (we gaan naar Verzonden).
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = p_order_id
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.rol_id, sp.verwacht_inkooporder_regel_id
  )
  SELECT
    COALESCE(
      ARRAY_AGG(DISTINCT rol_id)
        FILTER (WHERE rol_id IS NOT NULL),
      ARRAY[]::BIGINT[]
    ),
    COALESCE(
      ARRAY_AGG(DISTINCT verwacht_inkooporder_regel_id)
        FILTER (WHERE verwacht_inkooporder_regel_id IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_affected_rollen, v_io_regel_ids
    FROM cancelled;

  -- Rollen vrijgeven die hun laatste actieve snijplan verloren
  -- NOT EXISTS-guard: rol kan nog andere (niet-geannuleerde) stukken bedienen
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status             = CASE
                                  WHEN ro.oorsprong_rol_id IS NOT NULL
                                  THEN 'reststuk'
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

  -- IO-claim-snapshots wissen (inkooporder_regels.snijplan_gebruikte_lengte_cm)
  -- Spiegelt het claim-wis-deel van release_wacht_op_inkoop_stukken (mig 438/445):
  -- de stukken zijn Geannuleerd dus de IO-lengte-claim verdwijnt volledig.
  IF COALESCE(array_length(v_io_regel_ids, 1), 0) > 0 THEN
    UPDATE inkooporder_regels
       SET snijplan_gebruikte_lengte_cm = 0
     WHERE id = ANY(v_io_regel_ids);
  END IF;

  -- ── §C: Actieve reserveringen wissen → herberekenen → verzonden-claims ─────
  -- 1. Verzamel alle fysieke artikelnrs die actieve claims hebben (voor
  --    herberekening vrije_voorraad ná de delete).
  SELECT COALESCE(ARRAY_AGG(DISTINCT r.fysiek_artikelnr), ARRAY[]::TEXT[])
    INTO v_herbereken_ids
    FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
   WHERE oreg.order_id = p_order_id
     AND r.status = 'actief';

  -- 2. Delete alle actieve claims (voorraad + IO)
  DELETE FROM order_reserveringen r
   USING order_regels oreg
   WHERE oreg.id = r.order_regel_id
     AND oreg.order_id = p_order_id
     AND r.status = 'actief';

  -- 3. Herbereken vrije_voorraad voor geraakte artikelen
  --    (geeft IO-bezetting vrij zodat andere orders die IO kunnen claimen)
  IF COALESCE(array_length(v_herbereken_ids, 1), 0) > 0 THEN
    FOREACH v_artikel IN ARRAY v_herbereken_ids LOOP
      PERFORM herbereken_product_reservering(v_artikel);
    END LOOP;
  END IF;

  -- 4. Aanmaken verzonden-claims (mirrort §C van registreer_achteraf_order):
  --    status='verzonden' zodat vrije_voorraad correct daalt voor toekomstige orders.
  FOR v_regel_id, v_artikelnr, v_te_leveren IN
    SELECT oreg.id, oreg.artikelnr, oreg.te_leveren
      FROM order_regels oreg
     WHERE oreg.order_id = p_order_id
       AND oreg.artikelnr IS NOT NULL
       AND NOT COALESCE(oreg.is_vrije_regel, FALSE)
       AND NOT is_admin_pseudo(oreg.artikelnr)
       AND COALESCE(oreg.te_leveren, 0) > 0
  LOOP
    -- Doos-artikel? → reserve op stuks_artikelnr × stuks_per_doos (mig 408)
    SELECT stuks_artikelnr, stuks_per_doos
      INTO v_stuks_artikelnr, v_stuks_per_doos
      FROM producten
     WHERE artikelnr = v_artikelnr;

    IF v_stuks_artikelnr IS NOT NULL AND v_stuks_per_doos IS NOT NULL THEN
      v_reserveer_artikelnr := v_stuks_artikelnr;
      v_reserveer_aantal    := v_te_leveren * v_stuks_per_doos;
    ELSE
      v_reserveer_artikelnr := v_artikelnr;
      v_reserveer_aantal    := v_te_leveren;
    END IF;

    INSERT INTO order_reserveringen (
      order_regel_id, fysiek_artikelnr,
      bron, status, aantal, is_handmatig
    ) VALUES (
      v_regel_id,
      v_reserveer_artikelnr,
      'voorraad',
      'verzonden',
      v_reserveer_aantal,
      FALSE
    ) ON CONFLICT DO NOTHING;

    PERFORM herbereken_product_reservering(v_reserveer_artikelnr);
  END LOOP;

  -- ── §D: Gepland-deelzendingen verwijderen ────────────────────────────────
  -- Status='Gepland' = deelzending aangemaakt maar nog niet gestart (mig 477).
  -- Veilig te verwijderen: er zijn geen labels geprint, geen carrier-notificatie.
  -- Verwijder in de juiste FK-volgorde (spiegelt annuleer_pickronde, mig 398).
  FOR v_zend_id IN
    SELECT z.id
      FROM zendingen z
      JOIN zending_orders zo ON zo.zending_id = z.id
     WHERE zo.order_id = p_order_id
       AND z.status    = 'Gepland'
  LOOP
    DELETE FROM zending_colli  WHERE zending_id = v_zend_id;
    DELETE FROM zending_regels WHERE zending_id = v_zend_id;
    DELETE FROM zending_orders WHERE zending_id = v_zend_id;
    DELETE FROM zendingen      WHERE id         = v_zend_id;
  END LOOP;

  -- ── §E: Phantom-zending aanmaken ─────────────────────────────────────────
  -- Factuur-trigger (enqueue_factuur_voor_event, mig 474) leest zending_orders
  -- om zending_id te vinden → zonder een zending geen factuur_queue-entry.
  -- gereed_op=NULL → DESADV-sweep (bouw-verzendbericht-edi) vuurt niet.
  -- status='Gepland' → verschijnt niet in Pick & Ship start-tab.
  -- Trigger trg_zending_set_m2m_a_ins maakt automatisch een zending_orders-rij.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr,
    order_id,
    status,
    vervoerder_code,
    verzenddatum,
    is_deelzending,
    aantal_colli,
    totaal_gewicht_kg
  ) VALUES (
    v_zending_nr,
    p_order_id,
    'Gepland',
    NULL,
    p_verzenddatum,
    FALSE,
    0,
    0
  ) RETURNING id INTO v_zending_id;

  -- ── §F: Order bijwerken naar Verzonden ───────────────────────────────────
  UPDATE orders
     SET status       = 'Verzonden',
         verzonden_at = p_verzenddatum::TIMESTAMPTZ,
         is_achteraf  = TRUE,
         afleverdatum = p_verzenddatum,
         afhalen      = p_afhalen
   WHERE id = p_order_id;

  -- ── §G: order_events → triggert factuur_queue ────────────────────────────
  -- event_type='pickronde_voltooid' + status_na='Verzonden' is de exacte
  -- combinatie die enqueue_factuur_voor_event (mig 474) afhandelt.
  -- Andere listeners op order_events reageren NIET op dit event:
  --   • trg_order_events_reservering_release → alleen 'geannuleerd'
  --   • trg_order_events_snijplan_release    → alleen 'geannuleerd'
  --   • trg_order_events_zending_release     → alleen 'geannuleerd'
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na, metadata
  ) VALUES (
    p_order_id,
    'pickronde_voltooid',
    'Verzonden',
    'Verzonden',
    jsonb_build_object(
      'achteraf',        TRUE,
      'verzenddatum',    p_verzenddatum,
      'afhalen',         p_afhalen,
      'bestaande_order', TRUE
    )
  );

  RETURN jsonb_build_object(
    'order_id',   p_order_id,
    'order_nr',   v_order_nr,
    'zending_id', v_zending_id,
    'zending_nr', v_zending_nr
  );
END;
$function$;

COMMENT ON FUNCTION public.markeer_achteraf_verzonden IS
  'Mig 539: zet een bestaande open order achteraf om naar status=Verzonden '
  '(spiegelt registreer_achteraf_order mig 524 maar voor bestaande orders). '
  'Annuleert openstaande snijplannen, releaset IO-claims, maakt verzonden- '
  'reserveringen aan, verwijdert Gepland-deelzendingen, prikst een '
  'phantom-zending aan en triggert de factuur-pipeline. '
  'Hard-blokkeert bij snijmachine in uitvoering of actieve pickronde.';

NOTIFY pgrst, 'reload schema';
