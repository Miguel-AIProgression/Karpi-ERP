-- Migratie 307: EDI debiteur-GLN-alias (meerdere factuur-GLN's per debiteur)
--
-- Context (2026-06-04):
--   BDSK/XXXLutz (#600556) is de centrale debiteur voor de hele groep: orders
--   matchen op de gefactureerd-GLN 9007019015989 (= debiteuren.gln_bedrijf), de
--   besteller/aflever-GLN's zijn wisselende filiaalcodes en tellen niet voor de
--   match. Eén order (klant-PO 8NLMC, bericht 21) kwam binnen met een AFWIJKENDE
--   gefactureerd-GLN 9007019010007 die nergens in onze data staat → matchDebiteur
--   faalde en de order bleef op order_id IS NULL liggen.
--
--   Dit is geen Hornbach-vestiging-geval (mig 306, aflever-GLN onthouden op een
--   afleveradres), maar een tweede FACTUUR-entiteit van dezelfde debiteur. Het
--   afleveradres wisselt per order, dus aflever-GLN onthouden lost niets terugkerend
--   op — de factuur-GLN moet als alias van de debiteur gelden.
--
-- Oplossing:
--   Tabel `debiteur_gln_aliassen` koppelt extra GLN's aan een debiteur. matchDebiteur
--   (transus-poll) raadpleegt deze tabel ná debiteuren.gln_bedrijf. RPC
--   `koppel_edi_debiteur_alias` legt de alias vast, koppelt de debiteur aan het
--   bericht en maakt de order aan via create_edi_order (mig 158) — die zonder
--   afleveradres-match netjes terugvalt op het debiteur-adres als afl-snapshot.
--
-- Idempotent.

-- ============================================================================
-- 1. Alias-tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS debiteur_gln_aliassen (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  debiteur_nr INTEGER NOT NULL REFERENCES debiteuren(debiteur_nr) ON DELETE CASCADE,
  gln         TEXT    NOT NULL,
  -- Welke rol deze GLN in de order-header speelt. V1 alleen 'gefactureerd';
  -- 'besteller' staat klaar voor toekomstige centrale-bestel-patronen.
  rol         TEXT    NOT NULL DEFAULT 'gefactureerd'
              CHECK (rol IN ('gefactureerd', 'besteller')),
  reden       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Een GLN identificeert één entiteit → uniek aan één debiteur.
  UNIQUE (gln)
);

CREATE INDEX IF NOT EXISTS idx_debiteur_gln_aliassen_debiteur
  ON debiteur_gln_aliassen (debiteur_nr);

COMMENT ON TABLE debiteur_gln_aliassen IS
  'Extra GLN''s die aan een debiteur toebehoren naast debiteuren.gln_bedrijf '
  '(mig 307). Bedient centrale facturatie met meerdere factuur-entiteiten, bv. '
  'BDSK/XXXLutz. matchDebiteur (transus-poll) raadpleegt deze tabel na het '
  'hoofd-GLN. Een GLN is uniek aan één debiteur.';

-- RLS (consistent met edi_handelspartner_config, mig 156: authenticated = volledige
-- toegang). De edge function gebruikt service_role (bypasst RLS); de frontend leest
-- niet direct maar via de SECURITY DEFINER-RPC hieronder.
ALTER TABLE debiteur_gln_aliassen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debiteur_gln_aliassen_select ON debiteur_gln_aliassen;
CREATE POLICY debiteur_gln_aliassen_select
  ON debiteur_gln_aliassen FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS debiteur_gln_aliassen_insert ON debiteur_gln_aliassen;
CREATE POLICY debiteur_gln_aliassen_insert
  ON debiteur_gln_aliassen FOR INSERT
  TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS debiteur_gln_aliassen_update ON debiteur_gln_aliassen;
CREATE POLICY debiteur_gln_aliassen_update
  ON debiteur_gln_aliassen FOR UPDATE
  TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS debiteur_gln_aliassen_delete ON debiteur_gln_aliassen;
CREATE POLICY debiteur_gln_aliassen_delete
  ON debiteur_gln_aliassen FOR DELETE
  TO authenticated USING (TRUE);

-- ============================================================================
-- 2. RPC: koppel een bericht via een (nieuwe) factuur-GLN-alias
-- ============================================================================
CREATE OR REPLACE FUNCTION koppel_edi_debiteur_alias(
  p_bericht_id  BIGINT,
  p_debiteur_nr INTEGER,
  p_gln         TEXT,
  p_reden       TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_payload     JSONB;
  v_richting    TEXT;
  v_berichttype TEXT;
  v_deb_status  TEXT;
  v_gln         TEXT := NULLIF(btrim(p_gln), '');
  v_botst_deb   INTEGER;
  v_order_id    BIGINT;
BEGIN
  SELECT payload_parsed, richting, berichttype
    INTO v_payload, v_richting, v_berichttype
    FROM edi_berichten
   WHERE id = p_bericht_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'EDI-bericht % niet gevonden of zonder geparseerde payload', p_bericht_id;
  END IF;
  IF v_richting <> 'in' OR v_berichttype <> 'order' THEN
    RAISE EXCEPTION 'Koppelen kan alleen voor een inkomende order (bericht % is %/%)',
      p_bericht_id, v_richting, v_berichttype;
  END IF;
  IF v_gln IS NULL THEN
    RAISE EXCEPTION 'Geen GLN opgegeven om als alias vast te leggen';
  END IF;

  SELECT status INTO v_deb_status FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF v_deb_status IS NULL THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  -- Guard: GLN mag niet al aan een ándere debiteur hangen (als alias of hoofd-GLN).
  SELECT debiteur_nr INTO v_botst_deb
    FROM debiteur_gln_aliassen
   WHERE gln IN (v_gln, v_gln || '.0') AND debiteur_nr <> p_debiteur_nr
   LIMIT 1;
  IF v_botst_deb IS NOT NULL THEN
    RAISE EXCEPTION 'GLN % is al alias van debiteur % — corrigeer dat eerst', v_gln, v_botst_deb;
  END IF;

  SELECT debiteur_nr INTO v_botst_deb
    FROM debiteuren
   WHERE gln_bedrijf IN (v_gln, v_gln || '.0') AND debiteur_nr <> p_debiteur_nr
   LIMIT 1;
  IF v_botst_deb IS NOT NULL THEN
    RAISE EXCEPTION 'GLN % is het hoofd-GLN van debiteur % — koppel daar de order aan', v_gln, v_botst_deb;
  END IF;

  -- Alias vastleggen (idempotent: zelfde GLN → geen dubbele rij).
  INSERT INTO debiteur_gln_aliassen (debiteur_nr, gln, rol, reden)
  VALUES (p_debiteur_nr, v_gln, 'gefactureerd', p_reden)
  ON CONFLICT (gln) DO NOTHING;

  -- Debiteur aan het bericht koppelen + foutstatus opschonen.
  UPDATE edi_berichten
     SET debiteur_nr = p_debiteur_nr,
         status = 'Verwerkt',
         error_msg = NULL
   WHERE id = p_bericht_id;

  -- Order aanmaken (of bestaande teruggeven). create_edi_order valt zonder
  -- afleveradres-match terug op het debiteur-adres als afl-snapshot.
  v_order_id := create_edi_order(p_bericht_id, v_payload, p_debiteur_nr);

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION koppel_edi_debiteur_alias(BIGINT, INTEGER, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION koppel_edi_debiteur_alias IS
  'EDI-koppeling op factuur-GLN (mig 307): legt een onbekende gefactureerd/besteller-'
  'GLN vast als alias van een debiteur (debiteur_gln_aliassen), zet '
  'edi_berichten.debiteur_nr en roept create_edi_order aan. Voor centrale facturatie '
  'met meerdere factuur-entiteiten (BDSK/XXXLutz). Idempotent. Guard: GLN mag niet al '
  'aan een andere debiteur hangen.';
