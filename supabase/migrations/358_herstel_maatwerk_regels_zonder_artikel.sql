-- Migratie 358: generiek herstel — maatwerk-orderregels zonder artikelnr
--
-- Vervolg op mig 356 (die herstelde 3 specifieke productie-regels). Aanleiding:
-- eigenaar-besluit n.a.v. bug phdobbe (ORD-2026-0166, ORD-2026-0188) — ook
-- handmatige op-maat-regels uit het orderformulier landden zonder artikelnr
-- (kwaliteit-first-selector koppelde het ROL-product-artikelnr, dat NULL is
-- als er geen rol-product bestaat). Frontend-fix zit in dezelfde branch
-- (`fix/maatwerk-form-artikel`); deze migratie herstelt de bestaande data
-- generiek i.p.v. per order.
--
-- Logica: elke `order_regels`-rij met `is_maatwerk = TRUE AND artikelnr IS
-- NULL` in een open order (status niet Verzonden/Geannuleerd) die NIET
-- productie-only is (ADR-0029: `alleen_productie`-orders blijven bewust
-- artikel-loos — facturatie loopt via Basta) en waarvan kwaliteit+kleur
-- gevuld zijn, wordt gekoppeld aan het generieke MAATWERK-artikel met EXACT
-- dezelfde kwaliteit+kleur (omschrijving-patroon `^[A-Z]+[0-9]+MAATWERK$`,
-- spiegelt mig 106/356a). Geen uitwissel- of andere-kleur-fallback: alleen
-- een exacte match mag de facturatie-artikelnr leveren. De kandidaat-set is
-- bovendien beperkt tot actieve, niet-pseudo producten (`actief = TRUE AND
-- NOT is_pseudo`) — consistent met de frontend-helper
-- `fetchMaatwerkArtikelExact` en de mig 356a-kandidatenset.
--
-- Daarnaast: regel-karpi_code wordt op de catalogus-karpi_code gezet wanneer
-- die NULL is of gelijk aan de kale `{KWAL}{KLEUR}`-concat (de oude
-- formulier-fallback die "VERR14"-achtige regel-codes opleverde).
--
-- Idempotent: raakt alleen rijen met artikelnr IS NULL; herdraaien = no-op.
-- Geen aannames over row counts: geen passend product → NOTICE + skip.
-- Zelf-test is informatief (NOTICE, geen EXCEPTION) — onbekende data.

BEGIN;

DO $$
DECLARE
  r                 RECORD;
  v_art_nr          TEXT;
  v_art_karpi       TEXT;
  v_kleur_norm      TEXT;
  v_gekoppeld       INT := 0;
  v_geen_product    INT := 0;
  v_geskipt_codes   INT := 0;
  v_geen_detail     TEXT := NULL;
