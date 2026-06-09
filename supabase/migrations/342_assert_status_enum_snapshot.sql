-- Migratie 342: borgt snijplan_status/confectie_status ≡ TS-golden-snapshot.
-- Geen schema-wijziging — puur een assertie die faalt als iemand de enum
-- wijzigt zonder status-enums.golden.json + snijplan-status.ts mee te nemen.
-- (Idempotent: alleen leesbewerkingen.)

DO $$
DECLARE
  v_snij  TEXT[] := ARRAY['Wacht','Gepland','In productie','Snijden','Gesneden','In confectie','Gereed','Ingepakt','Geannuleerd'];
  v_conf  TEXT[] := ARRAY['Wacht op materiaal','In productie','Kwaliteitscontrole','Gereed','Geannuleerd'];
  v_db    TEXT[];
BEGIN
  SELECT array_agg(e ORDER BY e) INTO v_db
    FROM unnest(enum_range(NULL::snijplan_status)::TEXT[]) e;
  IF v_db <> (SELECT array_agg(e ORDER BY e) FROM unnest(v_snij) e) THEN
    RAISE EXCEPTION 'snijplan_status enum <> snapshot. DB=%, snapshot=%', v_db, v_snij;
  END IF;

  SELECT array_agg(e ORDER BY e) INTO v_db
    FROM unnest(enum_range(NULL::confectie_status)::TEXT[]) e;
  IF v_db <> (SELECT array_agg(e ORDER BY e) FROM unnest(v_conf) e) THEN
    RAISE EXCEPTION 'confectie_status enum <> snapshot. DB=%, snapshot=%', v_db, v_conf;
  END IF;

  RAISE NOTICE 'Mig 342: status-enums matchen de TS-snapshot';
END $$;
