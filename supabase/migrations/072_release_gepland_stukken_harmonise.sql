-- Migration 072: release_gepland_stukken werkend maken na status-harmonisatie.
--
-- Context: na migraties 051/052/069/070 bestaat status 'Gepland' niet meer —
-- alles staat op 'Snijden'. De legacy `release_gepland_stukken` filterde op
-- status='Gepland' en gaf daardoor altijd 0 terug. Gevolg: een goedgekeurd
-- snijvoorstel kan niet geheroptimaliseerd worden, want de oude rol-toewijzing
-- wordt niet losgelaten.
--
-- Fix: release alle snijplannen in de groep met rol_id IS NOT NULL en
-- status='Snijden' waarbij de rol nog NIET actief in productie is
-- (snijden_gestart_op IS NULL). Voor vrijgekomen rollen: reset van
-- 'in_snijplan' terug naar 'beschikbaar' / 'reststuk'.

CREATE OR REPLACE FUNCTION release_gepland_stukken(
  p_kwaliteit_code TEXT,
  p_kleur_code TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_released INTEGER := 0;
  v_kleur_varianten TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  -- 1. Verzamel snijplannen die vrijgegeven kunnen worden: status='Snijden',
  --    rol_id gezet, rol is nog niet in productie gestart.
  WITH te_releasen AS (
    SELECT sn.id AS snijplan_id, sn.rol_id
    FROM snijplannen sn
    JOIN rollen ro ON ro.id = sn.rol_id
    JOIN order_regels orr ON orr.id = sn.order_regel_id
    WHERE orr.maatwerk_kwaliteit_code = p_kwaliteit_code
      AND orr.maatwerk_kleur_code = ANY(v_kleur_varianten)
      AND sn.status = 'Snijden'
      AND sn.rol_id IS NOT NULL
      AND ro.snijden_gestart_op IS NULL
  ),
  cleared AS (
    UPDATE snijplannen sn
    SET rol_id = NULL,
        positie_x_cm = NULL,
        positie_y_cm = NULL,
        geroteerd = false
    FROM te_releasen tr
    WHERE sn.id = tr.snijplan_id
    RETURNING sn.id, tr.rol_id
  )
  SELECT COUNT(*) INTO v_released FROM cleared;

  -- 2. Reset vrijgekomen rollen: als er geen snijplannen meer naar verwijzen
  --    en de rol status='in_snijplan' had, terug naar 'beschikbaar' of 'reststuk'.
  UPDATE rollen ro
  SET status = CASE WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk' ELSE 'beschikbaar' END
  WHERE ro.status = 'in_snijplan'
    AND ro.kwaliteit_code = p_kwaliteit_code
    AND ro.kleur_code = ANY(v_kleur_varianten)
    AND NOT EXISTS (
      SELECT 1 FROM snijplannen sn
      WHERE sn.rol_id = ro.id
        AND sn.status IN ('Snijden', 'Gesneden')
    );

  RETURN v_released;
END;
$$;

COMMENT ON FUNCTION release_gepland_stukken IS
  'Release snijplannen met status=Snijden en rol_id gezet (rol niet in productie) voor heroptimalisatie. Zie migratie 072.';
