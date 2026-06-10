-- Migratie 342: borgt snijplan_status/confectie_status ≡ TS-golden-snapshot.
-- Geen schema-wijziging — puur een assertie die faalt als iemand de enum
-- wijzigt zonder status-enums.golden.json + snijplan-status.ts mee te nemen.
-- (Idempotent: alleen leesbewerkingen.)

DO $$
DECLARE
  v_snij  TEXT[] := ARRAY['Wacht','Gepland','In productie','Snijden','Gesneden','In confectie','Gereed','Ingepakt','Geannuleerd'];
  v_conf  TEXT[] := ARRAY['Wacht op materiaal','In productie','Kwaliteitscontrole','Gereed','Geannuleerd'];
BEGIN
  IF enum_range(NULL::snijplan_status)::TEXT[] <> v_snij THEN
    RAISE EXCEPTION 'snijplan_status enum <> snapshot (volgorde/inhoud). DB=%, snapshot=%',
      enum_range(NULL::snijplan_status)::TEXT[], v_snij;
  END IF;
  IF enum_range(NULL::confectie_status)::TEXT[] <> v_conf THEN
    RAISE EXCEPTION 'confectie_status enum <> snapshot (volgorde/inhoud). DB=%, snapshot=%',
      enum_range(NULL::confectie_status)::TEXT[], v_conf;
  END IF;
  RAISE NOTICE 'Mig 342: status-enums matchen de TS-snapshot (incl. volgorde)';
END $$;
