-- Migratie 188: vorm-kolom + correcte gewicht-resolver voor ronde producten
--
-- Doel: rondes (karpi_code-suffix `\d{3}RND`) gebruikten bij mig 184/185 nog
-- de legacy `producten.gewicht_kg`-waarde omdat de regex `^.{8}\d{3}\d{3}$`
-- ze niet matchte. Resultaat: 160 RND en 200 RND tonen beide hetzelfde
-- placeholder-getal uit het oude systeem (vaak een willekeurige value zoals
-- 3.7 kg) i.p.v. het echte gewicht op basis van diameter.
--
-- Deze migratie:
--   1. Voegt `producten.vorm` toe (`rechthoek` | `rond`).
--   2. Parst RND-codes (1541 producten): zet `vorm='rond'`, vult `lengte_cm`
--      en `breedte_cm` met de diameter (zelfde waarde — gebruikt door de
--      resolver als d).
--   3. Parst OVL-codes (127 producten) uit de omschrijving (`NxN cm OVAAL`):
--      vult `lengte_cm` + `breedte_cm` als bbox. `vorm` blijft `rechthoek` —
--      we benaderen ovaal als bbox-rechthoek per beslissing van de owner.
--      Dit overschat het gewicht met factor 4/π (~27%) maar is consistent
--      met de keuze "alleen ronde producten krijgen aparte formule".
--   4. Vervangt `bereken_product_gewicht_kg` zodat `vorm='rond'` de cirkel-
--      formule π × (d/200)² × density gebruikt.
--   5. Vervangt `trg_kwaliteit_gewicht_recalc` met dezelfde vorm-logica.
--   6. Triggert herberekening: voor elke kwaliteit met `gewicht_per_m2_kg`
--      gevuld vuurt de update zichzelf opnieuw (no-op-update truc) zodat
--      alle RND/OVL-producten herrekend worden.

------------------------------------------------------------------------
-- 1. Vorm-kolom
------------------------------------------------------------------------

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS vorm TEXT NOT NULL DEFAULT 'rechthoek'
    CHECK (vorm IN ('rechthoek', 'rond'));

COMMENT ON COLUMN producten.vorm IS
  '`rechthoek` (default, ook voor ovaal — bbox-aanname) | `rond` (cirkel-'
  'oppervlak via π × (lengte_cm/200)²; lengte_cm = breedte_cm = diameter). '
  'Bepaalt welke formule `bereken_product_gewicht_kg` gebruikt. Mig 188.';

------------------------------------------------------------------------
-- 2. RND-codes parsen → vorm=rond + diameter in lengte_cm/breedte_cm
------------------------------------------------------------------------
-- Patroon: `KKKKllXXdddRND` (bv. LORA11XX160RND → diameter 160 cm).

UPDATE producten
SET
  vorm       = 'rond',
  lengte_cm  = (regexp_match(karpi_code, '^.{8}(\d{3})RND$'))[1]::INTEGER,
  breedte_cm = (regexp_match(karpi_code, '^.{8}(\d{3})RND$'))[1]::INTEGER
WHERE
  product_type IN ('vast', 'staaltje')
  AND karpi_code IS NOT NULL
  AND karpi_code ~ '^.{8}\d{3}RND$';

