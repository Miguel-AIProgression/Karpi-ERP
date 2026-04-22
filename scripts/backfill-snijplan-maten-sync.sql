-- ============================================================================
-- Backfill: snijplan-maten synchroniseren + ontbrekende snijplannen aanmaken
-- ============================================================================
-- BESTEL VAN TOEPASSING:
--   1. Voer migratie 110 + 111 toe (via Supabase Studio → SQL Editor of CLI).
--   2. Draai eerst SECTIE 0 (PREVIEW) en controleer de aantallen.
--   3. Draai SECTIE 1 (veilig — snijplannen zonder rol).
--   4. Lees de waarschuwingen over SECTIE 2 voordat je hem draait
--      (release + re-planning van bestaande rol-toewijzingen).
--   5. Draai SECTIE 3 (ontbrekende snijplannen aanmaken).
--   6. Draai `node scripts/herplan-alle-groepen.mjs` om auto-plan voor alle
--      getroffen groepen opnieuw te laten lopen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SECTIE 0 — PREVIEW (alleen SELECT, wijzigt niets)
-- ----------------------------------------------------------------------------

-- 0.1 — Snijplannen 100×100 die desync zijn met hun order_regel
SELECT
  o.order_nr,
  sp.snijplan_nr,
  sp.id                        AS snijplan_id,
  orr.maatwerk_kwaliteit_code  AS kw,
  orr.maatwerk_kleur_code      AS kleur,
  sp.lengte_cm                 AS snij_l,
  sp.breedte_cm                AS snij_b,
  orr.maatwerk_lengte_cm::int  AS regel_l,
  orr.maatwerk_breedte_cm::int AS regel_b,
  sp.rol_id,
  sp.status::text              AS status,
  o.afleverdatum
FROM snijplannen sp
JOIN order_regels orr ON orr.id = sp.order_regel_id
JOIN orders o         ON o.id  = orr.order_id
WHERE sp.lengte_cm = 100
  AND sp.breedte_cm = 100
  AND (orr.maatwerk_lengte_cm  IS DISTINCT FROM 100
    OR orr.maatwerk_breedte_cm IS DISTINCT FROM 100)
  AND orr.maatwerk_lengte_cm  IS NOT NULL
  AND orr.maatwerk_breedte_cm IS NOT NULL
ORDER BY (sp.rol_id IS NOT NULL) DESC, o.afleverdatum NULLS LAST;

-- 0.2 — Order_regels zonder snijplan (maten zijn bekend, order is open)
SELECT
  o.order_nr,
  orr.id                       AS regel_id,
  orr.maatwerk_kwaliteit_code  AS kw,
  orr.maatwerk_kleur_code      AS kleur,
  orr.maatwerk_lengte_cm::int  AS regel_l,
  orr.maatwerk_breedte_cm::int AS regel_b,
  o.afleverdatum,
  o.status::text               AS order_status
FROM order_regels orr
JOIN orders o ON o.id = orr.order_id
LEFT JOIN snijplannen sp ON sp.order_regel_id = orr.id
WHERE orr.is_maatwerk = true
  AND orr.maatwerk_lengte_cm  IS NOT NULL
  AND orr.maatwerk_breedte_cm IS NOT NULL
  AND sp.id IS NULL
  AND o.status::text NOT IN ('Geannuleerd', 'Afgerond', 'Gesloten')
ORDER BY o.afleverdatum NULLS LAST;

-- 0.3 — Getroffen (kwaliteit, kleur) groepen — deze moeten straks herplanned
SELECT DISTINCT orr.maatwerk_kwaliteit_code AS kwaliteit_code,
                orr.maatwerk_kleur_code     AS kleur_code
FROM order_regels orr
LEFT JOIN snijplannen sp ON sp.order_regel_id = orr.id
WHERE orr.is_maatwerk = true
  AND orr.maatwerk_lengte_cm  IS NOT NULL
  AND orr.maatwerk_breedte_cm IS NOT NULL
  AND (
    sp.id IS NULL
    OR (sp.lengte_cm = 100 AND sp.breedte_cm = 100
        AND (orr.maatwerk_lengte_cm IS DISTINCT FROM 100
          OR orr.maatwerk_breedte_cm IS DISTINCT FROM 100))
  )
  AND orr.maatwerk_kwaliteit_code IS NOT NULL
  AND orr.maatwerk_kleur_code     IS NOT NULL
ORDER BY 1, 2;


-- ----------------------------------------------------------------------------
-- SECTIE 1 — snijplan-maten corrigeren (ZONDER rol: volledig veilig)
-- ----------------------------------------------------------------------------
-- Synchroniseert lengte_cm/breedte_cm met order_regel. Alleen rijen waar
-- nog geen rol is toegewezen — planning blijft intact.

