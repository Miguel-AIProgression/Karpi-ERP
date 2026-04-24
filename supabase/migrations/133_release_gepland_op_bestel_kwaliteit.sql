-- Migration 133: release_gepland_stukken filtert op BESTEL-kwaliteit i.p.v. rol-kwaliteit
-- (hernummerd van 131 → 133 vanwege naamconflict met 131_inkoop_dubbele_fks_opruimen)
--
-- ROOT CAUSE van de "verdwenen rol-koppeling bij uitwisselbare plaatsingen":
-- de vorige versie (migratie 073) koppelde losgemaakte snijplannen aan de
-- ROL waar ze op stonden: `rollen.kwaliteit_code = p_kwaliteit_code`. Zodra
-- een `auto-plan-groep(LUXR, 17)` liep, werden dus ALLE Gepland-snijplannen
-- op LUXR-rollen vrijgegeven — inclusief VERR 17-stukken die via uitwissel-
-- baarheid correct op LUXR 17-rollen geplaatst waren. De daaropvolgende
-- packer draait alleen voor LUXR 17-stukken, waardoor de VERR-stukken
-- achterbleven met `rol_id = NULL` terwijl hun `snijvoorstel` op
-- `goedgekeurd` bleef staan: state-divergentie.
--
-- FIX: filter op `order_regels.maatwerk_kwaliteit_code` /
-- `maatwerk_kleur_code` — de BESTELDE kwaliteit/kleur van het stuk. Cross-
-- kwaliteit plaatsingen blijven zo in tact: een LUXR-cycle raakt alleen
-- LUXR-stukken, ook als die op een CISC/VERR-rol liggen.
--
-- De set rollen die door de vrijgave hun laatste Gepland/Snijden/Gesneden-
-- stuk verliezen, gaat terug naar `beschikbaar` (of `reststuk` voor
-- reststuk-afgeleide rollen). Rollen waarvan `snijden_gestart_op IS NOT NULL`
-- blijven onaangeroerd: een snijder is dan fysiek aan het werk.
--
-- Idempotent via CREATE OR REPLACE. Geen data-migratie nodig — de fix heeft
-- alleen effect op volgende auto-plan-runs. Bestaande orphaned snijplannen
-- (rol_id=NULL, status=Gepland/Wacht) worden automatisch opgepakt zodra
-- auto-plan opnieuw draait voor hun eigen groep.

CREATE OR REPLACE FUNCTION release_gepland_stukken(
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_released        INTEGER    := 0;
  v_affected_rollen BIGINT[]   := ARRAY[]::BIGINT[];
  v_kleur_varianten TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  -- Vrijgave: alleen snijplannen waarvan de ORDER-REGEL bij deze bestel-
  -- groep hoort, status 'Gepland', al gekoppeld aan een rol, en die rol
  -- nog niet fysiek onder het mes zit.
  WITH cleared AS (
    UPDATE snijplannen sn
       SET rol_id       = NULL,
           positie_x_cm = NULL,
           positie_y_cm = NULL,
           geroteerd    = false
      FROM order_regels orr,
           rollen        ro
     WHERE sn.order_regel_id          = orr.id
       AND sn.rol_id                  = ro.id
       AND sn.status                  = 'Gepland'
       AND ro.snijden_gestart_op      IS NULL
       AND orr.maatwerk_kwaliteit_code = p_kwaliteit_code
       AND orr.maatwerk_kleur_code     = ANY(v_kleur_varianten)
    RETURNING sn.id AS snijplan_id, ro.id AS rol_id
  )
  SELECT COUNT(*)::INTEGER,
         COALESCE(ARRAY_AGG(DISTINCT rol_id), ARRAY[]::BIGINT[])
    INTO v_released, v_affected_rollen
    FROM cleared;

  -- Rollen die door deze vrijgave leeg zijn geraakt terug naar
  -- beschikbaar/reststuk. Een rol blijft in_snijplan als er nog Gepland-,
  -- Snijden- of Gesneden-stukken op staan (bv. van een andere groep).
  IF COALESCE(array_length(v_affected_rollen, 1), 0) > 0 THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = ANY(v_affected_rollen)
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn
          WHERE sn.rol_id = ro.id
            AND sn.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  RETURN v_released;
END;
$$;

COMMENT ON FUNCTION release_gepland_stukken(TEXT, TEXT) IS
  'Geeft Gepland-snijplannen van de BESTEL-groep (order_regels.maatwerk_kwaliteit_code/_kleur_code) '
  'vrij voor heroptimalisatie. Raakt rollen niet aan die fysiek onder het mes zitten '
  '(snijden_gestart_op IS NOT NULL). Returnt aantal vrijgegeven snijplannen. Zie migratie 133 '
  'voor root-cause fix: vorige versie filterde op rol-kwaliteit en brak daarmee cross-kwaliteit '
  'plaatsingen via uitwisselbaarheid.';
