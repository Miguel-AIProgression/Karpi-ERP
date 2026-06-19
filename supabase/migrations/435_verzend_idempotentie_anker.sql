-- Migratie 435: idempotentie-anker tegen DUBBELE vervoerder-aanmelding.
--
-- AANLEIDING: ZEND-2026-0061 werd 4× bij HST aangemeld (4 transportorder-
-- nummers, zelfde referentie). Oorzaak — de verzend-state-machine (mig 426,
-- ADR-0038) was niet POST-veilig voor een niet-idempotente carrier:
--
--   claim → status 'Bezig'  (verzend_wachtrij)
--   POST /TransportOrder → HST maakt de order aan + geeft OrderNumber terug
--   ... audit + PDF-upload + markeer_transportorder_verstuurd ...
--
-- Crasht/timeout't de edge function NÁ de geslaagde POST maar vóór de flip naar
-- 'Verstuurd', dan blijft de rij op 'Bezig'. De reaper
-- `herstel_vastgelopen_verzending` (elke run, drempel 10 min) zette zo'n rij —
-- puur op leeftijd — terug naar 'Wachtrij'; de minuut-cron POST'te 'm opnieuw.
-- HST is POST-only zonder idempotentie (elke POST = nieuwe transportorder) →
-- elke reaper-cyclus = een dubbele aanmelding. 4 transportorders = 1 POST + 3
-- reaper-recycles.
--
-- FIX (data-as, hoort bij de skeleton-wijziging in
-- _shared/verzend-orchestrator.ts): leg op de wachtrij-rij een ANKER vast zodra
-- het transport is geslaagd — vóór de faalbare audit/artefact/markeer-stappen.
-- De reaper slaat een rij met een anker over: die heeft de carrier al bereikt en
-- mag NOOIT opnieuw verstuurd worden. Een onderbroken-na-succes rij blijft dan
-- 'Bezig' (zichtbaar in verzend_monitor.oudste_bezig_minuten = operator-aandacht)
-- i.p.v. stilletjes te dupliceren.
--
-- Geldt voor ALLE carriers (HST/Verhoek/Rhenus delen de skeleton). Voor de SFTP-
-- carriers was re-upload al dedup-veilig (bestandsnaam = idempotentiesleutel),
-- maar het anker maakt het gedrag uniform: transport geslaagd → nooit nog eens.
--
-- VOORWAARDE: mig 426 (verzend_wachtrij + herstel_vastgelopen_verzending).
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.

-- ============================================================================
-- §1. Anker-kolom.
-- ============================================================================
ALTER TABLE verzend_wachtrij
  ADD COLUMN IF NOT EXISTS transport_bevestigd_op TIMESTAMPTZ;

COMMENT ON COLUMN verzend_wachtrij.transport_bevestigd_op IS
  'Idempotentie-anker (mig 435): gezet zodra het transport naar de vervoerder '
  'GESLAAGD is (POST ok / SFTP-upload ok), vóór de audit/artefact/markeer-'
  'afronding. Niet-NULL = de carrier heeft deze zending al → de reaper '
  'herstel_vastgelopen_verzending zet ''m NOOIT terug naar Wachtrij '
  '(anti-dubbele-aanmelding). Backfill: bestaande Verstuurd-rijen ← sent_at.';

-- Bestaande Verstuurd-historie consistent ankeren (de reaper raakt 'Bezig'-rijen,
-- dus dit is voor de volledigheid/diagnose; idempotent via de IS NULL-guard).
UPDATE verzend_wachtrij
   SET transport_bevestigd_op = COALESCE(sent_at, updated_at)
 WHERE status = 'Verstuurd' AND transport_bevestigd_op IS NULL;

-- ============================================================================
-- §2. markeer_transport_bevestigd: zet het anker (en bewaart de OrderNumber/
--     correlatiesleutel mee, zodat die niet verloren gaat als de afronding
--     daarna faalt). Idempotent: anker niet overschrijven; status blijft 'Bezig'.
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_transport_bevestigd(
  p_id                BIGINT,
  p_extern_referentie TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE verzend_wachtrij
     SET transport_bevestigd_op = COALESCE(transport_bevestigd_op, now()),
         extern_referentie      = COALESCE(p_extern_referentie, extern_referentie)
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_transport_bevestigd(BIGINT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION markeer_transport_bevestigd IS
  'ADR-0038/mig 435: legt het idempotentie-anker (transport_bevestigd_op) vast '
  'zodra het transport geslaagd is, vóór de afronding. Bewaart extern_referentie '
  'mee. Idempotent (COALESCE — anker nooit overschreven).';

-- ============================================================================
-- §3. markeer_transportorder_verstuurd: ook het anker zetten (verstuurd ⊇
--     bevestigd). Volledige body van mig 426 + de anker-regel — zodat ook een
--     rij die het happy-path direct doorloopt een consistent anker krijgt.
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_transportorder_verstuurd(
  p_id                BIGINT,
  p_extern_referentie TEXT,
  p_track_trace       TEXT,
  p_document_pad      TEXT
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE verzend_wachtrij
     SET status                 = 'Verstuurd',
         extern_referentie      = p_extern_referentie,
         track_trace            = COALESCE(p_track_trace, track_trace),
         document_pad           = COALESCE(p_document_pad, document_pad),
         transport_bevestigd_op = COALESCE(transport_bevestigd_op, now()),
         sent_at                = now(),
         error_msg              = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_track_trace, track_trace),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_transportorder_verstuurd(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- §4. herstel_vastgelopen_verzending: reaper met anker-guard. Een 'Bezig'-rij
--     die het transport al haalde (transport_bevestigd_op IS NOT NULL) wordt
--     NIET teruggezet naar 'Wachtrij' → geen re-POST → geen dubbele aanmelding.
-- ============================================================================
CREATE OR REPLACE FUNCTION herstel_vastgelopen_verzending(
  p_vervoerder_code TEXT,
  p_minuten         INTEGER DEFAULT 10
) RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND vervoerder_code = p_vervoerder_code
     AND updated_at < now() - make_interval(mins => p_minuten)
     AND transport_bevestigd_op IS NULL;   -- anker = al aangemeld → niet opnieuw versturen
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_verzending(TEXT, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION herstel_vastgelopen_verzending IS
  'Self-healing reaper (mig 337 → 426 → 435). Zet >p_minuten op Bezig hangende '
  'rijen terug naar Wachtrij voor herverwerking — MAAR slaat rijen met een '
  'idempotentie-anker (transport_bevestigd_op) over: die haalden de carrier al, '
  'opnieuw versturen zou dupliceren (incident ZEND-2026-0061 4×).';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Handmatige verificatie na deploy (SQL Editor):
-- ============================================================================
-- 1. Anker-kolom bestaat:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='verzend_wachtrij' AND column_name='transport_bevestigd_op';
-- 2. Reaper laat een geankerde Bezig-rij met rust (verwacht 0):
--    -- maak een test-Bezig-rij met transport_bevestigd_op = now() - interval '1 hour',
--    -- updated_at idem, draai herstel_vastgelopen_verzending('hst_api', 10) → RETURN 0.
-- 3. Geen Bezig-rijen met anker die blijven hangen (operator-aandacht):
--    SELECT id, zending_id, vervoerder_code, updated_at, extern_referentie
--      FROM verzend_wachtrij
--     WHERE status='Bezig' AND transport_bevestigd_op IS NOT NULL;
