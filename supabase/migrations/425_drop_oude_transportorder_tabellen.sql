-- Migratie 425: contract-drop van de oude per-vervoerder transportorder-artefacten
-- ADR-0038 (data-as), slice 5. Plan/draaiboek:
--   docs/superpowers/plans/2026-06-18-verzend-wachtrij-cutover-draaiboek.md (stap 7)
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  NIET DRAAIEN TOT DE NIEUWE KETEN LIVE-BEWEZEN IS.                      ║
-- ║                                                                            ║
-- ║  Voorwaarde: mig 424 is gecutoverd ÉN er is ≥1 ECHTE HST-zending én ≥1     ║
-- ║  ECHTE Rhenus-zending succesvol via `verzend_wachtrij` verstuurd, en de    ║
-- ║  keten draait een paar dagen stabiel. Tot dan zijn de oude tabellen +      ║
-- ║  RPC's het rollback-vangnet — die mag je niet weggooien.                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Idempotent: DROP ... IF EXISTS overal.

-- ── Guard: mig 424 moet gedraaid zijn (anders is dit een no-op-ramp) ─────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'verzend_wachtrij') THEN
    RAISE EXCEPTION 'Mig 425 afgebroken: verzend_wachtrij bestaat niet — draai eerst mig 424 + de cutover.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM verzend_wachtrij WHERE status = 'Verstuurd') THEN
    RAISE WARNING 'Mig 425: nog GEEN Verstuurd-rij in verzend_wachtrij. Zeker dat de nieuwe keten live-bewezen is? (alleen waarschuwing)';
  END IF;
END $$;

-- ── 1. Monitor-views (shims uit mig 424) ────────────────────────────────────
DROP VIEW IF EXISTS hst_verzend_monitor;
DROP VIEW IF EXISTS verhoek_verzend_monitor;
DROP VIEW IF EXISTS rhenus_verzend_monitor;

-- ── 2. Losse oude RPC's (de table-returning claim_* + trigger-fns gaan met de
--      tabel-CASCADE mee, maar enqueue/markeer/herstel/pdf-fn niet) ──────────
DROP FUNCTION IF EXISTS enqueue_hst_transportorder(BIGINT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS enqueue_verhoek_transportorder(BIGINT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS enqueue_rhenus_transportorder(BIGINT, INTEGER, BOOLEAN);

DROP FUNCTION IF EXISTS markeer_hst_verstuurd(BIGINT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS markeer_hst_fout(BIGINT, TEXT, JSONB, JSONB, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS markeer_verhoek_verstuurd(BIGINT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS markeer_verhoek_fout(BIGINT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS markeer_rhenus_verstuurd(BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS markeer_rhenus_fout(BIGINT, TEXT, TEXT, INTEGER);

DROP FUNCTION IF EXISTS herstel_vastgelopen_hst(INTEGER);
DROP FUNCTION IF EXISTS herstel_vastgelopen_verhoek(INTEGER);
DROP FUNCTION IF EXISTS herstel_vastgelopen_rhenus(INTEGER);

-- mig 304 PDF-spiegel-trigger-fn (de nieuwe leeft op verzend_wachtrij).
DROP FUNCTION IF EXISTS fn_hst_pdf_naar_order_documenten();

-- ── 3. De drie tabellen (CASCADE neemt claim_volgende_* + updated_at-triggers
--      + de PDF-trigger mee) ──────────────────────────────────────────────────
DROP TABLE IF EXISTS hst_transportorders     CASCADE;
DROP TABLE IF EXISTS verhoek_transportorders CASCADE;
DROP TABLE IF EXISTS rhenus_transportorders  CASCADE;

-- ── 4. Trigger-fns + enums (na de tabellen) ─────────────────────────────────
DROP FUNCTION IF EXISTS set_hst_to_updated_at();
DROP FUNCTION IF EXISTS set_verhoek_to_updated_at();
DROP FUNCTION IF EXISTS set_rhenus_to_updated_at();

DROP TYPE IF EXISTS hst_transportorder_status;
DROP TYPE IF EXISTS verhoek_transportorder_status;
DROP TYPE IF EXISTS rhenus_transportorder_status;

NOTIFY pgrst, 'reload schema';

-- Verificatie: geen van de oude objecten bestaat nog; verzend_wachtrij + de
-- generieke RPC's + verzend_monitor zijn de enige verzend-wachtrij-objecten.
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name LIKE '%_transportorders';   -- 0 rijen
--   SELECT routine_name FROM information_schema.routines
--    WHERE routine_name LIKE 'markeer_%_verstuurd'; -- alleen markeer_transportorder_verstuurd
