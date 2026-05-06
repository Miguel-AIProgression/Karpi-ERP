-- Migratie 185 — Gewicht-resolver: functies, triggers, modus-seed, RPC-migratie.
--
-- Bouwt op migratie 184 (kolommen). Vanaf nu is `kwaliteiten.gewicht_per_m2_kg`
-- de bron-van-waarheid; producten- en orderregel-gewicht zijn gederiveerde caches.
-- Trigger-cascade: kwaliteit → producten → open order_regels.
--
-- Issues: #39. Plan: docs/superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md

BEGIN;

------------------------------------------------------------------------
-- 1. Modus-seed: vul kwaliteiten.gewicht_per_m2_kg waar mogelijk vanuit
--    bestaande maatwerk_m2_prijzen.gewicht_per_m2_kg (per kwaliteit modus).
--    Excel-import in #42 overschrijft. Drop van bron-kolom in #43 (mig 186).
------------------------------------------------------------------------

WITH modus_per_kwaliteit AS (
  SELECT
    kwaliteit_code,
    gewicht_per_m2_kg AS modus_gewicht
  FROM (
    SELECT
      mp.kwaliteit_code,
      mp.gewicht_per_m2_kg,
      ROW_NUMBER() OVER (
        PARTITION BY mp.kwaliteit_code
        ORDER BY COUNT(*) DESC, mp.gewicht_per_m2_kg DESC
      ) AS rn
    FROM maatwerk_m2_prijzen mp
    WHERE mp.gewicht_per_m2_kg IS NOT NULL
      AND mp.gewicht_per_m2_kg > 0
    GROUP BY mp.kwaliteit_code, mp.gewicht_per_m2_kg
  ) ranked
  WHERE rn = 1
)
UPDATE kwaliteiten q
SET gewicht_per_m2_kg = m.modus_gewicht
FROM modus_per_kwaliteit m
WHERE q.code = m.kwaliteit_code
  AND q.gewicht_per_m2_kg IS NULL;

------------------------------------------------------------------------
-- 2. Publieke resolver-functies (smal interface gewicht-resolver-Module)
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code TEXT)
RETURNS NUMERIC AS $$
  SELECT gewicht_per_m2_kg FROM kwaliteiten WHERE code = p_kwaliteit_code;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION gewicht_per_m2_voor_kwaliteit IS
  'Gewicht-resolver — eenvoudige lookup van density per kwaliteit. NULL als '
  'kwaliteit nog geen gewicht heeft. Mig 185.';

CREATE OR REPLACE FUNCTION bereken_product_gewicht_kg(p_artikelnr TEXT)
RETURNS TABLE(gewicht_kg NUMERIC, uit_kwaliteit BOOLEAN) AS $$
DECLARE
  v_lengte INTEGER;
  v_breedte INTEGER;
  v_density NUMERIC;
  v_legacy_gewicht NUMERIC;
BEGIN
  SELECT p.lengte_cm, p.breedte_cm, q.gewicht_per_m2_kg, p.gewicht_kg
    INTO v_lengte, v_breedte, v_density, v_legacy_gewicht
  FROM producten p
  LEFT JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  IF v_lengte IS NOT NULL AND v_breedte IS NOT NULL AND v_density IS NOT NULL THEN
    RETURN QUERY SELECT
      ROUND((v_lengte::NUMERIC * v_breedte::NUMERIC / 10000.0) * v_density, 2),
      true;
  ELSE
    RETURN QUERY SELECT v_legacy_gewicht, false;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_product_gewicht_kg IS
  'Gewicht-resolver — gewicht (kg/stuk) voor een vast/staaltje-product. Bij '
  'volledige cache-bron retourneert (gewicht, true). Bij ontbrekende kwaliteit-'
  'density of maat-data retourneert (legacy_gewicht, false). Mig 185.';

CREATE OR REPLACE FUNCTION bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
  v_is_maatwerk BOOLEAN;
  v_maatwerk_opp NUMERIC;
  v_maatwerk_kwaliteit TEXT;
  v_artikelnr TEXT;
  v_density NUMERIC;
  v_product_gewicht NUMERIC;
