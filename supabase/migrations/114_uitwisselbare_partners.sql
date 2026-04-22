-- Migration 114: uitwisselbare_partners RPC voor volledig uitwisselgroep-overzicht
--
-- rollen_uitwissel_voorraad() (migratie 112) retourneert alleen de BESTE
-- uitwissel-kandidaat (meeste beschikbare m²) en filtert paren zonder voorraad
-- weg. De Rollen & Reststukken-pagina wil ook de volledige lijst van uitwissel-
-- bare partners zien — ongeacht voorraad — zodat de gebruiker weet welke
-- kwaliteiten uitwisselbaar zijn, óók als niemand op voorraad heeft.

CREATE OR REPLACE FUNCTION uitwisselbare_partners()
RETURNS TABLE(
  kwaliteit_code         TEXT,
  kleur_code             TEXT,
  partner_kwaliteit_code TEXT,
  partner_kleur_code     TEXT,
  partner_rollen         INTEGER,
  partner_m2             NUMERIC
) AS $$
SELECT
  u1.kwaliteit_code                                                           AS kwaliteit_code,
  u1.kleur_code                                                               AS kleur_code,
  u2.kwaliteit_code                                                           AS partner_kwaliteit_code,
  u2.kleur_code                                                               AS partner_kleur_code,
  COALESCE(COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0), 0)::INTEGER         AS partner_rollen,
  COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS partner_m2
FROM kwaliteit_kleur_uitwisselgroepen u1
JOIN kwaliteit_kleur_uitwisselgroepen u2
  ON u2.basis_code = u1.basis_code
 AND u2.variant_nr = u1.variant_nr
 AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
LEFT JOIN rollen r
  ON r.kwaliteit_code = u2.kwaliteit_code
 AND r.kleur_code = u2.kleur_code
 AND r.status = 'beschikbaar'
GROUP BY u1.kwaliteit_code, u1.kleur_code, u2.kwaliteit_code, u2.kleur_code
ORDER BY u1.kwaliteit_code, u1.kleur_code, partner_m2 DESC, u2.kwaliteit_code;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION uitwisselbare_partners() IS
  'Voor elk (kwaliteit, kleur) in kwaliteit_kleur_uitwisselgroepen: alle andere '
  'leden van dezelfde uitwisselgroep (basis_code + variant_nr) met hun huidige '
  'voorraad (aantal rollen + m², excl. placeholders met oppervlak_m2=0). '
  'Gebruikt door Rollen & Reststukken-pagina om alle potentiële uitwisselbare '
  'partners te tonen, ongeacht of ze voorraad hebben.';
