-- Migratie 553: prioriteitspass uitbreiden met "ongeplaatste stukken + beschikbare rol"
--
-- Aanleiding: VERR/15-stukken stonden meerdere dagen als "Niet planbaar" in de
-- werklijst terwijl 4 beschikbare rollen van 1500×400cm lagen te wachten. De
-- herplan-sweep pikt groepen willekeurig op (50/~220 per run, elke 30 min);
-- theoretisch worden alle groepen in 2 uur geraakt, maar praktijk leert dat
-- een specifieke groep toch een dag(en) kan blijven liggen.
--
-- Oplossing: twee gevallen verdienen altijd prioriteit —
--   Case 1 (bestaand, mig 552): recent aangemaakte stukken zonder rol.
--   Case 2 (nieuw): stukken die al ongeplaatst staan (elke leeftijd) terwijl
--     er wél beschikbare rollen van dezelfde kwaliteit/kleur in het magazijn
--     liggen. Zodra auto-plan-groep succesvol draait, krijgen de stukken een
--     rol en verdwijnt de groep vanzelf uit Case 2.
--
-- Scope: directe kwaliteit/kleur-match (geen uitwisselbare paren-join — te
-- complex en zeldzaam; de willekeurige sweep pakt uitwisselbare combos snel op).
--
-- Geen wijziging in herplan-sweep/index.ts nodig — de functienaam en het
-- retourtype zijn ongewijzigd; enkel meer rijen mogelijk.
CREATE OR REPLACE FUNCTION groepen_met_nieuwe_ongeplande_stukken(
  p_window_minuten INTEGER DEFAULT 360
)
RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  -- Case 1 (mig 552): recentelijk aangemaakte stukken zonder rol of IO-claim.
  -- Tijdsfilter: aangemaakt binnen p_window_minuten (default 360 min = 6 uur).
  SELECT DISTINCT
    orr.maatwerk_kwaliteit_code::TEXT,
    orr.maatwerk_kleur_code::TEXT
  FROM snijplannen sn
  JOIN order_regels orr ON sn.order_regel_id = orr.id
  WHERE sn.status = 'Gepland'
    AND sn.rol_id IS NULL
    AND sn.verwacht_inkooporder_regel_id IS NULL
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
    AND sn.snijden_uit_standaardmaat = false
    AND sn.created_at > NOW() - (p_window_minuten || ' minutes')::INTERVAL

  UNION

  -- Case 2 (mig 553): stukken die al ongeplaatst zijn (elke leeftijd) terwijl
  -- er beschikbare rollen van dezelfde kwaliteit/kleur aanwezig zijn.
  -- Geen tijdsfilter: zolang materiaal beschikbaar is én stukken wachten,
  -- hoort de groep in de prioriteitspass. Reden: nieuwe rollen kunnen uren of
  -- dagen geleden zijn binnengekomen en de willekeurige sweep heeft de groep
  -- statistisch wel geraakt maar de planning toch niet afgerond (lock contention,
  -- verdringingscheck, of transiënte fout). Zonder dit filter blijft zo'n groep
  -- in de willekeurige roulatie terwijl direct actie mogelijk was.
  SELECT DISTINCT
    orr.maatwerk_kwaliteit_code::TEXT,
    orr.maatwerk_kleur_code::TEXT
  FROM snijplannen sn
  JOIN order_regels orr ON sn.order_regel_id = orr.id
  JOIN rollen ro
    ON  ro.kwaliteit_code = orr.maatwerk_kwaliteit_code
    AND (   ro.kleur_code = orr.maatwerk_kleur_code
         OR ro.kleur_code = orr.maatwerk_kleur_code || '.0'
         OR ro.kleur_code = regexp_replace(orr.maatwerk_kleur_code, '\.0$', ''))
    AND ro.status IN ('beschikbaar', 'reststuk')
    AND ro.snijden_gestart_op IS NULL
  WHERE sn.status = 'Gepland'
    AND sn.rol_id IS NULL
    AND sn.verwacht_inkooporder_regel_id IS NULL
    AND orr.maatwerk_kwaliteit_code IS NOT NULL
    AND sn.snijden_uit_standaardmaat = false

  ORDER BY 1, 2
$$;

GRANT EXECUTE ON FUNCTION groepen_met_nieuwe_ongeplande_stukken(INTEGER) TO service_role;
