-- Migratie 290: order-annulering cascadeert naar de Snijplanning-Module
--
-- Symptoom (P. Dobbe): een geannuleerde order bleef op de snijlijst staan en
-- de gereserveerde rollen kwamen niet vrij.
--
-- Root cause: markeer_geannuleerd (mig 218) schrijft een 'geannuleerd'-event;
-- daarop reageert alleen trg_order_events_reservering_release (mig 255) — die
-- releaset order_reserveringen (voorraad+IO). NIEMAND cancelt de snijplannen.
-- Hun status blijft 'Gepland'/'Snijden', rol blijft 'in_snijplan'. Bovendien
-- mist snijplanning_overzicht (mig 233) een order-status-filter, anders dan de
-- zustersview orderregel_pickbaarheid (mig 288). Dus: snijplan-status
-- onveranderd + geen order-filter = geannuleerde order blijft zichtbaar +
-- rollen vastgehouden.
--
-- Fix (ADR-0023), drie delen:
--   1. Snijplanning-Module event-listener op order_events (symmetrisch met
--      mig 255): bij 'geannuleerd' → alle snijplannen van de order naar
--      'Geannuleerd' (ongeacht voortgang — werkvloer-keuze) + geraakte rollen
--      vrij (patroon uit release_gepland_stukken, mig 133).
--   2. snijplanning_overzicht krijgt WHERE o.status <> 'Geannuleerd'
--      (defense-in-depth; bewust NIET ook 'Verzonden' — die view voedt ook de
--      fysieke rol-uitvoer en de packer).
--   3. Backfill van bestaande Geannuleerd-orders met levende snijplannen.
--
-- Idempotent: CREATE OR REPLACE FUNCTION/VIEW, DROP TRIGGER IF EXISTS.

-- ============================================================================
-- 1. Handler + trigger — Snijplanning-Module reageert op 'geannuleerd'
-- ============================================================================
--
-- Geen SECURITY DEFINER: snijplannen/rollen worden alleen door system-paths
-- gemuteerd en de aanroepende RPC (markeer_geannuleerd) draait al authenticated
-- — exact zoals trg_order_events_reservering_release (mig 255).
--
-- Trigger-volgorde: 'reservering' < 'snijplan' (alfabetisch) → claims worden
-- eerst gereleaset, daarna snijplannen+rollen. De twee zijn onafhankelijk; er
-- is geen ordening-afhankelijkheid. Het terugzetten van een rol naar
-- 'beschikbaar'/'reststuk' triggert mig 111 (auto-plan) non-blocking — gewenst:
-- vrijgekomen capaciteit wordt heraangeboden aan wachtende orders.

