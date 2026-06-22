-- Migratie 463: snij-marge negeren wanneer korte zijde al exact de standaard
-- rolbreedte is (bv. 400×400 rond op een 400cm-rol — geen ruimte voor de
-- gebruikelijke +5cm vorm-marge, en dat is in de praktijk geen probleem).
--
-- Aanleiding: LUXR 14, een 400×400 rond stuk (order OUD-26559570) zat
-- blijvend in Tekort en de tekort-analyse meldde ten onrechte "past niet eens
-- op een rol van 400cm breed" — `stuk_snij_marge_cm` telt voor ronde/ovale
-- vormen altijd +5cm op, ook als er geen ruimte (meer) voor is omdat de korte
-- zijde de rolbreedte al exact opvult. Bevestigd met gebruiker: alleen de
-- vorm-marge krijgt deze uitzondering (niet de ZO-afwerking-marge, 6cm,
-- andere fysieke reden), en de uitzondering moet zowel de fit-check als de
-- snij-instructie op het scanstation raken.
--
-- `marge_cm` wordt uitsluitend hier berekend en als kolom doorgegeven — het
-- scanstation (rol-uitvoer-modal.tsx → derive.ts) leest die kolom 1-op-1
-- zonder eigen marge-logica, dus deze migratie volstaat (geen frontend-wijziging).

-- 1) stuk_snij_marge_cm: 3 optionele parameters erbij. Backward-compatible —
--    een 2-argument-aanroep evalueert de clamp niet (standaard_breedte_cm is
--    dan NULL) en geeft exact het oude resultaat. CREATE OR REPLACE vervangt
--    een functie alleen bij identieke signature (parameter-types) — bij een
--    nieuwe arity (2 → 5 params) blijft de oude overload anders naast de
--    nieuwe bestaan en wordt een aanroep met exact 2 argumenten ambigu. De
--    oude 2-argument-vorm wordt nergens los meer aangeroepen (alle 3 call-
--    sites hieronder geven expliciet alle 5 argumenten door), dus veilig te
--    droppen.
DROP FUNCTION IF EXISTS stuk_snij_marge_cm(TEXT, TEXT);

CREATE OR REPLACE FUNCTION stuk_snij_marge_cm(
  afwerking TEXT,
  vorm TEXT,
  lengte_cm INTEGER DEFAULT NULL,
  breedte_cm INTEGER DEFAULT NULL,
  standaard_breedte_cm INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO' THEN 6 ELSE 0 END,
    CASE
      -- Korte zijde (de enige échte fysieke grens — rollengte is altijd
      -- uitbreidbaar) is al exact de standaard rolbreedte: geen vorm-marge
      -- nodig/mogelijk. Bewust exacte match, geen >=, anders verdwijnt een
      -- écht te groot stuk ten onrechte uit de tekort-melding.
      WHEN standaard_breedte_cm IS NOT NULL
       AND lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL
       AND LEAST(lengte_cm, breedte_cm) = standaard_breedte_cm
        THEN 0
      WHEN lower(COALESCE(vorm, '')) IN (
        'rond', 'ovaal',
        'organisch_a', 'organisch_b_sp',
        'pebble', 'ellips', 'afgeronde_hoeken'
      ) THEN 5
      ELSE 0
    END
  );
$$;

COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Mig 463: vorm-marge (5cm) wordt 0 als de korte zijde van het stuk al exact de '
  'standaard rolbreedte is (bv. 400×400 rond op een 400cm-rol) — die marge is dan '
  'fysiek niet nodig/mogelijk. ZO-afwerking-marge (6cm) blijft altijd ongewijzigd. '
  'De 3 extra parameters zijn optioneel (DEFAULT NULL) zodat oude 2-argument-'
  'aanroepen ongewijzigd blijven werken.';

