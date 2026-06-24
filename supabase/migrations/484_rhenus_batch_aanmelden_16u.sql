-- Migratie 484: Rhenus-dagbatch om 16:00 i.p.v. handmatig 1-voor-1 aanmelden.
--
-- TWEE wijzigingen, gevraagd door de gebruiker (24-06-2026):
--   1) Na pickronde-voltooien hoeft een Rhenus-zending niet meer handmatig
--      ("Aanmelden bij Rhenus") in de wachtrij gezet te worden — dat gebeurt
--      voortaan automatisch (de hold-guard van mig 420 vervalt voor Rhenus).
--   2) Rhenus wil niet meer elke zending los, maar alle orders van die dag in
--      één batch om 16:00. De zending gaat dus wél meteen in de wachtrij, maar
--      wordt pas om 16:00 (eerstvolgende WERKDAG) opgepakt door de cron.
--
-- AANPAK = hergebruik bestaande diepe modules, geen nieuwe concepten:
--   * Verzend-wachtrij (ADR-0038, mig 426) — de queue zelf.
--   * beschikbaar_op-vertraging-patroon — exact zoals factuur_queue (mig 423):
--     een rij wordt pas claimbaar als beschikbaar_op <= now(). NULL = direct
--     (HST/Verhoek ongewijzigd).
--   * Werkagenda-rekenkunde (mig 279, werkdag_plus_n) voor "eerstvolgende werkdag".
--
-- De rhenus-send cron (mig 381, elke minuut) HOEFT NIET te wijzigen: hij vindt
-- overdag niets claimbaars (beschikbaar_op in de toekomst) en drained vanaf
-- 16:00 de hele dagbatch over een paar runs (MAX_PER_RUN/min). DST-correct via
-- Europe/Amsterdam i.p.v. een UTC-cron die 2× per jaar een uur verschuift.
--
-- Batch-FORMAAT blijft ongewijzigd: één GS1-XML per zending, allemaal om 16:00
-- in /in (bevestigd met gebruiker — geen multi-shipment-bestand).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, backfill-guards.
-- VOORWAARDE: mig 426 (verzend_wachtrij + generieke RPC's) + mig 420
-- (handmatig_aanmelden + colli-bundeling) toegepast. Nummer 484 = hoogste +1 op
-- moment van schrijven — parallelle sessies schrijven live migraties, dus
-- HERVERIFIEER het nummer (max +1) vlak vóór merge en hernummer indien nodig.
--
-- DEPLOY-TIMING (review-bevinding): §7(b) zet bestaande wachtende Rhenus-rijen op
-- de eerstvolgende werkdag-16:00 → in-flight zendingen die net zouden vertrekken
-- worden eenmalig tot dan vastgehouden. Deploy bij voorkeur kort vóór 16:00 op
-- een werkdag, of vervroeg in-flight rijen na deploy met meld_zending_handmatig_aan.
--
-- MONITOR (review-bevinding, latent): verzend_monitor.oudste_wachtrij_minuten voor
-- rhenus_sftp loopt nu legitiem op tot ~24h (wacht op de batch). De HST-monitor
-- filtert op hst_api → geen vals alarm vandaag; een toekomstig Rhenus-monitorpaneel
-- moet batch_cutoff_tijd meewegen in de "cron staat stil"-heuristiek.

-- ============================================================================
-- §1. Schema: beschikbaar_op op de wachtrij + batch_cutoff_tijd op vervoerders
-- ============================================================================
ALTER TABLE verzend_wachtrij ADD COLUMN IF NOT EXISTS beschikbaar_op TIMESTAMPTZ;

COMMENT ON COLUMN verzend_wachtrij.beschikbaar_op IS
  'Mig 484: rij pas claimbaar als beschikbaar_op <= now() (NULL = direct). '
  'Spiegelt factuur_queue.beschikbaar_op (mig 423). Voor dagbatch-vervoerders '
  '(Rhenus, 16:00) gezet op de eerstvolgende werkdag-cutoff; HST/Verhoek = NULL.';

-- Data-driven dagbatch: een vervoerder met batch_cutoff_tijd gezet wordt niet
-- direct verstuurd maar verzameld tot die tijd (eerstvolgende werkdag). NULL =
-- direct versturen (HST/Verhoek). Houdt de dispatch carrier-blind: een nieuwe
-- batch-vervoerder = alleen deze kolom vullen, geen code-edit.
ALTER TABLE vervoerders ADD COLUMN IF NOT EXISTS batch_cutoff_tijd TIME;

COMMENT ON COLUMN vervoerders.batch_cutoff_tijd IS
  'Mig 484: NULL = zending direct aanmelden. Gezet (bv. 16:00) = dagbatch — de '
  'zending gaat wél meteen in de wachtrij maar wordt pas op de eerstvolgende '
  'werkdag-cutoff (Europe/Amsterdam) opgepakt. Zie volgende_batch_moment().';

-- ============================================================================
-- §2. volgende_batch_moment: eerstvolgende werkdag-cutoff (Europe/Amsterdam)
-- ============================================================================
-- Geeft het eerstvolgende tijdstip dat p_cutoff is op een werkdag (ma-vr),
-- op-of-na nu. Vandaag telt alleen als het een werkdag is én de cutoff nog niet
-- voorbij is; anders de eerstvolgende werkdag (werkdag_plus_n, mig 279 — skipt
-- za/zo, geen feestdagen, consistent met de TS/Deno-mirrors). DST-correct: de
-- cutoff is een LOKALE wandkloktijd in Amsterdam.
CREATE OR REPLACE FUNCTION volgende_batch_moment(p_cutoff TIME)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_lokaal_nu TIMESTAMP;   -- Amsterdamse wandklok (timestamp zonder tz)
  v_dag       DATE;
BEGIN
  IF p_cutoff IS NULL THEN RETURN NULL; END IF;

  v_lokaal_nu := now() AT TIME ZONE 'Europe/Amsterdam';
  v_dag       := v_lokaal_nu::date;

  -- Vandaag bruikbaar alleen als werkdag (ISODOW 1..5) én cutoff nog niet voorbij.
  IF NOT (EXTRACT(ISODOW FROM v_dag) BETWEEN 1 AND 5)
     OR v_lokaal_nu::time >= p_cutoff THEN
    v_dag := werkdag_plus_n(v_dag, 1);  -- eerstvolgende werkdag (skipt weekend)
  END IF;

  -- Lokale (Amsterdamse) cutoff terug naar timestamptz (DST-correct).
  RETURN (v_dag + p_cutoff) AT TIME ZONE 'Europe/Amsterdam';
END;
$$;

GRANT EXECUTE ON FUNCTION volgende_batch_moment(TIME) TO authenticated, service_role;

COMMENT ON FUNCTION volgende_batch_moment(TIME) IS
  'Mig 484: eerstvolgende werkdag-cutoff (Europe/Amsterdam) op-of-na nu. Vandaag '
  'alleen als werkdag + cutoff nog niet voorbij, anders werkdag_plus_n (mig 279). '
  'Voedt verzend_wachtrij.beschikbaar_op voor dagbatch-vervoerders (Rhenus).';

-- ============================================================================
-- §3. enqueue_transportorder: +p_beschikbaar_op. DROP de 4-arg versie zodat er
--     geen overload-ambiguïteit ontstaat; de 5-arg met DEFAULT NULL dekt oude
--     4-arg-aanroepen backward-compatible.
-- ============================================================================
DROP FUNCTION IF EXISTS enqueue_transportorder(BIGINT, INTEGER, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION enqueue_transportorder(
  p_zending_id      BIGINT,
  p_debiteur_nr     INTEGER,
  p_vervoerder_code TEXT,
  p_is_test         BOOLEAN DEFAULT FALSE,
  p_beschikbaar_op  TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO verzend_wachtrij
      (zending_id, debiteur_nr, vervoerder_code, status, is_test, beschikbaar_op)
       VALUES (p_zending_id, p_debiteur_nr, p_vervoerder_code, 'Wachtrij', p_is_test, p_beschikbaar_op)
  ON CONFLICT (zending_id) WHERE status NOT IN ('Fout','Geannuleerd')
  DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_transportorder(BIGINT, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated, service_role;

COMMENT ON FUNCTION enqueue_transportorder IS
  'ADR-0038 + mig 484: generieke enqueue. Idempotent (actieve rij bestaat al → '
  'no-op). p_beschikbaar_op NULL = direct claimbaar; gezet = dagbatch-vertraging.';

-- ============================================================================
-- §4. claim_volgende_transportorder: respecteer beschikbaar_op (spiegelt
--     claim_factuur_queue_items, mig 423). Verder ongewijzigd.
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_volgende_transportorder(p_vervoerder_code TEXT)
RETURNS verzend_wachtrij AS $$
DECLARE
  v_row verzend_wachtrij;
BEGIN
  UPDATE verzend_wachtrij
     SET status = 'Bezig'
   WHERE id = (
     SELECT id FROM verzend_wachtrij
      WHERE status = 'Wachtrij' AND vervoerder_code = p_vervoerder_code
        AND (beschikbaar_op IS NULL OR beschikbaar_op <= now())
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_volgende_transportorder(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION claim_volgende_transportorder IS
  'ADR-0038 + mig 484: claimt de oudste claimbare Wachtrij-rij voor een carrier '
  '(beschikbaar_op IS NULL OR <= now()). FOR UPDATE SKIP LOCKED.';

-- ============================================================================
-- §5. enqueue_zending_naar_vervoerder: hold-guard eruit, dagbatch-cutoff erin.
--     BASIS = mig 429 (de WERKELIJK laatste body — 429 > 426; 429 fixte de
--     'eigen'-tak naar status='Afgeleverd', die HIER ongewijzigd blijft). Twee
--     wijzigingen t.o.v. 429:
--       - de HOLD-GUARD (mig 420) is verwijderd → Rhenus meldt automatisch aan.
--       - batch_cutoff_tijd-lookup + volgende_batch_moment() → beschikbaar_op.
--     Drift-check: diff tegen mig 429 — alleen de api/sftp-tak + hold-guard
--     mogen verschillen. p_handmatig blijft als parameter (signatuur-stabiliteit;
--     meld_zending_handmatig_aan + de trigger roepen aan) maar stuurt geen hold meer.
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT,
  p_handmatig  BOOLEAN DEFAULT FALSE
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_batch_tijd      TIME;
  v_beschikbaar     TIMESTAMPTZ;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, batch_cutoff_tijd INTO v_actief, v_type, v_batch_tijd
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- Dagbatch (mig 484): een vervoerder met batch_cutoff_tijd gaat wél meteen in
  -- de wachtrij, maar pas claimbaar op de eerstvolgende werkdag-cutoff. NULL =
  -- direct (HST/Verhoek). De mig-420-hold-guard is hiermee overbodig en weg.
  v_beschikbaar := volgende_batch_moment(v_batch_tijd);

  -- SWITCH-POINT (ADR-0038): api/sftp via één generieke enqueue, carrier-blind.
  CASE v_type
    WHEN 'api', 'sftp' THEN
      PERFORM enqueue_transportorder(p_zending_id, v_debiteur_nr, v_vervoerder_code, v_is_test, v_beschikbaar);
      RETURN 'enqueued_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    -- Eigen vervoer (mig 424/429): colli klaarzetten + zending synchroon naar
    -- 'Afgeleverd' (geen carrier-callback). ONGEWIJZIGD overgenomen uit mig 429 —
    -- deze CREATE OR REPLACE moet die fix behouden (drift-valkuil).
    WHEN 'eigen' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      UPDATE zendingen
         SET status = 'Afgeleverd'::zending_status
       WHERE id = p_zending_id
         AND status = 'Klaar voor verzending';
      RETURN 'eigen_afgeleverd';

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT (ADR-0038). Mig 484: de mig-420-hold-guard is verwijderd '
  '(Rhenus meldt automatisch aan na voltooien). Een vervoerder met '
  'batch_cutoff_tijd krijgt beschikbaar_op = volgende_batch_moment() → dagbatch. '
  'p_handmatig is vestigiaal (signatuur-stabiliteit), stuurt geen hold meer.';

-- ============================================================================
-- §6. meld_zending_handmatig_aan → "Nu aanmelden (niet wachten tot de batch)".
--     De rij staat na voltooien al in de wachtrij (beschikbaar_op = cutoff).
--     Deze escape-hatch zet beschikbaar_op = now() zodat de eerstvolgende
--     cron-run (binnen een minuut) de zending alsnog meteen oppakt — voor een
--     urgente zending die niet tot 16:00 kan wachten.
-- ============================================================================
CREATE OR REPLACE FUNCTION meld_zending_handmatig_aan(p_zending_id BIGINT)
RETURNS TEXT AS $$
DECLARE
  v_status      TEXT;
  v_vervoerder  TEXT;
  v_geraakt     INTEGER;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Aanmelden kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  -- Vervroeg de wachtende rij naar nu (de normale flow heeft 'm al ge-enqueued).
  UPDATE verzend_wachtrij
     SET beschikbaar_op = now()
   WHERE zending_id = p_zending_id AND status = 'Wachtrij';
  GET DIAGNOSTICS v_geraakt = ROW_COUNT;

  IF v_geraakt > 0 THEN
    RETURN 'vervroegd_naar_nu';
  END IF;

  -- Geen wachtende rij (edge: trigger niet gevuurd) → alsnog enqueuen ÉN meteen
  -- vervroegen. enqueue_zending_naar_vervoerder zet beschikbaar_op op de cutoff
  -- (16:00); die moet hier alsnog naar now(), anders wacht "Nu aanmelden" tóch
  -- tot de batch — tegengesteld aan de belofte.
  PERFORM enqueue_zending_naar_vervoerder(p_zending_id, TRUE);
  UPDATE verzend_wachtrij
     SET beschikbaar_op = now()
   WHERE zending_id = p_zending_id AND status = 'Wachtrij';
  RETURN 'enqueued_en_vervroegd';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION meld_zending_handmatig_aan(BIGINT) TO authenticated;

COMMENT ON FUNCTION meld_zending_handmatig_aan IS
  'Mig 484 (herbestemd): "Nu aanmelden" — vervroegt de wachtende dagbatch-rij '
  'naar beschikbaar_op=now() zodat de eerstvolgende cron-run de zending meteen '
  'oppakt i.p.v. te wachten tot de cutoff (16:00). Escape-hatch voor urgentie.';

-- ============================================================================
-- §7. Vlag voor Rhenus + cutover-backfill van in-flight zendingen
-- ============================================================================
UPDATE vervoerders SET batch_cutoff_tijd = TIME '16:00' WHERE code = 'rhenus_sftp';

-- (a) Rhenus-zendingen die nu vastgehouden zijn op 'Klaar voor verzending'
--     ZONDER actieve wachtrij-rij (de oude held_handmatig-toestand): alsnog
--     enqueuen in de dagbatch. enqueue_transportorder is idempotent (ON CONFLICT).
DO $$
DECLARE
  v_z RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR v_z IN
    SELECT z.id, o.debiteur_nr
      FROM zendingen z
      JOIN orders o ON o.id = z.order_id
     WHERE z.vervoerder_code = 'rhenus_sftp'
       AND z.status = 'Klaar voor verzending'
       AND NOT EXISTS (
         SELECT 1 FROM verzend_wachtrij w
          WHERE w.zending_id = z.id
            AND w.status NOT IN ('Fout','Geannuleerd')
       )
  LOOP
    PERFORM enqueue_transportorder(
      v_z.id, v_z.debiteur_nr, 'rhenus_sftp', FALSE, volgende_batch_moment(TIME '16:00')
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Mig 484 backfill: % vastgehouden Rhenus-zending(en) alsnog ge-enqueued in de dagbatch.', v_n;
END $$;

-- (b) Reeds-wachtende Rhenus-rijen zonder beschikbaar_op (van vóór deze migratie)
--     niet stiekem vóór 16:00 laten uitgaan: zet ze in de eerstvolgende dagbatch.
UPDATE verzend_wachtrij
   SET beschikbaar_op = volgende_batch_moment(TIME '16:00')
 WHERE vervoerder_code = 'rhenus_sftp'
   AND status = 'Wachtrij'
   AND beschikbaar_op IS NULL;

-- ============================================================================
-- §8. Verifier — pure helper-asserts + claim-gate (rollback, net-nul)
-- ============================================================================
DO $$
DECLARE
  v_batch     TIMESTAMPTZ;
  v_lokaal    TIMESTAMP;
  v_zending   BIGINT;
  v_id        BIGINT;
  v_claim     verzend_wachtrij;
BEGIN
  -- volgende_batch_moment: in de toekomst, 16:00 lokaal, op een werkdag.
  v_batch  := volgende_batch_moment(TIME '16:00');
  v_lokaal := v_batch AT TIME ZONE 'Europe/Amsterdam';
  ASSERT v_batch >= now(), 'Mig 484: volgende_batch_moment ligt in het verleden';
  ASSERT v_lokaal::time = TIME '16:00', format('Mig 484: cutoff niet 16:00 maar %s', v_lokaal::time);
  ASSERT EXTRACT(ISODOW FROM v_lokaal::date) BETWEEN 1 AND 5,
    format('Mig 484: batch-dag is geen werkdag (%s)', v_lokaal::date);
  ASSERT volgende_batch_moment(NULL) IS NULL, 'Mig 484: NULL-cutoff moet NULL geven';
  ASSERT (SELECT batch_cutoff_tijd FROM vervoerders WHERE code = 'rhenus_sftp') = TIME '16:00',
    'Mig 484: rhenus_sftp.batch_cutoff_tijd niet 16:00';

  -- Claim-gate: een dummy-rij (vervoerder_code zonder cron) in de toekomst mag
  -- NIET geclaimd worden; vervroegd naar het verleden WEL. Net-nul opgeruimd.
  SELECT z.id INTO v_zending
    FROM zendingen z
   WHERE NOT EXISTS (
     SELECT 1 FROM verzend_wachtrij w WHERE w.zending_id = z.id AND w.status NOT IN ('Fout','Geannuleerd')
   )
   ORDER BY z.id LIMIT 1;
  IF v_zending IS NULL THEN
    RAISE NOTICE 'Mig 484 verifier: geen vrije zending — claim-gate-assert overgeslagen.';
    RETURN;
  END IF;

  v_id := enqueue_transportorder(v_zending, NULL, 'verifier_batch_484', FALSE, now() + interval '1 hour');
  IF v_id IS NULL THEN
    -- Race: een gelijktijdige transactie zette net een actieve rij op deze
    -- zending (buiten het gepauzeerde cutover-venster) → claim-gate-assert
    -- overslaan i.p.v. hard falen (spiegelt mig 426's verifier-guard).
    RAISE NOTICE 'Mig 484 verifier: testrij niet aangemaakt (zending al actief) — claim-gate-assert overgeslagen.';
    RETURN;
  END IF;

  v_claim := claim_volgende_transportorder('verifier_batch_484');
  ASSERT v_claim.id IS NULL, 'Mig 484: rij met beschikbaar_op in de toekomst werd tóch geclaimd';

  UPDATE verzend_wachtrij SET beschikbaar_op = now() - interval '1 minute' WHERE id = v_id;
  v_claim := claim_volgende_transportorder('verifier_batch_484');
  ASSERT v_claim.id = v_id, 'Mig 484: vervroegde rij werd niet geclaimd';

  DELETE FROM verzend_wachtrij WHERE id = v_id;
  RAISE NOTICE 'Mig 484 verifier: helpers + claim-gate OK (testrij opgeruimd).';
END $$;

NOTIFY pgrst, 'reload schema';
