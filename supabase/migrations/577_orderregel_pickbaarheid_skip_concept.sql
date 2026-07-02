-- 577: Concept-orders uit Pick & Ship
--
-- Een Concept-order (e-mail/Shopify/EDI-intake, nog niet bevestigd) krijgt via
-- trg_orderregel_herallocateer al echte voorraadclaims bij het inserten van de
-- regels, waardoor is_pickbaar=true en de order in Pick & Ship verscheen
-- (46 live gevallen, o.a. ORD-2026-1165). Het status-filter in
-- orderregel_pickbaarheid sloot alleen Verzonden/Geannuleerd uit.
-- Fix: 'Concept' toevoegen aan het filter — zelfde precedent als
-- orders_zonder_vervoerder (mig 372) en hst_verzend_monitor (mig 338).
-- Geen rijen in orderregel_pickbaarheid = geen rij in order_pickbaarheid =
-- niet zichtbaar; bij bevestiging (Concept -> vervolgstatus) verschijnen de
-- rijen vanzelf weer. Live geverifieerd: geen enkele Concept-order heeft een
-- actieve zending (Gepland/Picken), dus de mig 476-OR-tak wordt niet geraakt.
--
-- Body = letterlijke live definitie (pg_get_viewdef, 2026-07-02 — superset
-- van mig 386 met de manco-kolommen van mig 518/521); enige wijziging is het
-- status-filter onderaan.

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
    SELECT sp.order_regel_id,
        count(*) AS totaal_stuks,
        count(*) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS pickbaar_stuks,
        min(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS locatie,
        min(
            CASE sp.status
                WHEN 'Wacht'::snijplan_status THEN 1
                WHEN 'Gepland'::snijplan_status THEN 2
                WHEN 'Snijden'::snijplan_status THEN 2
                WHEN 'Gesneden'::snijplan_status THEN 3
                WHEN 'In confectie'::snijplan_status THEN 4
                WHEN 'In productie'::snijplan_status THEN 5
                WHEN 'Gereed'::snijplan_status THEN 6
                WHEN 'Ingepakt'::snijplan_status THEN 7
                ELSE NULL::integer
            END) AS slechtste_rang
       FROM snijplannen sp
      WHERE sp.status <> 'Geannuleerd'::snijplan_status
      GROUP BY sp.order_regel_id
    ), voorraad_claim AS (
     SELECT rsv.order_regel_id,
        sum(rsv.aantal) AS totaal_geclaimd
       FROM order_reserveringen rsv
      WHERE rsv.bron = 'voorraad'::text AND rsv.status = 'actief'::text
      GROUP BY rsv.order_regel_id
    ), rol_locatie_per_artikel AS (
     SELECT DISTINCT ON (r.artikelnr) r.artikelnr,
        ml.code
       FROM rollen r
         JOIN magazijn_locaties ml ON ml.id = r.locatie_id
      WHERE r.status = 'beschikbaar'::text AND r.locatie_id IS NOT NULL
      ORDER BY r.artikelnr, r.id
    )
SELECT oreg.id AS order_regel_id,
    oreg.order_id,
    oreg.regelnummer,
    oreg.artikelnr,
    oreg.is_maatwerk,
    oreg.orderaantal,
    oreg.maatwerk_lengte_cm,
    oreg.maatwerk_breedte_cm,
    oreg.omschrijving,
    oreg.maatwerk_kwaliteit_code,
    oreg.maatwerk_kleur_code,
    ma.totaal_stuks,
    ma.pickbaar_stuks,
    CASE
        WHEN oreg.pick_backorder_sinds IS NOT NULL THEN false
        WHEN oreg.is_maatwerk THEN COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
        ELSE COALESCE(vc.totaal_geclaimd >= oreg.te_leveren, false)
    END AS is_pickbaar,
    CASE
        WHEN oreg.is_maatwerk THEN 'snijplan'::text
        WHEN rl.code IS NOT NULL THEN 'rol'::text
        WHEN p.locatie IS NOT NULL THEN 'producten_default'::text
        ELSE NULL::text
    END AS bron,
    CASE
        WHEN oreg.is_maatwerk THEN ma.locatie
        ELSE COALESCE(rl.code, p.locatie)
    END AS fysieke_locatie,
    CASE
        WHEN oreg.pick_backorder_sinds IS NOT NULL THEN 'manco'::text
        WHEN oreg.is_maatwerk THEN
        CASE
            WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 2 THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 4 THEN 'confectie'::text
            WHEN ma.slechtste_rang <= 6 THEN 'inpak'::text
            ELSE NULL::text
        END
        ELSE
        CASE
            WHEN COALESCE(vc.totaal_geclaimd, 0::bigint) < COALESCE(oreg.te_leveren, 0) THEN 'inkoop'::text
            ELSE NULL::text
        END
    END AS wacht_op,
    oreg.gewicht_kg
   FROM order_regels oreg
     JOIN orders o ON o.id = oreg.order_id
     LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
     LEFT JOIN maatwerk_aggr ma ON ma.order_regel_id = oreg.id
     LEFT JOIN voorraad_claim vc ON vc.order_regel_id = oreg.id
     LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
  WHERE o.status NOT IN ('Verzonden'::order_status, 'Geannuleerd'::order_status, 'Concept'::order_status)
    AND NOT is_admin_pseudo(oreg.artikelnr);
