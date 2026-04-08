-- Migration 032: Scan events + voorraad mutaties tabellen

-- 1. scan_events: centraal scan-log (append-only audit trail)
CREATE TABLE IF NOT EXISTS scan_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scancode    TEXT NOT NULL,
  actie       TEXT NOT NULL CHECK (actie IN ('start', 'gereed', 'pauze', 'herstart', 'fout')),
  station     TEXT,
  medewerker  TEXT,
  notitie     TEXT,
  gescand_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No FKs on purpose: scancode is the link (flexible, station-independent)
CREATE INDEX idx_scan_events_scancode ON scan_events(scancode);
CREATE INDEX idx_scan_events_gescand_op ON scan_events(gescand_op DESC);

-- 2. voorraad_mutaties: audit trail for roll inventory changes
CREATE TABLE IF NOT EXISTS voorraad_mutaties (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id           BIGINT NOT NULL REFERENCES rollen(id),
  type             TEXT NOT NULL CHECK (type IN ('inkoop', 'snij', 'reststuk', 'correctie', 'afgekeurd')),
  lengte_cm        NUMERIC NOT NULL,
  breedte_cm       NUMERIC,
  referentie_id    BIGINT,
  referentie_type  TEXT,
  notitie          TEXT,
  aangemaakt_op    TIMESTAMPTZ NOT NULL DEFAULT now(),
  aangemaakt_door  TEXT
);

CREATE INDEX idx_voorraad_mutaties_rol ON voorraad_mutaties(rol_id);
CREATE INDEX idx_voorraad_mutaties_type ON voorraad_mutaties(type);

-- 3. RLS
ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON scan_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE voorraad_mutaties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON voorraad_mutaties FOR ALL TO authenticated USING (true) WITH CHECK (true);
