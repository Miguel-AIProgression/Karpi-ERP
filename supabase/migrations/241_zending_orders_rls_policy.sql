-- Migratie 241: RLS-policy op zending_orders (hotfix mig 222)
--
-- Achtergrond
-- -----------
-- Mig 222 introduceerde de M2M-tabel `zending_orders` voor bundel-zendingen,
-- maar vergat het RLS-pattern uit mig 169 (zendingen + zending_regels) door te
-- trekken naar deze tabel. RLS is op de live DB alsnog aangezet (Supabase
-- advisor-remediatie via Studio) zonder dat er een INSERT-policy voor de rol
-- `authenticated` bij gemaakt is.
--
-- Symptoom
-- --------
-- `start_pickronden_bundel(order_ids[], picker_id)` (mig 222 r225 / mig 230 r224)
-- faalt op de tweede INSERT van de RPC met:
--   42501: new row violates row-level security policy for table "zending_orders"
-- bij elke bundel met ≥2 orders. Het solo-pad (start_pickronden_voor_order)
-- raakt zending_orders niet en blijft werken.
--
-- Root cause
-- ----------
-- RLS staat aan op zending_orders, géén policy aanwezig, RPC is SECURITY
-- INVOKER (consistent met start_pickronden_voor_order). De keuze in mig 222
-- r357 om voltooi_pickronde DEFINER te maken was specifiek voor `order_events`
-- (bewust restrictieve audit-log). Voor `zending_orders` past het zending_regels-
-- pattern: open voor alle ingelogde gebruikers, niet via DEFINER.
--
-- Fix
-- ---
-- Spiegel mig 169 r86-93: ENABLE RLS (idempotent — geen-op als al aan) +
-- all-authenticated policy met DROP IF EXISTS-guard zodat de migratie veilig
-- her-uit te voeren is.
--
-- Verificatie
-- -----------
-- Na toepassen: open Pick & Ship, selecteer ≥2 orders met identiek genormaliseerd
-- afleveradres + zelfde week + zelfde effectieve vervoerder, klik "Start bundel".
-- Verwacht: nieuwe zending met meerdere zending_orders-rijen, geen 42501.

ALTER TABLE zending_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zending_orders_all ON zending_orders;
CREATE POLICY zending_orders_all ON zending_orders
  FOR ALL TO authenticated
  USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';
