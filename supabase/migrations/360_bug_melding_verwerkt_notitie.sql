-- Migratie 360: bug-meldingen — verwerkingsnotitie + "verwerkt"-notificatie voor de melder
--
-- Bouwt voort op mig 342 (bug_meldingen). Twee toevoegingen:
--
-- 1. Verwerkingsnotitie. Bij het op 'Verwerkt' zetten kan de beheerder nu een
--    toelichting meegeven in twee velden: wat is opgelost (verwerkt_opgelost) en
--    hoe de melder het kan testen (verwerkt_testen). Beide zijn zichtbaar voor de
--    melder op de meldingen-pagina.
--
-- 2. "Verwerkt"-notificatie voor de melder. Nieuwe kolom verwerkt_gezien_op legt
--    vast wanneer de melder de verwerking gezien heeft. Een melding telt als
--    "ongezien verwerkt" zolang status='Verwerkt' AND verwerkt_gezien_op IS NULL.
--    De frontend toont daarop een belletje + teller rechtsboven. Bij het openen
--    van de meldingen-pagina stempelt de melder zijn eigen ongeziene meldingen
--    via markeer_verwerkt_gezien() — daarna verdwijnt de teller.
--
-- set_bug_status krijgt twee extra (optionele) parameters voor de notitie en
-- reset verwerkt_gezien_op bij elke nieuwe verwerking (zodat een her-verwerking
-- de melder opnieuw attendeert). 'Open' wist notitie + gezien-stempel; bij
-- 'Geaccepteerd' impliceert de acceptatie dat de melder het gezien heeft.
--
-- Idempotent: kolommen via ADD COLUMN IF NOT EXISTS, RPC's via DROP + CREATE.

-- ---------------------------------------------------------------------------
-- 1. Nieuwe kolommen
-- ---------------------------------------------------------------------------
ALTER TABLE bug_meldingen ADD COLUMN IF NOT EXISTS verwerkt_opgelost   TEXT;
ALTER TABLE bug_meldingen ADD COLUMN IF NOT EXISTS verwerkt_testen     TEXT;
ALTER TABLE bug_meldingen ADD COLUMN IF NOT EXISTS verwerkt_gezien_op  TIMESTAMPTZ;

COMMENT ON COLUMN bug_meldingen.verwerkt_opgelost  IS 'Mig 360: toelichting van de beheerder — wat is opgelost (gezet bij status Verwerkt).';
COMMENT ON COLUMN bug_meldingen.verwerkt_testen    IS 'Mig 360: toelichting van de beheerder — hoe de melder het kan testen.';
COMMENT ON COLUMN bug_meldingen.verwerkt_gezien_op IS 'Mig 360: wanneer de melder de verwerking heeft gezien. NULL + status Verwerkt = ongezien (voedt de teller rechtsboven).';

-- ---------------------------------------------------------------------------
-- 2. Status-transitie-RPC herzien (extra notitie-parameters + gezien-reset)
-- ---------------------------------------------------------------------------
-- De oude 2-argument-versie moet eerst weg: een extra parameter met default
-- maakt een nieuwe signature die naast de oude zou blijven bestaan.
DROP FUNCTION IF EXISTS set_bug_status(BIGINT, bug_melding_status);

CREATE OR REPLACE FUNCTION set_bug_status(
  p_id       BIGINT,
  p_status   bug_melding_status,
  p_opgelost TEXT DEFAULT NULL,
  p_testen   TEXT DEFAULT NULL
)
RETURNS bug_meldingen
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      bug_meldingen;
  v_is_admin BOOLEAN := is_bug_beheerder();
  v_uid      UUID    := auth.uid();
BEGIN
  SELECT * INTO v_row FROM bug_meldingen WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bug-melding % bestaat niet', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_status = 'Geaccepteerd' THEN
    -- Accepteren mag de melder zelf (of de beheerder), alleen vanuit 'Verwerkt'.
    IF v_row.gemeld_door IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de melder kan een melding accepteren';
    END IF;
    IF v_row.status <> 'Verwerkt' THEN
      RAISE EXCEPTION 'Een melding kan alleen vanuit "Verwerkt" geaccepteerd worden';
    END IF;
  ELSE
    -- 'Open' / 'Verwerkt' (verwerken + terugzetten): alleen de beheerder.
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Alleen de beheerder kan deze status zetten';
    END IF;
  END IF;

  UPDATE bug_meldingen
     SET status            = p_status,
         verwerkt_op       = CASE
                               WHEN p_status = 'Verwerkt' THEN now()
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_op
                             END,
         -- Notitie alleen schrijven bij verwerken; bij terugzetten wissen;
         -- bij accepteren ongemoeid laten (melder ziet de toelichting nog).
         verwerkt_opgelost = CASE
                               WHEN p_status = 'Verwerkt' THEN NULLIF(btrim(p_opgelost), '')
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_opgelost
                             END,
         verwerkt_testen   = CASE
                               WHEN p_status = 'Verwerkt' THEN NULLIF(btrim(p_testen), '')
                               WHEN p_status = 'Open'     THEN NULL
                               ELSE verwerkt_testen
                             END,
         -- Nieuwe verwerking = ongezien voor de melder (teller licht weer op).
         -- Open wist de stempel; accepteren impliceert dat de melder het zag.
         verwerkt_gezien_op = CASE
                               WHEN p_status = 'Verwerkt'    THEN NULL
                               WHEN p_status = 'Open'        THEN NULL
                               WHEN p_status = 'Geaccepteerd' THEN now()
                               ELSE verwerkt_gezien_op
                             END,
         geaccepteerd_op   = CASE WHEN p_status = 'Geaccepteerd' THEN now() ELSE NULL END
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END; $$;

COMMENT ON FUNCTION set_bug_status(BIGINT, bug_melding_status, TEXT, TEXT) IS
  'Mig 360 (was 342): zet de status van een bug-melding met autorisatie. '
  'Open/Verwerkt = alleen beheerder; Geaccepteerd = melder (vanuit Verwerkt). '
  'Bij Verwerkt optioneel een notitie (opgelost/testen) en reset van de gezien-stempel.';

GRANT EXECUTE ON FUNCTION set_bug_status(BIGINT, bug_melding_status, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Melder stempelt zijn eigen verwerkte meldingen als gezien
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION markeer_verwerkt_gezien()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE bug_meldingen
     SET verwerkt_gezien_op = now()
   WHERE gemeld_door = v_uid
     AND status = 'Verwerkt'
     AND verwerkt_gezien_op IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

COMMENT ON FUNCTION markeer_verwerkt_gezien() IS
  'Mig 360: stempelt alle eigen Verwerkt-meldingen van de ingelogde melder als '
  'gezien (verwerkt_gezien_op = now()). Dooft de teller rechtsboven.';

GRANT EXECUTE ON FUNCTION markeer_verwerkt_gezien() TO authenticated;

NOTIFY pgrst, 'reload schema';
