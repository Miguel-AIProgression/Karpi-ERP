-- Migration 078: kwaliteit_kleur_uitwisselgroepen
--
-- Fijnmaziger uitwisselbaarheidsmodel dan `collecties`. Bron: Map1.xlsx —
-- per (kwaliteit_code, kleur_code, variant_nr) is een `basis_code` bekend.
-- Rollen met dezelfde (basis_code, variant_nr) zijn onderling uitwisselbaar
-- voor snijplanning, ook als ze uit verschillende kwaliteit-codes komen.
--
-- Valt het input-paar buiten deze tabel, dan valt de edge function terug op
-- het bestaande `collecties`-pad.

BEGIN;

CREATE TABLE IF NOT EXISTS kwaliteit_kleur_uitwisselgroepen (
  kwaliteit_code TEXT    NOT NULL,
  kleur_code     TEXT    NOT NULL,
  variant_nr     INTEGER NOT NULL DEFAULT 1,
  basis_code     TEXT    NOT NULL,
  collectie_code TEXT,
  bron_artikelnr TEXT,
  aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kwaliteit_code, kleur_code, variant_nr)
);

CREATE INDEX IF NOT EXISTS kku_basis_variant_idx
  ON kwaliteit_kleur_uitwisselgroepen (basis_code, variant_nr);

COMMENT ON TABLE kwaliteit_kleur_uitwisselgroepen IS
  'Fijnmazige uitwisselbaarheid op (kwaliteit,kleur)-niveau. Rijen met dezelfde (basis_code,variant_nr) zijn uitwisselbaar voor snijplanning.';

-- Helper-view: per (kw,kl) geeft dit de set uitwisselbare (kw,kl)-paren.
CREATE OR REPLACE VIEW kwaliteit_kleur_uitwisselbaar AS
SELECT
  a.kwaliteit_code AS input_kwaliteit_code,
  a.kleur_code     AS input_kleur_code,
  b.kwaliteit_code AS uitwissel_kwaliteit_code,
  b.kleur_code     AS uitwissel_kleur_code,
  a.basis_code,
  a.variant_nr
FROM kwaliteit_kleur_uitwisselgroepen a
JOIN kwaliteit_kleur_uitwisselgroepen b
  ON a.basis_code = b.basis_code
 AND a.variant_nr = b.variant_nr;

COMMIT;
