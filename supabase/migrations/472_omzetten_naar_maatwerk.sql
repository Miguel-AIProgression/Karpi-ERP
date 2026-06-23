-- Migratie 472: orderregel omzetten naar maatwerk (vaste maat → snijden uit rol)
--
-- Achtergrond
-- -----------
-- Gebruiker beschreef de gewenste workflow: als een vaste-maat-orderregel
-- geen voorraad én geen (tijdige) inkooporder heeft, wil een medewerker 'm
-- handmatig kunnen omzetten naar maatwerk — mits het artikel (of een
-- uitwisselbaar equivalent) een rol heeft om uit te snijden. Deze
-- functionaliteit bestond nergens (geverifieerd: nul matches in de codebase).
--
-- Aanpak: hergebruik het bestaande, al-getriggerde mechanisme zo veel
-- mogelijk — geen nieuwe orchestratie.
--   1. RPC `kandidaat_rollen_voor_conversie(...)` — puur lezend, mirrort
--      `kandidaat_rollen_voor_handmatige_toewijzing` (mig 453) één-op-één maar
--      vanaf ruwe kwaliteit/kleur/maat i.p.v. een al-bestaand snijplan (dat
--      bestaat hier nog niet — de regel is nog vaste maat). Voedt de "geen rol
--      beschikbaar"-blokkade in de UI.
--   2. RPC `converteer_regel_naar_maatwerk(...)` — de eigenlijke actie. Is
--      bewust een kleine functie: de UPDATE op `order_regels` (is_maatwerk +
--      maten) triggert via twee AL BESTAANDE triggers alles wat nodig is:
--        - `trg_auto_sync_snijplan_maten` (mig 110/323, self-healing fallback)
--          maakt het/de snijplan(nen) aan zodra is_maatwerk=true + maten compleet.
--        - `trg_orderregel_herallocateer` (mig 273 e.v.) ziet
--          `OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk` en roept zelf
--          `herallocateer_orderregel` aan — die op zijn beurt (regel is nu
--          maatwerk) alle actieve `order_reserveringen` van deze regel
--          released én `herwaardeer_order_status` aanroept.
--      Geen van deze twee triggers hoeft hier dus expliciet aangeroepen te
--      worden — alleen de juiste kolommen in één UPDATE zetten is genoeg.

------------------------------------------------------------------------
-- 1. Kandidaat-rollen voor een (nog-niet-bestaande) maatwerk-conversie
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kandidaat_rollen_voor_conversie(
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT,
  p_lengte_cm      INTEGER,
  p_breedte_cm     INTEGER,
  p_afwerking      TEXT DEFAULT NULL,
  p_vorm           TEXT DEFAULT 'rechthoek'
)
RETURNS TABLE(rol_id BIGINT, rolnummer TEXT, breedte_cm INTEGER, lengte_cm INTEGER, status TEXT, kwaliteit_code TEXT, kleur_code TEXT, is_exact BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  WITH stuk AS (
    SELECT
      p_lengte_cm + stuk_snij_marge_cm(p_afwerking, p_vorm, p_lengte_cm, p_breedte_cm, k.standaard_breedte_cm) AS benodigd_lengte_cm,
      p_breedte_cm + stuk_snij_marge_cm(p_afwerking, p_vorm, p_lengte_cm, p_breedte_cm, k.standaard_breedte_cm) AS benodigd_breedte_cm
    FROM (SELECT 1) dummy
    LEFT JOIN kwaliteiten k ON k.code = p_kwaliteit_code
  ),
  paren AS (
    SELECT p.target_kwaliteit_code, p.target_kleur_code, p.is_zelf
    FROM uitwisselbare_paren(p_kwaliteit_code, p_kleur_code) p
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

COMMENT ON FUNCTION public.kandidaat_rollen_voor_conversie(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) IS
  'Mig 472: kandidaat-rollen (eigen + uitwisselbaar) voor een vaste-maat-regel '
  'die nog NIET maatwerk is — voedt de "omzetten naar maatwerk"-blokkade in de '
  'UI (geen kandidaat = knop disabled). Mirrort kandidaat_rollen_voor_handmatige_'
  'toewijzing (mig 453) maar vanaf ruwe maten i.p.v. een bestaand snijplan.';

------------------------------------------------------------------------
-- 2. De conversie zelf
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.converteer_regel_naar_maatwerk(
  p_order_regel_id BIGINT,
  p_lengte_cm      INTEGER,
  p_breedte_cm     INTEGER DEFAULT NULL,
  p_vorm           TEXT DEFAULT 'rechthoek'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id      BIGINT;
  v_order_status  order_status;
  v_is_maatwerk   BOOLEAN;
  v_te_leveren    INTEGER;
  v_artikelnr     TEXT;
  v_kwaliteit     TEXT;
  v_kleur         TEXT;
BEGIN
  SELECT order_id, is_maatwerk, te_leveren, artikelnr
    INTO v_order_id, v_is_maatwerk, v_te_leveren, v_artikelnr
  FROM order_regels
  WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;
  IF COALESCE(v_is_maatwerk, false) THEN
    RAISE EXCEPTION 'Orderregel % is al maatwerk', p_order_regel_id;
  END IF;
  IF COALESCE(v_te_leveren, 0) <= 0 THEN
    RAISE EXCEPTION 'Orderregel % heeft niets meer te leveren', p_order_regel_id;
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0 THEN
    RAISE EXCEPTION 'Geen geldige lengte opgegeven voor orderregel %', p_order_regel_id;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
    RAISE EXCEPTION 'Order % staat al in eindstatus % — kan orderregel niet meer omzetten', v_order_id, v_order_status;
  END IF;

  SELECT kwaliteit_code, kleur_code INTO v_kwaliteit, v_kleur
  FROM producten WHERE artikelnr = v_artikelnr;

  -- Eén UPDATE — trg_auto_sync_snijplan_maten (snijplan-aanmaak) en
  -- trg_orderregel_herallocateer (claim-release + status-herwaardering)
  -- triggeren hierop automatisch, geen expliciete PERFORM nodig.
  UPDATE order_regels
  SET is_maatwerk          = TRUE,
      maatwerk_lengte_cm   = p_lengte_cm,
      maatwerk_breedte_cm  = COALESCE(p_breedte_cm, p_lengte_cm),
      maatwerk_vorm        = p_vorm,
      maatwerk_kwaliteit_code = v_kwaliteit,
      maatwerk_kleur_code     = v_kleur
  WHERE id = p_order_regel_id;
END;
$$;

COMMENT ON FUNCTION public.converteer_regel_naar_maatwerk(BIGINT, INTEGER, INTEGER, TEXT) IS
  'Mig 472: zet een vaste-maat-orderregel om naar maatwerk (snijden uit een '
  'rol i.p.v. uit voorraad/inkoop bestellen). Geen eigen release-/snijplan-'
  'logica — leunt bewust op de bestaande triggers trg_auto_sync_snijplan_maten '
  '(mig 110/323) en trg_orderregel_herallocateer (mig 273+) die op de '
  'is_maatwerk/maten-UPDATE reageren.';

NOTIFY pgrst, 'reload schema';
