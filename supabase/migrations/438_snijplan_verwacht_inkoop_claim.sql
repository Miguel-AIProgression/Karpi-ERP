-- Migratie 438: snijplan-claims op openstaande rol-inkoop
--
-- Vervolg op mig 437. Voegt de kolommen + RPC's toe waarmee `auto-plan-groep`
-- (tweede pas, in-memory virtuele rol per openstaande inkooporder_regel)
-- snijplan-stukken kan koppelen aan een inkooporder_regel i.p.v. aan een
-- echte rol. Spiegelt het bestaande `release_gepland_stukken` (mig 133)
-- release-dan-herberekenen-patroon — geen drift-gevoelige optel/aftrek-logica.
--
-- Scope (zie plan): matching is exacte kwaliteit_code, dus een
-- inkooporder_regel kan in v1 maar door ÉÉN (kwaliteit,kleur)-groep
-- geclaimd worden — `release_wacht_op_inkoop_stukken` mag de teller daarom
-- veilig op 0 zetten i.p.v. te moeten aftrekken.

ALTER TABLE snijplannen
  ADD COLUMN verwacht_inkooporder_regel_id BIGINT NULL
    REFERENCES inkooporder_regels(id) ON DELETE SET NULL;

ALTER TABLE snijplannen
  ADD CONSTRAINT snijplannen_rol_of_verwacht_xor
    CHECK (NOT (rol_id IS NOT NULL AND verwacht_inkooporder_regel_id IS NOT NULL));

COMMENT ON COLUMN snijplannen.verwacht_inkooporder_regel_id IS
  'Mig 438: gezet zodra status=''Wacht op inkoop'' — stuk past (volgens de '
  'guillotine-packer) op een nog niet ontvangen rol uit deze openstaande '
  'inkooporder_regel. Wederzijds exclusief met rol_id. NOOIT een echte rol-rij.';

ALTER TABLE inkooporder_regels
  ADD COLUMN snijplan_gebruikte_lengte_cm INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN inkooporder_regels.snijplan_gebruikte_lengte_cm IS
  'Mig 438: snapshot — hoeveel cm van deze (nog niet ontvangen) rol-lengte is '
  'belegd door snijplannen.status=''Wacht op inkoop''. Single writer: '
  'claim_wacht_op_inkoop()/release_wacht_op_inkoop_stukken(). Volledige '
  'overwrite per auto-plan-groep-run, geen incrementele optelling (voorkomt '
  'drift). Alleen betekenisvol bij eenheid=''m''.';

-- ---------------------------------------------------------------------------
-- claim_wacht_op_inkoop: schrijft het resultaat van de tweede pak-pas weg.
-- p_claims:        [{"snijplan_id": 1, "inkooporder_regel_id": 9651}, ...]
-- p_regel_totalen: [{"inkooporder_regel_id": 9651, "gebruikte_lengte_cm": 18000}, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_wacht_op_inkoop(
  p_claims JSONB,
  p_regel_totalen JSONB
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_geclaimd INTEGER := 0;
BEGIN
  WITH input AS (
    SELECT (c->>'snijplan_id')::BIGINT AS snijplan_id,
           (c->>'inkooporder_regel_id')::BIGINT AS inkooporder_regel_id
      FROM jsonb_array_elements(COALESCE(p_claims, '[]'::jsonb)) c
  ),
  updated AS (
    UPDATE snijplannen sn
       SET status = 'Wacht op inkoop',
           rol_id = NULL,
           positie_x_cm = NULL,
           positie_y_cm = NULL,
           geroteerd = false,
           verwacht_inkooporder_regel_id = input.inkooporder_regel_id
      FROM input
     WHERE sn.id = input.snijplan_id
       AND sn.status IN ('Wacht', 'Gepland')
       AND sn.rol_id IS NULL
    RETURNING sn.id
  )
  SELECT COUNT(*)::INTEGER INTO v_geclaimd FROM updated;

  UPDATE inkooporder_regels ir
     SET snijplan_gebruikte_lengte_cm = (t->>'gebruikte_lengte_cm')::INTEGER
    FROM jsonb_array_elements(COALESCE(p_regel_totalen, '[]'::jsonb)) t
   WHERE ir.id = (t->>'inkooporder_regel_id')::BIGINT;

  RETURN v_geclaimd;
END;
$$;

COMMENT ON FUNCTION claim_wacht_op_inkoop(JSONB, JSONB) IS
  'Mig 438: legt het resultaat van de auto-plan-groep tweede pak-pas '
  '(virtuele IO-rollen) vast. Idempotent — alleen stukken die nog in '
  'Wacht/Gepland staan en geen rol_id hebben worden geraakt.';

-- ---------------------------------------------------------------------------
-- release_wacht_op_inkoop_stukken: spiegelt release_gepland_stukken (mig 133)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_wacht_op_inkoop_stukken(
  p_kwaliteit_code TEXT,
  p_kleur_code TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_released         INTEGER  := 0;
  v_affected_regels   BIGINT[] := ARRAY[]::BIGINT[];
  v_kleur_varianten   TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  WITH cleared AS (
    UPDATE snijplannen sn
       SET status = 'Wacht',
           verwacht_inkooporder_regel_id = NULL
      FROM order_regels orr
     WHERE sn.order_regel_id           = orr.id
       AND sn.status                   = 'Wacht op inkoop'
       AND orr.maatwerk_kwaliteit_code  = p_kwaliteit_code
       AND orr.maatwerk_kleur_code      = ANY(v_kleur_varianten)
    RETURNING sn.verwacht_inkooporder_regel_id AS regel_id
  )
  SELECT COUNT(*)::INTEGER,
         COALESCE(ARRAY_AGG(DISTINCT regel_id) FILTER (WHERE regel_id IS NOT NULL),
                  ARRAY[]::BIGINT[])
    INTO v_released, v_affected_regels
    FROM cleared;

  -- Exacte-kwaliteit-matching (zie plan-scope): een inkooporder_regel wordt
  -- in v1 maar door één (kwaliteit,kleur)-groep geclaimd, dus hier veilig op
  -- 0 terugzetten i.p.v. aftrekken.
  IF COALESCE(array_length(v_affected_regels, 1), 0) > 0 THEN
    UPDATE inkooporder_regels
       SET snijplan_gebruikte_lengte_cm = 0
     WHERE id = ANY(v_affected_regels);
  END IF;

  RETURN v_released;
END;
$$;

COMMENT ON FUNCTION release_wacht_op_inkoop_stukken(TEXT, TEXT) IS
  'Mig 438: spiegelt release_gepland_stukken (mig 133) voor de '
  '"Wacht op inkoop"-claim — zet stukken terug naar Wacht zodat '
  'auto-plan-groep ze opnieuw vanaf nul kan inplannen.';