BEGIN
  SELECT
    ore.is_maatwerk,
    ore.maatwerk_oppervlak_m2,
    ore.maatwerk_kwaliteit_code,
    ore.artikelnr
  INTO v_is_maatwerk, v_maatwerk_opp, v_maatwerk_kwaliteit, v_artikelnr
  FROM order_regels ore
  WHERE ore.id = p_order_regel_id;

  IF v_is_maatwerk = true AND v_maatwerk_opp IS NOT NULL AND v_maatwerk_kwaliteit IS NOT NULL THEN
    SELECT gewicht_per_m2_kg INTO v_density
      FROM kwaliteiten WHERE code = v_maatwerk_kwaliteit;
    IF v_density IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN ROUND(v_maatwerk_opp * v_density, 2);
  END IF;

  IF v_artikelnr IS NOT NULL THEN
    SELECT gewicht_kg INTO v_product_gewicht
      FROM producten WHERE artikelnr = v_artikelnr;
    RETURN v_product_gewicht;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_orderregel_gewicht_kg IS
  'Gewicht-resolver — gewicht (kg/stuk) voor een orderregel. Maatwerk: '
  'oppervlak × kwaliteit-density. Vast: copy van producten.gewicht_kg (zelf '
  'cache). Service-items zonder artikelnr retourneren NULL. Mig 185.';

------------------------------------------------------------------------
-- 3. Triggers — cascade kwaliteit → producten → open order_regels
------------------------------------------------------------------------

-- 3a. Kwaliteit-update herrekent producten + open maatwerk-orderregels.
CREATE OR REPLACE FUNCTION trg_kwaliteit_gewicht_recalc()
RETURNS TRIGGER AS $$
BEGIN
  -- Update gederiveerde cache op alle vaste/staaltje-producten in deze kwaliteit.
  -- Trigger op producten (3b) cascadeert daarna naar open order_regels (vast).
  UPDATE producten p
  SET
    gewicht_kg = CASE
      WHEN p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL
        THEN ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * NEW.gewicht_per_m2_kg, 2)
      ELSE p.gewicht_kg
    END,
    gewicht_uit_kwaliteit = (
      p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL
    )
  WHERE p.kwaliteit_code = NEW.code
    AND p.product_type IN ('vast', 'staaltje');

  -- Update gederiveerde cache op open maatwerk-orderregels in deze kwaliteit.
  UPDATE order_regels ore
  SET gewicht_kg = CASE
    WHEN NEW.gewicht_per_m2_kg IS NOT NULL AND ore.maatwerk_oppervlak_m2 IS NOT NULL
      THEN ROUND(ore.maatwerk_oppervlak_m2 * NEW.gewicht_per_m2_kg, 2)
    ELSE NULL
  END
  FROM orders o
  WHERE ore.order_id = o.id
    AND ore.maatwerk_kwaliteit_code = NEW.code
    AND ore.is_maatwerk = true
    AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kwaliteit_gewicht_recalc ON kwaliteiten;
CREATE TRIGGER trg_kwaliteit_gewicht_recalc
  AFTER UPDATE OF gewicht_per_m2_kg ON kwaliteiten
  FOR EACH ROW
  WHEN (OLD.gewicht_per_m2_kg IS DISTINCT FROM NEW.gewicht_per_m2_kg)
  EXECUTE FUNCTION trg_kwaliteit_gewicht_recalc();

COMMENT ON TRIGGER trg_kwaliteit_gewicht_recalc ON kwaliteiten IS
  'Cascade: bij wijziging gewicht_per_m2_kg op kwaliteit, herrekent producten + '
  'open maatwerk-orderregels in die kwaliteit. Mig 185.';

-- 3b. Product-update cascadeert naar open vaste-orderregels met dat artikelnr.
CREATE OR REPLACE FUNCTION trg_product_gewicht_recalc()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE order_regels ore
  SET gewicht_kg = NEW.gewicht_kg
  FROM orders o
  WHERE ore.order_id = o.id
    AND ore.artikelnr = NEW.artikelnr
    AND ore.is_maatwerk = false
    AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_gewicht_recalc ON producten;
CREATE TRIGGER trg_product_gewicht_recalc
  AFTER UPDATE OF gewicht_kg ON producten
  FOR EACH ROW
  WHEN (OLD.gewicht_kg IS DISTINCT FROM NEW.gewicht_kg)
  EXECUTE FUNCTION trg_product_gewicht_recalc();

COMMENT ON TRIGGER trg_product_gewicht_recalc ON producten IS
  'Cascade: bij wijziging gewicht_kg op product, kopieert naar gewicht_kg op '
  'open vaste-orderregels met dat artikelnr. Mig 185.';

