-- Migratie 474: facturatie reageert op een voltooide deelzending
--
-- Achtergrond
-- -----------
-- `enqueue_factuur_voor_event()` (mig 252/423) filterde tot nu toe alleen op
-- `event_type='pickronde_voltooid' AND status_na='Verzonden'` — exact het
-- event dat `markeer_verzonden()` logt wanneer een order VOLLEDIG verzonden
-- is. Een voltooide DEELzending zet de order op 'Deels verzonden' via
-- `markeer_deels_verzonden()` (mig 258), die een ANDER event_type logt:
-- `'deels_verzonden'`. De trigger ving dat dus nooit op.
--
-- Gevolg: als de laatste regel van een order nog weken/maanden op inkoop
-- wacht, kreeg de klant voor de allang geleverde deelzending(en) geen
-- factuur totdat de hele order eindelijk compleet was.
--
-- Fix: de conditie dekt nu BEIDE combinaties. De rest van de functie blijft
-- ongewijzigd — de bestaande `FROM zending_orders zo WHERE zo.order_id =
-- NEW.order_id ... ON CONFLICT (zending_id) DO NOTHING` dekt dit al correct:
--   - bij de deelzending-completion is er nog maar 1 zending voor deze order
--     om over te loopen → die wordt nu wél ingequeued.
--   - bij de latere order-completion loopt hij over ALLE zendingen van de
--     order; de al-ingequeuede deelzending wordt door de ON CONFLICT
--     overgeslagen, dus geen dubbele factuur.
--
-- Backwards-compatibel: een order zonder deelzending doorloopt 'Deels
-- verzonden' nooit, dus dit raakt uitsluitend deelzending-orders.

CREATE OR REPLACE FUNCTION public.enqueue_factuur_voor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_voorkeur       factuurvoorkeur;
  v_debiteur_nr    INTEGER;
  v_vertraging_min INTEGER;
BEGIN
  -- Mig 474: ook op een voltooide deelzending (event 'deels_verzonden' →
  -- status 'Deels verzonden'), niet alleen op de laatste zending van de order.
  IF NOT (
    (NEW.event_type = 'pickronde_voltooid' AND NEW.status_na = 'Verzonden') OR
    (NEW.event_type = 'deels_verzonden'    AND NEW.status_na = 'Deels verzonden')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  -- Wekelijkse klanten enqueueren via cron, niet hier. NULL = per_zending-default.
  IF v_voorkeur IS NOT NULL AND v_voorkeur <> 'per_zending' THEN
    RETURN NEW;
  END IF;

  -- Verzend-vertraging uit config (default 120 min = 2 uur). Geen rij of geen
  -- veld → COALESCE valt terug op 120.
  SELECT (ac.waarde->>'vertraging_minuten')::int
    INTO v_vertraging_min
    FROM app_config ac
   WHERE ac.sleutel = 'facturatie';
  v_vertraging_min := COALESCE(v_vertraging_min, 120);

  -- Per zending waarin deze order zit: één queue-rij, beschikbaar over
  -- v_vertraging_min minuten. ON CONFLICT dedupliceert het herhaald vuren van
  -- de trigger voor de zusterorders van dezelfde bundel-zending (én voorkomt
  -- nu ook een dubbele rij voor een deelzending die al eerder ingequeued is).
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, zending_id, bron_event_id, beschikbaar_op)
  SELECT
    v_debiteur_nr,
    (SELECT array_agg(zo2.order_id ORDER BY zo2.order_id)
       FROM zending_orders zo2
      WHERE zo2.zending_id = zo.zending_id),
    'per_zending',
    zo.zending_id,
    NEW.id,
    now() + make_interval(mins => v_vertraging_min)
  FROM zending_orders zo
  WHERE zo.order_id = NEW.order_id
  ON CONFLICT (zending_id) WHERE zending_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
