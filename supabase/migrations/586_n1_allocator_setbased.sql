-- Migratie 586: N+1 in de voorraad-allocator (PLpgSQL) set-based maken
--
-- Probleem (perf-audit, zie CLAUDE.md-taak "N+1 in de voorraad-allocator"):
-- 1. herallocateer_orderregel_auto: Stap 1.5 (alias-voorraad) en Stap 2 (IO-claims)
--    riepen per FOR-loop-iteratie voorraad_beschikbaar_voor_artikel()/io_regel_ruimte()
--    aan (elk 2 interne SELECTs) -> N+1 round-trips.
-- 2. allocatie_opties_voor_artikel: io_regel_ruimte(ir.id) werd 2x per rij geevalueerd
--    (SELECT-lijst + WHERE) -> dubbel werk per rij.
--
-- Fix: de kandidaten + hun beschikbaarheid/ruimte worden vooraf in EEN set-based
-- query gematerialiseerd (CTE's die de helperfunctie-logica inline repliceren, resp.
-- een LATERAL-join die de helperfunctie 1x per rij aanroept i.p.v. 2x). De PL/pgSQL
-- FOR-loop doet daarna alleen nog de greedy-toewijzing op de al-berekende cijfers.
--
-- Signatures, returntypes, greedy-volgorde en toewijzingsgedrag blijven IDENTIEK
-- voor het niet-gelijktijdige geval. Kanttekening concurrency: de beschikbaarheid
-- wordt nu 1x vooraf gematerialiseerd i.p.v. per iteratie vers gelezen; tussen
-- twee GELIJKTIJDIGE aanroepen (verschillende order_regels, zelfde alias/IO-regel)
-- bestond er al een ongelockt double-booking-venster (geen FOR UPDATE op
-- producten/concurrente reserveringen) — dit verbreedt dat venster marginaal,
-- het opent geen nieuw. Echte fix zou een advisory-lock per artikelnr zijn.

