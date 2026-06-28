-- Migratie 523: portal-updates van leverancier propageren naar inkooporders-niveau
--
-- Probleem (gevonden 2026-06-28):
--   update_regel_eta (mig 326) updatet inkooporder_regels.verwacht_datum en triggert
--   order-herberekening, maar schrijft NIET terug naar inkooporders.verwacht_datum.
--   De /inkoop-pagina toont inkooporders.verwacht_datum — dus wat Zhang Qi (Henan)
--   via het portal invoert was wél leidend voor de allocator, maar NIET zichtbaar
--   op het inkoopoverzicht.
--
-- Oplossing:
--   Na elke regel-update berekent update_regel_eta de MAX(verwacht_datum) over alle
--   regels van die IO en schrijft dat terug naar inkooporders.verwacht_datum +
--   inkooporders.leverweek. Hierdoor is de portal-invoer meteen zichtbaar op /inkoop.
--
-- Backfill (onderaan):
--   75 open Henan IOs waarvan de orderdatum afwijkt van de MAX(regel-datum) worden
--   eenmalig gesynchroniseerd. Geen order-retrigger nodig — de allocator gebruikte
--   al de juiste regel-niveau datums (inkooporder_regels.verwacht_datum).

-- ── 1. update_regel_eta uitbreiden met IO-niveau propagatie ──────────────────
--
-- CREATE OR REPLACE is safe: signatuur ongewijzigd t.o.v. mig 326.
-- Twee nieuwe DECLARE-variabelen: v_inkooporder_id + v_max_regel_datum.

