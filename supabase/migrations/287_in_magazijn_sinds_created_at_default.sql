-- Migratie 287: in_magazijn_sinds — sentinel vervangen door record-aanmaakdatum
--
-- Context (ADR-0021): mig 280 zette historische rollen zonder IO-koppeling op
-- de sentinel DATE '2000-01-01'. Beter signaal voor "wanneer kwam dit binnen"
-- is de aanmaakdatum van het rollen-record in Supabase (rollen.created_at).
--
-- Deze migratie:
--   1. Backfill: elke rol die nu op de sentinel staat → created_at::date
--      (keten-wortels eerst, daarna erven reststukken opnieuw via CTE).
--   2. BEFORE INSERT-trigger: nieuwe rollen zonder expliciete in_magazijn_sinds
--      krijgen voortaan created_at::date als default (IO-ontvangst en
--      reststuk-erfgang zetten het al expliciet en passeren de trigger).
--
-- Defensief: als rollen géén created_at-kolom heeft (basis-tabel is pre-053,
-- buiten de repo) valt de backfill terug op reststuk_datum en raakt de rest
-- niet aan; een NOTICE meldt dat dan.

-- ---------------------------------------------------------------------------
-- 1. Backfill bestaande sentinel-rijen
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_has_created BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rollen'
      AND column_name = 'created_at'
  ) INTO v_has_created;

  IF v_has_created THEN
    -- Keten-wortels die op de sentinel staan → eigen created_at.
    UPDATE rollen
       SET in_magazijn_sinds = created_at::date
     WHERE in_magazijn_sinds = DATE '2000-01-01'
       AND created_at IS NOT NULL;

    -- Reststuk-keten erft opnieuw van de (mogelijk net gecorrigeerde) wortel.
    WITH RECURSIVE keten AS (
      SELECT id, in_magazijn_sinds
      FROM rollen
      WHERE oorsprong_rol_id IS NULL
      UNION ALL
      SELECT r.id, k.in_magazijn_sinds
      FROM rollen r
      JOIN keten k ON r.oorsprong_rol_id = k.id
    )
    UPDATE rollen rr
       SET in_magazijn_sinds = k.in_magazijn_sinds
      FROM keten k
     WHERE rr.id = k.id
       AND rr.oorsprong_rol_id IS NOT NULL
       AND k.in_magazijn_sinds IS NOT NULL;

    RAISE NOTICE 'Mig 287: sentinel-rijen herzet naar rollen.created_at::date + keten opnieuw geërfd.';
  ELSE
    -- Fallback: geen created_at-kolom → gebruik reststuk_datum waar mogelijk.
    UPDATE rollen
       SET in_magazijn_sinds = reststuk_datum::date
     WHERE in_magazijn_sinds = DATE '2000-01-01'
       AND reststuk_datum IS NOT NULL;
    RAISE NOTICE 'Mig 287: rollen.created_at ontbreekt — sentinel waar mogelijk uit reststuk_datum gehaald; overige blijven 2000-01-01.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Default voor nieuwe rollen via BEFORE INSERT-trigger
-- ---------------------------------------------------------------------------
-- Leest created_at veilig via to_jsonb (geen harde kolom-afhankelijkheid als
-- de basis-tabel die kolom niet zou hebben). Expliciet gezette waarden
-- (IO-ontvangst mig 281, reststuk-erfgang mig 282) blijven ongemoeid.
CREATE OR REPLACE FUNCTION trg_rollen_default_in_magazijn_sinds()
RETURNS trigger AS $$
DECLARE
  v_created TEXT;
BEGIN
  IF NEW.in_magazijn_sinds IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_created := to_jsonb(NEW) ->> 'created_at';

  NEW.in_magazijn_sinds := COALESCE(
    NULLIF(v_created, '')::timestamptz::date,
    NEW.reststuk_datum::date,
    CURRENT_DATE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rollen_default_in_magazijn_sinds ON rollen;
CREATE TRIGGER trg_rollen_default_in_magazijn_sinds
  BEFORE INSERT ON rollen
  FOR EACH ROW
  EXECUTE FUNCTION trg_rollen_default_in_magazijn_sinds();

COMMENT ON FUNCTION trg_rollen_default_in_magazijn_sinds() IS
  'ADR-0021/mig 287: vult rollen.in_magazijn_sinds bij INSERT als die NULL is — '
  'COALESCE(created_at::date, reststuk_datum::date, CURRENT_DATE). Expliciet '
  'gezette waarden (IO-ontvangst, reststuk-erfgang) passeren ongemoeid.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 287 toegepast: in_magazijn_sinds default = record-aanmaakdatum (ADR-0021).';
END $$;
