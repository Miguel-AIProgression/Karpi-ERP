-- Migratie 313: migratie_blokkering
-- Eenmalige FIFO-lengteblokkering van oud-systeem maatwerk-orders op fysieke rollen.
-- Zie ADR-0028. Ontkoppeld van order_reserveringen (geen new-system order_regel_id).

CREATE TABLE migratie_blokkering (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id                  BIGINT NOT NULL REFERENCES rollen(id) ON DELETE CASCADE,
  gereserveerde_lengte_cm INTEGER NOT NULL CHECK (gereserveerde_lengte_cm > 0),
  breedte_nodig_cm        INTEGER NOT NULL CHECK (breedte_nodig_cm > 0),
  oud_ordernr             TEXT NOT NULL,
  oud_orderregel          TEXT NOT NULL,
  deel_index              INTEGER NOT NULL DEFAULT 1,  -- 1..aantal voor regels met Aantal>1
  kwaliteit_code          TEXT,
  kleur_code              TEXT,
  status                  TEXT NOT NULL DEFAULT 'actief'
                            CHECK (status IN ('actief', 'vrijgegeven')),
  aangemaakt_op           TIMESTAMPTZ NOT NULL DEFAULT now(),
  vrijgegeven_op          TIMESTAMPTZ,
  -- idempotentie: een (order, regel, deel) wordt nooit dubbel geblokkeerd.
  UNIQUE (oud_ordernr, oud_orderregel, deel_index)
);

-- Hot path: fetchBezettePlaatsingen sommeert actieve blokkering per rol.
CREATE INDEX idx_migratie_blokkering_rol_actief
  ON migratie_blokkering (rol_id)
  WHERE status = 'actief';

-- Release-script zoekt op (ordernr, regel).
CREATE INDEX idx_migratie_blokkering_order
  ON migratie_blokkering (oud_ordernr, oud_orderregel);

COMMENT ON TABLE migratie_blokkering IS
  'Eenmalige FIFO-lengteblokkering van oud-systeem maatwerk-orders op rollen (ADR-0028). Tijdelijk; leeg zodra alle oude orders gesneden zijn.';

ALTER TABLE migratie_blokkering ENABLE ROW LEVEL SECURITY;

-- Lezen mag voor ingelogde gebruikers (edge-functies gebruiken service-role en
-- omzeilen RLS sowieso). Schrijven loopt uitsluitend via het service-role
-- migratiescript → geen INSERT/UPDATE-policy voor 'authenticated'.
CREATE POLICY migratie_blokkering_select
  ON migratie_blokkering FOR SELECT
  TO authenticated
  USING (true);