-- 2) snijplanning_overzicht: +1 join naar kwaliteiten, uitgebreide aanroepen
--    voor marge_cm/placed_lengte_cm/placed_breedte_cm (volledige bestaande
--    body, additief, zelfde patroon als mig 450/453).
CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,
  sp.snijplan_nr,
  sp.scancode,
  sp.status,
  sp.rol_id,
  sp.lengte_cm AS snij_lengte_cm,
  sp.breedte_cm AS snij_breedte_cm,
  sp.prioriteit,
  sp.planning_week,
  sp.planning_jaar,
  o.afleverdatum,
  sp.positie_x_cm,
  sp.positie_y_cm,
  sp.geroteerd,
  sp.gesneden_datum,
  sp.gesneden_op,
  sp.gesneden_door,
  r.rolnummer,
  r.breedte_cm AS rol_breedte_cm,
  r.lengte_cm AS rol_lengte_cm,
  r.oppervlak_m2 AS rol_oppervlak_m2,
  r.status AS rol_status,
  p.locatie,
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,
  COALESCE(r.kleur_code, p.kleur_code, oreg.maatwerk_kleur_code) AS kleur_code,
  oreg.artikelnr,
  p.omschrijving AS product_omschrijving,
  p.karpi_code,
  oreg.maatwerk_vorm,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.maatwerk_afwerking,
  oreg.maatwerk_band_kleur,
  oreg.maatwerk_instructies,
  oreg.orderaantal,
  oreg.id AS order_regel_id,
  o.id AS order_id,
  o.order_nr,
  o.debiteur_nr,
  d.naam AS klant_naam,
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS marge_cm,
  sp.locatie AS snijplan_locatie,
  sp.lengte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_lengte_cm,
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_breedte_cm,
  o.alleen_productie,
  o.oud_order_nr,
  oreg.snijden_uit_standaardmaat,
  o.lever_type,
  sp.verwacht_inkooporder_regel_id,
  o.express,
  sp.is_handmatig_toegewezen
FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  JOIN orders o ON o.id = oreg.order_id
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
  LEFT JOIN rollen r ON r.id = sp.rol_id
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
WHERE o.status <> 'Geannuleerd'::order_status;

-- 3) snijplanning_tekort_analyse(): stuk_checks-CTE krijgt dezelfde join +
--    uitgebreide aanroepen (volledige bestaande body, mig 439).
CREATE OR REPLACE FUNCTION public.snijplanning_tekort_analyse()
RETURNS TABLE(kwaliteit_code text, kleur_code text, heeft_collectie boolean, uitwisselbare_codes text[], aantal_beschikbaar integer, totaal_beschikbaar_m2 numeric, max_lange_zijde_cm integer, max_korte_zijde_cm integer, grootste_onpassend_stuk_lange_cm integer, grootste_onpassend_stuk_korte_cm integer)
LANGUAGE sql
STABLE
AS $function$
  WITH groepen AS (
    SELECT DISTINCT so.kwaliteit_code, so.kleur_code
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.kwaliteit_code IS NOT NULL
      AND so.kleur_code     IS NOT NULL
  ),
  paren AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      up.target_kwaliteit_code AS target_kw,
      up.target_kleur_code     AS target_kl_norm,
      up.is_zelf
    FROM groepen g
    CROSS JOIN LATERAL uitwisselbare_paren(g.kwaliteit_code, g.kleur_code) up
  ),
  zusters AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      EXISTS (
        SELECT 1 FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
          AND NOT p.is_zelf
      ) AS heeft_collectie,
      (SELECT ARRAY_AGG(DISTINCT p.target_kw ORDER BY p.target_kw)
         FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
      ) AS codes
    FROM groepen g
  ),
  rollen_per_groep AS (
    SELECT
      p.kwaliteit_code,
      p.kleur_code,
      r.id                                AS rol_id,
      GREATEST(r.lengte_cm, r.breedte_cm) AS rol_lange,
      LEAST(r.lengte_cm, r.breedte_cm)    AS rol_korte,
      COALESCE(r.oppervlak_m2, 0)         AS m2
    FROM paren p
    JOIN rollen r
      ON r.status IN ('beschikbaar', 'reststuk')
     AND r.kwaliteit_code = p.target_kw
     AND normaliseer_kleur_code(r.kleur_code) = p.target_kl_norm
     AND r.lengte_cm  > 0
     AND r.breedte_cm > 0
  ),
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC   AS totaal_m2
    FROM rollen_per_groep
    GROUP BY kwaliteit_code, kleur_code
  ),
  best_rol AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, rol_lange, rol_korte
    FROM rollen_per_groep
    ORDER BY kwaliteit_code, kleur_code, rol_korte DESC, rol_lange DESC
  ),
  stuk_checks AS (
    SELECT so.kwaliteit_code,
           so.kleur_code,
           GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm, so.snij_lengte_cm, so.snij_breedte_cm, k2.standaard_breedte_cm) AS stuk_lange,
           LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm, so.snij_lengte_cm, so.snij_breedte_cm, k2.standaard_breedte_cm) AS stuk_korte,
           EXISTS (
             SELECT 1 FROM rollen_per_groep rpg
             WHERE rpg.kwaliteit_code = so.kwaliteit_code
               AND rpg.kleur_code     = so.kleur_code
               AND rpg.rol_lange >= GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm, so.snij_lengte_cm, so.snij_breedte_cm, k2.standaard_breedte_cm)
               AND rpg.rol_korte >= LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm, so.snij_lengte_cm, so.snij_breedte_cm, k2.standaard_breedte_cm)
           ) AS past
    FROM snijplanning_overzicht so
    LEFT JOIN kwaliteiten k2 ON k2.code = so.kwaliteit_code
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.snij_lengte_cm  IS NOT NULL
      AND so.snij_breedte_cm IS NOT NULL
      AND so.snij_lengte_cm  > 0
      AND so.snij_breedte_cm > 0
  ),
  grootste_onpassend AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, stuk_lange, stuk_korte
    FROM stuk_checks
    WHERE past = FALSE
    ORDER BY kwaliteit_code, kleur_code, stuk_lange DESC, stuk_korte DESC
  )
  SELECT z.kwaliteit_code,
         z.kleur_code,
         z.heeft_collectie,
         z.codes,
         COALESCE(agg.aantal,    0),
         COALESCE(agg.totaal_m2, 0),
         COALESCE(br.rol_lange,  0)::INTEGER AS max_lange_zijde_cm,
         COALESCE(br.rol_korte,  0)::INTEGER AS max_korte_zijde_cm,
         COALESCE(go.stuk_lange, 0)::INTEGER AS grootste_onpassend_stuk_lange_cm,
         COALESCE(go.stuk_korte, 0)::INTEGER AS grootste_onpassend_stuk_korte_cm
  FROM zusters z
  LEFT JOIN agg                   ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code  = z.kwaliteit_code AND br.kleur_code  = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code  = z.kwaliteit_code AND go.kleur_code  = z.kleur_code;
