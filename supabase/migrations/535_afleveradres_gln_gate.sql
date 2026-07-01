-- 535: Afleveradres-GLN-poort — blokkeer EDI-orders met niet-gekoppelde aflever-GLN
--      uit Pick & Ship tot het adres is opgelost óf bewust vrijgegeven.
--
-- Bouwt voort op het read-only signaal (mig 534). De stille HQ-fallback van
-- create_edi_order (mig 357) mag niet meer ongemerkt naar de werkvloer: een
-- EDI-order waarvan de aflever-GLN geen vestiging matcht wordt nu een HARDE
-- intake-gate, exact gespiegeld op de afleveradres-/prijs-gate (mig 395/396).
--
-- Twee nullable timestamps (zoals de prijs-gate twee uitwegen heeft):
--   afl_gln_ongekoppeld_sinds  — AUTO (trigger): "aflever-GLN matcht geen vestiging"
--   afl_gln_gecontroleerd_op   — HANDMATIG (RPC): "operator heeft het adres goedgekeurd"
-- BLOK = afl_gln_ongekoppeld_sinds IS NOT NULL AND afl_gln_gecontroleerd_op IS NULL.
--
-- Vrijgave, twee wegen:
--   (a) GLN koppelen aan een vestiging → match → de afleveradressen-trigger wist
--       afl_gln_ongekoppeld_sinds (toekomstige orders matchen dan ook automatisch);
--   (b) bewust vrijgeven → markeer_afleveradres_gecontroleerd zet
--       afl_gln_gecontroleerd_op (de "goedkeuring" specifiek voor het adres — los
--       van de orderbevestiging, zodat een al-bevestigde-maar-foute order niet
--       per ongeluk doorglipt).
--
-- De NOT-EXISTS-match-logica leeft op ÉÉN plek (_afl_gln_matcht_vestiging, gespiegeld
-- op create_edi_order, .0-tolerant); de view (mig 534) + _valideer_intake_gates +
-- frontend lezen alleen de twee kolommen.

-- 1. Kolommen ---------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS afl_gln_ongekoppeld_sinds TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS afl_gln_gecontroleerd_op  TIMESTAMPTZ;

-- 2. Single-source match-predicaat (spiegelt create_edi_order, mig 357) ------
CREATE OR REPLACE FUNCTION _afl_gln_matcht_vestiging(p_debiteur_nr INTEGER, p_gln TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM afleveradressen a
     WHERE a.debiteur_nr = p_debiteur_nr
       AND a.gln_afleveradres IN (p_gln, p_gln || '.0')
  );
$$;

-- 3. Orders-trigger: zet/wist afl_gln_ongekoppeld_sinds ----------------------
-- Alleen EDI-orders met een aflever-GLN in een actieve, niet-afhaal/niet-productie
-- status. Raakt afl_gln_gecontroleerd_op NOOIT aan (anders zou een edit een
-- bewuste vrijgave terugdraaien).
CREATE OR REPLACE FUNCTION fn_orders_afl_gln_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bron_systeem = 'edi'
     AND NEW.afleveradres_gln IS NOT NULL AND NEW.afleveradres_gln <> ''
     AND COALESCE(NEW.afhalen, FALSE) = FALSE
     AND COALESCE(NEW.alleen_productie, FALSE) = FALSE
     AND NEW.status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
     AND NOT _afl_gln_matcht_vestiging(NEW.debiteur_nr, NEW.afleveradres_gln)
  THEN
    IF NEW.afl_gln_ongekoppeld_sinds IS NULL THEN
      NEW.afl_gln_ongekoppeld_sinds := now();
    END IF;
  ELSE
    NEW.afl_gln_ongekoppeld_sinds := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_afl_gln_gate ON orders;
CREATE TRIGGER trg_orders_afl_gln_gate
  BEFORE INSERT OR UPDATE OF bron_systeem, afleveradres_gln, debiteur_nr, status, afhalen, alleen_productie
  ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_orders_afl_gln_gate();

-- 4. Afleveradressen-trigger: koppelen wist de gate op alle matchende orders --
-- Zodra een GLN aan een vestiging gekoppeld wordt, vervalt de blokkade voor
-- élke order die op die GLN wachtte (niet alleen de order die de koppeling
-- triggerde). afl_gln_ongekoppeld_sinds staat niet in de UPDATE OF-lijst van de
-- orders-trigger → die vuurt hier niet opnieuw.
CREATE OR REPLACE FUNCTION fn_afleveradressen_gln_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gln_afleveradres IS NOT NULL THEN
    UPDATE orders o
       SET afl_gln_ongekoppeld_sinds = NULL
     WHERE o.afl_gln_ongekoppeld_sinds IS NOT NULL
       AND o.debiteur_nr = NEW.debiteur_nr
       AND o.afleveradres_gln IN (
             NEW.gln_afleveradres,
             NEW.gln_afleveradres || '.0',
             regexp_replace(NEW.gln_afleveradres, '\.0$', '')
           );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_afleveradressen_gln_gate ON afleveradressen;
CREATE TRIGGER trg_afleveradressen_gln_gate
  AFTER INSERT OR UPDATE OF gln_afleveradres ON afleveradressen
  FOR EACH ROW
  EXECUTE FUNCTION fn_afleveradressen_gln_gate();