CREATE OR REPLACE FUNCTION public.allocatie_opties_voor_artikel(p_artikelnr text)
 RETURNS TABLE(bron text, artikelnr text, omschrijving text, inkooporder_regel_id bigint, vrij_aantal integer, verwacht_datum date, eigen_artikelnr text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_eigen_artikelnr    TEXT;
  v_stuks_artikelnr    TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       BIGINT;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
BEGIN
  SELECT p0.stuks_artikelnr INTO v_stuks_artikelnr
    FROM producten p0 WHERE p0.artikelnr = p_artikelnr;
  v_eigen_artikelnr := COALESCE(v_stuks_artikelnr, p_artikelnr);

  -- Optie 2: eigen artikel, open inkoop met ETA.
  -- io_regel_ruimte(ir.id) 1x per rij via LATERAL (was: 2x, in SELECT en WHERE).
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, v_eigen_artikelnr, p.omschrijving,
         ir.id, r.ruimte, io.verwacht_datum, v_eigen_artikelnr
    FROM inkooporder_regels ir
    JOIN inkooporders io ON io.id = ir.inkooporder_id
    JOIN producten p ON p.artikelnr = ir.artikelnr
    CROSS JOIN LATERAL io_regel_ruimte(ir.id) AS r(ruimte)
   WHERE ir.artikelnr = v_eigen_artikelnr
     AND ir.eenheid = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND r.ruimte > 0
   ORDER BY io.verwacht_datum NULLS LAST;

  SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
    INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = v_eigen_artikelnr;

  IF v_collectie_id IS NULL OR v_kleur_code IS NULL THEN
    RETURN;
  END IF;

  -- Optie 1: equivalent, nu op voorraad.
  RETURN QUERY
  SELECT 'voorraad'::TEXT, p.artikelnr, p.omschrijving,
         NULL::BIGINT, p.vrije_voorraad, NULL::DATE, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.vrije_voorraad > 0
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
   ORDER BY p.vrije_voorraad DESC;

  -- Optie 3: equivalent, wacht op zíjn eigen inkoop met ETA.
  -- io_regel_ruimte(ir.id) 1x per rij via LATERAL (was: 2x, in SELECT en WHERE).
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, p.artikelnr, p.omschrijving,
         ir.id, r.ruimte, io.verwacht_datum, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    JOIN inkooporder_regels ir ON ir.artikelnr = p.artikelnr
    JOIN inkooporders io ON io.id = ir.inkooporder_id
    CROSS JOIN LATERAL io_regel_ruimte(ir.id) AS r(ruimte)
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
     AND ir.eenheid      = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND r.ruimte > 0
   ORDER BY io.verwacht_datum NULLS LAST;
END;
$function$;


CREATE OR REPLACE FUNCTION public.herallocateer_orderregel_auto(p_order_regel_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr          TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       INTEGER;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
  v_te_leveren         INTEGER;
  v_is_maatwerk        BOOLEAN;
  v_order_id           BIGINT;
  v_order_status       order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad        INTEGER;
  v_resterend          INTEGER;
  v_handmatig_totaal   INTEGER;
  v_alias              RECORD;
  v_alias_alloc        INTEGER;
  v_io                 RECORD;
  v_alloc              INTEGER;
  v_stuks_artikelnr    TEXT;
  v_stuks_per_doos     INTEGER;
BEGIN
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN RETURN; END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = CASE WHEN v_order_status = 'Verzonden' THEN 'verzonden' ELSE 'released' END,
           updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Doos→stuks vertaling (mig 408)
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;

  -- Lock + release alleen NIET-handmatige claims
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- Stap 1.5: alias voorraad (zelfde collectie + kleur_code + maat + maatwerk_vorm_code)
  -- Kandidaten + hun voorraad_beschikbaar_voor_artikel()-cijfer worden nu in EEN
  -- set-based query gematerialiseerd (CTE's), i.p.v. de helperfunctie 1x per
  -- loop-iteratie aan te roepen. Zelfde formule als voorraad_beschikbaar_voor_artikel:
  -- GREATEST(0, voorraad - backorder - SUM(actieve/verzonden voorraad-claims van
  -- andere regels)). De greedy-volgorde (ORDER BY vrije_voorraad DESC, artikelnr ASC)
  -- en toewijzingsgedrag blijven identiek.
  IF v_resterend > 0 THEN
    SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
      INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    WHERE p.artikelnr = v_artikelnr;

    IF v_collectie_id IS NOT NULL AND v_kleur_code IS NOT NULL THEN
      FOR v_alias IN
        WITH kandidaten AS (
          SELECT p.artikelnr, p.voorraad, p.backorder, p.vrije_voorraad
            FROM producten p
            JOIN kwaliteiten k ON k.code = p.kwaliteit_code
           WHERE k.collectie_id = v_collectie_id
             AND p.kleur_code    = v_kleur_code
             AND p.breedte_cm    = v_breedte_cm
             AND p.lengte_cm     = v_lengte_cm
             AND p.artikelnr    <> v_artikelnr
             AND p.actief        = true
             AND p.vrije_voorraad > 0
             AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
             AND NOT EXISTS (
               SELECT 1 FROM order_reserveringen or2
                WHERE or2.order_regel_id  = p_order_regel_id
                  AND or2.fysiek_artikelnr = p.artikelnr
                  AND or2.bron            = 'voorraad'
                  AND or2.status          = 'actief'
                  AND or2.is_handmatig    = true
             )
        ),
        claims AS (
          SELECT r.fysiek_artikelnr AS artikelnr, COALESCE(SUM(r.aantal), 0) AS geclaimd
            FROM order_reserveringen r
           WHERE r.bron = 'voorraad'
             AND r.status IN ('actief', 'verzonden')
             AND r.order_regel_id <> p_order_regel_id
             AND r.fysiek_artikelnr IN (SELECT artikelnr FROM kandidaten)
           GROUP BY r.fysiek_artikelnr
        )
        SELECT k.artikelnr,
               GREATEST(0, COALESCE(k.voorraad, 0) - COALESCE(k.backorder, 0) - COALESCE(c.geclaimd, 0)) AS beschikbaar
          FROM kandidaten k
          LEFT JOIN claims c ON c.artikelnr = k.artikelnr
         ORDER BY k.vrije_voorraad DESC, k.artikelnr ASC
      LOOP
        EXIT WHEN v_resterend <= 0;
        v_alias_alloc := LEAST(v_resterend, v_alias.beschikbaar);
        IF v_alias_alloc > 0 THEN
          INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
          VALUES (p_order_regel_id, 'voorraad', v_alias_alloc, v_alias.artikelnr, false);
          v_resterend := v_resterend - v_alias_alloc;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Stap 2: IO-claims stuks-artikel op oudste verwacht_datum eerst
  -- Kandidaten + hun io_regel_ruimte()-cijfer worden nu in EEN set-based query
  -- gematerialiseerd (CTE's), i.p.v. de helperfunctie 1x per loop-iteratie aan te
  -- roepen. Zelfde formule als io_regel_ruimte (eenheid='stuks' staat al vast via
  -- het kandidaten-filter): GREATEST(0, FLOOR(te_leveren_m) - SUM(actieve IO-claims)).
  -- De greedy-volgorde (ORDER BY verwacht_datum NULLS LAST, id ASC) en
  -- toewijzingsgedrag blijven identiek.
  IF v_resterend > 0 THEN
    FOR v_io IN
      WITH kandidaten AS (
        SELECT ir.id, ir.te_leveren_m, io.verwacht_datum
          FROM inkooporder_regels ir
          JOIN inkooporders io ON io.id = ir.inkooporder_id
         WHERE ir.artikelnr = v_artikelnr
           AND ir.eenheid   = 'stuks'
           AND io.status IN ('Besteld', 'Deels ontvangen')
      ),
      claims AS (
        SELECT r.inkooporder_regel_id AS id, COALESCE(SUM(r.aantal), 0) AS geclaimd
          FROM order_reserveringen r
         WHERE r.bron = 'inkooporder_regel'
           AND r.status = 'actief'
           AND r.inkooporder_regel_id IN (SELECT id FROM kandidaten)
         GROUP BY r.inkooporder_regel_id
      )
      SELECT k.id, k.verwacht_datum,
             GREATEST(0, FLOOR(COALESCE(k.te_leveren_m, 0))::INTEGER - COALESCE(c.geclaimd, 0)) AS ruimte
        FROM kandidaten k
        LEFT JOIN claims c ON c.id = k.id
       ORDER BY k.verwacht_datum NULLS LAST, k.id ASC
    LOOP
      EXIT WHEN v_resterend <= 0;
      v_alloc := LEAST(v_resterend, v_io.ruimte);
      IF v_alloc > 0 THEN
        INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr)
        VALUES (p_order_regel_id, 'inkooporder_regel', v_io.id, v_alloc, v_artikelnr);
        v_resterend := v_resterend - v_alloc;
      END IF;
    END LOOP;
  END IF;

  PERFORM herwaardeer_order_status(v_order_id);
END;
$function$;


-- Contract-assert (verplicht bij RPC-herdefinitie, zie mig 527/585-incident):
-- signatuur bestaat + minimale gedragsasserts zonder side-effects.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- 1. Signatuur-check: beide functies bestaan met exacte parameter-/returntype.
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'herallocateer_orderregel_auto'
     AND pg_get_function_identity_arguments(p.oid) = 'p_order_regel_id bigint'
     AND pg_get_function_result(p.oid) = 'void';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Contract-assert gefaald: herallocateer_orderregel_auto(bigint) RETURNS void niet gevonden (count=%)', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'allocatie_opties_voor_artikel'
     AND pg_get_function_identity_arguments(p.oid) = 'p_artikelnr text';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Contract-assert gefaald: allocatie_opties_voor_artikel(text) niet gevonden (count=%)', v_count;
  END IF;

  -- 2. Gedragsassert: niet-bestaand artikel geeft 0 rijen, geen error.
  SELECT COUNT(*) INTO v_count
    FROM allocatie_opties_voor_artikel('__mig586_niet_bestaand_artikel__');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Contract-assert gefaald: allocatie_opties_voor_artikel op niet-bestaand artikel gaf % rijen i.p.v. 0', v_count;
  END IF;

  RAISE NOTICE 'mig 586 contract-assert geslaagd: signaturen + leeg-resultaat-gedrag ongewijzigd.';
END;
$$;
