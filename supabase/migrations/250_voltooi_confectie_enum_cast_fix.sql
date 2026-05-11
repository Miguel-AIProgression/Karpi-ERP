-- Migratie 250: voltooi_confectie — expliciete ::snijplan_status cast op CASE-expressie
--
-- Symptoom: na "Afronden" in de Confectielijst gooit Supabase:
--   `column "status" is of type snijplan_status but expression is of type text`
--
-- Root cause: in mig 247 (en de gestagede duplicate mig 245) is het status-veld
-- in de UPDATE een CASE-expressie met drie string-literals:
--
--     status = CASE WHEN p_ingepakt    THEN 'Ingepakt'
--                   WHEN v_eff_afgerond THEN 'In confectie'
--                   ELSE                    'Gesneden'
--              END
--
-- PostgreSQL leidt het resultaattype van een CASE af uit de THEN-takken. Bij
-- naakte string-literals krijgt de hele expressie type `text` en valt de
-- impliciete cast naar `snijplan_status` op het UPDATE-target weg — net zoals
-- bij een directe `SET enumcol = 'text'`-cast op een ENUM-kolom. De
-- CREATE FUNCTION zelf slaagt (PL/pgSQL parst de body lazy bij aanroep), de
-- fout komt pas wanneer de RPC echt wordt gecalled. Vandaar dat mig 247
-- (en mig 101 in de oorsprong) op `git push` slaagde maar de modal nu hangt.
--
-- Fix: cast elke tak van de CASE expliciet naar `snijplan_status`. Daarmee is
-- het resultaattype van de CASE eenduidig het enum en is geen impliciete cast
-- meer nodig. Geen wijziging in gedrag — alleen typing.
--
-- Backward-compat: identieke signatuur (BIGINT, BOOLEAN, BOOLEAN, TEXT) en
-- identieke effecten. `CREATE OR REPLACE` overschrijft mig 247.

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
                                   WHEN p_ingepakt    THEN 'Ingepakt'::snijplan_status
                                   WHEN v_eff_afgerond THEN 'In confectie'::snijplan_status
                                   ELSE                    'Gesneden'::snijplan_status
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden'::snijplan_status,
                    'In confectie'::snijplan_status,
                    'Gereed'::snijplan_status,
                    'Ingepakt'::snijplan_status)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed/Ingepakt', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Ingepakt + ingepakt_op=NOW() (impliceert afgerond, maakt direct pickbaar via mig 170). p_locatie="" → clear locatie; NULL → ongemoeid. Mig 247: ingepakt-pad zet Ingepakt i.p.v. Gereed. Mig 250: expliciete ::snijplan_status casts op CASE-takken zodat de UPDATE niet faalt op type-coercie. Idempotent.';

NOTIFY pgrst, 'reload schema';
