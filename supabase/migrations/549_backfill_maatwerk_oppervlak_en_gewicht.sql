-- Migratie 549: backfill maatwerk_oppervlak_m2 + gewicht_kg voor open maatwerk-regels
--
-- Root-cause: 1.086 maatwerk-orderregels (status "In productie") hadden
-- maatwerk_lengte_cm / maatwerk_breedte_cm wél ingevuld, maar
-- maatwerk_oppervlak_m2 = NULL. bereken_orderregel_gewicht_kg vereist
-- maatwerk_oppervlak_m2 als tussenwaarde — bij NULL returnde de functie NULL,
-- waarna mig 538 het gewicht niet kon backfillen.
--
-- Stap 1: herstel maatwerk_oppervlak_m2 vanuit de dimensies.
--   Formule per vorm (spiegelt frontend bereekenM2PerStuk in
--   _shared/facturatie/intracom-statregel.ts):
--     rond  → π × (LEAST(lengte,breedte) / 200)²
--     ovaal / ellips → π × (lengte/200) × (breedte/200)
--     alle overige vormen (rechthoek, organisch_*, pebble, contour,
--     klanteigen_vorm, NULL) → lengte × breedte / 10000
--
-- Stap 2: vul gewicht_kg via bereken_orderregel_gewicht_kg voor alle
--   maatwerk-regels die nu wél een oppervlak hebben (maar nog NULL gewicht).
--
-- Bewust alleen niet-geannuleerde orders — geannuleerde orders hebben geen
-- actieve facturen en het aanpassen van hun gewichten levert geen waarde.
-- Stap 1 raakt ook Verzonden/In productie/etc. — dat is gewenst: ook
-- historische facturen krijgen op de live DB het correcte gewicht.

-- ── Stap 1: backfill maatwerk_oppervlak_m2 ──────────────────────────────────
UPDATE order_regels orr
SET maatwerk_oppervlak_m2 = CASE
  WHEN orr.maatwerk_vorm IN ('rond')
    THEN ROUND(
      (PI() * POWER(LEAST(orr.maatwerk_lengte_cm, orr.maatwerk_breedte_cm) / 200.0, 2))::NUMERIC,
      4
    )
  WHEN orr.maatwerk_vorm IN ('ovaal', 'ellips')
    THEN ROUND(
      (PI() * (orr.maatwerk_lengte_cm / 200.0) * (orr.maatwerk_breedte_cm / 200.0))::NUMERIC,
      4
    )
  ELSE
    ROUND(
      (orr.maatwerk_lengte_cm * orr.maatwerk_breedte_cm / 10000.0)::NUMERIC,
      4
    )
END
FROM orders o
WHERE orr.order_id = o.id
  AND orr.is_maatwerk = true
  AND orr.maatwerk_oppervlak_m2 IS NULL
  AND orr.maatwerk_lengte_cm IS NOT NULL
  AND orr.maatwerk_breedte_cm IS NOT NULL
  AND o.status <> 'Geannuleerd';

-- ── Stap 2: backfill gewicht_kg via de bestaande resolver ───────────────────
-- Let op: geen filter op artikelnr IS NULL — maatwerk-regels die via
-- converteer_regel_naar_maatwerk (mig 472) zijn omgezet behouden hun
-- originele artikelnr maar de functie volgt altijd de maatwerk-tak (eerste
-- IF-blok) zodra maatwerk_oppervlak_m2 aanwezig is.
UPDATE order_regels
SET gewicht_kg = bereken_orderregel_gewicht_kg(id)
WHERE gewicht_kg IS NULL
  AND is_maatwerk = true
  AND maatwerk_oppervlak_m2 IS NOT NULL;
