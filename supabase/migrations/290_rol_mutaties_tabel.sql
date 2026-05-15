-- Migratie 290: rol_mutaties — audittrail voor handmatige rol-CRUD
--
-- Context: handmatige voorraadcorrecties (rol toevoegen/bewerken/verwijderen)
-- vereisen een verplichte reden + een audit-regel die een VERWIJDERDE rol
-- overleeft. Het bestaande voorraad_mutaties kan dit structureel niet
-- (rol_id NOT NULL + FK, geen reden-kolom — zie mig 148 + database-schema.md).
-- Daarom een dedicated tabel; voorraad_mutaties blijft ongemoeid.

CREATE TABLE IF NOT EXISTS rol_mutaties (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id              BIGINT,                       -- geen FK: rol kan weg zijn
  rolnummer           TEXT,
  artikelnr           TEXT,
  actie               TEXT NOT NULL
                        CHECK (actie IN ('toevoegen','bewerken','verwijderen')),
  oppervlak_delta_m2  NUMERIC(10,2),
  oud_json            JSONB,
  nieuw_json          JSONB,
  reden               TEXT NOT NULL,
  medewerker          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rol_mutaties_rol_id ON rol_mutaties (rol_id);
CREATE INDEX IF NOT EXISTS idx_rol_mutaties_created_at ON rol_mutaties (created_at DESC);

COMMENT ON TABLE rol_mutaties IS
  'Audittrail voor handmatige rol-CRUD (voorraadcorrectie/inventarisatie). '
  'rol_id heeft bewust GEEN FK zodat de audit-regel een verwijderde rol '
  'overleeft. reden is verplicht. Mig 290.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 290 toegepast: rol_mutaties audittabel aangemaakt.';
END $$;
