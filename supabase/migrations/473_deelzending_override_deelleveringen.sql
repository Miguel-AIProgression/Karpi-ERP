-- Migratie 473: handmatige override van deelleveringen_toegestaan bij een deelzending
--
-- Achtergrond
-- -----------
-- `start_deelzending` blokkeert hard als de klant geen deelleveringen
-- toestaat (guard (d)) — geen escape hatch. Gebruiker wil een operator
-- bewust kunnen laten overrulen, met een verplichte reden + audit-trail
-- (zelfde filosofie als andere handmatige overrides in dit systeem, bv.
-- `rol_handmatig_toevoegen`).
--
-- Twee delen:
--   1. Nieuwe read-only RPC `kan_deelzending(p_order_id)` — exact dezelfde
--      voorwaarde als guard (d), los gehaald zodat de frontend dit vooraf
--      kan checken zonder op een foutmelding-string te gokken.
--   2. `start_deelzending` krijgt een optionele `p_override_reden` —
--      NULL = ongewijzigd gedrag; een waarde slaat guard (d) over en logt
--      de reden mee in de bestaande 'deelzending_gestart'-audit-rij.

------------------------------------------------------------------------
-- 1. kan_deelzending: read-only check, los van start_deelzending
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kan_deelzending(p_order_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(d.deelleveringen_toegestaan, FALSE) OR o.lever_modus = 'deelleveringen'
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.kan_deelzending(BIGINT) IS
  'Mig 473: TRUE als deze order normaal (zonder override) een deelzending mag '
  'krijgen — spiegelt guard (d) in start_deelzending() exact. Voedt de '
  'override-waarschuwing in de deelzending-dialog vóórdat de operator regels '
  'selecteert, i.p.v. pas bij een mislukte RPC-aanroep.';

------------------------------------------------------------------------
-- 2. start_deelzending: optionele override met verplichte reden
------------------------------------------------------------------------
-- Een nieuw parameter-aantal is voor Postgres een ANDER overload, geen
-- vervanging — zonder deze DROP zouden de oude (3-arg) en nieuwe (4-arg)
-- versie naast elkaar blijven bestaan en elke 3-argument-aanroep ambigu maken.
DROP FUNCTION IF EXISTS public.start_deelzending(BIGINT, BIGINT[], BIGINT);

CREATE OR REPLACE FUNCTION public.start_deelzending(
  p_order_id BIGINT,
  p_regel_ids BIGINT[],
  p_picker_id BIGINT,
  p_override_reden TEXT DEFAULT NULL
)
RETURNS TABLE(zending_id BIGINT, zending_nr TEXT, vervoerder_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order        RECORD;
  v_zending_id   BIGINT;
  v_zending_nr   TEXT;
  v_vervoerder   TEXT;
  v_service      TEXT;
  v_buffer       INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  -- Laad order + debiteuren-vlag in één query
  SELECT o.*, d.deelleveringen_toegestaan
    INTO v_order
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- (e) Eindstatus-guard
  IF v_order.status IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % heeft status % — geen deelzending mogelijk',
      p_order_id, v_order.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) Deelleveringen toegestaan? — overrulebaar met een verplichte reden.
  IF NOT COALESCE(v_order.deelleveringen_toegestaan, FALSE)
     AND v_order.lever_modus IS DISTINCT FROM 'deelleveringen'
     AND COALESCE(btrim(p_override_reden), '') = '' THEN
    RAISE EXCEPTION
      'Order %: deelleveringen niet toegestaan voor debiteur % '
      '(stel deelleveringen_toegestaan in op de klant of pas lever_modus aan, '
      'of geef een reden op om te overrulen)',
      p_order_id, v_order.debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) Alle regel_ids horen bij deze order?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM order_regels
        WHERE id = rid AND order_id = p_order_id
     )
  ) THEN
    RAISE EXCEPTION 'Niet alle regel_ids horen bij order %', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (b) Alle regels pickbaar?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM orderregel_pickbaarheid op
        WHERE op.order_regel_id = rid
          AND op.is_pickbaar = TRUE
     )
  ) THEN
    RAISE EXCEPTION
      'Niet alle geselecteerde regels zijn pickbaar. '
      'Controleer wacht_op per regel via orderregel_pickbaarheid.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (c) Geen regel al in actieve zending?
  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
      JOIN zendingen z ON z.id = zr.zending_id
     WHERE zr.order_regel_id = ANY(p_regel_ids)
       AND z.status NOT IN ('Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Een of meer geselecteerde regels zitten al in een actieve zending. '
      'Voltooi of annuleer die zending eerst.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Vervoerder bepalen: gebruik de eerste effectieve vervoerder van de selectie
  -- (zelfde ladder als start_pickronden_voor_order)
  SELECT evpo.effectief_code, evpo.effectief_service
    INTO v_vervoerder, v_service
    FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
   WHERE evpo.orderregel_id = ANY(p_regel_ids)
   ORDER BY evpo.orderregel_id ASC
   LIMIT 1;

  -- Maak de deelzending aan
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status, picker_id,
    vervoerder_code, service_code,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum,
    is_deelzending
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken', p_picker_id,
    v_vervoerder, v_service,
    v_order.afl_naam, v_order.afl_adres,
    v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    TRUE
  ) RETURNING id INTO v_zending_id;

  -- M2M koppeling (mig 222 canoniek patroon)
  INSERT INTO zending_orders (zending_id, order_id)
  VALUES (v_zending_id, p_order_id)
  ON CONFLICT DO NOTHING;

  -- Alleen geselecteerde regels aan zending koppelen
  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.id = ANY(p_regel_ids)
     AND COALESCE(ore.orderaantal, 0) > 0;

  -- Colli genereren
  PERFORM genereer_zending_colli(v_zending_id);

  -- Order → 'In pickronde' (no-op als al op die status of Deels verzonden)
  PERFORM markeer_pickronde_gestart(
    p_order_id            := p_order_id,
    p_actor_medewerker_id := p_picker_id
  );

  -- Audit-event voor de deelzending-start (mig 473: + override_reden indien gezet).
  -- Bugfix mig 473: kolom heet `metadata`, niet `payload` (was sinds mig 413
  -- altijd kapot — elke start_deelzending-aanroep faalde op deze laatste
  -- statement en rolde de hele transactie terug, dus er is nooit een
  -- deelzending succesvol aangemaakt totdat dit hier gefixt werd).
  INSERT INTO order_events (order_id, event_type, status_voor, status_na, metadata)
  SELECT
    p_order_id,
    'deelzending_gestart',
    v_order.status,
    'In pickronde',
    jsonb_build_object(
      'zending_id',   v_zending_id,
      'zending_nr',   v_zending_nr,
      'regel_ids',    p_regel_ids,
      'vervoerder',   v_vervoerder
    ) || CASE
      WHEN COALESCE(btrim(p_override_reden), '') <> ''
        THEN jsonb_build_object('deelleveringen_override_reden', btrim(p_override_reden))
      ELSE '{}'::jsonb
    END;

  RETURN QUERY SELECT v_zending_id, v_zending_nr, v_vervoerder;
END;
$function$;

NOTIFY pgrst, 'reload schema';
