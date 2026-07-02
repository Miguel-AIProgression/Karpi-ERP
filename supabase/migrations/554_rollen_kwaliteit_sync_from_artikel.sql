-- Migratie 554: rollen.kwaliteit_code/kleur_code synchroniseren vanuit producten
--
-- Probleem: sync_rollen_voorraad.py leidde kwaliteit_code en kleur_code af via
-- parse_karpi_code() — eerste letters = kwaliteit, eerste 2 digits = kleur.
-- Voor karpi_code 'TAM123400ONG' geeft dit kw='TAM', kl='12' terwijl het product
-- (artikelnr 1337007) kw='TAMA', kl='23' heeft. De productpagina toont rollen via
-- artikelnr (correct), maar fetchBeschikbareRollen zoekt op kwaliteit_code/kleur_code
-- (incorrect) — vandaar dat 3 beschikbare TAMA/23-rollen onzichtbaar waren voor
-- de snijplanner en als "tekort" werden gerapporteerd.
--
-- Fix:
--   1. Data-correctie: UPDATE de 7 foutieve rollen via producten-JOIN.
--   2. Trigger: BEFORE INSERT OR UPDATE zorgt dat kwaliteit_code/kleur_code/
--      zoeksleutel altijd consistent zijn met het gekoppelde product. Zo zijn
--      toekomstige importfouten zelfherstellend.

-- ─── Stap 1: corrigeer bestaande mismatches ───────────────────────────────────
UPDATE rollen r
SET
  kwaliteit_code = p.kwaliteit_code,
  kleur_code     = p.kleur_code,
  zoeksleutel    = p.kwaliteit_code || '_' || p.kleur_code
FROM producten p
WHERE r.artikelnr = p.artikelnr
  AND (
    r.kwaliteit_code IS DISTINCT FROM p.kwaliteit_code
    OR r.kleur_code  IS DISTINCT FROM p.kleur_code
  );

-- ─── Stap 2: trigger voor toekomstige inserts/updates ─────────────────────────
CREATE OR REPLACE FUNCTION _sync_rol_kwaliteit_from_artikel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_kw TEXT;
  v_kl TEXT;
BEGIN
  IF NEW.artikelnr IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kwaliteit_code, kleur_code
  INTO v_kw, v_kl
  FROM producten
  WHERE artikelnr = NEW.artikelnr;

  IF FOUND THEN
    NEW.kwaliteit_code := v_kw;
    NEW.kleur_code     := v_kl;
    NEW.zoeksleutel    := v_kw || '_' || v_kl;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollen_sync_kwaliteit ON rollen;

CREATE TRIGGER trg_rollen_sync_kwaliteit
BEFORE INSERT OR UPDATE OF artikelnr
ON rollen
FOR EACH ROW EXECUTE FUNCTION _sync_rol_kwaliteit_from_artikel();
