-- Migratie 327: productie-only schema (R1 + R5)
-- Voegt het 'productie-only'-concept toe: orders uit Basta die in RugFlow alleen
-- snijden+confectie doorlopen. Strikt additief; gewone orders ongewijzigd.
--
-- Wijzigingen:
--   1. orders.alleen_productie (BOOLEAN) — dé schakelaar voor alle guards
--   2. CHECK chk_alleen_productie_bron — gouden regel: vlag impliceert bron Basta
--   3. order_status 'Maatwerk afgerond' — terminale status voor productie-only
--   4. order_regels.snijden_uit_standaardmaat (BOOLEAN) — R5: knippen uit kleed
--   5. snijplannen.snijden_uit_standaardmaat (BOOLEAN) — gekopieerd van regel
--   6. Partiële indexen op beide vlaggen
--   7. Verzameldebiteur 900000 'OUD SYSTEEM (PRODUCTIE)' (idempotent)
--   8. UNIQUE-index op orders.oud_order_nr (idempotent dubbelkoppeling-guard)
--   9. Assertie-blok
--
-- Idempotent: IF NOT EXISTS / ADD VALUE IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Uitzondering CHK-constraint: gewikkeld in DO-blok met pg_constraint-guard.
--
-- Zie ADR-0029.

-- ============================================================================
-- STAP 1: Kolommen + enum-waarde + CHECK
-- ============================================================================
BEGIN;

-- 1a. Vlag op orders: dé schakelaar die alle guards uitlezen.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS alleen_productie BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN orders.alleen_productie IS
  'TRUE = productie-only order uit Basta (oud systeem): RugFlow doet alleen '
  'snijden+confectie, facturatie/verzending in Basta. Zie ADR-0029.';

-- 1b. Gouden regel als DB-CHECK: alleen_productie impliceert herkomst Basta.
--     Gewikkeld in DO-blok zodat de migratie re-runnable is (kale ADD CONSTRAINT
--     faalt bij her-run met "already exists"; IF NOT EXISTS bestaat niet voor
--     ADD CONSTRAINT in Postgres ≤16).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_alleen_productie_bron'
       AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_alleen_productie_bron
      CHECK (alleen_productie = false OR bron_systeem = 'oud_systeem');
  END IF;
END $$;

-- 1c. Terminale order-status (enum-uitbreiding).
--     'Maatwerk afgerond' bestaat nog NIET per 2026-06-08 (geverifieerd in spec).
--     ADD VALUE IF NOT EXISTS is veilig in Postgres 12+ binnen een transactie;
--     de waarde mag pas ná COMMIT worden gebruikt (hier enkel gedeclareerd;
--     latere migraties — Task A4/A5 — gebruiken hem).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Maatwerk afgerond';

-- 1d. Standaardmaat-vlag op order_regels (R5): stuk wordt uit een standaard-maat
--     gesneden, NIET uit een rol. Verschijnt wel in snijden+confectie maar
--     verbruikt geen rollengte.
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS snijden_uit_standaardmaat BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN order_regels.snijden_uit_standaardmaat IS
  'TRUE = wordt uit een standaard-maat kleed gesneden, NIET uit een rol. '
  'Verschijnt wel in snijden+confectie maar verbruikt geen rollengte (R5).';

-- 1e. Zelfde vlag op snijplannen: gekopieerd door auto_maak_snijplan.
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS snijden_uit_standaardmaat BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN snijplannen.snijden_uit_standaardmaat IS
  'Gekopieerd van order_regels door auto_maak_snijplan. '
  'Uitgesloten van rol-packing.';

COMMIT;

-- ============================================================================
-- STAP 2: Partiële indexen (buiten BEGIN/COMMIT: netjes ná de enum-COMMIT)
-- ============================================================================

-- Snelle guards/queries op de productie-only-vlag.
CREATE INDEX IF NOT EXISTS idx_orders_alleen_productie
  ON orders(alleen_productie) WHERE alleen_productie;

-- Snelle opzoek van standaardmaat-regels (kleine set, partieel efficiënt).
CREATE INDEX IF NOT EXISTS idx_order_regels_uit_standaardmaat
  ON order_regels(snijden_uit_standaardmaat) WHERE snijden_uit_standaardmaat;

-- ============================================================================
-- STAP 3: Verzameldebiteur "Oud systeem (productie)" — debiteur_nr 900000
-- ============================================================================
--
-- Kolom-verificatie (docs/database-schema.md, debiteuren-sectie, 2026-06-08):
--   Verplicht zonder default: debiteur_nr (INTEGER PK) — gevuld: 900000
--   Verplicht zonder default: naam (TEXT) — er staat geen NOT NULL in de doc
--     maar de kolom-definitie impliceert het voor PK-rijen; gevuld: naam opgegeven
--   NOT NULL MÉT default:
--     gratis_verzending BOOLEAN NOT NULL DEFAULT false → default volstaat
--     afleverwijze TEXT DEFAULT 'Bezorgen'              → default volstaat
--     default_lever_type lever_type NOT NULL DEFAULT 'week' → default volstaat
--     btw_percentage NUMERIC(5,2) DEFAULT 21.00         → default volstaat
--   Alle overige kolommen (adres, postcode, telefoon, email_*, etc.) zijn nullable.
--   Conclusie: minimale INSERT volstaat; geen extra placeholder-waarden nodig.
INSERT INTO debiteuren (debiteur_nr, naam, plaats, land, status)
VALUES (900000, 'OUD SYSTEEM (PRODUCTIE)', 'Aalten', 'NL', NULL)
ON CONFLICT (debiteur_nr) DO NOTHING;

-- ============================================================================
-- STAP 4: Idempotentie-sleutel op oud_order_nr
-- ============================================================================

-- Voorkomt dubbele import van hetzelfde Basta-ordernummer bij her-run van het
-- import-script. Partieel (WHERE NOT NULL) zodat gewone orders (NULL) niet
-- worden belemmerd — oud_order_nr is alleen gevuld voor Basta-imports.
CREATE UNIQUE INDEX IF NOT EXISTS orders_oud_order_nr_uniek
  ON orders(oud_order_nr) WHERE oud_order_nr IS NOT NULL;

-- ============================================================================
-- STAP 5: Assertie-blok (conform bestaand codebase-patroon)
-- ============================================================================

DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'order_status'
       AND e.enumlabel = 'Maatwerk afgerond'
  ) = 1,
  'order_status mist Maatwerk afgerond';

  ASSERT (
    SELECT 1 FROM information_schema.columns
     WHERE table_name  = 'orders'
       AND column_name = 'alleen_productie'
  ) IS NOT NULL,
  'orders.alleen_productie ontbreekt';

  ASSERT (
    SELECT 1 FROM information_schema.columns
     WHERE table_name  = 'order_regels'
       AND column_name = 'snijden_uit_standaardmaat'
  ) IS NOT NULL,
  'order_regels.snijden_uit_standaardmaat ontbreekt';

  ASSERT (
    SELECT 1 FROM information_schema.columns
     WHERE table_name  = 'snijplannen'
       AND column_name = 'snijden_uit_standaardmaat'
  ) IS NOT NULL,
  'snijplannen.snijden_uit_standaardmaat ontbreekt';

  RAISE NOTICE 'Mig 327 OK: alleen_productie + Maatwerk afgerond + standaardmaat-vlaggen aanwezig.';
END $$;

NOTIFY pgrst, 'reload schema';
