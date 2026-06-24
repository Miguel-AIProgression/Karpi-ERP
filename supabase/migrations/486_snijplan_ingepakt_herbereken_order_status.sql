-- Migratie 486: snijplan-fase → order-status terugkoppel-seam
--
-- PROBLEEM (architectuur-audit 2026-06-24, kandidaat #1):
-- De order-fase (orders.status) is bedoeld als afleiding van de werkelijke
-- toestand (ADR-0016 "Order-status toont werkelijke fase"). Voor de
-- claim-state klopt dat — elke orderregel-/claim-mutatie loopt via
-- herallocateer_orderregel → herwaardeer_order_status → herbereken_wacht_status
-- (mig 254-wrapper, ADR-0015). Maar voor de PRODUCTIE-state (snijplannen) was
-- er GEEN terugkoppeling: noch voltooi_confectie (mig 348, doet alleen de
-- productie-only 'Maatwerk afgerond'-flip) noch de directe scanstation-UPDATE
-- (opboekenItem: kale `UPDATE snijplannen SET status='Ingepakt'`) riep
-- herbereken_wacht_status aan, en geen enkele trigger op `snijplannen`
-- (auto-plan mig 111, auto-verzendweek mig 469/471) deed dat.
--
-- GEVOLG: een gewone maatwerk-order bleef op 'Wacht op maatwerk' staan nadat
-- al zijn snijplannen 'Ingepakt' waren — terwijl orderregel_pickbaarheid (view,
-- mig 386) hem dan al pickbaar toont in Pick & Ship. Twee verhalen naast
-- elkaar: de Pick & Ship-lijst zegt "klaar om te picken", de order-badge zegt
-- "wacht op productie". De order toonde nooit 'Klaar voor picken' en sprong van
-- 'Wacht op maatwerk' direct naar 'In pickronde'. Precies het spook-status-
-- patroon dat ADR-0016 wilde uitbannen, teruggekeerd op de confectie→pick-naad.
--
-- FIX: één listener op `snijplannen` die de wacht-status van de eigenaar-order
-- herberekent wanneer een stuk de 'Ingepakt'-grens kruist (in- of uitpakken).
-- Dit is het ADR-0006/0015-listener-patroon (lifecycle §5: "nieuwe cascade-
-- effecten = nieuwe listener, géén edit in de command-RPC's"), nu in de
-- snijplan→order-richting. Vangt BEIDE Ingepakt-zetters (confectie-modal én
-- kale scanstation-UPDATE) op één plek — geen sync-burden over twee call-sites.
-- De beslissing zelf blijft single-source: herbereken_wacht_status delegeert
-- aan derive_wacht_status (mig 352), die eindstatussen/pickronde-fases
-- no-toucht. Dus een order in 'In pickronde'/'Verzonden' wordt nooit
-- teruggetrokken; een uitgepakt stuk ('Ingepakt' → 'In confectie') laat
-- derive's tak-4 de order netjes terug naar 'Wacht op maatwerk' zetten.
--
-- SCOPE-GRENS — productie-only orders (alleen_productie=true) worden BEWUST
-- overgeslagen: die hebben hun eigen terminale pad ('Maatwerk afgerond' via
-- voltooi_confectie mig 348) en horen nooit in Pick & Ship. herbereken zou ze
-- weliswaar no-touchen zodra ze 'Maatwerk afgerond' zijn, maar vóór die flip
-- zou hij overbodige 'Wacht op maatwerk'-events loggen — daarom de guard.
--
-- WAAROM EEN TRIGGER OP `snijplannen` EN GEEN RPC-AANROEP: opboekenItem
-- (scanstation, de "officiële" inpak-scan) is een directe tabel-UPDATE vanuit
-- de frontend, geen RPC. Een command-side aanroep zou dus twee plekken vereisen
-- (voltooi_confectie + een nieuw RPC rond opboekenItem) die synchroon moeten
-- blijven — de fout-magneet uit ADR-0013. De trigger is de deep seam: één
-- plek, alle (huidige en toekomstige) Ingepakt-zetters gedekt.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION trg_fn_snijplan_herbereken_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id         BIGINT;
  v_alleen_productie BOOLEAN;
BEGIN
  SELECT orr.order_id, COALESCE(o.alleen_productie, false)
    INTO v_order_id, v_alleen_productie
    FROM order_regels orr
    JOIN orders o ON o.id = orr.order_id
   WHERE orr.id = NEW.order_regel_id;

  -- Geen order of productie-only → niet aanraken (zie header).
  IF v_order_id IS NULL OR v_alleen_productie THEN
    RETURN NEW;
  END IF;

  -- Order-fase = afleiding van productie- én claim-state. herbereken_wacht_status
  -- (SECURITY DEFINER) no-toucht eindstatussen/pickronde-fases en schrijft via
  -- _apply_transitie. Geen recursie: het raakt orders/order_events, nooit
  -- snijplannen.
  PERFORM herbereken_wacht_status(v_order_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_snijplan_herbereken_order_status() IS
  'Mig 486: triggert herbereken_wacht_status voor de eigenaar-order wanneer een '
  'snijplan de Ingepakt-grens kruist (confectie→pick terugkoppeling, ADR-0016). '
  'Slaat productie-only orders over (eigen terminale flip, mig 348). Listener-'
  'patroon (ADR-0006/0015) — niet in de command-RPC''s gedupliceerd.';

DROP TRIGGER IF EXISTS trg_snijplan_herbereken_order_status ON snijplannen;
CREATE TRIGGER trg_snijplan_herbereken_order_status
  AFTER UPDATE OF status ON snijplannen
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        AND (NEW.status = 'Ingepakt'::snijplan_status
             OR OLD.status = 'Ingepakt'::snijplan_status))
  EXECUTE FUNCTION trg_fn_snijplan_herbereken_order_status();

-- Zelf-test (statisch, conform codebase-conventie — gedrag wordt apart in een
-- rolled-back transactie op een live order geverifieerd):
--   1. de trigger bestaat op `snijplannen`;
--   2. de trigger-functie roept herbereken_wacht_status aan;
--   3. de functie slaat productie-only over.
DO $$
DECLARE
  v_def TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'snijplannen'::regclass
      AND tgname = 'trg_snijplan_herbereken_order_status'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Mig 486: trigger trg_snijplan_herbereken_order_status ontbreekt op snijplannen';
  END IF;

  v_def := pg_get_functiondef('trg_fn_snijplan_herbereken_order_status()'::regprocedure);
  IF v_def NOT LIKE '%herbereken_wacht_status%' THEN
    RAISE EXCEPTION 'Mig 486: trigger-functie roept herbereken_wacht_status niet aan';
  END IF;
  IF v_def NOT LIKE '%alleen_productie%' THEN
    RAISE EXCEPTION 'Mig 486: productie-only-guard ontbreekt in de trigger-functie';
  END IF;

  RAISE NOTICE 'Mig 486: alle asserties geslaagd — snijplan→order terugkoppel-seam actief';
END $$;

NOTIFY pgrst, 'reload schema';