BEGIN
  FOR r IN
    SELECT reg.id, reg.regelnummer, reg.karpi_code,
           reg.maatwerk_kwaliteit_code AS kwal,
           reg.maatwerk_kleur_code     AS kleur,
           o.order_nr
    FROM order_regels reg
    JOIN orders o ON o.id = reg.order_id
    WHERE reg.is_maatwerk = TRUE
      AND reg.artikelnr IS NULL
      AND o.status NOT IN ('Verzonden', 'Geannuleerd')
      AND COALESCE(o.alleen_productie, FALSE) = FALSE
    ORDER BY o.order_nr, reg.regelnummer
  LOOP
    -- Zonder kwaliteit+kleur valt er niets te matchen — skip + tellen.
    IF r.kwal IS NULL OR btrim(r.kwal) = '' OR r.kleur IS NULL OR btrim(r.kleur) = '' THEN
      v_geskipt_codes := v_geskipt_codes + 1;
      CONTINUE;
    END IF;

    -- Kleur `.0`-tolerant in BEIDE richtingen (regel '16' vs product '16.0'
    -- en omgekeerd) door beide kanten te normaliseren — superset van de
    -- IN (x, strip(x))-vorm, want product-kleur_codes dragen óók het
    -- `.0`-import-artefact. ORDER BY artikelnr: deterministisch (mig 356).
    v_kleur_norm := regexp_replace(r.kleur, '\.0$', '');
    SELECT p.artikelnr, p.karpi_code
    INTO v_art_nr, v_art_karpi
    FROM producten p
    WHERE p.kwaliteit_code = r.kwal
      AND regexp_replace(p.kleur_code, '\.0$', '') = v_kleur_norm
      AND p.omschrijving ~ '^[A-Z]+[0-9]+MAATWERK$'
      AND p.actief = TRUE
      AND COALESCE(p.is_pseudo, FALSE) = FALSE
    ORDER BY p.artikelnr
    LIMIT 1;

    IF v_art_nr IS NULL THEN
      v_geen_product := v_geen_product + 1;
      IF v_geen_product <= 20 THEN
        v_geen_detail := COALESCE(v_geen_detail || ', ', '')
          || r.order_nr || ' regel ' || r.regelnummer || ' (' || r.kwal || '/' || r.kleur || ')';
      END IF;
      CONTINUE;
    END IF;

    -- karpi_code alleen meenemen als de regel-code NULL is of de kale
    -- `{KWAL}{KLEUR}`-concat (beide kleurvarianten) — een afwijkende,
    -- bewust gezette code blijft staan.
    UPDATE order_regels reg
    SET artikelnr  = v_art_nr,
        karpi_code = CASE
          WHEN (reg.karpi_code IS NULL
                OR reg.karpi_code IN (r.kwal || r.kleur, r.kwal || v_kleur_norm))
            THEN COALESCE(v_art_karpi, reg.karpi_code)
          ELSE reg.karpi_code
        END
    WHERE reg.id = r.id
      AND reg.artikelnr IS NULL;  -- idempotentie-guard (concurrent herstel)

    v_gekoppeld := v_gekoppeld + 1;
  END LOOP;

  RAISE NOTICE 'Mig 358: % regel(s) gekoppeld, % zonder passend MAATWERK-product, % geskipt (kwaliteit/kleur ontbreekt)',
    v_gekoppeld, v_geen_product, v_geskipt_codes;
  IF v_geen_product > 0 THEN
    RAISE NOTICE 'Mig 358: geen product gevonden voor (max 20): %', v_geen_detail;
  END IF;
END $$;

-- ============================================================================
-- Zelf-test (informatief): hoeveel artikel-loze maatwerk-regels resteren er in
-- open, niet-productie-only orders? Géén EXCEPTION — een ontbrekend
-- catalogus-product of ontbrekende codes zijn data-condities die deze
-- migratie niet kan oplossen (zie NOTICE-skips hierboven).
-- ============================================================================
DO $$
DECLARE
  v_rest   INT;
  v_detail TEXT;
BEGIN
  SELECT COUNT(*),
         string_agg(o.order_nr || ' regel ' || reg.regelnummer, ', ' ORDER BY o.order_nr, reg.regelnummer)
  INTO v_rest, v_detail
  FROM order_regels reg
  JOIN orders o ON o.id = reg.order_id
  WHERE reg.is_maatwerk = TRUE
    AND reg.artikelnr IS NULL
    AND o.status NOT IN ('Verzonden', 'Geannuleerd')
    AND COALESCE(o.alleen_productie, FALSE) = FALSE;

  IF v_rest = 0 THEN
    RAISE NOTICE 'Mig 358: zelf-test OK — geen open maatwerk-regels zonder artikelnr meer (excl. productie-only)';
  ELSE
    RAISE NOTICE 'Mig 358: LET OP — nog % open maatwerk-regel(s) zonder artikelnr: % (zie skip-NOTICEs hierboven)',
      v_rest, v_detail;
  END IF;
END $$;

COMMIT;
