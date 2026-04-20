-- De CHECK constraint order_regels_maatwerk_vorm_check bevatte alleen
-- 'rechthoek', 'rond', 'ovaal' en blokkeerde organisch_a en organisch_b_sp.
-- De FK fk_order_regels_vorm → maatwerk_vormen(code) garandeert al correcte
-- waarden, dus de CHECK is redundant en wordt verwijderd.
ALTER TABLE order_regels
  DROP CONSTRAINT IF EXISTS order_regels_maatwerk_vorm_check;
