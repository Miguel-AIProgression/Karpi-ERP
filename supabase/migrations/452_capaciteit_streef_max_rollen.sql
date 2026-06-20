-- Migratie 452: productiecapaciteit-config van 1 getal naar streef/max + rolwissel-limiet
--
-- Fase 3 van het maatwerk-snijplanning-vervolgtraject (na Fase 1: haalbaarheid-overzicht,
-- Fase 2: express + verdringing). De oude `capaciteit_per_week` (450) was verouderd. De
-- échte regel: 350 stuks/week is de streefwaarde, mag automatisch naar 400 escaleren bij
-- verzendweek-druk, en daarnaast geldt een streefwaarde van max 20 verschillende rollen
-- (wissels) per dag. Scope: raakt alleen de levertijd-belofte bij ordercreatie
-- (check-levertijd/levertijd-capacity.ts) — niet de daadwerkelijke snijplanner.
--
-- Non-destructieve JSONB-update, zelfde patroon als mig 103 (confectie_buffer_minuten)
-- en mig 285 (FIFO-modus): vervangt de oude sleutel volledig (geen back-compat-shim,
-- "was verouderd") door de drie nieuwe sleutels.

UPDATE app_config
   SET waarde = (waarde - 'capaciteit_per_week') || jsonb_build_object(
         'capaciteit_per_week_streef', 350,
         'capaciteit_per_week_max', 400,
         'max_rollen_per_dag_streef', 20
       )
 WHERE sleutel = 'productie_planning';

COMMENT ON TABLE app_config IS
  'Centrale config-tabel (sleutel/waarde JSONB). productie_planning.capaciteit_per_week '
  '(mig <103, verouderd) is sinds mig 452 vervangen door capaciteit_per_week_streef (350), '
  'capaciteit_per_week_max (400) en max_rollen_per_dag_streef (20).';
