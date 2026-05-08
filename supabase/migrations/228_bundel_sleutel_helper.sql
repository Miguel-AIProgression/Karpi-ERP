-- Migratie 228: bundel-sleutel-fundament voor dynamische zending-bundeling
--
-- Achtergrond
-- -----------
-- Mig 222 introduceerde 1-op-1 én bundel-zendingen op (debiteur + adres +
-- vervoerder) — gematerialiseerd bij pickronde-start via `zending_orders`
-- M2M. Voor de "live preview" vóór pickronde-start (Pick & Ship UI) hebben we
-- een 4e dimensie nodig: **verzendweek**. Bundel-sleutel wordt:
--
--     debiteur_nr × _normaliseer_afleveradres × effectieve_vervoerder × verzendweek
--
-- Deze migratie levert de twee pure functies (`bundel_sleutel`,
-- `verzendweek_voor_datum`) en zet eindelijk ook de `gratis_verzending`-kolom
-- op `debiteuren` neer. Die kolom wordt al jaren door de frontend gelezen
-- (`klant-detail.tsx`, `client-selector.tsx`, `order-mutations.ts`) en in
-- `docs/database-schema.md` gedocumenteerd, maar de oorspronkelijke ALTER
-- TABLE is nooit als migratie gecommit. Mig 201 voegde wel
-- `verzendkosten` + `verzend_drempel` toe maar oversloeg deze.
--
-- Idempotent: CREATE OR REPLACE voor functies, ADD COLUMN IF NOT EXISTS.

------------------------------------------------------------------------
-- 1. ISO-week voor een datum (formaat 'YYYY-Www', stabiel sorteerbaar)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verzendweek_voor_datum(p_datum DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  -- to_char IYYY = ISO-jaar (waar week 1 hoort), IW = ISO-weeknummer
  -- (1..53). NULL-input → NULL output zodat aanroepers expliciet kunnen
  -- filteren op orders zonder afleverdatum.
  SELECT CASE
    WHEN p_datum IS NULL THEN NULL
    ELSE to_char(p_datum, 'IYYY') || '-W' || to_char(p_datum, 'IW')
  END;
$$;

COMMENT ON FUNCTION verzendweek_voor_datum(DATE) IS
  'Mig 228: ISO-jaar+week voor een afleverdatum (formaat YYYY-Www). 1-op-1 '
  'spiegel van TypeScript verzendWeekIsoString() in '
  'frontend/src/lib/orders/verzendweek.ts. Single source of truth voor de '
  'verzendweek-dimensie in zending-bundeling.';

------------------------------------------------------------------------
-- 2. Bundel-sleutel: deterministisch over alle 4 dimensies
------------------------------------------------------------------------
-- Vorm: 'D{deb}|V{vervoerder}|W{week}|A{adres-norm}'.
-- - p_adres_norm verwacht je via `_normaliseer_afleveradres` (mig 222) of de
--   identieke TS-spiegel in frontend/src/lib/orders/normaliseer-adres.ts.
-- - p_vervoerder NULL/'' → 'GEEN'; afhalen-orders hebben geen effectieve
--   vervoerder en vallen daar dus op terug.
-- - p_jaar_week NULL → 'GEEN' (orders zonder afleverdatum vallen samen).
-- De volgorde is bewust adres-laatste: zo is het eerste segment de meest
-- selectieve dimensie (debiteur), wat lookups debug-vriendelijker maakt.
CREATE OR REPLACE FUNCTION bundel_sleutel(
  p_debiteur_nr INTEGER,
  p_adres_norm  TEXT,
  p_vervoerder  TEXT,
  p_jaar_week   TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'D' || p_debiteur_nr::TEXT
      || '|V' || COALESCE(NULLIF(p_vervoerder, ''), 'GEEN')
      || '|W' || COALESCE(NULLIF(p_jaar_week, ''), 'GEEN')
      || '|A' || COALESCE(NULLIF(p_adres_norm, ''), '?');
$$;

COMMENT ON FUNCTION bundel_sleutel(INTEGER, TEXT, TEXT, TEXT) IS
  'Mig 228: deterministische sleutel voor zending-bundeling. Wijzigt één van '
  'de 4 dimensies (debiteur/adres/vervoerder/week) → andere sleutel → orders '
  'splitsen automatisch in een nieuwe bundel. Gespiegeld in '
  'frontend/src/lib/orders/bundel-sleutel.ts; updates moeten beide kanten '
  'tegelijk landen anders divergeren UI-clustering en DB-validatie.';

------------------------------------------------------------------------
-- 3. gratis_verzending op debiteuren (lacune mig 201)
------------------------------------------------------------------------
ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS gratis_verzending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.gratis_verzending IS
  'Mig 228 (post-hoc): klant krijgt altijd gratis verzending, ongeacht '
  'bundel-totaal vs verzend_drempel. Frontend-types kenden dit veld al; '
  'oorspronkelijke ALTER TABLE was nooit gecommit (mig 201 sloeg het over).';

NOTIFY pgrst, 'reload schema';