UPDATE snijplannen sp
   SET lengte_cm  = orr.maatwerk_lengte_cm::INTEGER,
       breedte_cm = orr.maatwerk_breedte_cm::INTEGER
  FROM order_regels orr
 WHERE sp.order_regel_id = orr.id
   AND sp.lengte_cm = 100
   AND sp.breedte_cm = 100
   AND (orr.maatwerk_lengte_cm  IS DISTINCT FROM 100
     OR orr.maatwerk_breedte_cm IS DISTINCT FROM 100)
   AND orr.maatwerk_lengte_cm  IS NOT NULL
   AND orr.maatwerk_breedte_cm IS NOT NULL
   AND sp.rol_id IS NULL;


-- ----------------------------------------------------------------------------
-- SECTIE 2 — snijplan-maten corrigeren + rol-toewijzing VRIJGEVEN (MET rol)
-- ----------------------------------------------------------------------------
-- ⚠️  Destructief voor bestaande planning.
--
-- Voor 17 snijplannen is de rol toegewezen op basis van 100×100; het werkelijke
-- stuk is vaak groter (bv. 300×300 op 400cm breed = nooit passend op dezelfde
-- rol als andere 300×300). We moeten de maat corrigeren én rol_id=NULL zetten
-- zodat auto-plan opnieuw plant met de correcte dimensies.
--
-- We raken alleen snijplannen aan waarvan de rol NOG NIET in productie is
-- (`rollen.snijden_gestart_op IS NULL`). Fysiek lopende rollen blijven
-- intact — corrigeer die met de hand indien nodig.

UPDATE snijplannen sp
   SET lengte_cm  = orr.maatwerk_lengte_cm::INTEGER,
       breedte_cm = orr.maatwerk_breedte_cm::INTEGER,
       rol_id     = NULL,
       status     = 'Snijden'::snijplan_status,
       positie_x_cm = NULL,
       positie_y_cm = NULL,
       geroteerd    = false
  FROM order_regels orr, rollen r
 WHERE sp.order_regel_id = orr.id
   AND sp.rol_id = r.id
   AND sp.lengte_cm = 100
   AND sp.breedte_cm = 100
   AND (orr.maatwerk_lengte_cm  IS DISTINCT FROM 100
     OR orr.maatwerk_breedte_cm IS DISTINCT FROM 100)
   AND orr.maatwerk_lengte_cm  IS NOT NULL
   AND orr.maatwerk_breedte_cm IS NOT NULL
   AND sp.rol_id IS NOT NULL
   AND r.snijden_gestart_op IS NULL
   AND sp.status IN ('Wacht', 'Gepland', 'Snijden');


-- ----------------------------------------------------------------------------
-- SECTIE 3 — ontbrekende snijplannen aanmaken (regels zonder snijplan)
-- ----------------------------------------------------------------------------
-- Voor order_regels met is_maatwerk=true + maten ingevuld maar zonder snijplan
-- (trigger nooit gevuurd, meestal omdat is_maatwerk later op true gezet is).

INSERT INTO snijplannen (snijplan_nr, order_regel_id, lengte_cm, breedte_cm, status, opmerkingen)
SELECT
  volgend_nummer('SNIJ'),
  orr.id,
  orr.maatwerk_lengte_cm::INTEGER,
  orr.maatwerk_breedte_cm::INTEGER,
  'Wacht'::snijplan_status,
  'Auto-aangemaakt (backfill)'
FROM order_regels orr
JOIN orders o ON o.id = orr.order_id
LEFT JOIN snijplannen sp ON sp.order_regel_id = orr.id
WHERE orr.is_maatwerk = true
  AND orr.maatwerk_lengte_cm  IS NOT NULL
  AND orr.maatwerk_breedte_cm IS NOT NULL
  AND sp.id IS NULL
  AND o.status::text NOT IN ('Geannuleerd', 'Afgerond', 'Gesloten');


-- ----------------------------------------------------------------------------
-- SECTIE 4 — herplannen (shell, NIET in dit SQL-script)
-- ----------------------------------------------------------------------------
-- Draai na afloop — NB. migratie 111's INSERT-trigger zou al voor SECTIE 3
-- auto-plan getriggerd hebben; deze manual herplan dekt óók SECTIE 1 + 2.
--
--   node scripts/herplan-alle-groepen.mjs
--
-- Voor één specifieke groep:
--   node scripts/herplan-alle-groepen.mjs LUXR 35
