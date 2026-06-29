-- Migratie 533: herplan-sweep — periodieke herplanning alle snijgroepen
--
-- Probleem: auto-plan-groep triggert alleen bij order-/snijplan-aanmaak.
-- Als stukken Gesneden worden of nieuwe rollen binnenkomen (voorraad-import)
-- weet de planner niet dat er herplanning nodig is — tekort-stukken blijven
-- tekort terwijl er ruimte vrijgekomen is.
--
-- Oplossing: edge function herplan-sweep draait elke 30 minuten alle
-- actieve (kwaliteit, kleur) groepen opnieuw via auto-plan-groep (batches
-- van 5 parallel → ~2 minuten voor 220 groepen).
--
-- Deploy-volgorde: deze migratie VOOR de edge function deployen is OK —
-- de cron roept de URL aan; als de function nog niet bestaat geeft Supabase
-- een 404 die stil genegeerd wordt (net.http_post is fire-and-forget).

-- ── DB-FUNCTIE: actieve_snijgroepen() ────────────────────────────────────────
-- Geeft alle unieke (kwaliteit_code, kleur_code) groepen terug die nog
-- openstaande snijplan-stukken hebben (Gepland/Wacht/Wacht op inkoop/Snijden).
-- Gesorteerd op kwaliteit + kleur voor een deterministische volgorde.

CREATE OR REPLACE FUNCTION actieve_snijgroepen()
RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT
    sp.kwaliteit_code,
    sp.kleur_code
  FROM snijplanning_overzicht sp
  WHERE sp.order_status NOT IN ('Verzonden', 'Geannuleerd')
    AND sp.status IN ('Gepland', 'Wacht', 'Wacht op inkoop', 'Snijden')
    AND sp.snijden_uit_standaardmaat = FALSE
    AND sp.kwaliteit_code IS NOT NULL
    AND sp.kleur_code IS NOT NULL
  ORDER BY sp.kwaliteit_code, sp.kleur_code
$$;

-- ── CRON ────────────────────────────────────────────────────────────────────
-- Elke 30 minuten: herplan-sweep aanroepen.
-- Dezelfde bearer-token als andere cron-edge-functions (vault 'cron_token').

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('herplan-sweep');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

SELECT cron.schedule(
  'herplan-sweep',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/herplan-sweep',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
