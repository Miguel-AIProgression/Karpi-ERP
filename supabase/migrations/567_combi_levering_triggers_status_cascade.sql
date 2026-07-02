-- Migratie 567: Combi-levering-triggers herevalueren nu ook orders.status (ADR-0040)
--
-- mig 558/561's twee triggers herwaardeerden tot nu toe alleen de VERZEND-
-- orderregel (herwaardeer_combi_levering_verzendregel) bij een override- of
-- klant-instelling-toggle. Zonder aanvullende aanroep zou de nieuwe
-- order_status-gate (mig 564/565) pas bij de eerstvolgende toevallige
-- orderregel-/claim-mutatie herevalueren — een operator die de instelling
-- omzet, verwacht dat de order DIRECT verschijnt/verdwijnt in Pick & Ship.
--
-- Cascade-parameter is bewust verschillend per trigger (voorkomt O(n²) i.p.v.
-- O(n) DB-round-trips bij een klantbrede toggle):
--   - trg_orders_combi_levering_override_fn raakt precies ÉÉN order → moet
--     zelf zijn siblings vinden: cascade=TRUE (default).
--   - trg_debiteuren_combi_levering_fn loopt al over ALLE open orders van de
--     klant (over mogelijk meerdere adres-groepen) → elk lid van elke groep
--     wordt toch al door deze buitenste FOR-loop bezocht, dus cascade=FALSE
--     (verdere cascade per order zou hetzelfde werk dubbel doen).
--
-- Volgorde van de twee PERFORM-aanroepen maakt niet uit (beide zijn puur
-- lezend-dan-schrijvend op onafhankelijke kolommen: order_regels.VERZEND-regel
-- resp. orders.status) — VERZEND-regel eerst gehouden voor leesbaarheid t.o.v.
-- mig 558/561.

CREATE OR REPLACE FUNCTION trg_orders_combi_levering_override_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.combi_levering_override IS DISTINCT FROM OLD.combi_levering_override THEN
    PERFORM herwaardeer_combi_levering_verzendregel(NEW.id);
    PERFORM herbereken_wacht_status(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_debiteuren_combi_levering_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF NEW.combi_levering IS DISTINCT FROM OLD.combi_levering THEN
    FOR v_order_id IN
      SELECT id FROM orders
       WHERE debiteur_nr = NEW.debiteur_nr
         AND status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
    LOOP
      PERFORM herwaardeer_combi_levering_verzendregel(v_order_id);
      PERFORM herbereken_wacht_status(v_order_id, FALSE);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_orders_combi_levering_override_fn() IS
  'Mig 558/567 (ADR-0039/0040): bij override-toggle op één order, herwaardeer '
  'zowel de VERZEND-regel als orders.status (met groep-cascade, cascade=TRUE).';

COMMENT ON FUNCTION trg_debiteuren_combi_levering_fn() IS
  'Mig 558/561/567 (ADR-0039/0040): bij klant-instelling-toggle, herwaardeer voor '
  'elk open order van de klant zowel de VERZEND-regel als orders.status '
  '(cascade=FALSE — deze buitenste loop bezoekt zelf al elk groepslid).';

NOTIFY pgrst, 'reload schema';
