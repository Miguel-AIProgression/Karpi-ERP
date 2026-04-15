-- Migration 073: fix release_gepland_stukken — filter via rol.kwaliteit/kleur.
--
-- Migratie 072 joinede op `order_regels.maatwerk_kwaliteit_code` /
-- `maatwerk_kleur_code`, maar die zijn op historische order_regels NULL
-- (kwaliteit/kleur worden afgeleid via het product of via de rol in de view
-- `snijplanning_overzicht`). Gevolg: de release gaf 0 terug voor alles.
--
-- Fix: de vrij te geven snijplannen zijn per definitie reeds aan een rol
-- gekoppeld. Filter dus direct op de rol zijn kwaliteit/kleur.

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

  WITH cleared AS (
    UPDATE snijplannen sn
    SET rol_id = NULL,
        positie_x_cm = NULL,
        positie_y_cm = NULL,
        geroteerd = false
    FROM rollen ro
    WHERE sn.rol_id = ro.id
      AND sn.status = 'Snijden'
      AND ro.kwaliteit_code = p_kwaliteit_code
      AND ro.kleur_code = ANY(v_kleur_varianten)
      AND ro.snijden_gestart_op IS NULL
    RETURNING sn.id, ro.id AS rol_id
  )
  SELECT COUNT(*) INTO v_released FROM cleared;

  -- Reset vrijgekomen rollen: alleen die geen Snijden/Gesneden stukken meer hebben.
  UPDATE rollen ro
  SET status = CASE WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk' ELSE 'beschikbaar' END
  WHERE ro.status = 'in_snijplan'
    AND ro.kwaliteit_code = p_kwaliteit_code
    AND ro.kleur_code = ANY(v_kleur_varianten)
    AND ro.snijden_gestart_op IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM snijplannen sn
      WHERE sn.rol_id = ro.id
        AND sn.status IN ('Snijden', 'Gesneden')
    );

  RETURN v_released;
END;
$$;

COMMENT ON FUNCTION release_gepland_stukken IS
  'Release snijplannen met rol uit deze kwaliteit/kleur-groep (rol niet in productie) voor heroptimalisatie. Zie migratie 073.';
