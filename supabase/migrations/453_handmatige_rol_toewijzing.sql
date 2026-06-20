-- Migratie 453: handmatige rol-toewijzing met bescherming tegen terugdraaien (Fase 4)
--
-- Laatste van de 4 geplande fases (na Fase 1 haalbaarheid, Fase 2 express/verdringing,
-- Fase 3 productiecapaciteit). Een planner kan een snijplan-stuk handmatig naar een
-- specifieke rol verplaatsen; die keuze moet beschermd zijn tegen `auto-plan-groep`'s
-- release-en-herpak-cyclus (die normaal ALLE Gepland-stukken in de groep loslaat).
--
-- Kernontdekking: `release_gepland_stukken` krijgt één extra voorwaarde
-- (`AND NOT is_handmatig_toegewezen`) — een vergrendeld stuk behoudt zijn rol_id/positie
-- en wordt vervolgens door de AL BESTAANDE `fetchBezettePlaatsingen` (status='Gepland' op
-- in_snijplan-rollen) automatisch als bezette shelf-ruimte gezien, exact zoals al-gesneden
-- stukken al beschermd worden. Geen wijziging nodig aan de packer of aan Fase 2.

-- 1) Vergrendel-vlag
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS is_handmatig_toegewezen BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN snijplannen.is_handmatig_toegewezen IS
  'Mig 453 (Fase 4): TRUE = een planner heeft dit stuk handmatig aan rol_id toegewezen via '
  'wijs_snijplan_handmatig_toe(). release_gepland_stukken() slaat vergrendelde stukken over, '
  'zodat auto-plan-groep de keuze nooit terugdraait. Ontgrendelen via '
  'ontgrendel_handmatige_toewijzing() (zet false + geeft vrij).';

-- 2) snijplanning_overzicht +1 kolom (additief, zelfde patroon als mig 450)
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
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm,
  sp.locatie AS snijplan_locatie,
  sp.lengte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_lengte_cm,
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS placed_breedte_cm,
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
WHERE o.status <> 'Geannuleerd'::order_status;

-- 3) release_gepland_stukken: vergrendelde stukken overslaan (volledige mig-133-body
--    + 1 voorwaarde — idempotent via CREATE OR REPLACE).
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
       -- Mig 453 (Fase 4): handmatig vergrendelde stukken nooit loslaten.
       AND NOT sn.is_handmatig_toegewezen
    RETURNING sn.id AS snijplan_id, ro.id AS rol_id
  )
  SELECT COUNT(*)::INTEGER,
         COALESCE(ARRAY_AGG(DISTINCT rol_id), ARRAY[]::BIGINT[])
    INTO v_released, v_affected_rollen
    FROM cleared;

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
  '(snijden_gestart_op IS NOT NULL) of handmatig vergrendeld zijn (mig 453, is_handmatig_toegewezen). '
  'Returnt aantal vrijgegeven snijplannen.';

-- 4) Kandidaat-rollen voor de handmatige-toewijzing-dropdown (frontend roept dit
--    rechtstreeks aan via supabase-js .rpc() — geen edge-function-tussenstap nodig
--    voor de lijst-query, alleen voor de positiebepaling bij het bevestigen).
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
      sn.lengte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm) AS benodigd_lengte_cm,
      sn.breedte_cm + stuk_snij_marge_cm(orr.maatwerk_afwerking, orr.maatwerk_vorm) AS benodigd_breedte_cm
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
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

COMMENT ON FUNCTION kandidaat_rollen_voor_handmatige_toewijzing(BIGINT) IS
  'Mig 453 (Fase 4): compatibele (zelfde/uitwisselbare kwaliteit+kleur), fysiek groot genoeg, '
  'nog niet fysiek onder het mes zittende rollen voor een snijplan-stuk — voedt de '
  'handmatige-toewijzing-dropdown.';

-- 5) Handmatig toewijzen — atomaire schrijfactie (de positiebepaling op de doelrol
--    gebeurt vóóraf in de edge function wijs-snijplan-handmatig-toe via de bestaande
--    pure packing-helpers tryPlacePiece/reconstructShelves, deze RPC committeert alleen).
CREATE OR REPLACE FUNCTION wijs_snijplan_handmatig_toe(
  p_snijplan_id BIGINT,
  p_rol_id BIGINT,
  p_positie_x_cm NUMERIC,
  p_positie_y_cm NUMERIC,
  p_geroteerd BOOLEAN
) RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_oude_rol_id BIGINT;
  v_status snijplan_status;
  v_kwaliteit TEXT;
  v_kleur TEXT;
