-- Migratie 242: zending_orders is canoniek (trigger + backfill)
--
-- Achtergrond
-- -----------
-- Mig 222 introduceerde `zending_orders` als M2M-koppeltabel voor bundel-
-- zendingen, met als belofte (r41-45 in de comment): *"deze tabel is de
-- authoritatieve bron voor de volledige order-set van een zending bij
-- bundeling"*. De backfill bij creatie dekte alle pré-mig-222 zendingen.
--
-- Probleem dat hier wordt gefixt
-- ------------------------------
-- `start_pickronden_voor_order` (mig 220) en `create_zending_voor_order`
-- (mig 206) schrijven géén M2M-rij — alleen `zendingen.order_id`. Daardoor
-- hebben alle solo-zendingen aangemaakt ná mig 222 GEEN rij in
-- `zending_orders`. Consumers die "alle orders van een zending"-vragen
-- stellen moeten dan een UNION doen met `zendingen.order_id` als fallback
-- (zoals `voltooi_pickronde` r310-315 al doet).
--
-- Concreet symptoom: in Pick & Ship toont `fetchActievePickrondes` voor een
-- bundel-zending alleen de "primaire" order (zending.order_id) als
-- "In pickronde", niet de overige orders die alleen via M2M gekoppeld zijn.
--
-- Fix
-- ---
-- 1. AFTER INSERT-trigger op `zendingen` die automatisch een M2M-rij
--    invoegt als die nog ontbreekt. Defense-in-depth voor élk INSERT-pad
--    (huidige + toekomstige RPC's). ON CONFLICT DO NOTHING zodat
--    `start_pickronden_bundel` (die zelf al de volledige M2M-set invoegt)
--    niet duplicaat-conflicteert.
-- 2. Backfill: alle bestaande zendingen met `order_id IS NOT NULL` krijgen
--    alsnog hun 1-op-1 M2M-rij. Idempotent via ON CONFLICT DO NOTHING.
-- 3. Comment-update op zending_orders zodat de belofte uit mig 222 nu ook
--    waar IS in plaats van alleen "bedoeld".
--
-- Met deze migratie kan élke consumer puur via `zending_orders` queryen
-- zonder fallback-UNION op `zendingen.order_id`. De fallback in
-- `voltooi_pickronde` mag blijven staan als defensieve veiligheidsklep,
-- maar wordt niet meer getriggerd.
--
-- Idempotent.

------------------------------------------------------------------------
-- 1. AFTER INSERT-trigger: schrijf M2M-rij automatisch
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_zending_set_m2m()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    INSERT INTO zending_orders (zending_id, order_id)
    VALUES (NEW.id, NEW.order_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION trg_zending_set_m2m() IS
  'Mig 242: schrijft automatisch een M2M-rij in zending_orders bij elke '
  'INSERT op zendingen. Maakt zending_orders de canonieke bron voor '
  '"alle orders van een zending"-queries, ongeacht of de zending solo '
  '(start_pickronden_voor_order, create_zending_voor_order) of bundel '
  '(start_pickronden_bundel) is. ON CONFLICT DO NOTHING beschermt tegen '
  'duplicaat-INSERT door bundel-RPC die zelf al de volledige M2M-set '
  'invoegt.';

DROP TRIGGER IF EXISTS trg_zending_set_m2m_a_ins ON zendingen;
CREATE TRIGGER trg_zending_set_m2m_a_ins
  AFTER INSERT ON zendingen
  FOR EACH ROW
  EXECUTE FUNCTION trg_zending_set_m2m();

------------------------------------------------------------------------
-- 2. Backfill bestaande zendingen zonder M2M-rij
------------------------------------------------------------------------
-- Mig 222 deed deze backfill al, maar alle solo-zendingen sinds mig 222
-- ontbreken nog. Idempotent: bestaande rijen worden niet overschreven.
INSERT INTO zending_orders (zending_id, order_id)
SELECT id, order_id
  FROM zendingen
 WHERE order_id IS NOT NULL
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------
-- 3. Aangescherpte tabel-comment
------------------------------------------------------------------------
COMMENT ON TABLE zending_orders IS
  'Mig 222+242: M2M tussen zendingen en orders. Voor solo-zendingen 1 rij; '
  'voor bundel-zendingen N rijen. Vanaf mig 242 is deze tabel canoniek — '
  'élke zending heeft hier minstens 1 rij dankzij de AFTER INSERT-trigger '
  'trg_zending_set_m2m. zendingen.order_id blijft als "primaire/eerste" '
  'order bestaan voor backwards-compat queries, maar consumers horen '
  'voortaan via deze tabel te queryen.';

NOTIFY pgrst, 'reload schema';
