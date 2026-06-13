-- Migratie 390: zendingen.totaal_gewicht_kg = SUM(zending_colli.gewicht_kg) sync
-- (repo-nr 390; volgt op 389_colli_omschrijving_snapshot. Vlak vóór merge
--  hernummerd van 389 — origin/main claimde 388 (maatwerk_vorm_contour). In de
--  live DB op 13-06 toegepast als werknummer 389; idempotent, inhoudelijk gelijk.)
--
-- VOLGORDE-EIS: draai dit NÁ mig 387 (colli-gewicht-fix, fix/colli-gewicht).
-- De backfill hieronder somt over zending_colli.gewicht_kg; mig 387 vult/
-- corrigeert die waarden eerst (density-bug). Vóór 387 zou de backfill over
-- nog-rotte/0-gewichten sommen. Idempotent, dus opnieuw draaien na 387 is veilig.
--
-- Aanleiding (SSCC-analogen-audit 2026-06-13, A2): drie vervoerders leiden het
-- verzendgewicht elk anders af. HST gebruikt per-colli zending_colli.gewicht_kg
-- met een FALLBACK op zendingen.totaal_gewicht_kg (bij 0 colli); Rhenus somt
-- runtime SUM(colli); Verhoek per-colli (decagram). zendingen.totaal_gewicht_kg
-- werd NOOIT gesynct met SUM(colli) — een zending kon dus twee verschillende
-- totaalgewichten hebben afhankelijk van het kanaal. Deze trigger maakt
-- zendingen.totaal_gewicht_kg een AFGELEIDE van SUM(colli), zodat de HST-
-- fallback gegarandeerd hetzelfde totaal stuurt als de per-colli-som.
--
-- Scope-grens: dit raakt UITSLUITEND zendingen.totaal_gewicht_kg (de afgeleide
-- som) + de trigger. NIET zending_colli.gewicht_kg of de producten-cache —
-- dat is de gewicht-DATA-keten van mig 387 (andere sessie). Géén overlap.
--
-- Bundel-lock (mig 230): die trigger lockt orders.afleverdatum/afl_*/debiteur_nr,
-- niet zendingen.totaal_gewicht_kg → deze sync mag draaien op actieve bundels.

CREATE OR REPLACE FUNCTION sync_zending_totaal_gewicht()
RETURNS TRIGGER AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  v_zending_id := COALESCE(NEW.zending_id, OLD.zending_id);
  UPDATE zendingen z
  SET totaal_gewicht_kg = (
    SELECT COALESCE(SUM(c.gewicht_kg), 0)
    FROM zending_colli c
    WHERE c.zending_id = v_zending_id
  )
  WHERE z.id = v_zending_id;
  RETURN NULL; -- AFTER-trigger: returnwaarde wordt genegeerd
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_zending_totaal_gewicht ON zending_colli;
CREATE TRIGGER trg_sync_zending_totaal_gewicht
  AFTER INSERT OR DELETE OR UPDATE OF gewicht_kg ON zending_colli
  FOR EACH ROW
  EXECUTE FUNCTION sync_zending_totaal_gewicht();

COMMENT ON FUNCTION sync_zending_totaal_gewicht IS
  'Mig 390: houdt zendingen.totaal_gewicht_kg = SUM(zending_colli.gewicht_kg). '
  'Afgeleide som zodat de HST-fallback hetzelfde totaal stuurt als de per-colli-'
  'gewichten (audit A2). Vuurt bij INSERT/DELETE/UPDATE OF gewicht_kg op colli.';

-- Eenmalige backfill voor niet-verzonden zendingen. Verzonden/afgeleverde
-- zendingen bewust ongemoeid (historie zoals die de deur uit ging).
UPDATE zendingen z
SET totaal_gewicht_kg = sub.som
FROM (
  SELECT zending_id, COALESCE(SUM(gewicht_kg), 0) AS som
  FROM zending_colli
  GROUP BY zending_id
) sub
WHERE z.id = sub.zending_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd')
  AND z.totaal_gewicht_kg IS DISTINCT FROM sub.som;

-- Verifier-rapport
DO $$
DECLARE
  v_mismatch INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_mismatch
  FROM zendingen z
  WHERE z.status NOT IN ('Onderweg', 'Afgeleverd')
    AND EXISTS (SELECT 1 FROM zending_colli c WHERE c.zending_id = z.id)
    AND z.totaal_gewicht_kg IS DISTINCT FROM (
      SELECT COALESCE(SUM(c.gewicht_kg), 0) FROM zending_colli c WHERE c.zending_id = z.id
    );
  RAISE NOTICE 'Mig 390 verifier: niet-verzonden zendingen met totaal <> SUM(colli): % (verwacht 0)', v_mismatch;
END $$;

NOTIFY pgrst, 'reload schema';
