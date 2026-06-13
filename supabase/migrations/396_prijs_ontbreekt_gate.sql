-- Migratie 396: prijs-ontbreekt gate (intake-validatie, Feature B)
--
-- Aanleiding (13-06-2026): soms komt een order via Shopify/webshop binnen
-- zonder prijs — sync-shopify-order's haalKlantPrijs() kan null teruggeven en
-- create_webshop_order schrijft prijs/bedrag dan zonder enige > 0-check weg
-- (NULLIF(...)::NUMERIC). EDI's create_edi_order zet bedrag=0 bij ontbrekende
-- verkoopprijs. Zo'n €0-order mag nooit stil naar de werkvloer/facturatie
-- doorstromen — er moet een melding komen en de operator moet expliciet
-- bevestigen (of de prijs corrigeren).
--
-- Patroon = de bestaande gate (mig 326 levertijd_wijziging_te_bevestigen_sinds):
-- één nullable timestamp-kolom op orders, afgeleid door een trigger op
-- order_regels (single source). NULL = geen ontbrekende prijs / bevestigd.
--
-- "Prijs ontbreekt" per regel = NOT admin-pseudo (ADR-0018, is_admin_pseudo)
-- AND artikelnr <> 'VERZEND' (verzendkosten mogen €0 onder de gratis-drempel)
-- AND korting_pct < 100 (bewuste 100%-gratis-levering telt niet) AND prijs
-- IS NULL/0. ≥1 zulke regel → de hele order is geflagd. Bewuste keuze Miguel
-- 13-06: admin-pseudo + VERZEND + 100%-korting uitgesloten.
--
-- Hard-block: start_pickronden weigert een order met open prijs-gate via de
-- gedeelde poort _valideer_intake_gates (mig 395 deed de adres-check; hier
-- breiden we 'm uit — start_pickronden zelf hoeft niet opnieuw herschreven).
-- Bevestigen: markeer_prijs_geaccepteerd zet de gate op NULL (operator
-- accepteert €0 bewust); prijs corrigeren via order-bewerken wist 'm
-- automatisch via de trigger. Frontend-spiegel: PrijsOntbreektBanner +
-- status-tab + StartPickrondesButton.
--
-- Idempotent.

-- 0. Audit-event-type ------------------------------------------------------
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'prijs_geaccepteerd';

-- 1. Gate-kolom ------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prijs_ontbreekt_sinds TIMESTAMPTZ;

COMMENT ON COLUMN orders.prijs_ontbreekt_sinds IS
  'Mig 396: NULL = geen ontbrekende prijs of bewust geaccepteerd. TIMESTAMPTZ '
  '= moment van eerste detectie dat ≥1 niet-pseudo/niet-VERZEND-regel zonder '
  '100%-korting een prijs van 0/NULL heeft. Afgeleid door '
  'trg_order_regels_prijs_gate; gewist door markeer_prijs_geaccepteerd of '
  'prijscorrectie. Blokkeert start_pickronden via _valideer_intake_gates.';

-- 2. Detectie-trigger op order_regels (single source) ----------------------
-- Een €0/NULL-prijs op een normale regel zet de gate op de parent-order. De
-- UPDATE OF-kolomlijst beperkt vuring tot prijs/korting/artikel-mutaties —
-- niet bij de frequente allocatie-updates op te_leveren/backorder.
CREATE OR REPLACE FUNCTION fn_order_regels_prijs_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id BIGINT;
  v_heeft    BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM order_regels r
     WHERE r.order_id = v_order_id
       AND COALESCE(r.artikelnr, '') <> 'VERZEND'
       AND NOT is_admin_pseudo(r.artikelnr)
       AND COALESCE(r.korting_pct, 0) < 100
       AND COALESCE(r.prijs, 0) = 0
  ) INTO v_heeft;

  IF v_heeft THEN
    -- Behoud bestaande "sinds"-timestamp; zet alleen als nog niet open.
    UPDATE orders
       SET prijs_ontbreekt_sinds = now()
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NULL;
  ELSE
    UPDATE orders
       SET prijs_ontbreekt_sinds = NULL
     WHERE id = v_order_id
       AND prijs_ontbreekt_sinds IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_order_regels_prijs_gate ON order_regels;
CREATE TRIGGER trg_order_regels_prijs_gate
  AFTER INSERT OR DELETE OR UPDATE OF prijs, korting_pct, artikelnr ON order_regels
  FOR EACH ROW
  EXECUTE FUNCTION fn_order_regels_prijs_gate();