CREATE OR REPLACE FUNCTION update_regel_eta(
  p_regel_id          BIGINT,
  p_verwacht_datum    DATE,
  p_door              TEXT,         -- 'karpi' | 'leverancier'
  p_leverancier_id    BIGINT DEFAULT NULL,
  p_portal_token      UUID   DEFAULT NULL,
  p_notitie           TEXT   DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_leverancier_id     BIGINT;
  v_order_id           BIGINT;
  v_oude_afleverdatum  DATE;
  v_inkooporder_id     BIGINT;
  v_max_regel_datum    DATE;
BEGIN
  -- Resolve leverancier_id vanuit token als die wordt gebruikt
  IF p_portal_token IS NOT NULL THEN
    SELECT id INTO v_leverancier_id FROM leveranciers WHERE portal_token = p_portal_token;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ongeldig portal token';
    END IF;
  ELSE
    v_leverancier_id := p_leverancier_id;
  END IF;

  -- Verificeer dat de regel bij deze leverancier hoort
  IF v_leverancier_id IS NOT NULL THEN
    PERFORM 1
      FROM inkooporder_regels r
      JOIN inkooporders o ON o.id = r.inkooporder_id
     WHERE r.id = p_regel_id
       AND o.leverancier_id = v_leverancier_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Regel % hoort niet bij leverancier %', p_regel_id, v_leverancier_id;
    END IF;
  END IF;

  IF p_door NOT IN ('karpi', 'leverancier') THEN
    RAISE EXCEPTION 'p_door moet ''karpi'' of ''leverancier'' zijn';
  END IF;

  -- Update de ETA op de inkooporder_regel
  UPDATE inkooporder_regels
  SET
    verwacht_datum      = p_verwacht_datum,
    eta_bijgewerkt_door = p_door,
    eta_bijgewerkt_op   = NOW(),
    leverancier_notitie = COALESCE(p_notitie, leverancier_notitie)
  WHERE id = p_regel_id
  RETURNING inkooporder_id INTO v_inkooporder_id;

  -- ── NIEUW (mig 523): propageer MAX(regel.verwacht_datum) naar order-niveau ──
  -- De /inkoop-pagina toont inkooporders.verwacht_datum. Zonder deze stap is wat
  -- de leverancier via het portal invoert niet zichtbaar op het inkoopoverzicht.
  -- MAX over ALLE regels van de IO (niet alleen open) zodat een volledige IO die
  -- al gedeeltelijk ontvangen is de juiste einddatum toont.
  SELECT MAX(verwacht_datum)
    INTO v_max_regel_datum
    FROM inkooporder_regels
   WHERE inkooporder_id = v_inkooporder_id
     AND verwacht_datum IS NOT NULL;

  IF v_max_regel_datum IS NOT NULL THEN
    UPDATE inkooporders
       SET verwacht_datum = v_max_regel_datum,
           -- leverweek afleiden als "W/YYYY" (ISO, geen leading zero) zodat de
           -- display consistent blijft met de import-notatie ("30/2026" etc.)
           leverweek = to_char(v_max_regel_datum, 'IW')::int::text
                       || '/' || to_char(v_max_regel_datum, 'IYYY')
     WHERE id = v_inkooporder_id;
  END IF;
  -- ── einde nieuw blok ────────────────────────────────────────────────────────

  -- Propageer naar alle orderregels met een actieve IO-claim op deze IO-regel:
  -- 1. Herbereken allocaties voor de betreffende orderregel
  -- 2. Sync afleverdatum bidirectioneel (ETA + buffer) naar de order, met
  --    signalering bij leverweek-verschuiving (mig 326) — context (regel + door)
  --    wordt meegegeven voor de audit-metadata.
  FOR v_order_id IN
    SELECT DISTINCT oreg.order_id
      FROM order_reserveringen r
      JOIN order_regels oreg ON oreg.id = r.order_regel_id
     WHERE r.inkooporder_regel_id = p_regel_id
       AND r.status = 'actief'
       AND r.bron = 'inkooporder_regel'
  LOOP
    -- Snapshot VÓÓR herallocateer_orderregel (mig 326): dat pad triggert zelf al
    -- herwaardeer_order_status -> sync_order_afleverdatum_met_claims (forward-only),
    -- die bij een latere ETA de afleverdatum al naar voren kan schuiven — waardoor
    -- de "voor"-waarde verloren zou gaan als we die pas ná allocatie zouden lezen.
    SELECT afleverdatum INTO v_oude_afleverdatum FROM orders WHERE id = v_order_id;

    -- Alleen de orderregels heralloceren die deze IO-regel claimen
    PERFORM herallocateer_orderregel(r2.order_regel_id)
      FROM order_reserveringen r2
      JOIN order_regels oreg2 ON oreg2.id = r2.order_regel_id
     WHERE r2.inkooporder_regel_id = p_regel_id
       AND r2.status = 'actief'
       AND r2.bron = 'inkooporder_regel'
       AND oreg2.order_id = v_order_id;

    -- Bidirectionele datum-sync + signalering na allocatie, met de pré-allocatie
    -- snapshot als betrouwbare "voor"-waarde voor de vergelijking.
    PERFORM sync_order_afleverdatum_eta(v_order_id, p_regel_id, p_door, v_oude_afleverdatum);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_regel_eta IS
  'Update ETA op inkooporder_regel en propageert naar afleverdatum '
  'van alle getroffen orders (bidirectioneel + signalering bij leverweek-wijziging, '
  'mig 319/326). Schrijft tevens MAX(regel.verwacht_datum) terug naar '
  'inkooporders.verwacht_datum + leverweek zodat het inkoopoverzicht (/inkoop) '
  'de leverancier-invoer direct toont (mig 523). '
  'Valideert token/leverancier-eigenaarschap.';


-- ── 2. Backfill: 75 open Henan IOs synchroniseren ───────────────────────────
--
-- Alle open Henan-IOs (leverancier_id = 9, status Besteld/Deels ontvangen)
-- waarvan inkooporders.verwacht_datum afwijkt van MAX(inkooporder_regels.verwacht_datum)
-- worden eenmalig bijgewerkt. De allocator gebruikte al de juiste regel-datums,
-- dus afhankelijke verkooporders hoeven NIET opnieuw getriggerd te worden —
-- dit is puur een display-fix voor het inkoopoverzicht.

WITH max_per_io AS (
  SELECT
    ior.inkooporder_id,
    MAX(ior.verwacht_datum) AS max_datum
  FROM inkooporder_regels ior
  JOIN inkooporders io ON io.id = ior.inkooporder_id
  WHERE io.leverancier_id = 9               -- HENAN BEST INT. TRADINGCO.,LTD
    AND io.status IN ('Besteld', 'Deels ontvangen')
    AND ior.verwacht_datum IS NOT NULL
  GROUP BY ior.inkooporder_id
)
UPDATE inkooporders io
SET
  verwacht_datum = m.max_datum,
  leverweek      = to_char(m.max_datum, 'IW')::int::text
                   || '/' || to_char(m.max_datum, 'IYYY')
FROM max_per_io m
WHERE io.id = m.inkooporder_id
  AND io.verwacht_datum IS DISTINCT FROM m.max_datum;
