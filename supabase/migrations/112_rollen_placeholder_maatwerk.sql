-- Migration 112: placeholder-rollen voor maatwerk-paren zonder eigen voorraad
--
-- ⚠️ NEUTRALIZED IN T004 (PR Voorraadpositie-Module, mig 182):
-- De INSERT-statements die placeholder-rollen aanmaakten zijn no-op gemaakt
-- (zie DO-block hieronder met `IF FALSE THEN ... END IF;`). Mig 181 verwijdert
-- bestaande PH-rollen via DELETE. Re-runs van mig 112 mogen géén nieuwe
-- PH-rollen meer aanmaken.
--
-- Reden: T003 introduceerde een ghost-merge in de rollen-overzicht-pagina
-- (`besteld_per_kwaliteit_kleur` als bron voor (kw, kl)-paren zonder eigen
-- voorraad), waardoor de "leeg-toch-zichtbaar"-truc via PH-rollen overbodig
-- werd. Audit-bevindingen: geen consumer leest meer specifiek op
-- oppervlak_m2 = 0 of rolnummer 'PH-%'.
--
-- De RPC `rollen_uitwissel_voorraad()` (Deel 2) blijft intact — die wordt in
-- T005 separaat gedemoteerd of gedropt na audit van consumers.
--
-- ────────────────────────────────────────────────────────────────────────
--
-- Originele achtergrond (historisch — gedrag is geneutraliseerd):
-- Bij de import van "rollenvoorraad per 15-04-2026" zijn alleen rollen
-- aangemaakt voor kwaliteiten waar daadwerkelijk voorraad van was. Daardoor
-- ontbraken maatwerk (kwaliteit, kleur) paren zoals CISC 15 op de Rollen &
-- Reststukken-pagina. Deze migratie maakte placeholder-rollen aan
-- (oppervlak=0, rolnummer 'PH-{KWAL}-{KLEUR}') zodat zulke paren via de
-- oude fetchRollenGegroepeerd-query alsnog zichtbaar werden.

-- ────────────────────────────────────────────────────────────────────────
-- Deel 1: placeholder-rollen inserten — NO-OP (T004 neutralization)
-- ────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF FALSE THEN
    -- Geneutraliseerd in T004 — INSERT blijft als referentie staan om
    -- duidelijk te maken wat de oude semantiek was. Mig 181 ruimt
    -- bestaande PH-rollen op; deze migratie maakt geen nieuwe meer aan.
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
  END IF;

  RAISE NOTICE 'Mig 112 placeholder-INSERT geneutraliseerd in T004 — zie mig 182.';
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
