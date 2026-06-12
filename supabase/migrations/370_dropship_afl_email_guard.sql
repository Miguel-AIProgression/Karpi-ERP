-- Migratie 370: dropshipment-herkenning + guard op het track & trace-e-mailadres
-- (hernummerd van 368 → 370 vóór merge: origin/main nam parallel 368 in
--  beslag met 368_intake_email_snapshots.sql. Inhoudelijk identiek aan wat
--  op 11-06-2026 als "368" live is uitgevoerd in de SQL-editor.)
--
-- Aanleiding (mail Marjon, Sales Support, 11-06-2026): bij een dropshipment-
-- order levert Karpi rechtstreeks aan de consument namens de debiteur (winkel).
-- Het aflever-e-mailadres (orders.afl_email → zendingen.afl_email → HST
-- ToAddress.Email, mig 364/365) moet dan het CONSUMENT-adres zijn — per
-- definitie een ander adres dan het factuur-/debiteur-e-mailadres. Het
-- orderformulier defaultte afl_email echter uit debiteuren.email_overig, en
-- de backfill (mig 367) deed hetzelfde op bestaande orders: de winkel kreeg
-- de track & trace, de consument niets.
--
-- Vier stappen:
--   1. producten.is_dropship — herkenning als data, geen string-lijst in code
--      (zelfde patroon als producten.is_pseudo, ADR-0018). Nieuw dropship-
--      artikel toevoegen = UPDATE producten, geen migratie.
--   2. Predicaat is_dropship_order(order_id) — SQL-spiegel van de TS-helper
--      detecteerDropshipKeuze (frontend/src/lib/orders/dropshipment-regel.ts).
--   3. fn_zending_fill_email (mig 365) krijgt een dropship-guard: het order-
--      afl_email wordt NIET naar de zending gekopieerd als het gelijk is aan
--      het factuur- of debiteur-e-mailadres — dan liever géén T&T-mail dan
--      een T&T naar de winkel. Defense-in-depth naast de form-validatie.
--   4. Data-fix: open dropship-orders (en hun nog niet verstuurde zendingen)
--      waar afl_email gelijk is aan het factuur-/debiteur-adres → NULL.
--      De operator vult het consument-adres aan via order bewerken (rose
--      hint op order-detail + orderformulier).
--
-- TS-spiegel: frontend/src/lib/orders/dropship-email.ts
-- Idempotent.

-- ── 1. Herkenning: producten.is_dropship ────────────────────────────────────

ALTER TABLE producten ADD COLUMN IF NOT EXISTS is_dropship BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN producten.is_dropship IS
  'Dropshipment-kostenregel (mig 370): order met zo''n regel wordt rechtstreeks '
  'aan de consument geleverd. afl_email moet dan het consument-adres zijn, '
  'nooit het factuur-/debiteur-adres. Zie is_dropship_order().';

UPDATE producten
   SET is_dropship = TRUE
 WHERE artikelnr IN ('DROPSHIP-KLEIN', 'DROPSHIP-GROOT')
   AND is_dropship IS DISTINCT FROM TRUE;

-- ── 2. Predicaat ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_dropship_order(p_order_id BIGINT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
      FROM order_regels r
      JOIN producten p ON p.artikelnr = r.artikelnr
     WHERE r.order_id = p_order_id
       AND p.is_dropship
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION is_dropship_order(BIGINT) IS
  'TRUE als de order een dropshipment-kostenregel bevat (producten.is_dropship, '
  'mig 370). SQL-spiegel van TS detecteerDropshipKeuze.';

-- ── 3. Dropship-guard in de zending-e-mail-trigger (herdefinitie mig 365) ────

CREATE OR REPLACE FUNCTION fn_zending_fill_email() RETURNS TRIGGER AS $$
DECLARE
  v_afl_email   TEXT;
  v_fact_email  TEXT;
  v_debiteur_nr INTEGER;
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_email, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_email,  '')), ''),
         NULLIF(TRIM(COALESCE(o.fact_email, '')), ''),
         o.debiteur_nr
    INTO v_afl_email, v_fact_email, v_debiteur_nr
    FROM orders o
   WHERE o.id = NEW.order_id;

  IF v_afl_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dropshipment-guard (mig 370): een factuur-/debiteur-adres mag nooit als
  -- T&T-adres bij de vervoerder belanden — de consument is de ontvanger.
  -- Liever geen T&T-mail dan een T&T naar de winkel.
  IF is_dropship_order(NEW.order_id) THEN
    IF LOWER(v_afl_email) = LOWER(COALESCE(v_fact_email, '')) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM debiteuren d
       WHERE d.debiteur_nr = v_debiteur_nr
         AND LOWER(v_afl_email) IN (
               LOWER(TRIM(COALESCE(d.email_factuur, ''))),
               LOWER(TRIM(COALESCE(d.email_overig,  '')))
             )
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.afl_email := v_afl_email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_zending_fill_email() IS
  'Vult zendingen.afl_email uit orders.afl_email (mig 365). Sinds mig 370 met '
  'dropship-guard: bij dropshipment-orders wordt een afl_email dat gelijk is '
  'aan het factuur-/debiteur-e-mailadres NIET gekopieerd.';

-- ── 4. Data-fix: foutief gedefaulte/gebackfillde adressen leegmaken ──────────

-- Open dropship-orders waarvan afl_email het factuur- of debiteur-adres is.
UPDATE orders o
   SET afl_email = NULL
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NOT NULL
   AND is_dropship_order(o.id)
   AND (
         LOWER(TRIM(o.afl_email)) = LOWER(TRIM(COALESCE(o.fact_email, '')))
      OR EXISTS (
           SELECT 1
             FROM debiteuren d
            WHERE d.debiteur_nr = o.debiteur_nr
              AND LOWER(TRIM(o.afl_email)) IN (
                    LOWER(TRIM(COALESCE(d.email_factuur, ''))),
                    LOWER(TRIM(COALESCE(d.email_overig,  '')))
                  )
         )
       );

-- Idem voor de zending-snapshots die nog niet onderweg zijn.
UPDATE zendingen z
   SET afl_email = NULL
  FROM orders o
 WHERE o.id = z.order_id
   AND z.status NOT IN ('Onderweg', 'Afgeleverd')
   AND NULLIF(TRIM(COALESCE(z.afl_email, '')), '') IS NOT NULL
   AND is_dropship_order(o.id)
   AND (
         LOWER(TRIM(z.afl_email)) = LOWER(TRIM(COALESCE(o.fact_email, '')))
      OR EXISTS (
           SELECT 1
             FROM debiteuren d
            WHERE d.debiteur_nr = o.debiteur_nr
              AND LOWER(TRIM(z.afl_email)) IN (
                    LOWER(TRIM(COALESCE(d.email_factuur, ''))),
                    LOWER(TRIM(COALESCE(d.email_overig,  '')))
                  )
         )
       );

NOTIFY pgrst, 'reload schema';
