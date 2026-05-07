-- Migratie 203: betaalcondities — dagen herleiden + RPC voor klantenlijst
--
-- Vervolg op mig 202. Twee toevoegingen:
-- (1) Voor `betaalcondities`-rijen waar `dagen` NULL is, een tweede poging
--     om het uit `naam` te halen — deze keer met breder regex-arsenaal
--     (incl. afgekorte vormen zoals "30 t.", "45 d.").
-- (2) Een RPC die alle klanten teruggeeft die een gegeven betaalconditie-
--     code gebruiken — voor de "klik op het aantal"-modal in de instellingen.

------------------------------------------------------------------------
-- 1. Tweede-poging-parse voor dagen
------------------------------------------------------------------------
-- Strategie:
--   a) "30 dagen", "45 tage", "60 days", "30 tag", "21 day"        (volledig woord)
--   b) "30 t.", "45 d.", "30 t", "45 d"                            (afgekort)
--   c) Leeg vooraan met getal: "30 netto", "45 ohne Abzug"         (leading number)
-- Stop bij eerste match. Alleen bijwerken waar dagen IS NULL.

UPDATE betaalcondities
SET dagen = sub.parsed
FROM (
  SELECT
    code,
    COALESCE(
      (regexp_match(naam, '\b(\d+)\s*(?:dagen|tage|days|tag|day)\b', 'i'))[1]::INTEGER,
      (regexp_match(naam, '\b(\d+)\s*(?:t|d)\.', 'i'))[1]::INTEGER,
      (regexp_match(naam, '\b(\d+)\s*(?:t|d)\b', 'i'))[1]::INTEGER,
      (regexp_match(naam, '^\s*(\d+)\b'))[1]::INTEGER
    ) AS parsed
  FROM betaalcondities
  WHERE dagen IS NULL
) sub
WHERE betaalcondities.code = sub.code
  AND betaalcondities.dagen IS NULL
  AND sub.parsed IS NOT NULL;

-- Rapport: hoeveel rijen alsnog gevuld
DO $$
DECLARE
  v_total   INTEGER;
  v_filled  INTEGER;
  v_empty   INTEGER;
  v_orphan  TEXT;
BEGIN
  SELECT COUNT(*)               INTO v_total  FROM betaalcondities;
  SELECT COUNT(*) FILTER (WHERE dagen IS NOT NULL) INTO v_filled FROM betaalcondities;
  v_empty := v_total - v_filled;

  RAISE NOTICE 'Mig 203 dagen-herleiding:';
  RAISE NOTICE '  Totaal condities:        %', v_total;
  RAISE NOTICE '  Met dagen ingevuld:      %', v_filled;
  RAISE NOTICE '  Nog NULL (handmatig):    %', v_empty;

  IF v_empty > 0 THEN
    RAISE NOTICE 'Naam-waarden zonder dagen-match (handmatig invullen via UI):';
    FOR v_orphan IN
      SELECT format('  "%s - %s"', code, naam) FROM betaalcondities
      WHERE dagen IS NULL
      ORDER BY code
    LOOP
      RAISE NOTICE '%', v_orphan;
    END LOOP;
  END IF;
END $$;

------------------------------------------------------------------------
-- 2. RPC: klanten_voor_betaalconditie(code)
------------------------------------------------------------------------
-- Geeft alle debiteuren terug wier betaalconditie-veld het format
-- "{code} - ..." gebruikt. Gebruikt door de modal achter het aantal-
-- klanten-cijfer op /instellingen/betaalcondities.

CREATE OR REPLACE FUNCTION klanten_voor_betaalconditie(p_code TEXT)
RETURNS TABLE (
  debiteur_nr   INTEGER,
  naam          TEXT,
  plaats        TEXT,
  status        TEXT,
  betaalconditie TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.debiteur_nr,
    d.naam,
    d.plaats,
    d.status,
    d.betaalconditie
  FROM debiteuren d
  WHERE d.betaalconditie IS NOT NULL
    AND d.betaalconditie ~ '^\s*\d+\s*-'
    AND trim(split_part(d.betaalconditie, '-', 1)) = p_code
  ORDER BY d.naam;
$$;

COMMENT ON FUNCTION klanten_voor_betaalconditie(TEXT) IS
  'Lijst van klanten die een betaalconditie met de gegeven code gebruiken. '
  'Match: prefix-extract uit debiteuren.betaalconditie zoals view '
  'betaalcondities_met_aantal_klanten dat ook doet. Mig 203.';

NOTIFY pgrst, 'reload schema';
