-- ============================================================================
-- UITVRAAG live-DB — audit-remediatie 2026-07-02
-- Miguel: draai elke sectie los in de Supabase SQL-editor en lever de output
-- aan zoals per sectie aangegeven. Alles is READ-ONLY (geen enkele mutatie).
-- Doel per sectie staat erbij; de taaknummers verwijzen naar het plan
-- docs/superpowers/plans/2026-07-02-audit-remediatie-architectuur.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTIE A (Task 1.5 — B6): actuele live body van herbereken_wacht_status.
-- Output: kopieer de volledige celinhoud naar het bestand
--   supabase/schema/live/herbereken_wacht_status.live.sql   (in deze worktree)
-- ----------------------------------------------------------------------------
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'herbereken_wacht_status';

-- ----------------------------------------------------------------------------
-- SECTIE B (Task 1.5): impact-telling vooraf — hoeveel orders in
-- 'Wacht op voorraad' hebben een regel waarvan de IO-claim het tekort NIET
-- volledig dekt (die zouden naar 'Wacht op inkoop' flippen)?
-- Output: plak het getal (en desgewenst de order_nrs) terug in de chat.
-- ----------------------------------------------------------------------------
SELECT COUNT(DISTINCT o.id) AS orders_die_flippen
FROM orders o
WHERE o.status = 'Wacht op voorraad'
  AND EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = o.id
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(r.aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id
          AND r.status IN ('actief', 'verzonden')
      ), 0)
      AND EXISTS (
        SELECT 1 FROM order_reserveringen r2
        WHERE r2.order_regel_id = oreg.id
          AND r2.bron = 'inkooporder_regel' AND r2.status = 'actief'
      )
  );

-- ----------------------------------------------------------------------------
-- SECTIE C (Task 2.5): verificatie-poort dode RPC's — beide queries moeten
-- 0 rijen geven. Output: plak beide resultaten ("0 rows" of de rijen) terug.
-- ----------------------------------------------------------------------------
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ILIKE ANY (ARRAY[
    '%start_pickronden_voor_order%',
    '%start_pickronden_bundel%',
    '%genereer_factuur_voor_bundel%'])
  AND p.proname NOT IN
    ('start_pickronden_voor_order','start_pickronden_bundel','genereer_factuur_voor_bundel');

SELECT jobname, command FROM cron.job
WHERE command ILIKE ANY (ARRAY[
  '%start_pickronden_voor_order%',
  '%start_pickronden_bundel%',
  '%genereer_factuur_voor_bundel%']);

-- ----------------------------------------------------------------------------
-- SECTIE D (Task 3.2): actuele trigger-lijst op order_regels (docs-verificatie).
-- Output: plak de rijen terug in de chat.
-- ----------------------------------------------------------------------------
SELECT tgname, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'order_regels' AND NOT t.tgisinternal
ORDER BY tgname;

-- ----------------------------------------------------------------------------
-- SECTIE E (Task 5.1): live definities BTW-functies (signatuur + kolomnamen
-- voor de SQL-assert). Output: kopieer beide celinhouden naar
--   supabase/schema/live/bepaal_btw_regeling.live.sql
--   supabase/schema/live/effectief_btw_pct.live.sql
-- ----------------------------------------------------------------------------
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'bepaal_btw_regeling';

SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'effectief_btw_pct';

-- ----------------------------------------------------------------------------
-- SECTIE F (Task 5.2): live definitie verzendweek_voor_datum + formaat-check.
-- Output: celinhoud naar supabase/schema/live/verzendweek_voor_datum.live.sql
-- en de 3 formaat-rijen terug in de chat.
-- ----------------------------------------------------------------------------
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'verzendweek_voor_datum';

SELECT verzendweek_voor_datum(DATE '2026-07-02') AS wk27,
       verzendweek_voor_datum(DATE '2025-12-29') AS wk1_2026,
       verzendweek_voor_datum(DATE '2027-01-01') AS wk53_2026;

-- ----------------------------------------------------------------------------
-- SECTIE G (Task 1.2 — B2 live-verificatie, al gecommit): vind een
-- Deels-verzonden-order met 'verzonden'-claims en check 'm daarna in de UI —
-- de valse "Wacht op nieuwe inkoop"-subrij moet weg zijn (na frontend-deploy
-- van deze branch; kan ook lokaal met npm run dev in de worktree).
-- ----------------------------------------------------------------------------
SELECT o.order_nr, orr.id AS order_regel_id, orr.te_leveren,
       SUM(r.aantal) FILTER (WHERE r.status = 'actief')    AS actief,
       SUM(r.aantal) FILTER (WHERE r.status = 'verzonden') AS verzonden
FROM order_reserveringen r
JOIN order_regels orr ON orr.id = r.order_regel_id
JOIN orders o ON o.id = orr.order_id
WHERE o.status = 'Deels verzonden' AND r.status = 'verzonden'
GROUP BY o.order_nr, orr.id, orr.te_leveren
LIMIT 5;