$function$;

-- 4) kandidaat_rollen_voor_handmatige_toewijzing(): stuk-CTE krijgt dezelfde
--    join + uitgebreide aanroepen (volledige bestaande body, mig 453).
CREATE OR REPLACE FUNCTION kandidaat_rollen_voor_handmatige_toewijzing(p_snijplan_id BIGINT)
RETURNS TABLE(
  rol_id BIGINT,
  rolnummer TEXT,
  breedte_cm INTEGER,
  lengte_cm INTEGER,
  status TEXT,
  kwaliteit_code TEXT,
  kleur_code TEXT,
  is_exact BOOLEAN
)
LANGUAGE sql STABLE AS $$
  WITH stuk AS (
    SELECT
      orr.maatwerk_kwaliteit_code AS kwaliteit_code,
      orr.maatwerk_kleur_code AS kleur_code,
      sn.lengte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm, sn.lengte_cm, sn.breedte_cm, k.standaard_breedte_cm) AS benodigd_lengte_cm,
      sn.breedte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm, sn.lengte_cm, sn.breedte_cm, k.standaard_breedte_cm) AS benodigd_breedte_cm
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
    LEFT JOIN kwaliteiten k ON k.code = orr.maatwerk_kwaliteit_code
    WHERE sn.id = p_snijplan_id
  ),
  paren AS (
    SELECT p.target_kwaliteit_code, p.target_kleur_code, p.is_zelf
    FROM stuk s, uitwisselbare_paren(s.kwaliteit_code, s.kleur_code) p
  )
  SELECT
    ro.id AS rol_id,
    ro.rolnummer,
    ro.breedte_cm,
    ro.lengte_cm,
    ro.status,
    ro.kwaliteit_code,
    ro.kleur_code,
    p.is_zelf AS is_exact
  FROM stuk s
  JOIN paren p ON true
  JOIN rollen ro
    ON ro.kwaliteit_code = p.target_kwaliteit_code
   AND ro.kleur_code IN (p.target_kleur_code, p.target_kleur_code || '.0')
  WHERE ro.status IN ('beschikbaar', 'reststuk', 'in_snijplan')
    AND ro.snijden_gestart_op IS NULL
    AND (
      (ro.breedte_cm >= s.benodigd_breedte_cm AND ro.lengte_cm >= s.benodigd_lengte_cm)
      OR (ro.breedte_cm >= s.benodigd_lengte_cm AND ro.lengte_cm >= s.benodigd_breedte_cm)
    )
  ORDER BY is_exact DESC, ro.rolnummer;
$$;

NOTIFY pgrst, 'reload schema';
