-- Migratie 223: Facturatie luistert op order_events ipv orders.status (ADR-0007)
--
-- Vervangt mig 118-trigger trg_enqueue_factuur die op orders.status='Verzonden'
-- vuurde. Met ADR-0006 wordt dat veld via _apply_transitie geschreven, dat ook
-- een order_events-rij INSERT'eert. Op die typed event-stroom luisteren is
-- robuuster: oorzaak (welke pickronde, welke picker) blijft traceerbaar.
--
-- Mig-nummer-noot: plan-spec was mig 219, maar 219+220+221+222 zijn door andere
-- features in gebruik genomen. 223 is het eerstvolgende vrije nummer.

-- 1. Optionele kolom — koppel factuur_queue aan bron-event voor audit
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS bron_event_id BIGINT REFERENCES order_events(id);

COMMENT ON COLUMN factuur_queue.bron_event_id IS
  'Mig 223 (ADR-0007): order_events-rij die deze factuur heeft getriggerd. NULL voor wekelijkse verzamelfacturen + legacy.';

-- 2. Drop oude trigger
DROP TRIGGER IF EXISTS trg_enqueue_factuur ON orders;

-- 3. Nieuwe trigger-procedure op order_events
-- Schema-noot: factuur_queue heeft debiteur_nr NOT NULL + type NOT NULL CHECK
-- IN ('per_zending','wekelijks'). factuurvoorkeur is een enum-type (niet TEXT).
-- Zie mig 117 + 118.
--
-- SECURITY DEFINER: trigger draait in context van aanroepende user
-- (authenticated bij voltooi_pickronde via order_events INSERT). Die heeft
-- geen INSERT-policy op factuur_queue (interne queue, alleen system-paths
-- mogen schrijven). DEFINER omzeilt RLS — zelfde aanpak als
-- 218_enqueue_factuur_security_definer voor de oude orders-trigger.
CREATE OR REPLACE FUNCTION enqueue_factuur_voor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voorkeur   factuurvoorkeur;
  v_debiteur_nr INTEGER;
BEGIN
  -- Alleen op pickronde_voltooid → Verzonden
  IF NEW.event_type <> 'pickronde_voltooid' OR NEW.status_na <> 'Verzonden' THEN
    RETURN NEW;
  END IF;

  -- Lees debiteur + factuurvoorkeur via order
  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  IF v_voorkeur = 'per_zending' THEN
    INSERT INTO factuur_queue (debiteur_nr, order_ids, type, bron_event_id)
    VALUES (v_debiteur_nr, ARRAY[NEW.order_id], 'per_zending', NEW.id);
  END IF;
  -- 'wekelijks' wordt door pg_cron-job opgepikt — geen rij hier.

  RETURN NEW;
END;
$$;

-- 4. Nieuwe trigger
DROP TRIGGER IF EXISTS trg_enqueue_factuur_op_event ON order_events;
CREATE TRIGGER trg_enqueue_factuur_op_event
  AFTER INSERT ON order_events
  FOR EACH ROW
  EXECUTE PROCEDURE enqueue_factuur_voor_event();

NOTIFY pgrst, 'reload schema';
