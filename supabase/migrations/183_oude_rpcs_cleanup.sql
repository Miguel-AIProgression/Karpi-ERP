-- Migratie 183: cleanup oude RPC's na Voorraadpositie-Module-cutover (T005, GH #30)
--
-- Audit-bevindingen per RPC (commit feat/voorraadpositie-module, 2026-05-06):
--
--   rollen_uitwissel_voorraad():
--     • Frontend: 0 callers (na T003).
--     • Edge functions: 0 callers.
--     • Scripts (mjs/sql/ps1) + import (py): 0 callers.
--     • SQL-migraties: alleen historische definities (mig 112, 115). voorraadposities()
--       gebruikt 'm NIET — die roept rechtstreeks `uitwisselbare_partners()` aan.
--     ⇒ ACTIE: DROP. De RPC is volledig vervangen door voorraadposities().
--
--   uitwisselbare_partners():
--     • Frontend: 0 directe callers (na T003).
--     • Edge functions: 0 callers.
--     • Scripts + import: 0 callers.
--     • SQL: voorraadposities() (mig 179 + 180) consumeert dit als CTE-bron in
--       de partners-aggregaat.
--     ⇒ ACTIE: DEMOTE (COMMENT-only). GRANT EXECUTE blijft voor anon/authenticated
--       omdat voorraadposities() LANGUAGE sql STABLE (= SECURITY INVOKER) is en
--       dus dezelfde permissies eist op de inner-call. Een REVOKE zou
--       voorraadposities() voor browser-callers breken.
--
--   besteld_per_kwaliteit_kleur():
--     • Frontend: alléén nog via Voorraadpositie-Module-seam — `fetchVoorraadpositie`
--       (single-paar caller via voorraadposities()) en `fetchGhostBesteldParen`
--       (T005-refactor: ghost-merge in rollen-overzicht loopt nu door de Module
--       ipv direct uit `pages/rollen/rollen-overview.tsx`).
--     • Edge functions: 0 callers.
--     • Scripts + import: 0 callers.
--     • SQL: voorraadposities() consumeert dit als CTE-bron in de besteld-aggregaat.
--     ⇒ ACTIE: DEMOTE (COMMENT-only). Reden identiek aan uitwisselbare_partners:
--       voorraadposities() is SECURITY INVOKER, en `fetchGhostBesteldParen` roept
--       de RPC vanuit de browser aan met `anon`/`authenticated`-credentials. GRANT
--       blijft dus behouden. De "demote" is conceptueel: nieuwe frontend-code
--       hoort de Module-seam te gebruiken, niet rechtstreeks de RPC.
--
-- Optie Y-keuze (zie commit-message): ghost-merge in rollen-overzicht is
-- gerefactord zodat ALLE frontend-DB-calls voor de Voorraadpositie-data-flow
-- door de Module-barrel lopen. `pages/rollen/rollen-overview.tsx` importeert
-- `fetchGhostBesteldParen` ipv direct `supabase.rpc('besteld_per_kwaliteit_kleur')`.
-- Hierdoor kan de RPC nu logisch gedemoot worden zonder breuk.
--
-- HITL-stap: Karpi Supabase MCP heeft geen toegang. Migratie handmatig
-- toepassen op productie-DB.

-- ----------------------------------------------------------------------------
-- 1. DROP rollen_uitwissel_voorraad — geen callers meer.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS rollen_uitwissel_voorraad();

-- ----------------------------------------------------------------------------
-- 2. DEMOTE uitwisselbare_partners — alleen interne SQL-caller (voorraadposities).
--    GRANT blijft voor anon/authenticated (voorraadposities is SECURITY INVOKER).
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION uitwisselbare_partners() IS
  'INTERN — uitsluitend geconsumeerd door voorraadposities() (mig 179/180) als '
  'CTE-bron voor de partners-aggregaat. Direct aanroepen vanuit nieuwe '
  'frontend-code is afgekeurd; gebruik in plaats daarvan de Voorraadpositie-Module '
  '(@/modules/voorraadpositie). GRANT EXECUTE blijft staan voor anon/authenticated '
  'omdat voorraadposities() LANGUAGE sql STABLE (= SECURITY INVOKER) is en '
  'dezelfde permissies eist op de inner-call. Status na T005 (mig 183).';

-- ----------------------------------------------------------------------------
-- 3. DEMOTE besteld_per_kwaliteit_kleur — Module-seam is enige frontend-caller.
--    GRANT blijft voor anon/authenticated (zelfde reden + browser-call vanuit
--    fetchGhostBesteldParen in @/modules/voorraadpositie).
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION besteld_per_kwaliteit_kleur() IS
  'INTERN voor de Voorraadpositie-Module — geconsumeerd door voorraadposities() '
  '(mig 179/180) als CTE-bron voor de besteld-aggregaat, en aangeroepen vanuit '
  '@/modules/voorraadpositie/queries/ghost-besteld.ts (fetchGhostBesteldParen) '
  'voor de ghost-paren-merge in het rollen-overzicht. Direct aanroepen vanuit '
  'nieuwe frontend-code is afgekeurd; gebruik de Module-seam '
  '(fetchVoorraadpositie / fetchVoorraadposities / fetchGhostBesteldParen). '
  'GRANT EXECUTE blijft staan voor anon/authenticated omdat zowel '
  'voorraadposities() (SECURITY INVOKER) als de browser-call dezelfde permissies '
  'eisen. Status na T005 (mig 183).';
