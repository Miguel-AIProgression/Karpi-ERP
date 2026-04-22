-- Migration 112: placeholder-rollen voor maatwerk-paren zonder eigen voorraad
--
-- Achtergrond: bij de import van "rollenvoorraad per 15-04-2026" zijn alleen
-- rollen aangemaakt voor kwaliteiten waar daadwerkelijk voorraad van was.
-- Daardoor ontbreken maatwerk (kwaliteit, kleur) paren zoals CISC 15 volledig
-- op de Rollen & Reststukken-pagina, ook als ze via kwaliteit_kleur_uitwissel-
-- groepen leverbaar zijn via een andere kwaliteit (bv. CISC 16).
--
-- Fix, twee onderdelen:
--   1. Idempotente INSERT die voor elk (kwaliteit, kleur)-paar in maatwerk_
--      m2_prijzen zonder actieve rol een placeholder-rol aanmaakt (oppervlak=0,
--      status='beschikbaar'). Rolnummer: 'PH-{KWAL}-{KLEUR}'.
--   2. RPC rollen_uitwissel_voorraad() die per (onze_kwal, onze_kleur) de
--      beste uitwissel-kandidaat retourneert (meeste beschikbare m²) uit
--      kwaliteit_kleur_uitwisselgroepen. Frontend mergt dit op groepen waar
--      eigen voorraad 0 is, zodat de "Leverbaar via"-badge gerenderd kan worden.
--
-- Herhaalbaar: de INSERT gebruikt ON CONFLICT DO NOTHING op rolnummer; paren
-- die nu een matchend product krijgen, kunnen bij een tweede run worden
-- toegevoegd.

-- ────────────────────────────────────────────────────────────────────────
-- Deel 1: placeholder-rollen inserten
-- ────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_ingevoegd  INTEGER;
  v_geskipt    INTEGER;
BEGIN
  -- Paren zonder matchend actief producten-record: we loggen ze bij elke run
  -- (ook bij re-runs na eerdere placeholder-inserts) zodat je kunt zien of er
  -- nog ontbrekende producten handmatig aangemaakt moeten worden. Deze paren
  -- kunnen niet ingevoegd worden vanwege rollen.artikelnr NOT NULL + FK.
  SELECT COUNT(*) INTO v_geskipt
  FROM maatwerk_m2_prijzen mp
  WHERE NOT EXISTS (
    SELECT 1 FROM producten pr
    WHERE pr.kwaliteit_code = mp.kwaliteit_code
      AND pr.kleur_code = mp.kleur_code
      AND pr.actief = true
  );

  INSERT INTO rollen (
    rolnummer,
    artikelnr,
    kwaliteit_code,
    kleur_code,
    lengte_cm,
    breedte_cm,
    oppervlak_m2,
    status,
    omschrijving
  )
  SELECT
    'PH-' || mp.kwaliteit_code || '-' || REPLACE(mp.kleur_code, '.0', '') AS rolnummer,
    p.artikelnr,
    mp.kwaliteit_code,
    mp.kleur_code,
    0,
    0,
    0,
    'beschikbaar',
    'Placeholder — geen eigen voorraad'
  FROM maatwerk_m2_prijzen mp
  CROSS JOIN LATERAL (
    SELECT pr.artikelnr
    FROM producten pr
    WHERE pr.kwaliteit_code = mp.kwaliteit_code
      AND pr.kleur_code = mp.kleur_code
      AND pr.actief = true
    ORDER BY (CASE WHEN pr.product_type = 'overig'         THEN 0
                   WHEN pr.karpi_code   ILIKE '%maatwerk%' THEN 1
                   WHEN pr.omschrijving ILIKE '%maatwerk%' THEN 2
                   ELSE 3 END),
             pr.artikelnr
    LIMIT 1
  ) p
  WHERE NOT EXISTS (
    SELECT 1 FROM rollen r
    WHERE r.kwaliteit_code = mp.kwaliteit_code
      AND r.kleur_code = mp.kleur_code
      AND r.status NOT IN ('verkocht', 'gesneden')
  )
  ON CONFLICT (rolnummer) DO NOTHING;

  GET DIAGNOSTICS v_ingevoegd = ROW_COUNT;

  RAISE NOTICE 'Placeholder-rollen: % ingevoegd, % geskipt (geen matchend actief product)',
    v_ingevoegd, v_geskipt;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- Deel 2: RPC rollen_uitwissel_voorraad
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rollen_uitwissel_voorraad()
RETURNS TABLE(
  kwaliteit_code       TEXT,
  kleur_code           TEXT,
  equiv_kwaliteit_code TEXT,
  equiv_kleur_code     TEXT,
  equiv_rollen         INTEGER,
  equiv_m2             NUMERIC
) AS $$
WITH
-- Voor elk (kwaliteit, kleur) in een uitwisselgroep: alle andere leden van
-- dezelfde groep (basis_code + variant_nr).
koppel AS (
  SELECT u1.kwaliteit_code AS onze_kwaliteit,
         u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
),
-- Beschikbare m² en aantal rollen per uitwissel-lid (excl. placeholders).
agg AS (
  SELECT k.onze_kwaliteit,
         k.onze_kleur,
         k.uit_kwaliteit,
         k.uit_kleur,
         COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0)::INTEGER          AS aantal,
         COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS m2
  FROM koppel k
  LEFT JOIN rollen r
    ON r.kwaliteit_code = k.uit_kwaliteit
   AND r.kleur_code = k.uit_kleur
   AND r.status = 'beschikbaar'
  GROUP BY k.onze_kwaliteit, k.onze_kleur, k.uit_kwaliteit, k.uit_kleur
)
SELECT DISTINCT ON (a.onze_kwaliteit, a.onze_kleur)
  a.onze_kwaliteit,
  a.onze_kleur,
  a.uit_kwaliteit,
  a.uit_kleur,
  a.aantal,
  a.m2
FROM agg a
WHERE a.aantal > 0
ORDER BY a.onze_kwaliteit, a.onze_kleur, a.m2 DESC, a.uit_kwaliteit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION rollen_uitwissel_voorraad() IS
  'Voor elk (kwaliteit, kleur) in kwaliteit_kleur_uitwisselgroepen: beste '
  'uitwissel-kandidaat (meeste beschikbare m² in rollen met status=beschikbaar '
  'en oppervlak_m2>0). Gebruikt door Rollen & Reststukken-pagina om '
  '"Leverbaar via"-badge te tonen op groepen zonder eigen voorraad.';