-- 3. Backfill open orders --------------------------------------------------
UPDATE orders o
   SET prijs_ontbreekt_sinds = now()
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND o.prijs_ontbreekt_sinds IS NULL
   AND EXISTS (
     SELECT 1
       FROM order_regels r
      WHERE r.order_id = o.id
        AND COALESCE(r.artikelnr, '') <> 'VERZEND'
        AND NOT is_admin_pseudo(r.artikelnr)
        AND COALESCE(r.korting_pct, 0) < 100
        AND COALESCE(r.prijs, 0) = 0
   );

-- 4. Bevestig-RPC: operator accepteert de €0-prijs bewust -------------------
-- No-op-guard (mig 227-pattern): doet niets als de gate al dicht is.
CREATE OR REPLACE FUNCTION markeer_prijs_geaccepteerd(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sinds  TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT prijs_ontbreekt_sinds, status
    INTO v_sinds, v_status
    FROM orders
   WHERE id = p_order_id;

  IF v_sinds IS NULL THEN
    RETURN;
  END IF;

  UPDATE orders SET prijs_ontbreekt_sinds = NULL WHERE id = p_order_id;

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (
    p_order_id,
    'prijs_geaccepteerd',
    v_status,
    jsonb_build_object('geaccepteerd_sinds', v_sinds, 'migratie', 396)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_prijs_geaccepteerd(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_prijs_geaccepteerd(BIGINT) IS
  'Mig 396: zet orders.prijs_ontbreekt_sinds op NULL — de operator bevestigt '
  'bewust dat de €0-prijs(en) op deze order kloppen. No-op als de gate al '
  'dicht is. Audit via order_events ''prijs_geaccepteerd''. Prijs corrigeren '
  'via order-bewerken wist de gate automatisch (trigger).';

-- 5. Intake-gate-poort uitbreiden met de prijs-check ------------------------
-- Vervangt de mig 395-versie (alleen adres) door adres + prijs. start_pickronden
-- roept deze poort al aan (mig 395) — geen wijziging daar nodig.
CREATE OR REPLACE FUNCTION _valideer_intake_gates(p_order_ids BIGINT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_adres_nr TEXT;
  v_prijs_nr TEXT;
BEGIN
  SELECT o.order_nr INTO v_adres_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.afl_adres_incompleet_sinds IS NOT NULL
   LIMIT 1;

  IF v_adres_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Afleveradres ontbreekt of is onvolledig voor order % — vul het '
      'afleveradres aan op de order voordat je een pickronde start.',
      v_adres_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT o.order_nr INTO v_prijs_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.prijs_ontbreekt_sinds IS NOT NULL
   LIMIT 1;

  IF v_prijs_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft één of meer regels zonder prijs (€0) — corrigeer de prijs '
      'of bevestig op de order dat €0 klopt voordat je een pickronde start.',
      v_prijs_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

COMMENT ON FUNCTION _valideer_intake_gates(BIGINT[]) IS
  'Mig 395/396: server-side intake-gate-poort voor start_pickronden. Weigert '
  'orders met open afleveradres-gate (mig 395) of prijs-gate (mig 396). '
  'Frontend-spiegel: StartPickrondesButton + banners.';

-- 6. orders_list view: prijs-gate-kolom toevoegen ---------------------------
-- Volledige herdefinitie van mig 395-versie + o.prijs_ontbreekt_sinds (alleen
-- aan het eind toevoegbaar bij CREATE OR REPLACE VIEW).
CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    cnt.aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT count(*)::integer AS aantal_orders
    FROM zending_orders zo2
    WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY zo.order_id, (
    CASE z.status
      WHEN 'Picken'::zending_status               THEN 1
      WHEN 'Klaar voor verzending'::zending_status THEN 2
      WHEN 'Onderweg'::zending_status              THEN 3
      WHEN 'Afgeleverd'::zending_status            THEN 4
      ELSE 5
    END), z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  o.debiteur_zeker,
  o.debiteur_match_bron,
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  o.levertijd_wijziging_te_bevestigen_sinds,
  o.bevestigd_at,
  o.afl_adres_incompleet_sinds,
  -- Mig 396: prijs-ontbreekt gate
  o.prijs_ontbreekt_sinds
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel-info. Sinds mig 309: '
  'edi_bevestigd_op + edi_gewenste_afleverdatum. Sinds mig 322: debiteur_zeker '
  '+ debiteur_match_bron. Sinds mig 326: levertijd_wijziging_te_bevestigen_sinds. '
  'Sinds mig 335: bevestigd_at. Sinds mig 395: afl_adres_incompleet_sinds. '
  'Sinds mig 396: prijs_ontbreekt_sinds.';

NOTIFY pgrst, 'reload schema';
