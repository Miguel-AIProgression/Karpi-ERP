-- Migration 098: Vooruitkijkende confectie-planning view --
-- Doel: Eén view die álle open maatwerk-stukken levert (snijplan.status IN
--   Gepland/Wacht/Snijden/Gesneden/In confectie/Ingepakt) met het afgeleide
--   type_bewerking, een geschatte confectie_startdatum en de strekkende meter.
--   Bron: snijplannen + afwerking_types (voor mapping) + orders/order_regels
--   (voor klant/afleverdatum) + rollen (voor rolnummer).
--
-- Backward-compatible: levert óók de kolomnamen die de bestaande
-- ConfectiePlanningRow-components (LaneKolom/ConfectieBlokCard/AfrondModal)
-- en de SnijplanRow-based overview-tabel verwachten. Dit vermijdt een
-- generieke type-refactor van die components in deze iteratie.
--
-- Planning-logica voor confectie_startdatum:
--   Gesneden/In confectie → vandaag (direct beschikbaar)
--   Snijden              → vandaag (bijna klaar)
--   Gepland/Wacht        → COALESCE(gesneden_datum, afleverdatum − 2 dagen, vandaag)

-- Defensieve ALTER: voeg kolommen toe als ze nog niet bestaan.
-- De bestaande afrondConfectie() client-code schrijft hier al naar,
-- maar deze kolommen waren nog niet gedocumenteerd/gemigreerd.
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS confectie_afgerond_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingepakt_op           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locatie               TEXT;

-- Vooruitkijkende confectie-planning view
CREATE OR REPLACE VIEW confectie_planning_forward AS
SELECT
  -- Primaire identifiers (nieuwe namen)
  sp.id                                 AS snijplan_id,
  sp.snijplan_nr                        AS snijplan_nr,
  sp.scancode                           AS scancode,
  sp.status                             AS snijplan_status,

  -- Alias-kolommen zodat bestaande components blijven werken
  sp.id                                 AS confectie_id,     -- alias voor LaneKolom-key
  sp.snijplan_nr                        AS confectie_nr,     -- alias voor AfrondModal
  sp.status                             AS status,           -- alias voor overview-tabel

  -- Lane + derived velden
  at.type_bewerking                     AS type_bewerking,
  sp.order_regel_id                     AS order_regel_id,
  orr.order_id                          AS order_id,
  o.order_nr                            AS order_nr,
  d.naam                                AS klant_naam,
  orr.maatwerk_afwerking                AS maatwerk_afwerking,
  orr.maatwerk_band_kleur               AS maatwerk_band_kleur,
  orr.maatwerk_instructies              AS maatwerk_instructies,
  orr.maatwerk_vorm                     AS maatwerk_vorm,    -- overview-kolom
  orr.maatwerk_vorm                     AS vorm,             -- planning-kolom
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS breedte_cm,

  -- Aliassen voor overview-tabel (SnijplanRow.snij_*)
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS snij_lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS snij_breedte_cm,

  -- Strekkende meter in cm (rechthoek: 2×(l+b), rond/ovaal: π×max(l,b))
  CASE
    WHEN lower(COALESCE(orr.maatwerk_vorm, '')) IN ('rond', 'ovaal') THEN
      (pi() * GREATEST(COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0),
                       COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
    ELSE
      (2 * (COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0) +
            COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
  END                                   AS strekkende_meter_cm,

  r.id                                  AS rol_id,
  r.rolnummer                           AS rolnummer,
  orr.maatwerk_kwaliteit_code           AS kwaliteit_code,
  orr.maatwerk_kleur_code               AS kleur_code,
  sp.afleverdatum                       AS afleverdatum,

  -- Afrond-velden (direct van snijplannen, nu gegarandeerd aanwezig via ALTER boven)
  sp.confectie_afgerond_op              AS confectie_afgerond_op,
  sp.ingepakt_op                        AS ingepakt_op,
  sp.locatie                            AS locatie,

  -- Beste schatting wanneer het stuk de confectie binnenkomt
  CASE
    WHEN sp.status IN ('Gesneden', 'In confectie') THEN CURRENT_DATE
    WHEN sp.status = 'Snijden'                     THEN CURRENT_DATE
    WHEN sp.gesneden_datum IS NOT NULL             THEN sp.gesneden_datum
    WHEN sp.afleverdatum IS NOT NULL               THEN (sp.afleverdatum - INTERVAL '2 days')::date
    ELSE CURRENT_DATE
  END::date                             AS confectie_startdatum,

  sp.opmerkingen                        AS opmerkingen

FROM snijplannen sp
LEFT JOIN order_regels orr  ON orr.id        = sp.order_regel_id
LEFT JOIN orders o          ON o.id          = orr.order_id
LEFT JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN rollen r          ON r.id          = sp.rol_id
LEFT JOIN afwerking_types at ON at.code      = orr.maatwerk_afwerking
WHERE sp.status IN ('Gepland', 'Wacht', 'Snijden', 'Gesneden', 'In confectie', 'Ingepakt');

COMMENT ON VIEW confectie_planning_forward IS
  'Vooruitkijkende confectie-lijst: alle open maatwerk-snijplannen met afgeleide type_bewerking en verwachte confectie-startdatum. Biedt zowel nieuwe (snijplan_*) als legacy (confectie_*, snij_*) kolomnamen voor backward compatibility.';
