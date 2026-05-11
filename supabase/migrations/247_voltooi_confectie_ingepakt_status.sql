-- Migratie 247: voltooi_confectie — p_ingepakt=true zet status='Ingepakt' (i.p.v. 'Gereed')
--
-- Symptoom: na "Afronden" in de Confectielijst met de Ingepakt-checkbox aan,
-- verdwijnt het stuk uit de confectie-views (correct), maar verschijnt het
-- niet in Pick & Ship — het komt nooit aan bij de magazijnier.
--
-- Root cause: mig 101 zette status='Gereed' bij p_ingepakt=true, maar de
-- pickbaarheid-view (mig 170) filtert op `snijplannen.status='Ingepakt'`.
-- Tussenliggende statussen:
--   * mig 098/103/104/243 confectie_planning_forward WHERE-clause:
--     ('Gepland','Wacht','Snijden','Gesneden','In confectie','Ingepakt') — geen 'Gereed'
--   * mig 170 orderregel_pickbaarheid WHERE status='Ingepakt' — geen 'Gereed'
--   * scanstation `opboekenItem` UPDATE → 'Ingepakt' (de "officiële" pickbaar-zetter)
--
-- 'Gereed' was daardoor een dead-end: niet in confectie-views, niet pickbaar,
-- alleen zichtbaar via scanstation `fetchOpenstaandItems` dat 'Gesneden' + 'In confectie'
-- + 'Gereed' toonde. De AfrondModal vermeldde "(status Gereed)" in de checkbox-uitleg
-- en de gebruiker moest daarna nog langs het scanstation om naar 'Ingepakt' te komen.
--
-- Fix: voltooi_confectie zet bij p_ingepakt=true direct status='Ingepakt'. De
-- AfrondModal verzamelt al alle data die het scanstation ook zou vragen
-- (locatie + ingepakt-bevestiging), dus dat extra scan-station-stap is nodeloos.
-- Scanstation-pad blijft werken voor stukken die rechtstreeks (zonder modal)
-- worden opgeboekt — daar wordt direct UPDATE gebruikt, niet deze RPC.
--
-- Backward-compat: 'Gereed' blijft een geldige enum-waarde voor historische rijen;
-- voltooi_confectie accepteert hem nog steeds als input-status. Alleen het output-
-- pad p_ingepakt=true is gewijzigd. Bestaande 'Gereed'-rijen blijven onveranderd.
-- Wie ze pickable wil maken roept voortaan voltooi_confectie opnieuw aan, of
-- gebruikt het scanstation-pad.

CREATE OR REPLACE FUNCTION voltooi_confectie(
  p_snijplan_id BIGINT,
  p_afgerond    BOOLEAN DEFAULT true,
  p_ingepakt    BOOLEAN DEFAULT false,
  p_locatie     TEXT    DEFAULT NULL
)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
  v_nu  TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN := p_afgerond OR p_ingepakt;  -- ingepakt impliceert afgerond
BEGIN
  UPDATE snijplannen
     SET confectie_afgerond_op = CASE WHEN v_eff_afgerond THEN v_nu ELSE NULL END,
         ingepakt_op           = CASE WHEN p_ingepakt THEN v_nu ELSE NULL END,
         locatie               = CASE
                                   WHEN p_locatie IS NULL THEN locatie
                                   WHEN trim(p_locatie) = '' THEN NULL
                                   ELSE trim(p_locatie)
                                 END,
         status                = CASE
                                   WHEN p_ingepakt THEN 'Ingepakt'
                                   WHEN v_eff_afgerond THEN 'In confectie'
                                   ELSE 'Gesneden'
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie', 'Gereed', 'Ingepakt')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed/Ingepakt', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Ingepakt + ingepakt_op=NOW() (impliceert afgerond, maakt direct pickbaar via mig 170). p_locatie="" → clear locatie; NULL → ongemoeid. Mig 245: ingepakt-pad zet voortaan Ingepakt i.p.v. Gereed zodat Pick & Ship het stuk direct ziet. Idempotent.';

NOTIFY pgrst, 'reload schema';
