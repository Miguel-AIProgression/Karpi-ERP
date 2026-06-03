-- Migratie 304: HST-vrachtbrief PDF opslaan + automatisch koppelen aan order
--
-- Waarom
-- ------
-- HST stuurt na een succesvolle POST een base64-PDF mee (vrachtbrief/label) in
-- het response-veld `PDFDocument.Contents`. Tot nu toe stripten we die uit
-- `response_payload` om de DB-rij compact te houden — de PDF verdween dus.
--
-- Vanaf nu uploadt de edge function de PDF naar de bestaande `order-documenten`-
-- bucket (mig 178) en legt het pad vast op `hst_transportorders.pdf_path`. Een
-- trigger spiegelt vervolgens automatisch één rij naar `order_documenten` voor
-- de primaire order van de zending. Resultaat: de vrachtbrief verschijnt
-- automatisch in de bestaande `<DocumentenCompact kind="order" />` widget op
-- order-detail, géén nieuwe UI nodig.
--
-- Scope-keuze
-- -----------
-- V1 koppelt aan ÉÉN order per zending (de primaire — meest voorkomend, 1-op-1).
-- Voor bundle-zendingen (mig 222: 1 zending = N orders zelfde adres+week) ziet
-- alleen de primaire order de PDF in DocumentenCompact; de andere bundle-orders
-- moeten via de zending-pagina. `order_documenten.storage_path UNIQUE` blokkeert
-- duplicate-koppeling — die globale uniqueness niet doorbreken voor één edge case.
-- Bundle-fan-out = V2-backlog wanneer het pijn doet.
--
-- Idempotent.

-- ============================================================================
-- 1. Kolommen op hst_transportorders
-- ============================================================================
ALTER TABLE hst_transportorders
  ADD COLUMN IF NOT EXISTS pdf_path        TEXT,
  ADD COLUMN IF NOT EXISTS pdf_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN hst_transportorders.pdf_path IS
  'Storage-pad in bucket "order-documenten" naar de HST-vrachtbrief (PDF). '
  'Convention: hst-vrachtbrieven/{zending_nr}.pdf. NULL = geen PDF (nog) ontvangen.';

COMMENT ON COLUMN hst_transportorders.pdf_uploaded_at IS
  'Tijdstip waarop de PDF is geüpload naar storage. NULL tot eerste upload.';

-- ============================================================================
-- 2. Uitgebreide markeer_hst_verstuurd-signature
-- ============================================================================
-- Backwards-compatible: nieuwe parameters hebben DEFAULT NULL zodat eerdere
-- callers (ook eventuele test-stubs) blijven werken.

CREATE OR REPLACE FUNCTION markeer_hst_verstuurd(
  p_id                          BIGINT,
  p_extern_transport_order_id   TEXT,
  p_extern_tracking_number      TEXT,
  p_request_payload             JSONB,
  p_response_payload            JSONB,
  p_response_http_code          INTEGER,
  p_pdf_path                    TEXT        DEFAULT NULL,
  p_pdf_uploaded_at             TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Verstuurd',
         extern_transport_order_id = p_extern_transport_order_id,
         extern_tracking_number    = p_extern_tracking_number,
         request_payload           = p_request_payload,
         response_payload          = p_response_payload,
         response_http_code        = p_response_http_code,
         pdf_path                  = COALESCE(p_pdf_path, pdf_path),
         pdf_uploaded_at           = COALESCE(p_pdf_uploaded_at, pdf_uploaded_at),
         sent_at                   = now(),
         error_msg                 = NULL
   WHERE id = p_id
   RETURNING zending_id INTO v_zending_id;

  -- Tracking + status doorzetten naar zending (ongewijzigd t.o.v. mig 171)
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET track_trace = COALESCE(p_extern_tracking_number, p_extern_transport_order_id),
           status = CASE
             WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
             ELSE status
           END
     WHERE id = v_zending_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_hst_verstuurd(BIGINT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 3. Trigger: pdf_path → order_documenten (primaire order)
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_hst_pdf_naar_order_documenten() RETURNS TRIGGER AS $$
DECLARE
  v_zending_nr      TEXT;
  v_primary_order_id BIGINT;
  v_filename        TEXT;
BEGIN
  -- Alleen vuren als pdf_path nieuw wordt gezet of wijzigt
  IF NEW.pdf_path IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.pdf_path IS NOT DISTINCT FROM NEW.pdf_path THEN
    RETURN NEW;
  END IF;

  -- Haal zending_nr op
  SELECT z.zending_nr INTO v_zending_nr
    FROM zendingen z WHERE z.id = NEW.zending_id;
  IF v_zending_nr IS NULL THEN
    RAISE NOTICE 'fn_hst_pdf_naar_order_documenten: zending % bestaat niet, skip', NEW.zending_id;
    RETURN NEW;
  END IF;

  -- Primaire order = zendingen.order_id (de eerste/originele).
  -- Voor bundle-zendingen blijft dit de primary order; andere bundle-orders
  -- zien de PDF niet in DocumentenCompact (zie scope-keuze in kop).
  SELECT z.order_id INTO v_primary_order_id
    FROM zendingen z WHERE z.id = NEW.zending_id;

  IF v_primary_order_id IS NULL THEN
    -- Edge case: zending zonder order_id (komt voor pre-mig-242). Skip.
    RAISE NOTICE 'fn_hst_pdf_naar_order_documenten: zending % heeft geen order_id, skip', NEW.zending_id;
    RETURN NEW;
  END IF;

  v_filename := 'HST-vrachtbrief-' || v_zending_nr || '.pdf';

  INSERT INTO order_documenten (
    order_id, bestandsnaam, storage_path, mime_type, omschrijving, geupload_op
  ) VALUES (
    v_primary_order_id,
    v_filename,
    NEW.pdf_path,
    'application/pdf',
    'HST vrachtbrief — OrderNumber ' || COALESCE(NEW.extern_transport_order_id, '?'),
    COALESCE(NEW.pdf_uploaded_at, now())
  )
  ON CONFLICT (storage_path) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_hst_pdf_naar_order_documenten ON hst_transportorders;
CREATE TRIGGER trg_hst_pdf_naar_order_documenten
  AFTER INSERT OR UPDATE OF pdf_path ON hst_transportorders
  FOR EACH ROW EXECUTE FUNCTION fn_hst_pdf_naar_order_documenten();

COMMENT ON FUNCTION fn_hst_pdf_naar_order_documenten() IS
  'Mig 304: spiegelt hst_transportorders.pdf_path naar één order_documenten-rij '
  'voor de primaire order van de zending. Bundle-zending = alleen primary order '
  'krijgt de PDF zichtbaar in DocumentenCompact (V1-scope; bundle-fan-out V2). '
  'Idempotent via ON CONFLICT (storage_path) DO NOTHING.';

NOTIFY pgrst, 'reload schema';
