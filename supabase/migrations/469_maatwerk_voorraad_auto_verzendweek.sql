-- Migratie 469: automatische verzendweek voor maatwerk-op-voorraad
--
-- Achtergrond
-- -----------
-- Maatwerk-orderregels hadden geen enkele verzendweek-aanduiding: de
-- bestaande `order_regels.verzendweek` (mig 334) en `VerzendweekCell`-UI
-- werken alleen voor niet-maatwerk-regels. Zodra een maatwerk-stuk een echte
-- rol toegewezen krijgt (materiaal is dus op voorraad, geen wachten op
-- inkoop), wil de gebruiker dat de verzendweek automatisch op "vandaag + N
-- weken" komt te staan — bewerkbaar per regel — en dat die week vervolgens
-- op de orderbevestiging verschijnt.
--
-- Een live "vandaag + N weken"-berekening zou bij elke weergave verschuiven
-- (geen stabiele toezegging richting de klant). Dit moet dus een snapshot
-- zijn, vastgezet op het moment dat het materiaal beschikbaar komt — een
-- DB-trigger, niet een client-side berekening.
--
-- Wat deze migratie doet
-- -----------------------
-- 1. Kolom `order_regels.verzendweek_bron` — onderscheidt een systeemvoorstel
--    ('automatisch_voorraad') van een bewuste handmatige keuze ('handmatig').
-- 2. Trigger op `snijplannen`: zodra een stuk een rol krijgt (en — bij een
--    regel met meerdere snijplan-stukken — ALLE stukken van die regel nu een
--    rol hebben), wordt voor de bijbehorende maatwerk-orderregel éénmalig
--    `verzendweek` gezet, mits nog NULL (nooit een bestaande waarde
--    overschrijven, automatisch of handmatig).
-- 3. `set_regel_verzendweek` (mig 334) labelt voortaan ook `verzendweek_bron`
--    bij een handmatige aanpassing/reset.
-- 4. Nieuwe, additieve `app_config.productie_planning.maatwerk_voorraad_levertijd_weken`
--    (default 7) — tunebaar zonder migratie, zelfde conventie als de
--    bestaande buffer-velden in deze config-rij.

------------------------------------------------------------------------
-- 1. Kolom + config-default
------------------------------------------------------------------------
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS verzendweek_bron TEXT
    CHECK (verzendweek_bron IN ('handmatig', 'automatisch_voorraad'));

COMMENT ON COLUMN order_regels.verzendweek_bron IS
  'Herkomst van order_regels.verzendweek (mig 469): ''handmatig'' = bewust '
  'door een operator ingevuld/aangepast, ''automatisch_voorraad'' = systeem-'
  'voorstel zodra een maatwerk-stuk materiaal op voorraad bleek te hebben. '
  'NULL = geen verzendweek gezet.';

UPDATE app_config
SET waarde = waarde || jsonb_build_object('maatwerk_voorraad_levertijd_weken', 7)
WHERE sleutel = 'productie_planning'
  AND NOT (waarde ? 'maatwerk_voorraad_levertijd_weken');

------------------------------------------------------------------------
-- 2. Trigger: auto-verzendweek zodra een maatwerk-regel volledig op een
--    rol staat
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_snijplan_rol_toegewezen_auto_verzendweek()
RETURNS TRIGGER AS $$
DECLARE
  v_weken INTEGER;
BEGIN
  IF NEW.rol_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.rol_id IS NOT DISTINCT FROM NEW.rol_id THEN
    RETURN NEW;
  END IF;

  -- Alleen als ALLE (niet-geannuleerde) snijplan-stukken van deze orderregel
  -- nu een rol hebben — bij een deels gedekte regel zou de belofte te
  -- optimistisch zijn (spiegelt de "volledig gepland"-voorwaarde die
  -- useSnijHaalbaarheid ook al voor de verwachte-verzenddatum gebruikt).
  IF EXISTS (
    SELECT 1 FROM snijplannen sp2
    WHERE sp2.order_regel_id = NEW.order_regel_id
      AND sp2.status <> 'Geannuleerd'
      AND sp2.rol_id IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((waarde->>'maatwerk_voorraad_levertijd_weken')::INTEGER, 7)
    INTO v_weken
  FROM app_config WHERE sleutel = 'productie_planning';

  UPDATE order_regels
  SET verzendweek = verzendweek_voor_datum((CURRENT_DATE + (v_weken || ' weeks')::INTERVAL)::DATE),
      verzendweek_bron = 'automatisch_voorraad'
  WHERE id = NEW.order_regel_id
    AND is_maatwerk = TRUE
    AND verzendweek IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_snijplan_rol_toegewezen_auto_verzendweek() IS
  'Mig 469: zet order_regels.verzendweek op ''vandaag + N weken'' (snapshot, '
  'niet live) zodra een maatwerk-regel volledig op een echte rol staat — '
  'alleen als er nog geen verzendweek gezet was.';

DROP TRIGGER IF EXISTS trg_snijplan_rol_toegewezen_auto_verzendweek ON snijplannen;
CREATE TRIGGER trg_snijplan_rol_toegewezen_auto_verzendweek
AFTER INSERT OR UPDATE OF rol_id ON snijplannen
FOR EACH ROW
EXECUTE FUNCTION trg_snijplan_rol_toegewezen_auto_verzendweek();

------------------------------------------------------------------------
-- 3. set_regel_verzendweek: labelt verzendweek_bron bij handmatige actie
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_regel_verzendweek(
  p_regel_id  BIGINT,
  p_verzendweek TEXT   -- NULL = reset naar auto
)
RETURNS VOID AS $$
BEGIN
  UPDATE order_regels
     SET verzendweek = p_verzendweek,
         verzendweek_bron = CASE WHEN p_verzendweek IS NULL THEN NULL ELSE 'handmatig' END
   WHERE id = p_regel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_regel_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION set_regel_verzendweek(BIGINT, TEXT) IS
  'Stel handmatige verzendweek in voor een orderregel (mig 334, uitgebreid '
  'in mig 469 met verzendweek_bron). NULL-aanroep reset naar auto-berekening.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 469 toegepast: order_regels.verzendweek_bron + auto-verzendweek-trigger op snijplannen.';
END $$;
