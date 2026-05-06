-- Migratie 193: `afwerking_types.prijs_per_meter` — afwerkingsprijs per
-- strekkende meter omtrek + RLS-policy fix voor instellingen-pagina's.
--
-- Context: tot nu toe had `afwerking_types` alleen een vaste `prijs` (snapshot
-- naar `order_regels.maatwerk_afwerking_prijs`). In de praktijk wordt
-- randafwerking per strekkende meter omtrek geprijsd: een 200×300 tapijt
-- heeft 2×(200+300)/100 = 10 m omtrek, een 80×150 maar 4,6 m. De vaste
-- `prijs`-kolom blijft bestaan in de database (default 0, niet meer in de UI
-- exposed) zodat legacy snapshots en order_regels onaangetast blijven.
--
-- UI-formule:    afwerkingPrijs = omtrek_m × prijs_per_meter
--   omtrek_m = 2 × (L + B) / 100   (rechthoek-achtig)
--   omtrek_m = π × diameter / 100  (rond)
--
-- Default 0 = backwards-compatible: bestaande afwerkingen blijven exact gelijk
-- werken totdat de gebruiker via /instellingen/afwerkingen een tarief invult.

ALTER TABLE afwerking_types
  ADD COLUMN IF NOT EXISTS prijs_per_meter NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN afwerking_types.prijs_per_meter IS
  'Tarief per strekkende meter omtrek (€/m). Wordt in de UI vermenigvuldigd '
  'met de tapijt-omtrek (2×(L+B)/100 voor rechthoek, π×D/100 voor rond) voor '
  'de totale afwerkingsprijs. Vervangt de oudere `prijs`-kolom (vaste '
  'toeslag, niet meer in UI). Mig 193 (2026-05-06).';

-- ============================================================
-- RLS-policy fix voor nieuwe instellingen-pagina's
-- ============================================================
-- Mig 041 zette enkel `Anon full access` op deze master-tabellen.
-- Ingelogde gebruikers (auth-rol = authenticated) konden daardoor wel SELECT
-- doen (anon-policy lekt op publieke schemas) maar UPDATE/INSERT/DELETE faalde
-- stilzwijgend met een Postgres-error. De nieuwe /instellingen/vormen en
-- /instellingen/afwerkingen pagina's hebben write-access vanuit authenticated
-- nodig. We voegen idempotent extra policies toe voor authenticated.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='maatwerk_vormen'
       AND policyname='Authenticated full access'
  ) THEN
    EXECUTE 'CREATE POLICY "Authenticated full access" ON maatwerk_vormen '
            'FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='afwerking_types'
       AND policyname='Authenticated full access'
  ) THEN
    EXECUTE 'CREATE POLICY "Authenticated full access" ON afwerking_types '
            'FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
