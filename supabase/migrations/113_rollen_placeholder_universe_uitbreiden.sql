-- Migration 113: placeholder-rollen universe uitbreiden met producten + uitwisselgroepen
--
-- Migratie 112 gebruikte alleen maatwerk_m2_prijzen als bron voor placeholder-paren.
-- Dat bleek te smal: veel maatwerk-varianten (bv. CISC 15 met rol-product 1771001
-- en uitwisselgroep-lid basis_code='CISC15' variant_nr=2) staan niet in
-- maatwerk_m2_prijzen. Resultaat: slechts 1 placeholder bij eerste run.
--
-- Fix: universe uitbreiden tot maatwerk_m2_prijzen ∪ producten(actief, kleur NOT NULL)
-- ∪ kwaliteit_kleur_uitwisselgroepen — identiek aan de `kleur_universe` CTE uit
-- migratie 105. Artikelnr-lookup priority: overig > karpi_code maatwerk >
-- omschrijving maatwerk > rol > else. Zo krijgt een paar zonder maatwerk-variant
-- maar mét rol-product alsnog een zinnige FK.
--
-- Herhaalbaar: NOT EXISTS + ON CONFLICT DO NOTHING — paren die inmiddels een rol
-- hebben worden overgeslagen.

DO $$
DECLARE
  v_ingevoegd  INTEGER;
  v_geskipt    INTEGER;
BEGIN
  WITH universe AS (
    SELECT DISTINCT kwaliteit_code, kleur_code FROM (
      SELECT mp.kwaliteit_code, mp.kleur_code
        FROM maatwerk_m2_prijzen mp
        WHERE mp.kleur_code IS NOT NULL
      UNION
      SELECT p.kwaliteit_code, p.kleur_code
        FROM producten p
        WHERE p.kleur_code IS NOT NULL
          AND p.kwaliteit_code IS NOT NULL
          AND p.actief = true
      UNION
      SELECT u.kwaliteit_code, u.kleur_code
        FROM kwaliteit_kleur_uitwisselgroepen u
    ) s
  )
  SELECT COUNT(*) INTO v_geskipt
  FROM universe u
  WHERE NOT EXISTS (
    SELECT 1 FROM producten pr
    WHERE pr.kwaliteit_code = u.kwaliteit_code
      AND pr.kleur_code = u.kleur_code
      AND pr.actief = true
  );

  WITH universe AS (
    SELECT DISTINCT kwaliteit_code, kleur_code FROM (
      SELECT mp.kwaliteit_code, mp.kleur_code
        FROM maatwerk_m2_prijzen mp
        WHERE mp.kleur_code IS NOT NULL
      UNION
      SELECT p.kwaliteit_code, p.kleur_code
        FROM producten p
        WHERE p.kleur_code IS NOT NULL
          AND p.kwaliteit_code IS NOT NULL
          AND p.actief = true
      UNION
      SELECT u.kwaliteit_code, u.kleur_code
        FROM kwaliteit_kleur_uitwisselgroepen u
    ) s
  )
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
    'PH-' || u.kwaliteit_code || '-' || REPLACE(u.kleur_code, '.0', '') AS rolnummer,
    p.artikelnr,
    u.kwaliteit_code,
    u.kleur_code,
    0,
    0,
    0,
    'beschikbaar',
    'Placeholder — geen eigen voorraad'
  FROM universe u
  CROSS JOIN LATERAL (
    SELECT pr.artikelnr
    FROM producten pr
    WHERE pr.kwaliteit_code = u.kwaliteit_code
      AND pr.kleur_code = u.kleur_code
      AND pr.actief = true
    ORDER BY (CASE WHEN pr.product_type = 'overig'         THEN 0
                   WHEN pr.karpi_code   ILIKE '%maatwerk%' THEN 1
                   WHEN pr.omschrijving ILIKE '%maatwerk%' THEN 2
                   WHEN pr.product_type = 'rol'            THEN 3
                   ELSE 4 END),
             pr.artikelnr
    LIMIT 1
  ) p
  WHERE NOT EXISTS (
    SELECT 1 FROM rollen r
    WHERE r.kwaliteit_code = u.kwaliteit_code
      AND r.kleur_code = u.kleur_code
      AND r.status NOT IN ('verkocht', 'gesneden')
  )
  ON CONFLICT (rolnummer) DO NOTHING;

  GET DIAGNOSTICS v_ingevoegd = ROW_COUNT;

  RAISE NOTICE 'Placeholder-rollen (uitgebreide universe): % ingevoegd, % geskipt (geen matchend actief product)',
    v_ingevoegd, v_geskipt;
END $$;
