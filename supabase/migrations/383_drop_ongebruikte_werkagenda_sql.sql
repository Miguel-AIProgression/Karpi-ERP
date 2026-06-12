-- Migratie 383: drop ongebruikte werkagenda-SQL-functies (mig 279)
--
-- Mig 279 introduceerde werkdag_offset_n / werkdag_plus_n / werkdag_min_n /
-- werkagenda_kalender als "SQL ground-truth", maar er is nooit één SQL-caller
-- gekomen (geverifieerd 2026-06-12: nul verwijzingen in views/RPC's, repo én
-- live). De levende bron is supabase/functions/_shared/werkagenda.ts (plan
-- 2026-06-12-werkagenda-een-bron). Drie definities onderhouden voor nul
-- SQL-gebruik is puur divergentie-risico — vandaar drop. Her-introduceer pas
-- wanneer een echte SQL-caller bestaat, en laat die dan de werkagenda-config
-- uit app_config sleutel 'werkagenda' (mig 384) lezen i.p.v. hardcoded ma-vr.

-- Pre-flight: faal hard als een functie-body tóch naar de helpers verwijst
-- (DROP ... RESTRICT vangt alleen views/geregistreerde dependencies, geen
-- dynamische plpgsql-aanroepen).
DO $$
DECLARE v_caller TEXT;
BEGIN
  SELECT p.proname INTO v_caller
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.prosrc ILIKE '%werkdag\_offset\_n%' ESCAPE '\'
       OR p.prosrc ILIKE '%werkdag\_plus\_n%'   ESCAPE '\'
       OR p.prosrc ILIKE '%werkdag\_min\_n%'    ESCAPE '\'
       OR p.prosrc ILIKE '%werkagenda\_kalender%' ESCAPE '\')
     AND p.proname NOT IN ('werkdag_offset_n', 'werkdag_plus_n', 'werkdag_min_n', 'werkagenda_kalender')
   LIMIT 1;
  IF v_caller IS NOT NULL THEN
    RAISE EXCEPTION 'mig 383: functie "%" verwijst nog naar de werkagenda-helpers — niet droppen', v_caller;
  END IF;
END $$;

-- Wrappers eerst, dan de kern (RESTRICT default: een onverwachte view-dependency laat de drop falen).
DROP FUNCTION IF EXISTS werkdag_min_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkdag_plus_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkdag_offset_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkagenda_kalender(DATE, DATE);

NOTIFY pgrst, 'reload schema';
