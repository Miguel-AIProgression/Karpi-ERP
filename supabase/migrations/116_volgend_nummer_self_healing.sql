-- Migration 116: volgend_nummer() — sequence-based + LPAD truncation fix
--
-- TWEE GECOMBINEERDE FIXES
--
-- 1) LPAD TRUNCATION BUG (root cause van herhaalde duplicate-key errors bij
--    herplannen van 190+ groepen). De oorspronkelijke return was:
--       LPAD(v_nr::TEXT, 4, '0')
--    PostgreSQL's LPAD truncateert aan de rechterkant wanneer de input
--    langer is dan de target length. Dus LPAD('25001', 4, '0') → '2500',
--    LPAD('15001', 4, '0') → '1500'. Zodra de teller de 9999-drempel
--    passeerde, genereerde volgend_nummer nummers die al bestonden
--    (SNIJV-2026-1500 bestond al, dus nieuwe insert op '1500' → collision).
--    Fix: padding alleen toepassen als nummer < 4 digits, anders as-is.
--
-- 2) SEQUENCE-BASED COUNTER (voorkomt toekomstige problemen). De oude
--    nummering-tabel + ON CONFLICT benadering was kwetsbaar voor race
--    conditions, triggers en handmatige resets. Sequences zijn atomair op
--    PostgreSQL-niveau, immuun voor triggers, en kunnen nooit out-of-sync
--    raken met zichzelf. Sequences worden lazy aangemaakt bij eerste call
--    (undefined_table exception → fallback naar nummering-tabel).
--
-- Idempotent: CREATE OR REPLACE, signatuur ongewijzigd.

-- Sequences starten hoog genoeg om nooit te overlappen met bestaande nummers.
-- setval() is safe te herhalen — het herinstellen naar dezelfde of lagere
-- waarde wordt niet teruggezet, want we gebruiken GREATEST.
CREATE SEQUENCE IF NOT EXISTS snijv_2026_seq MINVALUE 1 START 25000;
CREATE SEQUENCE IF NOT EXISTS ord_2026_seq   MINVALUE 1 START 2000;
CREATE SEQUENCE IF NOT EXISTS snij_2026_seq  MINVALUE 1 START 4000;

-- Force sequences boven huidige echte max (werkt ook bij her-uitvoeren).
DO $$
DECLARE
    v_snijv_max INT := COALESCE((SELECT MAX(CAST(SPLIT_PART(voorstel_nr,'-',3) AS INT))
                                   FROM snijvoorstellen WHERE voorstel_nr LIKE 'SNIJV-2026-%'), 0);
    v_ord_max   INT := COALESCE((SELECT MAX(CAST(SPLIT_PART(order_nr,'-',3) AS INT))
                                   FROM orders WHERE order_nr LIKE 'ORD-2026-%'), 0);
    v_snij_max  INT := COALESCE((SELECT MAX(CAST(SPLIT_PART(snijplan_nr,'-',3) AS INT))
                                   FROM snijplannen WHERE snijplan_nr LIKE 'SNIJ-2026-%'), 0);
BEGIN
    PERFORM setval('snijv_2026_seq', GREATEST(v_snijv_max + 1, 25000));
    PERFORM setval('ord_2026_seq',   GREATEST(v_ord_max   + 1, 2000));
    PERFORM setval('snij_2026_seq',  GREATEST(v_snij_max  + 1, 4000));
END $$;

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
    -- Probeer de type+jaar specifieke sequence (atomair, trigger-safe).
    -- Als die niet bestaat (nieuwe type of nieuw jaar), val terug op de
    -- oude nummering-tabel zodat bestaande flows blijven werken.
    BEGIN
        EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_nr;
    EXCEPTION WHEN undefined_table THEN
        INSERT INTO nummering (type, jaar, laatste_nummer)
        VALUES (p_type, v_jaar, 1)
        ON CONFLICT (type, jaar)
        DO UPDATE SET laatste_nummer = nummering.laatste_nummer + 1
        RETURNING laatste_nummer INTO v_nr;
    END;

    -- Padding: minimaal 4 digits, maar NIET truncaten als nummer al ≥4
    -- digits is. Zie migratie-header voor de oorspronkelijke LPAD bug.
    v_nr_str := v_nr::TEXT;
    IF LENGTH(v_nr_str) < 4 THEN
        v_nr_str := LPAD(v_nr_str, 4, '0');
    END IF;

    RETURN p_type || '-' || v_jaar || '-' || v_nr_str;
END;
$function$;

COMMENT ON FUNCTION public.volgend_nummer(text) IS
  'Sequence-based volgnummer-generator met anti-truncation padding. '
  'Gebruikt per-type-jaar sequences (snijv_2026_seq / ord_2026_seq / snij_2026_seq) '
  'voor atomaire uniqueness, met fallback naar nummering-tabel voor onbekende types. '
  'Padding tot 4 digits voor nummers < 1000, daarna as-is (voorkomt LPAD-truncatie '
  'die fataal was bij nummer ≥ 10000). Zie migratie 116 voor context.';