------------------------------------------------------------------------
-- 3. OVL-codes parsen uit omschrijving → bbox in lengte_cm/breedte_cm
------------------------------------------------------------------------
-- Patroon omschrijving: `... CA: NxN cm OVAAL` (bv. "DELICATE Kl.16 CA:
-- 240x290 cm OVAAL"). De karpi_code-suffix is alleen `dddOVL` met 1
-- dimensie, dus de echte bbox staat alleen in de omschrijving.
-- vorm blijft 'rechthoek' (default) — gebruiker accepteert bbox-overschat.

UPDATE producten
SET
  lengte_cm  = (regexp_match(omschrijving, '(\d+)\s*[xX]\s*(\d+)\s*cm\s*OVAAL'))[1]::INTEGER,
  breedte_cm = (regexp_match(omschrijving, '(\d+)\s*[xX]\s*(\d+)\s*cm\s*OVAAL'))[2]::INTEGER
WHERE
  product_type IN ('vast', 'staaltje')
  AND karpi_code IS NOT NULL
  AND karpi_code ~ '^.{8}\d{3}OVL$'
  AND omschrijving ~ '(\d+)\s*[xX]\s*(\d+)\s*cm\s*OVAAL';

------------------------------------------------------------------------
-- 4. Resolver: vorm-aware gewicht-berekening
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bereken_product_gewicht_kg(p_artikelnr TEXT)
RETURNS TABLE(gewicht_kg NUMERIC, uit_kwaliteit BOOLEAN) AS $$
DECLARE
  v_lengte INTEGER;
  v_breedte INTEGER;
  v_vorm TEXT;
  v_density NUMERIC;
  v_legacy_gewicht NUMERIC;
BEGIN
  SELECT p.lengte_cm, p.breedte_cm, p.vorm, q.gewicht_per_m2_kg, p.gewicht_kg
    INTO v_lengte, v_breedte, v_vorm, v_density, v_legacy_gewicht
  FROM producten p
  LEFT JOIN kwaliteiten q ON q.code = p.kwaliteit_code
  WHERE p.artikelnr = p_artikelnr;

  IF v_lengte IS NOT NULL AND v_breedte IS NOT NULL AND v_density IS NOT NULL THEN
    IF v_vorm = 'rond' THEN
      -- Cirkel: π × (diameter/200)² × density. lengte_cm = diameter (cm).
      RETURN QUERY SELECT
        ROUND(PI() * POWER(v_lengte::NUMERIC / 200.0, 2) * v_density, 2),
        true;
    ELSE
      -- Rechthoek (incl. ovaal-bbox): lengte × breedte / 10000 × density.
      RETURN QUERY SELECT
        ROUND((v_lengte::NUMERIC * v_breedte::NUMERIC / 10000.0) * v_density, 2),
        true;
    END IF;
  ELSE
    RETURN QUERY SELECT v_legacy_gewicht, false;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_product_gewicht_kg IS
  'Gewicht-resolver — gewicht (kg/stuk) voor een vast/staaltje-product. '
  'Vorm-aware sinds mig 188: `rond` → π × (lengte_cm/200)² × density; '
  '`rechthoek` (default, incl. ovaal-bbox) → lengte × breedte / 10000 × '
  'density. Bij volledige cache-bron retourneert (gewicht, true). Bij '
  'ontbrekende kwaliteit-density of maat-data retourneert (legacy_gewicht, '
  'false). Mig 185, vorm-logica toegevoegd in mig 188.';

------------------------------------------------------------------------
-- 5. Trigger: zelfde vorm-logica in cascade
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_kwaliteit_gewicht_recalc()
RETURNS TRIGGER AS $$
BEGIN
  -- Update gederiveerde cache op alle vaste/staaltje-producten in deze
  -- kwaliteit. Vorm-aware: rond gebruikt cirkel-oppervlak, anders bbox.
  -- Trigger op producten (3b) cascadeert daarna naar open order_regels.
  UPDATE producten p
  SET
    gewicht_kg = CASE
      WHEN p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL THEN
        CASE p.vorm
          WHEN 'rond' THEN ROUND(PI() * POWER(p.lengte_cm::NUMERIC / 200.0, 2) * NEW.gewicht_per_m2_kg, 2)
          ELSE          ROUND((p.lengte_cm::NUMERIC * p.breedte_cm::NUMERIC / 10000.0) * NEW.gewicht_per_m2_kg, 2)
        END
      ELSE p.gewicht_kg
    END,
    gewicht_uit_kwaliteit = (
      p.lengte_cm IS NOT NULL AND p.breedte_cm IS NOT NULL AND NEW.gewicht_per_m2_kg IS NOT NULL
    )
  WHERE p.kwaliteit_code = NEW.code
    AND p.product_type IN ('vast', 'staaltje');

  -- Update gederiveerde cache op open maatwerk-orderregels in deze
  -- kwaliteit. Maatwerk-orderregels gebruiken `maatwerk_oppervlak_m2`,
  -- al gehandled door vorm-maatwerk feature (mig 179-183) — dus geen
  -- vorm-keuze nodig hier.
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

COMMENT ON FUNCTION trg_kwaliteit_gewicht_recalc IS
  'Cascade: bij wijziging gewicht_per_m2_kg op kwaliteit, herrekent producten '
  '(vorm-aware sinds mig 188) + open maatwerk-orderregels in die kwaliteit.';

------------------------------------------------------------------------
-- 6. Herberekening: trigger no-op-update voor alle gevulde kwaliteiten
------------------------------------------------------------------------
-- Self-update fired om de nieuwe vorm-aware formule toe te passen op
-- bestaande RND/OVL-producten (en alle andere — idempotent).
-- Filter: alleen kwaliteiten met density > 0 (geen no-ops voor NULL).

UPDATE kwaliteiten
SET gewicht_per_m2_kg = gewicht_per_m2_kg
WHERE gewicht_per_m2_kg IS NOT NULL;

------------------------------------------------------------------------
-- 7. Verifier-rapport
------------------------------------------------------------------------

DO $$
DECLARE
  v_rond INTEGER;
  v_ovl_geparsed INTEGER;
  v_uit_kw INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_rond FROM producten WHERE vorm = 'rond';
  SELECT COUNT(*) INTO v_ovl_geparsed FROM producten
    WHERE karpi_code ~ '^.{8}\d{3}OVL$' AND lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL;
  SELECT COUNT(*) INTO v_uit_kw FROM producten
    WHERE product_type IN ('vast', 'staaltje') AND gewicht_uit_kwaliteit = true;

  RAISE NOTICE 'Mig 188 verifier:';
  RAISE NOTICE '  Producten met vorm=rond: %', v_rond;
  RAISE NOTICE '  OVL-producten met bbox uit omschrijving: %', v_ovl_geparsed;
  RAISE NOTICE '  Totaal vast/staaltje met gewicht_uit_kwaliteit=true: %', v_uit_kw;
END $$;
