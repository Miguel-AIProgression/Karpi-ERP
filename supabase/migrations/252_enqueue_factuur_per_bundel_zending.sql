-- Migratie 252: enqueue_factuur_voor_event — per bundel-zending i.p.v. per order
--
-- Probleem: mig 223 enqueue't één queue-rij per order met
-- `order_ids = ARRAY[NEW.order_id]`. Bij bundel-zendingen (mig 222) met N
-- orders levert dit N facturen i.p.v. 1 (ondanks dat de zending wél correct
-- gebundeld is). Resultaat in productie: 4 orders in 1 zending → 4 aparte
-- facturen voor dezelfde klant op dezelfde dag.
--
-- Aanpak: behoud het event-driven pad (klant wil direct factuur na verzending,
-- niet wachten op wekelijkse cron) maar enqueue per bundel-zending. Voor
-- elke zending waar de order in zit (mig 222 zending_orders M2M) komt er
-- precies 1 queue-rij; de drain-edge-function dispatcht via `zending_id`
-- naar `genereer_factuur_voor_bundel` (mig 234). De partial unique index
-- voorkomt dubbele rijen wanneer de trigger N keer vuurt voor de N orders
-- in dezelfde zending.
--
-- Wijkt bewust af van mig 235 (die het hele event-pad sloopt voor wekelijkse
-- cron-only). Mig 235 + 240 zijn op deze installatie NIET toegepast — dit
-- maakt event-driven volledig bundel-conform zonder wekelijkse cutover.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS / CREATE OR REPLACE.
-- VOORWAARDE: mig 234 toegepast (`factuur_queue.zending_id` bestaat).

------------------------------------------------------------------------
-- 1. Partial unique index op zending_id
------------------------------------------------------------------------
-- Mig 234 maakte alleen een non-unique index. We voegen een unique partial
-- index toe zodat ON CONFLICT-pattern werkt en dubbele queue-rijen voor
-- dezelfde bundel-zending hard geblokkeerd worden — zelfs onder hypothetische
-- race-condities (twee parallelle voltooi_pickronde-calls die toevallig
-- dezelfde order in beide zendingen hebben). Index moet uniek zijn over
-- ALLE statussen — er is per zending precies 1 factuur, ooit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_factuur_queue_zending
  ON factuur_queue(zending_id)
  WHERE zending_id IS NOT NULL;

COMMENT ON INDEX uq_factuur_queue_zending IS
  'Mig 252: garandeert max 1 queue-rij per bundel-zending. Vervangt impliciet '
  'de non-unique idx_factuur_queue_zending uit mig 234 (mag blijven staan, '
  'is functioneel een subset).';

------------------------------------------------------------------------
-- 2. enqueue_factuur_voor_event — bundel-zending-aware
------------------------------------------------------------------------
-- Vervangt mig 223's per-order INSERT door een per-zending-INSERT op basis
-- van zending_orders M2M. Voor elke zending waarin deze order zit (kan er
-- meer dan één zijn bij multi-vervoerder-splits, mig 220) maken we 1 queue-
-- rij — gededupliceerd via ON CONFLICT op de partial unique index.
--
-- Triggert N keer voor een N-order bundel; vanaf rij 2 doet ON CONFLICT
-- niets (eerste won). Voor solo-zendingen 1 rij. Voor splits over 2
-- vervoerders 2 rijen → 2 facturen (aligned met mig 231/232: één bundel =
-- één fysieke transportbeweging = één verzendkosten-regel).
CREATE OR REPLACE FUNCTION enqueue_factuur_voor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voorkeur    factuurvoorkeur;
  v_debiteur_nr INTEGER;
BEGIN
  -- Alleen op pickronde_voltooid → Verzonden. Voor multi-zending-orders
  -- vuurt deze pas wanneer de LAATSTE zending van de order voltooid is
  -- (voltooi_pickronde flipt order pas dan naar Verzonden, mig 222).
  IF NEW.event_type <> 'pickronde_voltooid' OR NEW.status_na <> 'Verzonden' THEN
    RETURN NEW;
  END IF;

  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  -- Wekelijkse klanten enqueueren niet hier — pg_cron pakt die op via
  -- enqueue_wekelijkse_verzamelfacturen. NULL-voorkeur fallt terug naar
  -- 'per_zending'-gedrag (mig 117 default).
  IF v_voorkeur IS NOT NULL AND v_voorkeur <> 'per_zending' THEN
    RETURN NEW;
  END IF;

  -- Per zending waarin deze order zit: één queue-rij. order_ids bevat alle
  -- orders van die zending (legacy-vorm-compat — drain dispatcht primair op
  -- zending_id zodra die gevuld is). ON CONFLICT op de partial unique index
  -- maakt het herhaald vuren van de trigger voor zustersorders idempotent.
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, zending_id, bron_event_id)
  SELECT
    v_debiteur_nr,
    (SELECT array_agg(zo2.order_id ORDER BY zo2.order_id)
       FROM zending_orders zo2
      WHERE zo2.zending_id = zo.zending_id),
    'per_zending',
    zo.zending_id,
    NEW.id
  FROM zending_orders zo
  WHERE zo.order_id = NEW.order_id
  ON CONFLICT (zending_id) WHERE zending_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enqueue_factuur_voor_event() IS
  'Mig 252 (vervangt mig 223): enqueue per bundel-zending i.p.v. per order. '
  'Iteratie over zending_orders M2M; ON CONFLICT op uq_factuur_queue_zending '
  'dedupliceert herhaald-vuren voor zusterorders. Gate op factuurvoorkeur '
  '(per_zending-pad blijft event-driven, wekelijks via cron).';

-- Trigger zelf is sinds mig 223 al actief op order_events — geen DROP/CREATE
-- nodig. CREATE OR REPLACE FUNCTION volstaat omdat de signature ongewijzigd is.

NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------------
-- Verificatie (run in SQL Editor na deploy):
------------------------------------------------------------------------
-- 1. Trigger bestaat nog en wijst naar onze nieuwe function:
--    SELECT tgname, proname
--      FROM pg_trigger t
--      JOIN pg_proc p ON p.oid = t.tgfoid
--     WHERE t.tgname = 'trg_enqueue_factuur_op_event';
--    -- Verwacht: 1 rij, proname='enqueue_factuur_voor_event'
--
-- 2. Test op een net-Verzonden bundel: tel queue-rijen per zending
--    SELECT zending_id, COUNT(*) FROM factuur_queue WHERE zending_id IS NOT NULL
--    GROUP BY zending_id HAVING COUNT(*) > 1;
--    -- Verwacht: 0 rijen (max 1 per zending dankzij uq_factuur_queue_zending)
--
-- 3. Manueel een nieuwe bundel-zending naar Verzonden tikken (test-klant) en
--    daarna factuur-verzenden edge function triggeren. Verwacht: 1 factuur
--    voor de hele bundel, niet N facturen.
