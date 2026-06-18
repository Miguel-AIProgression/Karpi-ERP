-- Migratie 423: factuur-verzend-vertraging (2 uur buffer na verzending)
--
-- Tot nu wordt een per_zending-factuur DIRECT na het verzenden van de zending
-- geenqueued (enqueue_factuur_voor_event, mig 252) en binnen een minuut door de
-- cron-drain (mig 122) gemaild. Dat laat de operator geen tijd om een laatste
-- correctie te doen of een fout te onderscheppen vóór de factuur de deur uit is.
--
-- Deze migratie voegt een tijd-gate toe: een nieuw geenqueude factuur-rij is pas
-- na `app_config.facturatie.vertraging_minuten` (default 120 = 2 uur) beschikbaar
-- voor de drain. Omdat de factuur PAS bij het draaien wordt gegenereerd
-- (genereer_factuur_voor_bundel op claim-tijd), pakt hij automatisch alle
-- correcties op die in dat venster aan de order zijn gemaakt.
--
-- Werkt alleen op het event-driven per_zending-pad. Wekelijkse verzamelfacturen
-- (cron maandag 05:00) en retries krijgen GEEN extra delay: bij die rijen blijft
-- beschikbaar_op NULL resp. in het verleden, dus ze worden direct opgepakt.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, ON CONFLICT, CREATE OR REPLACE.
-- VOORWAARDE: mig 234 + 252 toegepast (factuur_queue.zending_id + type bestaan,
-- claim_factuur_queue_items heeft de mig 234-return-shape mét `type`).

------------------------------------------------------------------------
-- 1. beschikbaar_op-kolom
------------------------------------------------------------------------
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS beschikbaar_op TIMESTAMPTZ;

COMMENT ON COLUMN factuur_queue.beschikbaar_op IS
  'Mig 423: vroegste moment waarop deze rij door claim_factuur_queue_items '
  'opgepakt mag worden. NULL = direct beschikbaar (wekelijks/legacy/retry). '
  'Event-driven per_zending krijgt now() + facturatie.vertraging_minuten.';

-- De drain claimt pending op created_at; het beschikbaar_op-filter zit in de
-- WHERE. Een partial index houdt de claim-scan goedkoop ook als er veel
-- toekomstige (nog-niet-beschikbare) rijen in de wachtrij staan.
CREATE INDEX IF NOT EXISTS idx_factuur_queue_beschikbaar
  ON factuur_queue(beschikbaar_op)
  WHERE status = 'pending';

------------------------------------------------------------------------
-- 2. app_config.facturatie.vertraging_minuten (default 120 = 2 uur)
------------------------------------------------------------------------
-- Configureerbaar zonder code-wijziging. Bestaat de 'facturatie'-rij al, dan
-- behouden we een reeds ingevulde waarde en zetten we alleen het veld als het
-- ontbreekt — andere velden in de rij blijven onaangeroerd.
INSERT INTO app_config (sleutel, waarde)
VALUES ('facturatie', jsonb_build_object('vertraging_minuten', 120))
ON CONFLICT (sleutel) DO UPDATE
  SET waarde = jsonb_set(
        COALESCE(app_config.waarde, '{}'::jsonb),
        '{vertraging_minuten}',
        COALESCE(app_config.waarde->'vertraging_minuten', to_jsonb(120)),
        true);

------------------------------------------------------------------------
-- 3. enqueue_factuur_voor_event — zet beschikbaar_op = now() + vertraging
------------------------------------------------------------------------
-- Volledige body van mig 252 + de beschikbaar_op-kolom in de INSERT. De rest
-- (gate op event_type/status_na, factuurvoorkeur-gate, per-zending-iteratie,
-- ON CONFLICT-dedup) is ongewijzigd.
CREATE OR REPLACE FUNCTION enqueue_factuur_voor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voorkeur       factuurvoorkeur;
  v_debiteur_nr    INTEGER;
  v_vertraging_min INTEGER;
BEGIN
  -- Alleen op pickronde_voltooid → Verzonden (laatste zending van de order).
  IF NEW.event_type <> 'pickronde_voltooid' OR NEW.status_na <> 'Verzonden' THEN
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
  -- de trigger voor de zusterorders van dezelfde bundel-zending.
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
$$;

COMMENT ON FUNCTION enqueue_factuur_voor_event() IS
  'Mig 423 (was mig 252): enqueue per bundel-zending met verzend-vertraging '
  '(beschikbaar_op = now() + facturatie.vertraging_minuten, default 2u). '
  'Gate op factuurvoorkeur; ON CONFLICT dedupliceert zusterorders.';

------------------------------------------------------------------------
-- 4. claim_factuur_queue_items — respecteer beschikbaar_op
------------------------------------------------------------------------
-- Identieke return-shape als mig 234 (incl. type, zending_id, verzendweek) +
-- het beschikbaar_op-filter. NULL telt als 'nu beschikbaar' zodat bestaande
-- pending rijen, wekelijkse en retries onveranderd direct worden opgepakt.
CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id          BIGINT,
  debiteur_nr INTEGER,
  order_ids   BIGINT[],
  type        TEXT,
  attempts    INTEGER,
  zending_id  BIGINT,
  verzendweek TEXT
)
LANGUAGE sql
AS $$
  UPDATE factuur_queue q
     SET status = 'processing',
         processing_started_at = now()
   WHERE q.id IN (
     SELECT inner_q.id
       FROM factuur_queue inner_q
      WHERE inner_q.status = 'pending'
        AND (inner_q.beschikbaar_op IS NULL OR inner_q.beschikbaar_op <= now())
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.type, q.attempts,
            q.zending_id, q.verzendweek;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION claim_factuur_queue_items(INTEGER) IS
  'Mig 423 (was mig 234): claim met FOR UPDATE SKIP LOCKED + beschikbaar_op-gate '
  '(NULL of <= now()). Return-shape onveranderd t.o.v. mig 234.';

NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------------
-- Verificatie (run in SQL Editor na deploy):
------------------------------------------------------------------------
-- 1. Kolom + config bestaan:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='factuur_queue' AND column_name='beschikbaar_op';
--    SELECT waarde->>'vertraging_minuten' FROM app_config WHERE sleutel='facturatie';
--
-- 2. Verzend een test-zending → de queue-rij krijgt beschikbaar_op ≈ now()+2u
--    en blijft 'pending' tot dan:
--    SELECT id, zending_id, status, created_at, beschikbaar_op
--      FROM factuur_queue ORDER BY id DESC LIMIT 5;
--
-- 3. Vertraging aanpassen (bv. naar 30 min) zonder migratie:
--    UPDATE app_config
--       SET waarde = jsonb_set(waarde, '{vertraging_minuten}', to_jsonb(30))
--     WHERE sleutel = 'facturatie';
