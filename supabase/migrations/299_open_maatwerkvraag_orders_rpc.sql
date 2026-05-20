-- Migratie 299: open_maatwerkvraag_orders — orders achter de Bruto-maatwerkvraag
--
-- Context (ADR-0026): de Vrij-KPI op de Rollen & Reststukken-pagina toont een
-- familie-totaal, maar de inkoper wil bij expand óók weten WELKE orders die
-- druk veroorzaken (welke klant, welk stuk, wanneer leveren, welke status).
--
-- Hergebruikt `snijplanning_overzicht` (mig 168) als bron: die view heeft al
-- snijplan + order + klant + afleverdatum gejoined. Filter:
--   * status IN ('Wacht', 'Gepland', 'Snijden') — zelfde grens als mig 296
--   * (kw, kl) in uitwisselbare_paren(p_kw, p_kl) — familie-scoped
-- Berekent per rij bruto_m2 met dezelfde formule als mig 296.
--
-- Lazy gefetcht vanuit de RollenGroepRow-expand wanneer bruto_maatwerkvraag_m2 > 0.

CREATE OR REPLACE FUNCTION open_maatwerkvraag_orders(
  p_kwaliteit TEXT,
  p_kleur     TEXT
)
RETURNS TABLE (
  snijplan_id              BIGINT,
  snijplan_nr              TEXT,
  status                   TEXT,
  snij_lengte_cm           INTEGER,
  snij_breedte_cm          INTEGER,
  bruto_m2                 NUMERIC,
  besteld_kwaliteit_code   TEXT,
  besteld_kleur_code       TEXT,
  order_id                 BIGINT,
  order_nr                 TEXT,
  afleverdatum             DATE,
  debiteur_nr              INTEGER,
  klant_naam               TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    so.id                                                                          AS snijplan_id,
    so.snijplan_nr,
    so.status::TEXT                                                                AS status,
    so.snij_lengte_cm,
    so.snij_breedte_cm,
    ((LEAST(so.snij_lengte_cm, so.snij_breedte_cm)::NUMERIC / 100.0)
       * (COALESCE(k.standaard_breedte_cm, 400)::NUMERIC / 100.0))::NUMERIC        AS bruto_m2,
    so.kwaliteit_code                                                              AS besteld_kwaliteit_code,
    regexp_replace(so.kleur_code, '\.0+$', '')                                     AS besteld_kleur_code,
    so.order_id,
    so.order_nr,
    so.afleverdatum,
    so.debiteur_nr,
    so.klant_naam
  FROM snijplanning_overzicht so
  LEFT JOIN kwaliteiten k ON k.code = so.kwaliteit_code
  WHERE so.status IN ('Wacht'::snijplan_status,
                      'Gepland'::snijplan_status,
                      'Snijden'::snijplan_status)
    AND so.snij_lengte_cm  IS NOT NULL
    AND so.snij_breedte_cm IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM uitwisselbare_paren(p_kwaliteit, p_kleur) up
      WHERE up.target_kwaliteit_code = so.kwaliteit_code
        AND up.target_kleur_code     = regexp_replace(so.kleur_code, '\.0+$', '')
    )
  ORDER BY
    so.afleverdatum ASC NULLS LAST,
    so.snijplan_nr  ASC;
$$;

COMMENT ON FUNCTION open_maatwerkvraag_orders(TEXT, TEXT) IS
  'Open maatwerk-snijplannen die druk veroorzaken op een uitwisselbare familie. '
  'Returnt per snijplan in {Wacht, Gepland, Snijden} de bruto_m2-bijdrage + '
  'order/klant/afleverdatum-context. Familie-scoped via uitwisselbare_paren. '
  'Bron: snijplanning_overzicht (mig 168). Aangeroepen vanuit RollenGroepRow-'
  'expand wanneer bruto_maatwerkvraag_m2 > 0. ADR-0026.';

GRANT EXECUTE ON FUNCTION open_maatwerkvraag_orders(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 299 toegepast: open_maatwerkvraag_orders RPC (ADR-0026).';
END $$;
