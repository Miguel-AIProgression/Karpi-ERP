-- ============================================================================
-- Reset 'Snijden'-status snijplannen naar 'Gepland' + rol.snijden_gestart_op
-- voor een volledige herplan-run met het nieuwe best-of-both + reststuk-aware
-- algoritme.
-- ============================================================================
--
-- WAAROM: de normale auto-plan flow (release_gepland_stukken) raakt alleen
-- stukken met status='Gepland' op rollen waar snijden_gestart_op IS NULL.
-- Stukken die al op 'Snijden' staan (snijder heeft 'Start productie' geklikt)
-- blijven buiten beschouwing — ook als fysiek nog geen stuk is afgesneden.
--
-- Dit script corrigeert dat eenmalig: alle 'Snijden'-stukken waarvan
-- `gesneden_op IS NULL` (= nog niet fysiek afgesneden) worden teruggezet naar
-- 'Gepland' en losgekoppeld van hun rol. De rollen waarvoor ALLE bijbehorende
-- stukken nog niet gesneden zijn, krijgen `snijden_gestart_op = NULL` terug.
--
-- ⚠️ DESTRUCTIEF — als een snijder op dit moment fysiek aan het werk is op
-- een rol die nog geen stuk heeft afgesneden, raakt die zijn "start met rol"-
-- markering kwijt en moet 'm opnieuw klikken. Uitvoeren buiten productie-uren
-- of kort voor een herplan-run.
--
-- ROLLEN MET AL-GESNEDEN STUKKEN BLIJVEN ONAANGEROERD: als er minstens 1 stuk
-- op de rol al `gesneden_op IS NOT NULL` heeft, laten we die rol met rust —
-- dat betekent dat de snijder echt bezig is en we zijn werk niet ongedaan
-- maken.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SECTIE 0 — PREVIEW (alleen SELECT, geen wijzigingen)
-- ----------------------------------------------------------------------------

-- 0.1 — Rollen waar stukken op 'Snijden' staan met gesneden_op=NULL
SELECT
  r.id                                 AS rol_id,
  r.rolnummer,
  r.kwaliteit_code,
  r.kleur_code,
  r.status::text                       AS rol_status,
  r.snijden_gestart_op,
  COUNT(sp.id) FILTER (WHERE sp.status::text = 'Snijden' AND sp.gesneden_op IS NULL) AS te_resetten,
  COUNT(sp.id) FILTER (WHERE sp.gesneden_op IS NOT NULL)                              AS al_gesneden,
  COUNT(sp.id) FILTER (WHERE sp.status::text = 'Gepland')                             AS gepland,
  COUNT(sp.id)                                                                         AS totaal_stukken
FROM rollen r
JOIN snijplannen sp ON sp.rol_id = r.id
WHERE r.snijden_gestart_op IS NOT NULL
  AND r.snijden_voltooid_op IS NULL
GROUP BY r.id, r.rolnummer, r.kwaliteit_code, r.kleur_code, r.status, r.snijden_gestart_op
HAVING COUNT(sp.id) FILTER (WHERE sp.status::text = 'Snijden' AND sp.gesneden_op IS NULL) > 0
   AND COUNT(sp.id) FILTER (WHERE sp.gesneden_op IS NOT NULL) = 0
ORDER BY r.rolnummer;

-- 0.2 — Overzicht van stukken die gereset worden
SELECT
  r.rolnummer,
  sp.id                AS snijplan_id,
  sp.status::text      AS status,
  sp.lengte_cm,
  sp.breedte_cm,
  sp.positie_x_cm,
  sp.positie_y_cm,
  sp.geroteerd,
  orr.maatwerk_kwaliteit_code AS kw,
  orr.maatwerk_kleur_code     AS kleur,
  o.order_nr,
  o.afleverdatum
FROM snijplannen sp
JOIN rollen r         ON r.id = sp.rol_id
JOIN order_regels orr ON orr.id = sp.order_regel_id
JOIN orders o         ON o.id = orr.order_id
WHERE sp.status::text = 'Snijden'
  AND sp.gesneden_op IS NULL
  AND r.snijden_gestart_op IS NOT NULL
  AND r.snijden_voltooid_op IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM snijplannen sp2
    WHERE sp2.rol_id = r.id AND sp2.gesneden_op IS NOT NULL
  )
ORDER BY r.rolnummer, sp.positie_y_cm NULLS LAST;

-- 0.3 — Rollen die geskipt worden omdat er al 1+ gesneden stuk op zit
SELECT
  r.rolnummer,
  r.status::text AS rol_status,
  COUNT(sp.id) FILTER (WHERE sp.gesneden_op IS NOT NULL) AS al_gesneden,
  COUNT(sp.id) FILTER (WHERE sp.status::text = 'Snijden' AND sp.gesneden_op IS NULL) AS nog_te_snijden
FROM rollen r
JOIN snijplannen sp ON sp.rol_id = r.id
WHERE r.snijden_gestart_op IS NOT NULL
  AND r.snijden_voltooid_op IS NULL
GROUP BY r.id, r.rolnummer, r.status
HAVING COUNT(sp.id) FILTER (WHERE sp.gesneden_op IS NOT NULL) > 0
ORDER BY r.rolnummer;


-- ----------------------------------------------------------------------------
-- SECTIE 1 — RESET (UPDATE, run in één transactie)
-- ----------------------------------------------------------------------------
-- Controleer eerst SECTIE 0 voordat je dit draait.

BEGIN;

-- 1a. Snijplannen: Snijden + gesneden_op NULL → Gepland + losgekoppeld
UPDATE snijplannen sp
   SET status       = 'Gepland'::snijplan_status,
       rol_id       = NULL,
       positie_x_cm = NULL,
       positie_y_cm = NULL,
       geroteerd    = false
  FROM rollen r
 WHERE sp.rol_id = r.id
   AND sp.status::text = 'Snijden'
   AND sp.gesneden_op IS NULL
   AND r.snijden_gestart_op IS NOT NULL
   AND r.snijden_voltooid_op IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM snijplannen sp2
      WHERE sp2.rol_id = r.id
        AND sp2.gesneden_op IS NOT NULL
   );

-- 1b. Rollen: snijden_gestart_op → NULL voor rollen die nu volledig leeg zijn
--     (alle stukken losgekoppeld en geen enkel gesneden stuk over).
UPDATE rollen r
   SET snijden_gestart_op   = NULL,
       snijden_gestart_door = NULL
 WHERE r.snijden_gestart_op IS NOT NULL
   AND r.snijden_voltooid_op IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM snijplannen sp
      WHERE sp.rol_id = r.id
        AND sp.gesneden_op IS NOT NULL
   );

-- 1c. Rollen: status terug naar 'beschikbaar' als de rol volledig leeg is
--     (geen snijplannen meer gekoppeld). rollen.status is TEXT, geen enum.
UPDATE rollen r
   SET status = 'beschikbaar'
 WHERE r.status = 'in_snijplan'
   AND r.snijden_gestart_op IS NULL
   AND NOT EXISTS (SELECT 1 FROM snijplannen sp WHERE sp.rol_id = r.id);

COMMIT;


-- ----------------------------------------------------------------------------
-- SECTIE 2 — NA DE RESET: draai de herplan in je terminal
-- ----------------------------------------------------------------------------
-- $env:SUPABASE_URL="https://wqzeevfobwauxkalagtn.supabase.co"
-- $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
-- node scripts/herplan-alle-groepen.mjs