CREATE OR REPLACE FUNCTION trg_order_events_snijplan_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected_rollen BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
  -- Defensief, ook al filtert de trigger-WHEN al.
  IF NEW.event_type <> 'geannuleerd' THEN
    RETURN NEW;
  END IF;

  -- Alle nog-levende snijplannen van de order → Geannuleerd. ONGEACHT
  -- voortgang (Wacht/Gepland/Snijden/Gesneden/…): een geannuleerde order is
  -- dood. rol_id blijft behouden als audit-spoor; de status-filter sluit ze
  -- overal correct uit.
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = NEW.order_id
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.rol_id
  )
  SELECT COALESCE(ARRAY_AGG(DISTINCT rol_id) FILTER (WHERE rol_id IS NOT NULL),
                  ARRAY[]::BIGINT[])
    INTO v_affected_rollen
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_order_events_snijplan_release() IS
  'Mig 290 (ADR-0023): Snijplanning-Module event-listener. Bij een '
  '''geannuleerd''-event in order_events: alle nog-levende snijplannen van de '
  'order → Geannuleerd (ongeacht voortgang) en geraakte rollen die hun laatste '
  'actieve snijplan verliezen → beschikbaar/reststuk. Symmetrisch met '
  'trg_order_events_reservering_release (mig 255).';

DROP TRIGGER IF EXISTS trg_order_events_snijplan_release ON order_events;
CREATE TRIGGER trg_order_events_snijplan_release
  AFTER INSERT ON order_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'geannuleerd')
  EXECUTE FUNCTION trg_order_events_snijplan_release();

COMMENT ON TRIGGER trg_order_events_snijplan_release ON order_events IS
  'Mig 290 (ADR-0023): Snijplanning luistert op order_events (ADR-0006), '
  'analoog aan Reservering (mig 255) en Facturatie (mig 223).';

-- ============================================================================
-- 2. Defense-in-depth — snijplanning_overzicht sluit Geannuleerd uit
-- ============================================================================
--
-- Volledig identiek aan mig 233 (44 kolommen, posities ongewijzigd) op één
-- regel na: WHERE o.status <> 'Geannuleerd'. Bewust NIET ook 'Verzonden':
-- deze view voedt óók de fysieke rol-uitvoer (fetchRolSnijstukken) en de
-- packer (_shared/db-helpers.fetchStukken) — een Verzonden-filter zou daar
-- al-gesneden stukken verbergen. Geannuleerd is onbetwist.

CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,                                                                       -- 1
  sp.snijplan_nr,                                                              -- 2
  sp.scancode,                                                                 -- 3
  sp.status,                                                                   -- 4
  sp.rol_id,                                                                   -- 5
  sp.lengte_cm    AS snij_lengte_cm,                                           -- 6
  sp.breedte_cm   AS snij_breedte_cm,                                          -- 7
  sp.prioriteit,                                                               -- 8
  sp.planning_week,                                                            -- 9
  sp.planning_jaar,                                                            -- 10
  o.afleverdatum,                                                              -- 11
  sp.positie_x_cm,                                                             -- 12
  sp.positie_y_cm,                                                             -- 13
  sp.geroteerd,                                                                -- 14
  sp.gesneden_datum,                                                           -- 15
  sp.gesneden_op,                                                              -- 16
  sp.gesneden_door,                                                            -- 17
  r.rolnummer,                                                                 -- 18
  r.breedte_cm    AS rol_breedte_cm,                                           -- 19
  r.lengte_cm     AS rol_lengte_cm,                                            -- 20
  r.oppervlak_m2  AS rol_oppervlak_m2,                                         -- 21
  r.status        AS rol_status,                                               -- 22
  p.locatie       AS locatie,                                                  -- 23 (producten.locatie -- voorraad)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,  -- 24
  COALESCE(r.kleur_code,     p.kleur_code,     oreg.maatwerk_kleur_code)     AS kleur_code,      -- 25
  oreg.artikelnr,                                                              -- 26
  p.omschrijving  AS product_omschrijving,                                     -- 27
  p.karpi_code,                                                                -- 28
  oreg.maatwerk_vorm,                                                          -- 29
  oreg.maatwerk_lengte_cm,                                                     -- 30
  oreg.maatwerk_breedte_cm,                                                    -- 31
  oreg.maatwerk_afwerking,                                                     -- 32
  oreg.maatwerk_band_kleur,                                                    -- 33
  oreg.maatwerk_instructies,                                                   -- 34
  oreg.orderaantal,                                                            -- 35
  oreg.id         AS order_regel_id,                                           -- 36
  o.id            AS order_id,                                                 -- 37
  o.order_nr,                                                                  -- 38
  o.debiteur_nr,                                                               -- 39
  d.naam          AS klant_naam,                                               -- 40
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm, -- 41
  sp.locatie      AS snijplan_locatie,                                         -- 42
  sp.lengte_cm  + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_lengte_cm,   -- 43
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm   -- 44
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id
WHERE o.status <> 'Geannuleerd';

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'marge_cm (mig 143) = operator-semantiek (hoeveel bijsnijden). '
  'placed_lengte_cm/placed_breedte_cm (mig 233) = packer-semantiek '
  '(snij-maat na marge-ophoging). snijplan_locatie (mig 168) = '
  'sp.locatie magazijn-locatie van ingepakt stuk; los van locatie = '
  'producten.locatie voor voorraad. Mig 290: WHERE o.status <> ''Geannuleerd'' '
  '(defense-in-depth bij ADR-0023; bewust NIET ''Verzonden'').';

-- ============================================================================
-- 3. Backfill — bestaande Geannuleerd-orders met nog-levende snijplannen
-- ============================================================================
--
-- Repareert o.a. P. Dobbe's order. Dezelfde logica als de handler, in één set.

DO $$
DECLARE
  v_affected_rollen BIGINT[];
  v_aantal_sp       INTEGER;
  v_aantal_rol      INTEGER;
BEGIN
  WITH cancelled AS (
    UPDATE snijplannen sp
       SET status = 'Geannuleerd'
      FROM order_regels oreg, orders o
     WHERE sp.order_regel_id = oreg.id
       AND oreg.order_id     = o.id
       AND o.status          = 'Geannuleerd'
       AND sp.status        <> 'Geannuleerd'
    RETURNING sp.id AS sp_id, sp.rol_id
  )
  SELECT COUNT(*)::INTEGER,
         COALESCE(ARRAY_AGG(DISTINCT rol_id) FILTER (WHERE rol_id IS NOT NULL),
                  ARRAY[]::BIGINT[])
    INTO v_aantal_sp, v_affected_rollen
    FROM cancelled;

  v_aantal_rol := 0;
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    WITH freed AS (
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
         )
      RETURNING ro.id
    )
    SELECT COUNT(*)::INTEGER INTO v_aantal_rol FROM freed;
  END IF;

  RAISE NOTICE 'Mig 290 backfill: % snijplan(nen) geannuleerd, % rol(len) vrijgegeven.',
    v_aantal_sp, v_aantal_rol;
END $$;

NOTIFY pgrst, 'reload schema';
