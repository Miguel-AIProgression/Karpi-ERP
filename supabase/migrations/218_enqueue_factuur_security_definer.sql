-- Migratie 218: enqueue_factuur_bij_verzonden naar SECURITY DEFINER
--
-- Bug op 08-05 (na de zending_status-fix): voltooi_pickronde gooit nu
--   `new row violates row-level security policy for table "factuur_queue"` (42501).
--
-- Oorzaak: `enqueue_factuur_bij_verzonden` (mig 118) is een AFTER UPDATE-trigger
-- op `orders.status` die een rij in `factuur_queue` invoegt. De trigger draait
-- in de SECURITY-context van de aanroepende user (in dit pad: `authenticated`,
-- via `voltooi_pickronde` → `markeer_verzonden` → `_apply_transitie` → UPDATE
-- orders → trigger). RLS staat op `factuur_queue` aan (Supabase fase-1
-- enable-zonder-policies, zelfde scenario als mig 155 documenteerde voor
-- `order_reserveringen`), zonder INSERT-policy voor authenticated → 42501.
--
-- Fix-keuze: SECURITY DEFINER op de trigger-functie zelf, NIET een breed
-- INSERT-policy op `factuur_queue` voor authenticated. Reden:
--   * `factuur_queue` is een interne queue — alleen system-paths schrijven
--     erin (deze trigger, mig 122 cron-job die wekelijks-klanten enqueued,
--     mig 121 recovery-RPC). Edge function `factuur-verzenden` leest/schrijft
--     via service_role en negeert RLS sowieso.
--   * Een breed `WITH CHECK (true)` voor authenticated zou betekenen dat
--     elke ingelogde gebruiker willekeurige queue-items kan injecteren.
--   * SECURITY DEFINER laat de trigger draaien als de owner (postgres),
--     waardoor RLS wordt omzeild — dezelfde aanpak als mig 155 op
--     `set_uitwisselbaar_claims`.
--
-- search_path expliciet zetten zoals best practice vereist (advisor-warning
-- voor SECURITY DEFINER zonder vaste search_path).
--
-- Idempotent: ALTER FUNCTION + COMMENT ON FUNCTION.
-- Volgorde: dit bestand sorteert alfabetisch vóór 218_order_lifecycle_module.sql,
-- maar de target-functie wordt door mig 118 gemaakt en door mig 218
-- niet aangeraakt — geen volgorde-conflict.

ALTER FUNCTION enqueue_factuur_bij_verzonden() SECURITY DEFINER;
ALTER FUNCTION enqueue_factuur_bij_verzonden() SET search_path = public;

COMMENT ON FUNCTION enqueue_factuur_bij_verzonden() IS
  'Mig 118 + mig 218 RLS-fix: bij orders.status-overgang naar Verzonden inserteert '
  'een rij in factuur_queue voor klanten met factuurvoorkeur=per_zending. '
  'SECURITY DEFINER zodat de trigger werkt vanuit authenticated-context — '
  'factuur_queue heeft RLS aan zonder INSERT-policy voor authenticated, en dat '
  'is bewust: de queue is intern (alleen system-paths schrijven erin).';

NOTIFY pgrst, 'reload schema';
