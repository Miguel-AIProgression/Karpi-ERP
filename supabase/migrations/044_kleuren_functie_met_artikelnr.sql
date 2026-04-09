-- Migration 044: Update kleuren_voor_kwaliteit functie
-- 1. Voeg artikelnr toe (het rol-product voor die kwaliteit+kleur)
-- 2. Strip '.0' suffix van kleur_codes in de weergave
-- 3. Voeg voorraad info toe (eigen rollen + equivalenten uit zelfde collectie)
-- DROP nodig omdat return type verandert (nieuwe kolommen)

DROP FUNCTION IF EXISTS kleuren_voor_kwaliteit(text);

CREATE OR REPLACE FUNCTION kleuren_voor_kwaliteit(p_kwaliteit TEXT)
RETURNS TABLE(
  kleur_code TEXT,
  kleur_label TEXT,
  omschrijving TEXT,
  verkoopprijs_m2 NUMERIC,
  kostprijs_m2 NUMERIC,
  gewicht_per_m2_kg NUMERIC,
  max_breedte_cm INTEGER,
  artikelnr TEXT,
  karpi_code TEXT,
  aantal_rollen INTEGER,
  beschikbaar_m2 NUMERIC,
  equiv_rollen INTEGER,
  equiv_m2 NUMERIC
) AS $$
  SELECT
    mp.kleur_code,
    CASE
      WHEN mp.kleur_code LIKE '%.0' THEN LEFT(mp.kleur_code, LENGTH(mp.kleur_code) - 2)
      ELSE mp.kleur_code
    END AS kleur_label,
    COALESCE(
      (SELECT pr.omschrijving FROM producten pr
       WHERE pr.kwaliteit_code = mp.kwaliteit_code
         AND pr.kleur_code = mp.kleur_code
         AND pr.product_type = 'rol'
         AND pr.actief = true
       LIMIT 1),
      MIN(p.omschrijving)
    ) AS omschrijving,
    mp.verkoopprijs_m2,
    mp.kostprijs_m2,
    mp.gewicht_per_m2_kg,
    mp.max_breedte_cm,
    (SELECT pr.artikelnr FROM producten pr
     WHERE pr.kwaliteit_code = mp.kwaliteit_code
       AND pr.kleur_code = mp.kleur_code
       AND pr.product_type = 'rol'
       AND pr.actief = true
     LIMIT 1) AS artikelnr,
    (SELECT pr.karpi_code FROM producten pr
     WHERE pr.kwaliteit_code = mp.kwaliteit_code
       AND pr.kleur_code = mp.kleur_code
       AND pr.product_type = 'rol'
       AND pr.actief = true
     LIMIT 1) AS karpi_code,
    -- Eigen rollen: beschikbare rollen voor deze exacte kwaliteit+kleur
    (SELECT COUNT(*)::INTEGER FROM rollen r
     WHERE r.kwaliteit_code = p_kwaliteit
       AND r.kleur_code = mp.kleur_code
       AND r.status = 'beschikbaar'
    ) AS aantal_rollen,
    (SELECT COALESCE(ROUND(SUM(r.oppervlak_m2)::NUMERIC, 1), 0) FROM rollen r
     WHERE r.kwaliteit_code = p_kwaliteit
       AND r.kleur_code = mp.kleur_code
       AND r.status = 'beschikbaar'
    ) AS beschikbaar_m2,
    -- Equivalente rollen: andere kwaliteiten in dezelfde collectie, zelfde kleur
    (SELECT COUNT(*)::INTEGER FROM rollen r
     JOIN kwaliteiten k ON k.code = r.kwaliteit_code
     WHERE k.collectie_id = (SELECT k2.collectie_id FROM kwaliteiten k2 WHERE k2.code = p_kwaliteit)
       AND r.kwaliteit_code != p_kwaliteit
       AND r.kleur_code = mp.kleur_code
       AND r.status = 'beschikbaar'
    ) AS equiv_rollen,
    (SELECT COALESCE(ROUND(SUM(r.oppervlak_m2)::NUMERIC, 1), 0) FROM rollen r
     JOIN kwaliteiten k ON k.code = r.kwaliteit_code
     WHERE k.collectie_id = (SELECT k2.collectie_id FROM kwaliteiten k2 WHERE k2.code = p_kwaliteit)
       AND r.kwaliteit_code != p_kwaliteit
       AND r.kleur_code = mp.kleur_code
       AND r.status = 'beschikbaar'
    ) AS equiv_m2
  FROM maatwerk_m2_prijzen mp
  JOIN producten p ON p.kwaliteit_code = mp.kwaliteit_code
    AND p.kleur_code = mp.kleur_code AND p.actief = true
  WHERE mp.kwaliteit_code = p_kwaliteit
  GROUP BY mp.kleur_code, mp.verkoopprijs_m2, mp.kostprijs_m2,
           mp.gewicht_per_m2_kg, mp.max_breedte_cm, mp.kwaliteit_code
  ORDER BY mp.kleur_code;
$$ LANGUAGE sql STABLE;
