# Cutover-draaiboek: Verzend-wachtrij data-as (mig 424, ADR-0038)

**Datum:** 2026-06-18
**Status:** klaar om uit te voeren — wacht op een rustig venster
**Hoort bij:** [`2026-06-18-verzend-wachtrij-data-as.md`](2026-06-18-verzend-wachtrij-data-as.md) (plan) + [ADR-0038](../../adr/0038-verzend-wachtrij-als-data-as.md)
**Branch:** `refactor/verzend-wachtrij-data-as` (slices 0–4 gecommit; nog niet gemerged)

> **Raakt het live HST-pad.** HST verstuurt continu; Rhenus is net live. Daarom: drain → crons pauzeren → DB + edge + frontend in één venster → crons hervatten. De oude tabellen + RPC's blijven staan als rollback (drop = stap 7, aparte migratie 425, ná live-bewijs).

## 0. Vooraf (buiten het venster)
- [ ] Merge `refactor/verzend-wachtrij-data-as` naar `main` (op commando) — Vercel deployt de frontend automatisch bij push naar `main`. **Let op:** de frontend leest ná deploy `verzend_wachtrij`/`verzend_monitor`; die moeten dan op de live DB staan. Doe daarom de DB-migratie (stap 3) **vóór** de Vercel-deploy live is, of accepteer een korte mismatch binnen het venster. Veiligst: venster strak houden.
- [ ] Bevestig dat `externe_payloads` voor álle drie carriers gevuld wordt (HST/Verhoek/Rhenus loggen via `log_externe_payload` in de orchestrator — ADR-0035). Steekproef: `SELECT kanaal, count(*) FROM externe_payloads WHERE richting='out' GROUP BY kanaal;`

## 1. Venster openen — crons pauzeren
Zoek de verzend-crons en pauzeer ze (geen nieuwe claims tijdens de cutover):
```sql
SELECT jobid, jobname, schedule, active FROM cron.job
 WHERE command ILIKE '%hst-send%' OR command ILIKE '%verhoek-send%' OR command ILIKE '%rhenus-send%';
-- pauzeer per jobid:
SELECT cron.alter_job(<jobid>, active := false);
```
(De factuur-/verzendbericht-crons hoeven NIET gepauzeerd.)

## 2. Drain — wachtrijen leeg
Wacht tot er geen actieve rijen meer zijn (of zet ze handmatig stil). Controle:
```sql
SELECT 'hst' k, count(*) FROM hst_transportorders     WHERE status IN ('Wachtrij','Bezig')
UNION ALL SELECT 'verhoek', count(*) FROM verhoek_transportorders WHERE status IN ('Wachtrij','Bezig')
UNION ALL SELECT 'rhenus',  count(*) FROM rhenus_transportorders  WHERE status IN ('Wachtrij','Bezig');
```
Alle tellingen `0` → door. (Een nieuwe zending kan tijdens het venster `enqueue_zending_naar_vervoerder` triggeren; omdat operators in het venster niet verzenden is dat zeldzaam. Een eventuele rij landt ná stap 3 al in `verzend_wachtrij` — geen probleem.)

## 3. DB-migratie
- [ ] Pas **mig 424** (`424_verzend_wachtrij_data_as.sql`) toe op de live DB (handmatig, geen `db push`).
- [ ] De ingebouwde verifier draait mee (enqueue/claim/fout/verstuurd, net-nul). Daarna handmatig:
```sql
SELECT (SELECT count(*) FROM verzend_wachtrij) AS nieuw,
       (SELECT count(*) FROM hst_transportorders)+(SELECT count(*) FROM verhoek_transportorders)+(SELECT count(*) FROM rhenus_transportorders) AS oud;
-- nieuw == oud (backfill compleet)
SELECT * FROM verzend_monitor;          -- per carrier een rij
SELECT * FROM hst_verzend_monitor;      -- shim levert 1 rij
```

## 4. Edge functions deployen
```
supabase functions deploy hst-send     --project-ref wqzeevfobwauxkalagtn
supabase functions deploy verhoek-send --project-ref wqzeevfobwauxkalagtn
supabase functions deploy rhenus-send  --project-ref wqzeevfobwauxkalagtn
```
(Ze delen `_shared/verzend-orchestrator.ts` → alle drie herdeployen.)

## 5. Frontend live
- [ ] Merge naar `main` → Vercel auto-deploy (als nog niet in stap 0 gedaan). Verifieer dat de logistiek-overzicht-, zending-detail- en HST-monitor-pagina's laden zonder PostgREST-fouten.

## 6. Crons hervatten + rooktest
```sql
SELECT cron.alter_job(<jobid>, active := true);  -- per verzend-job
```
- [ ] Forceer één HST-zending (bv. een testorder of de eerstvolgende echte) → verifieer:
  - rij in `verzend_wachtrij` (`vervoerder_code='hst_api'`, `status` doorloopt Wachtrij→Bezig→Verstuurd),
  - `extern_referentie`/`track_trace`/`document_pad` gevuld, `zendingen.track_trace` + status `Onderweg`,
  - `externe_payloads` rij (kanaal `hst`), én de vrachtbrief-PDF in `order_documenten`/DocumentenCompact.
- [ ] Idem één Rhenus-zending (DE) → `vervoerder_code='rhenus_sftp'`, `track_trace` NULL (correct), XML in storage.
- [ ] HST-monitor-tab toont kloppende tellers; fout-lijst werkt.

## 7. Contract-drop (slice 5 — pas ná ≥1 bewezen HST- én Rhenus-zending via verzend_wachtrij)
- [ ] Pas **mig 425** (`425_drop_oude_transportorder_tabellen.sql`) toe: dropt de 3 monitor-shims, de 3 oude tabellen (CASCADE neemt hun enums/RPC's/triggers mee) en de losse oude RPC's/enums. Pas uitvoeren als de nieuwe keten een paar dagen stabiel live draait.

## Rollback (binnen het venster, vóór drain-hervatting)
1. Crons gepauzeerd houden.
2. Edge functions terug naar de vorige versie (`git checkout main -- supabase/functions/{hst,verhoek,rhenus}-send && supabase functions deploy ...`) — de oude RPC's/tabellen staan er nog, dus de oude code werkt direct.
3. Dispatch terugzetten: her-apply de mig-420-versie van `enqueue_zending_naar_vervoerder` (staat in `420_rhenus_colli_bundeling.sql`).
4. Frontend terug (revert merge).
Omdat de queue gedraind was, gaan er geen rijen verloren; rijen die in stap 3–6 in `verzend_wachtrij` belandden moeten handmatig naar de oude tabel teruggezet worden (zeldzaam — alleen bij verzending tijdens het venster).
