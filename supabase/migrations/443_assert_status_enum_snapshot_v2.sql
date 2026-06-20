-- Migratie 443: borgt snijplan_status ≡ TS-golden-snapshot (v2, mig 437).
-- Vervolg op mig 344 — die snapshot is verouderd sinds mig 437 'Wacht op
-- inkoop' toevoegde. Geen schema-wijziging — puur een assertie die faalt als
-- de DB-enum afwijkt van status-enums.golden.json + snijplan-status.ts.
-- (Idempotent: alleen leesbewerkingen.)

DO $$
DECLARE
  v_snij  TEXT[] := ARRAY['Wacht','Wacht op inkoop','Gepland','In productie','Snijden','Gesneden','In confectie','Gereed','Ingepakt','Geannuleerd'];
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
  RAISE NOTICE 'Mig 443: status-enums matchen de TS-snapshot (incl. volgorde, incl. Wacht op inkoop)';
END $$;
