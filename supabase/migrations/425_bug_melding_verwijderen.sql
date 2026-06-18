-- Migratie 425: bug_meldingen — melding verwijderen (melder of beheerder)
--
-- Bouwt voort op mig 342 (bug_meldingen) en mig 360 (verwerkingsnotitie).
--
-- Tot nu toe kon een melding alleen van status veranderen (Open/Verwerkt/
-- Geaccepteerd), niet verwijderd worden. De UI heeft nu een prullenbak-knop die
-- zichtbaar is voor (a) de oorspronkelijke melder en (b) de bug-beheerder
-- (Miguel, single source of truth is_bug_beheerder() / frontend beheerder.ts).
--
-- Twee onderdelen:
--
-- 1. RPC verwijder_bug_melding(p_id) — SECURITY DEFINER, spiegelt de autorisatie
--    van set_bug_status. Verwijdert de rij en geeft de bijlage_path terug zodat de
--    frontend daarna het storage-object kan opruimen (de RPC raakt storage niet —
--    een SQL-DELETE op storage.objects laat het fysieke S3-bestand als wees achter;
--    de Storage-API verwijdert het echt). Geen DELETE-policy op bug_meldingen nodig:
--    verwijderen loopt uitsluitend via deze RPC, net als de status-transities.
--
-- 2. Storage DELETE-policy op bucket 'bug-bijlagen'. Mig 342 gaf alleen INSERT +
--    SELECT; zonder DELETE-policy kan de frontend het bijlage-bestand niet
--    opruimen. De policy staat verwijderen toe voor de eigenaar (de bijlage ligt
--    in de map {gebruiker-id}/...) of de beheerder.
--
-- Idempotent: RPC via CREATE OR REPLACE, policy in DO-block met duplicate_object-guard.

-- ---------------------------------------------------------------------------
-- 1. Verwijder-RPC (autorisatie: melder of beheerder)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verwijder_bug_melding(p_id BIGINT)
RETURNS TEXT          -- bijlage_path van de verwijderde melding (of NULL)
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

  -- Alleen de melder zelf of de beheerder mag verwijderen.
  IF v_row.gemeld_door IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Alleen de melder of de beheerder kan een melding verwijderen';
  END IF;

  DELETE FROM bug_meldingen WHERE id = p_id;

  RETURN v_row.bijlage_path;
END; $$;

COMMENT ON FUNCTION verwijder_bug_melding(BIGINT) IS
  'Mig 425: verwijdert een bug-melding (alleen de melder of de beheerder). '
  'Geeft de bijlage_path terug zodat de frontend het storage-object kan opruimen.';

GRANT EXECUTE ON FUNCTION verwijder_bug_melding(BIGINT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Storage DELETE-policy voor bijlagen (eigen map of beheerder)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY "Verwijder eigen bug-bijlage of beheerder"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'bug-bijlagen'
      AND ( (storage.foldername(name))[1] = auth.uid()::text OR is_bug_beheerder() )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
