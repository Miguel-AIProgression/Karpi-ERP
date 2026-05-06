-- Migratie 195: werkdagen per vertegenwoordiger
--
-- Doel: per verteg vastleggen op welke dagen ze werken, met optionele
-- start-/eindtijd en opmerking. Wordt o.a. zichtbaar op de verteg-detail
-- pagina (eigen tab) en kan later gebruikt worden voor levertijd-
-- inschattingen of routeplanning.
--
-- Cardinaliteit: 1 verteg → 0..7 rijen (één per ISO-dag van de week).
-- Een rij bestaat alleen als de verteg op die dag werkt.
-- Idempotent: alle creates met IF NOT EXISTS.

------------------------------------------------------------------------
-- 1. Tabel vertegenwoordiger_werkdagen
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vertegenwoordiger_werkdagen (
  vertegenw_code TEXT NOT NULL
    REFERENCES vertegenwoordigers(code) ON DELETE CASCADE ON UPDATE CASCADE,
  dag_van_week  SMALLINT NOT NULL CHECK (dag_van_week BETWEEN 1 AND 7),
  -- 1 = maandag ... 7 = zondag (ISO 8601)
  start_tijd    TIME,
  eind_tijd     TIME,
  opmerking     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vertegenw_code, dag_van_week),
  CONSTRAINT vertegenw_werkdag_tijd_volgorde CHECK (
    start_tijd IS NULL OR eind_tijd IS NULL OR start_tijd < eind_tijd
  )
);

COMMENT ON TABLE vertegenwoordiger_werkdagen IS
  'Werkdagen per vertegenwoordiger (ISO 1=ma..7=zo). Rij aanwezig = werkt '
  'die dag. Tijden zijn optioneel; NULL = "hele dag". Mig 195 (2026-05-06).';

COMMENT ON COLUMN vertegenwoordiger_werkdagen.dag_van_week IS
  'ISO 8601 dag-van-week: 1=maandag ... 7=zondag.';

------------------------------------------------------------------------
-- 2. Index voor snelle verteg-lookup (PK dekt al, maar expliciet)
------------------------------------------------------------------------
-- (PK op (vertegenw_code, dag_van_week) is genoeg — query patronen
--  filteren altijd op vertegenw_code, dus extra index niet nodig.)

------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_vertegenwoordiger_werkdagen_updated_at'
  ) THEN
    CREATE TRIGGER trg_vertegenwoordiger_werkdagen_updated_at
      BEFORE UPDATE ON vertegenwoordiger_werkdagen
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END$$;