-- 5. Backfill bestaande open orders -----------------------------------------
UPDATE orders o
   SET afl_gln_ongekoppeld_sinds = now()
 WHERE o.afl_gln_ongekoppeld_sinds IS NULL
   AND o.bron_systeem = 'edi'
   AND o.afleveradres_gln IS NOT NULL AND o.afleveradres_gln <> ''
   AND COALESCE(o.afhalen, FALSE) = FALSE
   AND COALESCE(o.alleen_productie, FALSE) = FALSE
   AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
   AND NOT _afl_gln_matcht_vestiging(o.debiteur_nr, o.afleveradres_gln);

-- 6. View herdefiniëren op de kolommen (mig 534 was NOT-EXISTS-gebaseerd) -----
-- Toont nu wat geblokkeerd-en-niet-vrijgegeven is. Output-kolommen ongewijzigd
-- (de banner blijft werken).
CREATE OR REPLACE VIEW edi_orders_afleveradres_ongekoppeld AS
SELECT o.id AS order_id,
       o.order_nr,
       o.debiteur_nr,
       o.afl_naam,
       o.afl_plaats,
       o.afleveradres_gln,
       o.status,
       o.orderdatum
  FROM orders o
 WHERE o.afl_gln_ongekoppeld_sinds IS NOT NULL
   AND o.afl_gln_gecontroleerd_op IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Concept');

COMMENT ON VIEW edi_orders_afleveradres_ongekoppeld IS
  'Mig 534/535: EDI-orders met niet-gekoppelde aflever-GLN die nog niet bewust '
  'zijn vrijgegeven. Voedt de EdiAfleveradresOngekoppeldBanner. Verdwijnt zodra '
  'de GLN gekoppeld wordt (afleveradressen-trigger) of de order vrijgegeven '
  'wordt (markeer_afleveradres_gecontroleerd).';

-- 7. Vrijgave-RPC (bewuste goedkeuring van het adres) ------------------------
CREATE OR REPLACE FUNCTION markeer_afleveradres_gecontroleerd(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sinds  TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT afl_gln_ongekoppeld_sinds, status
    INTO v_sinds, v_status
    FROM orders
   WHERE id = p_order_id;

  IF v_sinds IS NULL THEN
    RETURN; -- no-op: order is niet geblokkeerd op de GLN-gate
  END IF;

  UPDATE orders
     SET afl_gln_gecontroleerd_op = now()
   WHERE id = p_order_id
     AND afl_gln_gecontroleerd_op IS NULL;

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (
    p_order_id,
    'afleveradres_gln_gecontroleerd',
    v_status,
    jsonb_build_object('ongekoppeld_sinds', v_sinds, 'migratie', 535)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION markeer_afleveradres_gecontroleerd(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_afleveradres_gecontroleerd(BIGINT) IS
  'Mig 535: zet orders.afl_gln_gecontroleerd_op — de operator bevestigt bewust '
  'dat het afleveradres van deze order klopt (los van de orderbevestiging). '
  'No-op als de gate al dicht is. Audit via order_events '
  '''afleveradres_gln_gecontroleerd''. GLN koppelen aan een vestiging wist de '
  'gate automatisch (afleveradressen-trigger).';

-- 8. Intake-gate-poort uitbreiden met de GLN-check (ná adres, vóór prijs) ----
CREATE OR REPLACE FUNCTION _valideer_intake_gates(p_order_ids BIGINT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_adres_nr TEXT;
  v_gln_nr   TEXT;
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

  SELECT o.order_nr INTO v_gln_nr
    FROM unnest(p_order_ids) AS oid
    JOIN orders o ON o.id = oid
   WHERE o.afl_gln_ongekoppeld_sinds IS NOT NULL
     AND o.afl_gln_gecontroleerd_op IS NULL
   LIMIT 1;

  IF v_gln_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Afleveradres van order % is niet gekoppeld aan een vestiging (de aflever-GLN '
      'matcht niets, het adres viel terug op het hoofdadres) — koppel de juiste '
      'vestiging of geef het adres bewust vrij voordat je een pickronde start.',
      v_gln_nr
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
  'Mig 395/396/535: server-side intake-gate-poort voor start_pickronden. Weigert '
  'orders met open afleveradres-gate (mig 395), niet-gekoppelde aflever-GLN-gate '
  '(mig 535) of prijs-gate (mig 396). Frontend-spiegel: StartPickrondesButton + banners.';

-- 9. orders_list view: gate-kolommen toevoegen (order-detail leest deze view) -
-- LET OP (bijgewerkt 2026-07-01, vóór apply): deze branch is afgetakt op main=533
-- (30-06). Sindsdien kreeg de live orders_list drie extra kolommen (express,
-- manco_sinds, afl_land — mig 451/518/521-klasse werk dat na deze branch landde).
-- De originele mig 535 herdefinieerde orders_list op de 30-06-snapshot, wat die
-- drie kolommen bij apply stil zou hebben laten verdwijnen (frontend leest ze al
-- live). Basis hieronder = de huidige productie-definitie (geverifieerd via
-- pg_get_viewdef vlak vóór deze correctie), plus de twee nieuwe GLN-gate-kolommen.
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
  o.prijs_ontbreekt_sinds,
  o.express,
  o.manco_sinds,
  o.afl_land,
  -- Mig 535: aflever-GLN-gate
  o.afl_gln_ongekoppeld_sinds,
  o.afl_gln_gecontroleerd_op
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Sinds mig 396: prijs_ontbreekt_sinds. '
  'Sinds mig 535: afl_gln_ongekoppeld_sinds + afl_gln_gecontroleerd_op (aflever-GLN-gate).';

NOTIFY pgrst, 'reload schema';
