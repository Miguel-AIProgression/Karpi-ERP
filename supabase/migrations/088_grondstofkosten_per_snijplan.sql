-- Migration 088: Grondstofkosten per snijplan bij rol-afsluiting
--
-- Context: voltooi_snijplan_rol (migratie 066) sluit een rol definitief af.
-- Op dat moment weten we hoeveel materiaal per stuk is verbruikt, hoeveel
-- als reststuk teruggaat naar voorraad, en hoeveel afval is. We leggen
-- per snijplan de toegerekende grondstofkosten vast (incl. proportioneel
-- afval-aandeel) voor latere winstmarge-berekening.
--
-- Tevens: nieuwe reststuk-rollen krijgen waarde toegekend
-- (oppervlak_m2 × bronrol-inkoopprijs_m2). Zonder dit tellen reststukken
-- niet mee in dashboard_stats.voorraadwaarde_inkoop.

ALTER TABLE snijplannen
  ADD COLUMN grondstofkosten     NUMERIC(12,2),
  ADD COLUMN grondstofkosten_m2  NUMERIC(10,4),
  ADD COLUMN inkoopprijs_m2      NUMERIC(10,2);

COMMENT ON COLUMN snijplannen.grondstofkosten IS
  'Toegerekende grondstofkosten in € voor dit gesneden stuk incl. proportioneel afval. Gezet bij voltooi_snijplan_rol. NULL als bronrol geen waarde/oppervlak had. Zie migratie 088.';
COMMENT ON COLUMN snijplannen.grondstofkosten_m2 IS
  'Aan dit stuk toegerekend materiaaloppervlak in m² = stuk_m² + aandeel × afval_m². Snapshot bij snijden.';
COMMENT ON COLUMN snijplannen.inkoopprijs_m2 IS
  'Inkoopprijs per m² van bronrol op moment van snijden. Snapshot: rol.waarde / rol.oppervlak_m2.';