------------------------------------------------------------------------
-- 4. Eénmalige back-fill: pas modus-seed door tot producten + open orders.
--    Triggers vanaf nu actief; deze backfill brengt bestaande data in lijn.
------------------------------------------------------------------------

UPDATE producten p
SET
  gewicht_kg = ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * q.gewicht_per_m2_kg, 2),
  gewicht_uit_kwaliteit = true
FROM kwaliteiten q
WHERE p.kwaliteit_code = q.code
  AND p.product_type IN ('vast', 'staaltje')
  AND p.lengte_cm IS NOT NULL
  AND p.breedte_cm IS NOT NULL
  AND q.gewicht_per_m2_kg IS NOT NULL;

------------------------------------------------------------------------
-- 5. RPC `kleuren_voor_kwaliteit` — leest gewicht voortaan uit kwaliteiten.
--    Functie-body identiek aan mig 109, alleen één veld-bron gewijzigd:
--    `mp.gewicht_per_m2_kg` → SELECT uit kwaliteiten via parameter.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kleuren_voor_kwaliteit(p_kwaliteit TEXT)
RETURNS TABLE(
  kleur_code           TEXT,
  kleur_label          TEXT,
  omschrijving         TEXT,
  verkoopprijs_m2      NUMERIC,
  kostprijs_m2         NUMERIC,
  gewicht_per_m2_kg    NUMERIC,
  max_breedte_cm       INTEGER,
  artikelnr            TEXT,
  karpi_code           TEXT,
  aantal_rollen        INTEGER,
  beschikbaar_m2       NUMERIC,
  equiv_rollen         INTEGER,
  equiv_m2             NUMERIC,
  equiv_kwaliteit_code TEXT,
  equiv_artikelnr      TEXT,
  equiv_m2_prijs       NUMERIC
) AS $$
WITH
kwaliteit_density AS (
  SELECT gewicht_per_m2_kg FROM kwaliteiten WHERE code = p_kwaliteit
),
kleur_universe AS (
  SELECT kc FROM (
    SELECT mp.kleur_code AS kc FROM maatwerk_m2_prijzen mp
      WHERE mp.kwaliteit_code = p_kwaliteit
    UNION
    SELECT p.kleur_code FROM producten p
      WHERE p.kwaliteit_code = p_kwaliteit
        AND p.kleur_code IS NOT NULL
        AND p.actief = true
    UNION
    SELECT u.kleur_code FROM kwaliteit_kleur_uitwisselgroepen u
      WHERE u.kwaliteit_code = p_kwaliteit
  ) s
  WHERE kc IS NOT NULL
),
eigen_rollen AS (
  SELECT r.kleur_code,
         COUNT(*)::INTEGER                         AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM rollen r
  WHERE r.kwaliteit_code = p_kwaliteit
    AND r.status = 'beschikbaar'
    AND r.kleur_code IS NOT NULL
  GROUP BY r.kleur_code
),
uitwissel_koppel AS (
  SELECT u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND u2.kwaliteit_code <> u1.kwaliteit_code
  WHERE u1.kwaliteit_code = p_kwaliteit
),
uit_rollen_agg AS (
  SELECT uk.onze_kleur,
         uk.uit_kwaliteit,
         uk.uit_kleur,
         COUNT(r.id)::INTEGER                      AS aantal,
         COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS m2
  FROM uitwissel_koppel uk
  LEFT JOIN rollen r
    ON r.kwaliteit_code = uk.uit_kwaliteit
   AND r.kleur_code = uk.uit_kleur
   AND r.status = 'beschikbaar'
  GROUP BY uk.onze_kleur, uk.uit_kwaliteit, uk.uit_kleur
),
beste_uitwissel AS (
  SELECT DISTINCT ON (ura.onze_kleur)
    ura.onze_kleur,
    ura.uit_kwaliteit,
    ura.uit_kleur,
    ura.aantal,
    ura.m2
  FROM uit_rollen_agg ura
  WHERE ura.aantal > 0
  ORDER BY ura.onze_kleur, ura.m2 DESC, ura.uit_kwaliteit
),
uit_maatwerk_artikel AS (
  SELECT bu.onze_kleur,
         (
           SELECT p.artikelnr
           FROM producten p
           WHERE p.kwaliteit_code = bu.uit_kwaliteit
             AND p.kleur_code = bu.uit_kleur
             AND p.actief = true
             AND (p.product_type = 'overig'
                  OR p.karpi_code   ILIKE '%maatwerk%'
                  OR p.omschrijving ILIKE '%maatwerk%')
           ORDER BY
             (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
             (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
             (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
             p.artikelnr
           LIMIT 1
         ) AS artikelnr
  FROM beste_uitwissel bu
),
uit_m2_prijs AS (
  SELECT bu.onze_kleur,
         COALESCE(
           (SELECT mp.verkoopprijs_m2 FROM maatwerk_m2_prijzen mp
             WHERE mp.kwaliteit_code = bu.uit_kwaliteit AND mp.kleur_code = bu.uit_kleur LIMIT 1),
           (SELECT p.verkoopprijs FROM producten p
             WHERE p.kwaliteit_code = bu.uit_kwaliteit
               AND p.kleur_code = bu.uit_kleur
               AND p.actief = true
               AND (p.product_type = 'overig'
                    OR p.karpi_code   ILIKE '%maatwerk%'
                    OR p.omschrijving ILIKE '%maatwerk%')
             ORDER BY
               (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
               (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
               (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
               p.artikelnr
             LIMIT 1)
         ) AS prijs
  FROM beste_uitwissel bu
),
rol_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.artikelnr,
         p.karpi_code,
         p.omschrijving
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.product_type = 'rol'
    AND p.actief = true
  ORDER BY p.kleur_code, p.artikelnr
),
eigen_maatwerk_artikel AS (
  SELECT DISTINCT ON (p.kleur_code)
         p.kleur_code,
         p.verkoopprijs
  FROM producten p
  WHERE p.kwaliteit_code = p_kwaliteit
    AND p.actief = true
    AND (p.product_type = 'overig'
         OR p.karpi_code   ILIKE '%maatwerk%'
         OR p.omschrijving ILIKE '%maatwerk%')
  ORDER BY
    p.kleur_code,
    (CASE WHEN p.omschrijving ILIKE '%MAATWERK%' OR p.karpi_code ILIKE '%MAATWERK%' THEN 0 ELSE 1 END),
    (CASE WHEN p.verkoopprijs IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN p.product_type = 'overig' THEN 0 ELSE 1 END),
    p.artikelnr
)
SELECT
  ku.kc                                          AS kleur_code,
  REPLACE(ku.kc, '.0', '')                       AS kleur_label,
  COALESCE(ra.omschrijving, '')                  AS omschrijving,
  COALESCE(mp.verkoopprijs_m2, ema.verkoopprijs) AS verkoopprijs_m2,
  mp.kostprijs_m2                                AS kostprijs_m2,
  (SELECT gewicht_per_m2_kg FROM kwaliteit_density) AS gewicht_per_m2_kg,
  mp.max_breedte_cm                              AS max_breedte_cm,
  ra.artikelnr                                   AS artikelnr,
  ra.karpi_code                                  AS karpi_code,
  COALESCE(er.aantal, 0)                         AS aantal_rollen,
  COALESCE(er.m2, 0)                             AS beschikbaar_m2,
  COALESCE(bu.aantal, 0)                         AS equiv_rollen,
  COALESCE(bu.m2, 0)                             AS equiv_m2,
  bu.uit_kwaliteit                               AS equiv_kwaliteit_code,
  uma.artikelnr                                  AS equiv_artikelnr,
  ump.prijs                                      AS equiv_m2_prijs
FROM kleur_universe ku
LEFT JOIN maatwerk_m2_prijzen mp
       ON mp.kwaliteit_code = p_kwaliteit AND mp.kleur_code = ku.kc
LEFT JOIN rol_artikel ra             ON ra.kleur_code = ku.kc
LEFT JOIN eigen_rollen er            ON er.kleur_code = ku.kc
LEFT JOIN beste_uitwissel bu         ON bu.onze_kleur = ku.kc
LEFT JOIN uit_maatwerk_artikel uma   ON uma.onze_kleur = ku.kc
LEFT JOIN uit_m2_prijs ump           ON ump.onze_kleur = ku.kc
LEFT JOIN eigen_maatwerk_artikel ema ON ema.kleur_code = ku.kc
ORDER BY ku.kc;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION kleuren_voor_kwaliteit IS
  'Sinds mig 185: gewicht_per_m2_kg komt uit kwaliteiten (één bron-van-waarheid). '
  'Voorheen mig 109: uit maatwerk_m2_prijzen per kleur. Drop van die kolom in mig 186.';

COMMIT;
