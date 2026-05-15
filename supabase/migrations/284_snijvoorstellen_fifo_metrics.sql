-- Migratie 284: snijvoorstellen — FIFO-badge & vergelijkingsmetrics (ADR-0021)
--
-- De packer materialiseert één leeftijd-slim voorstel maar berekent óók een
-- pure-efficiency-variant voor vergelijking. Deze kolommen leggen de uitkomst
-- vast zodat de frontend een subtiele badge + uitklapbare rationale kan tonen,
-- en auto-plan-groep een rode badge kan herkennen voor de auto-approve-carve-out.

ALTER TABLE snijvoorstellen
  ADD COLUMN IF NOT EXISTS fifo_badge TEXT
    CHECK (fifo_badge IN ('grijs', 'geel', 'rood')),
  ADD COLUMN IF NOT EXISTS extra_afval_m2 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS extra_afval_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS oudste_rol_dagen INTEGER,
  ADD COLUMN IF NOT EXISTS efficient_oudste_rol_dagen INTEGER,
  ADD COLUMN IF NOT EXISTS rolwissels INTEGER,
  ADD COLUMN IF NOT EXISTS efficient_rolwissels INTEGER,
  ADD COLUMN IF NOT EXISTS fifo_rationale JSONB;

COMMENT ON COLUMN snijvoorstellen.fifo_badge IS
  'ADR-0021: ''grijs'' = leeftijd speelde niet (short-circuit, 0 extra afval), '
  '''geel'' = matig extra afval voor FIFO, ''rood'' = fors extra afval → NIET '
  'auto-approven in auto-plan-groep.';
COMMENT ON COLUMN snijvoorstellen.extra_afval_m2 IS
  'ADR-0021: extra snijafval (m²) van dit leeftijd-slimme voorstel t.o.v. de '
  'pure-efficiency-variant. 0 bij grijs/short-circuit.';
COMMENT ON COLUMN snijvoorstellen.fifo_rationale IS
  'ADR-0021: per rol {rol_id, gekozen_dagen, gekozen_afval_m2, '
  'efficientst_rol_id, efficientst_afval_m2, reden} voor de uitklapbare uitleg.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 284 toegepast: snijvoorstellen FIFO-badge & metrics (ADR-0021).';
END $$;