BEGIN
  SELECT sn.rol_id, sn.status, orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
    INTO v_oude_rol_id, v_status, v_kwaliteit, v_kleur
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
   WHERE sn.id = p_snijplan_id
   FOR UPDATE OF sn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijplan % niet gevonden', p_snijplan_id;
  END IF;

  IF v_status NOT IN ('Wacht', 'Gepland', 'Wacht op inkoop') THEN
    RAISE EXCEPTION 'Snijplan % staat op status % — kan niet meer handmatig herplaatst worden', p_snijplan_id, v_status;
  END IF;

  PERFORM 1 FROM rollen ro
   WHERE ro.id = p_rol_id
     AND ro.status IN ('beschikbaar', 'reststuk', 'in_snijplan')
     AND ro.snijden_gestart_op IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % is niet bruikbaar (al in productie of niet beschikbaar)', p_rol_id;
  END IF;

  -- Eerst lospeuteren van de huidige toewijzing (mirrort release_gepland_stukken
  -- voor deze ene rij) — werkt zowel voor een auto-geplaatst als een al
  -- handmatig vergrendeld stuk. Bij Wacht-op-inkoop wordt de virtuele-rol-claim
  -- losgemaakt; de aggregaat-cleanup op inkooporder_regels.snijplan_gebruikte_lengte_cm
  -- gebeurt niet hier maar via de auto-plan-groep-trigger die de caller direct na
  -- deze RPC doet — dit stuk telt dan niet meer mee in die hertelling.
  UPDATE snijplannen
     SET rol_id = NULL,
         positie_x_cm = NULL,
         positie_y_cm = NULL,
         geroteerd = false,
         verwacht_inkooporder_regel_id = NULL
   WHERE id = p_snijplan_id;

  IF v_oude_rol_id IS NOT NULL THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = v_oude_rol_id
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn2
          WHERE sn2.rol_id = v_oude_rol_id
            AND sn2.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  UPDATE snijplannen
     SET rol_id = p_rol_id,
         positie_x_cm = p_positie_x_cm,
         positie_y_cm = p_positie_y_cm,
         geroteerd = p_geroteerd,
         status = 'Gepland',
         is_handmatig_toegewezen = true
   WHERE id = p_snijplan_id;

  UPDATE rollen
     SET status = 'in_snijplan'
   WHERE id = p_rol_id
     AND status <> 'in_snijplan';

  RETURN QUERY SELECT v_kwaliteit, v_kleur;
END;
$$;

COMMENT ON FUNCTION wijs_snijplan_handmatig_toe(BIGINT, BIGINT, NUMERIC, NUMERIC, BOOLEAN) IS
  'Mig 453 (Fase 4): wijst één snijplan handmatig toe aan een specifieke rol+positie en '
  'vergrendelt het (is_handmatig_toegewezen=true) — beschermt tegen release_gepland_stukken. '
  'Werkt zowel voor een nog-niet-geplaatst stuk als voor het verplaatsen van een al-geplaatst '
  '(ook al-vergrendeld) stuk naar een andere rol. Retourneert de bestelde kwaliteit/kleur zodat '
  'de caller direct daarna auto-plan-groep kan triggeren voor de rest van de groep.';

-- 6) Ontgrendelen — geeft het stuk vrij voor de normale automatische heroptimalisatie.
CREATE OR REPLACE FUNCTION ontgrendel_handmatige_toewijzing(p_snijplan_id BIGINT)
RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_oude_rol_id BIGINT;
  v_kwaliteit TEXT;
  v_kleur TEXT;
BEGIN
  SELECT sn.rol_id, orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
    INTO v_oude_rol_id, v_kwaliteit, v_kleur
    FROM snijplannen sn
    JOIN order_regels orr ON orr.id = sn.order_regel_id
   WHERE sn.id = p_snijplan_id
   FOR UPDATE OF sn;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijplan % niet gevonden', p_snijplan_id;
  END IF;

  IF v_oude_rol_id IS NOT NULL THEN
    PERFORM 1 FROM rollen WHERE id = v_oude_rol_id AND snijden_gestart_op IS NOT NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'Rol is al fysiek onder het mes — kan niet meer ontgrendeld worden';
    END IF;
  END IF;

  UPDATE snijplannen
     SET rol_id = NULL,
         positie_x_cm = NULL,
         positie_y_cm = NULL,
         geroteerd = false,
         is_handmatig_toegewezen = false
   WHERE id = p_snijplan_id;

  IF v_oude_rol_id IS NOT NULL THEN
    UPDATE rollen ro
       SET status = CASE
                      WHEN ro.oorsprong_rol_id IS NOT NULL THEN 'reststuk'
                      ELSE 'beschikbaar'
                    END
     WHERE ro.id = v_oude_rol_id
       AND ro.status = 'in_snijplan'
       AND ro.snijden_gestart_op IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM snijplannen sn2
          WHERE sn2.rol_id = v_oude_rol_id
            AND sn2.status IN ('Gepland', 'Snijden', 'Gesneden')
       );
  END IF;

  RETURN QUERY SELECT v_kwaliteit, v_kleur;
END;
$$;

COMMENT ON FUNCTION ontgrendel_handmatige_toewijzing(BIGINT) IS
  'Mig 453 (Fase 4): wist is_handmatig_toegewezen en geeft het stuk vrij (rol_id/positie NULL) '
  'zodat de volgende auto-plan-groep-run het weer normaal meeneemt. Retourneert de bestelde '
  'kwaliteit/kleur zodat de caller direct daarna auto-plan-groep kan triggeren.';

NOTIFY pgrst, 'reload schema';
