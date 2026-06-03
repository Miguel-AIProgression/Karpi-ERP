-- Migratie 306: EDI bootstrap-koppeling vestiging-afleveradres (Hornbach-patroon)
--
-- Context (cutover 2026-06-03):
--   Centraal-gefactureerde filiaalorders (Hornbach) komen binnen met:
--     gefactureerd-GLN = hoofd-AG (inactieve debiteur 361214)
--     besteller/aflever-GLN = de fysieke NL-vestiging
--   De vestiging-GLN's staan nergens in onze data, dus matchDebiteur faalde en de
--   eerste 4 echte orders bleven op order_id IS NULL ("Geen debiteur gematcht op GLN").
--
-- Oplossing (Optie B — bootstrap):
--   De operator koppelt een onbekende aflever-GLN éénmalig handmatig aan het juiste
--   afleveradres (= de 25 bestaande Hornbach-vestigingen onder 361208). Deze RPC
--   schrijft de GLN naar `afleveradressen.gln_afleveradres` ("onthouden"), zet de
--   debiteur op het bericht en maakt de order aan via `create_edi_order` (mig 166).
--   Daarna matcht `matchDebiteur` (transus-poll) de volgende order naar diezelfde
--   vestiging automatisch op stap 1 (aflever-GLN → afleveradres).
--
-- Idempotent: zelfde (bericht, adres) → bestaande order via create_edi_order.

CREATE OR REPLACE FUNCTION koppel_edi_afleveradres(
  p_bericht_id      BIGINT,
  p_debiteur_nr     INTEGER,
  p_afleveradres_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_payload     JSONB;
  v_richting    TEXT;
  v_berichttype TEXT;
  v_gln_afl     TEXT;
  v_adres_deb   INTEGER;
  v_adres_gln   TEXT;
  v_botst_id    BIGINT;
  v_order_id    BIGINT;
BEGIN
  -- Bericht ophalen
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

  v_gln_afl := NULLIF(v_payload->'header'->>'gln_afleveradres', '');
  IF v_gln_afl IS NULL THEN
    RAISE EXCEPTION 'Bericht % heeft geen aflever-GLN in de header — koppelen op afleveradres niet mogelijk',
      p_bericht_id;
  END IF;

  -- Afleveradres moet bij de gekozen debiteur horen
  SELECT debiteur_nr, gln_afleveradres
    INTO v_adres_deb, v_adres_gln
    FROM afleveradressen WHERE id = p_afleveradres_id;
  IF v_adres_deb IS NULL THEN
    RAISE EXCEPTION 'Afleveradres % bestaat niet', p_afleveradres_id;
  END IF;
  IF v_adres_deb <> p_debiteur_nr THEN
    RAISE EXCEPTION 'Afleveradres % hoort bij debiteur %, niet bij gekozen debiteur %',
      p_afleveradres_id, v_adres_deb, p_debiteur_nr;
  END IF;

  -- Guard: overschrijf geen bestaande ándere GLN op het gekozen adres (stille
  -- data-mutatie voorkomen — operator koos mogelijk de verkeerde vestiging).
  IF v_adres_gln IS NOT NULL AND v_adres_gln <> v_gln_afl THEN
    RAISE EXCEPTION 'Afleveradres % heeft al GLN % — koppel aan een ander adres of corrigeer eerst',
      p_afleveradres_id, v_adres_gln;
  END IF;

  -- Guard: een GLN is fysiek uniek aan één adres. Weiger als hij al ergens anders hangt.
  SELECT id INTO v_botst_id
    FROM afleveradressen
   WHERE gln_afleveradres = v_gln_afl
     AND id <> p_afleveradres_id
   LIMIT 1;
  IF v_botst_id IS NOT NULL THEN
    RAISE EXCEPTION 'Aflever-GLN % is al gekoppeld aan afleveradres % — los dat eerst op',
      v_gln_afl, v_botst_id;
  END IF;

  -- Onthoud de GLN op het gekozen afleveradres
  UPDATE afleveradressen
     SET gln_afleveradres = v_gln_afl
   WHERE id = p_afleveradres_id
     AND gln_afleveradres IS DISTINCT FROM v_gln_afl;

  -- Debiteur aan het bericht koppelen + foutstatus opschonen
  UPDATE edi_berichten
     SET debiteur_nr = p_debiteur_nr,
         status = 'Verwerkt',
         error_msg = NULL
   WHERE id = p_bericht_id;

  -- Order aanmaken (of bestaande teruggeven). create_edi_order matcht het
  -- afleveradres op de zojuist geschreven GLN en zet de adres-snapshot.
  v_order_id := create_edi_order(p_bericht_id, v_payload, p_debiteur_nr);

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION koppel_edi_afleveradres(BIGINT, INTEGER, BIGINT) TO authenticated;

COMMENT ON FUNCTION koppel_edi_afleveradres IS
  'EDI bootstrap-koppeling (mig 306): koppelt een inkomende order met onbekende '
  'aflever-GLN handmatig aan een afleveradres. Schrijft de GLN naar '
  'afleveradressen.gln_afleveradres (onthouden), zet edi_berichten.debiteur_nr en '
  'roept create_edi_order aan. Idempotent. Guard: GLN mag niet al aan een ander '
  'adres hangen.';
