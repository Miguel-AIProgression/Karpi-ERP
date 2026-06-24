-- Migratie 503: nieuwe factuurnummering voor facturen/creditnota's.
--
-- Aanleiding: gebruiker verzoekt overgang naar uniforme pure-numerieke reeks
-- zonder prefix of streepjes.
--
-- Oud format:  FACT-2026-0184  (laatste oude factuurnummer)
-- Nieuw format: 2026000185      (eerste nieuwe factuurnummer)
-- Schema: YYYY + 6-cijferig volgnummer (LPAD-veilig; > 999999 → automatisch 7 cijfers)
--
-- Aanpak:
-- 1. Maak sequence 'fact_2026_seq' aan — dit is de naam die volgend_nummer()
--    intern afleidt voor type='FACT' (LOWER('FACT') || '_' || 2026 || '_seq').
--    Tot nu toe bestond die sequence NIET, waardoor volgend_nummer terugviel op
--    de nummering-tabel. Zodra de sequence bestaat, wordt die automatisch gebruikt.
-- 2. Start de sequence op minstens 185 (= max-oud + 1 = 184 + 1).
-- 3. Overschrijf volgend_nummer: voor type='FACT' geeft het nu YYYYNNNNNN.
-- 4. Alle bestaande facturen bevatten nog het oude FACT-2026-XXXX format en
--    blijven ongewijzigd staan — geen backfill nodig.

CREATE SEQUENCE IF NOT EXISTS fact_2026_seq MINVALUE 1 START 185;

DO $$
DECLARE v_max INT;
BEGIN
  -- Bepaal het hoogste volgnummer uit de bestaande FACT-2026-XXXX-reeks.
  SELECT COALESCE(
    MAX(CAST(SPLIT_PART(factuur_nr, '-', 3) AS INT)),
    184
  ) + 1 INTO v_max
  FROM facturen
  WHERE factuur_nr ~ '^FACT-2026-\d+$';
  -- Setval is idempotent-safe: GREATEST zorgt dat her-uitvoeren de sequence
  -- nooit omlaag zet.
  PERFORM setval('fact_2026_seq', GREATEST(v_max, 185));
END $$;

-- Herstel volgend_nummer met de FACT-uitzondering.
-- De rest van de functie is byte-identiek aan mig 116 zodat alle andere types
-- (ORD, SNIJ, SNIJV, ...) ongewijzigd blijven.
CREATE OR REPLACE FUNCTION public.volgend_nummer(p_type text)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
    v_jaar   INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_seq    TEXT    := LOWER(p_type) || '_' || v_jaar || '_seq';
    v_nr     BIGINT;
    v_nr_str TEXT;
BEGIN
    BEGIN
        EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_nr;
    EXCEPTION WHEN undefined_table THEN
        INSERT INTO nummering (type, jaar, laatste_nummer)
        VALUES (p_type, v_jaar, 1)
        ON CONFLICT (type, jaar)
        DO UPDATE SET laatste_nummer = nummering.laatste_nummer + 1
        RETURNING laatste_nummer INTO v_nr;
    END;

    -- Nieuwe FACT-nummering: YYYYNNNNNN (6 cijfers, geen prefix/streepje).
    -- Oud: FACT-2026-0184 → Nieuw: 2026000185.
    -- > 999999: LPAD heeft geen maximum, dus 7+ cijfers gaan gewoon goed.
    IF p_type = 'FACT' THEN
        v_nr_str := v_nr::TEXT;
        IF LENGTH(v_nr_str) < 6 THEN
            v_nr_str := LPAD(v_nr_str, 6, '0');
        END IF;
        RETURN v_jaar::TEXT || v_nr_str;
    END IF;

    -- Overige types: bestaand gedrag (PREFIX-YYYY-NNNN).
    -- Anti-truncation: LPAD alleen als < 4 digits (mig 116).
    v_nr_str := v_nr::TEXT;
    IF LENGTH(v_nr_str) < 4 THEN
        v_nr_str := LPAD(v_nr_str, 4, '0');
    END IF;

    RETURN p_type || '-' || v_jaar || '-' || v_nr_str;
END;
$function$;

COMMENT ON FUNCTION public.volgend_nummer(text) IS
  'Sequence-based volgnummer-generator (mig 116, uitgebreid mig 503). '
  'FACT: YYYYNNNNNN (6+ cijfers, geen prefix — mig 503). '
  'Overig: PREFIX-YYYY-NNNN (anti-LPAD-truncation, mig 116). '
  'Gebruikt per-type-jaar sequences met fallback naar nummering-tabel.';
