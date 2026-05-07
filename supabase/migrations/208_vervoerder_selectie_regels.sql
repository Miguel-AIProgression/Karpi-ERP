-- Migratie 208: vervoerder-selectieregels
--
-- Achtergrond
-- -----------
-- Tot mig 176 was de selector "exact 1 actieve vervoerder = die wordt gekozen".
-- Met DPD erbij (mig 207) zijn er meerdere actieve vervoerders mogelijk en moet
-- per zending een regel-gebaseerde keuze gemaakt worden. Voorbeeld-regels die
-- Karpi vandaag toepast:
--   • Bestemming DE + tapijt-kleinste-zijde >130 cm  → Rhenus (palletvervoer)
--   • Bestemming DE + tapijt-kleinste-zijde ≤130 cm  → DPD (internationaal)
--
-- "Kleinste zijde" = LEAST(lengte_cm, breedte_cm) per orderregel; voor de hele
-- zending nemen we MAX over alle regels — het grootste tapijt bepaalt of DPD
-- nog past.
--
-- Datamodel
-- ---------
-- Eén tabel `vervoerder_selectie_regels` met JSONB-conditie. JSONB houdt het
-- uitbreidbaar (gewicht, debiteur, inkoopgroep, postcode-prefix komen later
-- zonder ALTER TABLE). De evaluator (mig 210) leest bekende sleutels; onbekende
-- sleutels worden genegeerd.
--
-- Conditie-sleutels V1
-- --------------------
--   land                  : TEXT[]    — match als zending.afl_land in lijst
--   kleinste_zijde_cm_min : INTEGER   — match als grootste kleinste-zijde >= waarde
--   kleinste_zijde_cm_max : INTEGER   — match als grootste kleinste-zijde <= waarde
--
-- Toekomstige sleutels (gereserveerd, evaluator-stub):
--   gewicht_kg_max, gewicht_kg_min, debiteur_nrs, inkoopgroep_codes,
--   postcode_prefix
--
-- Idempotent.

-- ============================================================================
-- Tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS vervoerder_selectie_regels (
  id              BIGSERIAL PRIMARY KEY,
  vervoerder_code TEXT    NOT NULL REFERENCES vervoerders(code) ON DELETE CASCADE,
  prio            INTEGER NOT NULL DEFAULT 100,
  conditie        JSONB   NOT NULL DEFAULT '{}'::JSONB,
  service_code    TEXT,
  actief          BOOLEAN NOT NULL DEFAULT TRUE,
  notitie         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsr_prio_actief
  ON vervoerder_selectie_regels (prio)
  WHERE actief = TRUE;

CREATE INDEX IF NOT EXISTS idx_vsr_vervoerder
  ON vervoerder_selectie_regels (vervoerder_code);

COMMENT ON TABLE vervoerder_selectie_regels IS
  'Regels voor selecteer_vervoerder_voor_zending(): eerste regel waarvan alle '
  'condities matchen wint, prio ASC (laag = eerst). Conditie-shape gedocumenteerd '
  'in mig 208 — nieuwe sleutels toevoegen vereist evaluator-uitbreiding (mig 210).';

COMMENT ON COLUMN vervoerder_selectie_regels.prio IS
  'Volgorde-prioriteit, ASC. Twee regels met dezelfde prio: id ASC als tiebreaker.';
COMMENT ON COLUMN vervoerder_selectie_regels.conditie IS
  'JSONB met conditie-sleutels. V1: land (TEXT[]), kleinste_zijde_cm_min/max (INT). '
  'Lege JSONB ({}) = altijd-match (fallback-regel).';
COMMENT ON COLUMN vervoerder_selectie_regels.service_code IS
  'Service-variant binnen vervoerder, bv. ''internationaal'' of ''predict''. '
  'Moet voorkomen in vervoerders.service_codes als die gevuld is. NULL = vervoerder-default.';

-- ============================================================================
-- updated_at-trigger (hergebruik bestaande functie)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_vsr_updated_at ON vervoerder_selectie_regels;
CREATE TRIGGER trg_vsr_updated_at
  BEFORE UPDATE ON vervoerder_selectie_regels
  FOR EACH ROW EXECUTE FUNCTION set_vervoerders_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE vervoerder_selectie_regels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vsr_all ON vervoerder_selectie_regels;
CREATE POLICY vsr_all ON vervoerder_selectie_regels
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- Seed: 2 voorbeeld-regels uit het gesprek met Karpi
-- ============================================================================
-- Alleen seeden als er nog geen regels zijn (anders re-apply zonder verrassingen).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vervoerder_selectie_regels) THEN
    INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, service_code, notitie) VALUES
      ('edi_partner_a', 10,
       jsonb_build_object('land', ARRAY['DE'], 'kleinste_zijde_cm_min', 131),
       NULL,
       'DE + tapijt >130cm kleinste zijde → Rhenus (pallet).'),
      ('dpd', 20,
       jsonb_build_object('land', ARRAY['DE'], 'kleinste_zijde_cm_max', 130),
       'internationaal',
       'DE + tapijt ≤130cm kleinste zijde → DPD internationaal.');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
