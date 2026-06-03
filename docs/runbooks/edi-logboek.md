# Logboek: EDI Transus go-live monitoring

> **Doel:** dag-na-dag makkelijk zien of de EDI-koppeling werkt en wat er nog moet
> gebeuren. Go-live (big-bang cutover) was **2026-06-03**.
>
> Zie ook: [`edi-cutover.md`](edi-cutover.md) (de cutover-procedure + rollback).

Project-ref: `wqzeevfobwauxkalagtn` · Endpoint: `https://webconnect.transus.com/exchange.asmx`

**Waar draai je de queries?** Supabase Dashboard → **SQL Editor** (project Karpi).
De `edi_berichten`-tabel is het volledige audit-logboek; de **Functions → Logs**
in het dashboard tonen de technische cron-calls per minuut.

---

## A. Dagelijkse health-check (copy-paste, 5 queries)

Draai deze elke ochtend. Samen vertellen ze in 30 seconden of alles loopt.

### A1. Draait de cron nog? (laatste poll-activiteit)
```sql
SELECT jobname, schedule, active,
       (SELECT max(start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS laatste_run,
       (SELECT status FROM cron.job_run_details d WHERE d.jobid = j.jobid
        ORDER BY start_time DESC LIMIT 1) AS laatste_status
FROM cron.job j
WHERE jobname LIKE 'transus-%';
```
**Goed:** `active=true`, `laatste_run` < 2 minuten geleden, `laatste_status='succeeded'`.
**Mis:** `laatste_run` staat stil → cron hapert of token-mismatch (zie [`edi-cutover.md`](edi-cutover.md) §0).

### A2. Totaaloverzicht — wat is er in/uit en in welke status?
```sql
SELECT richting, berichttype, status, count(*) AS aantal,
       max(created_at) AS laatste
FROM edi_berichten
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```
**Goed:** inkomend `in/order/Verwerkt`, uitgaand `uit/orderbev/Verstuurd`.
**Let op:** alles in `Fout` of een uitgaande rij die lang op `Wachtrij`/`Bezig` blijft.

### A3. Fouten — wat heeft aandacht nodig?
```sql
SELECT id, richting, berichttype, debiteur_nr, transactie_id,
       error_msg, retry_count, created_at
FROM edi_berichten
WHERE status = 'Fout'
ORDER BY created_at DESC;
```
Per fout: lees `error_msg`. *"Geen debiteur gematcht op GLN"* → vul
`debiteuren.gln_bedrijf` aan en herverwerk (zie §C). Payload is altijd bewaard in
`payload_raw` — er gaat nooit een order verloren.

### A4. Inkomende orders per partner (afgelopen 3 dagen)
```sql
SELECT b.debiteur_nr, d.naam, count(*) AS berichten,
       count(*) FILTER (WHERE b.status = 'Verwerkt') AS verwerkt,
       count(*) FILTER (WHERE b.status = 'Fout')     AS fout,
       max(b.created_at) AS laatste
FROM edi_berichten b
LEFT JOIN debiteuren d ON d.debiteur_nr = b.debiteur_nr
WHERE b.richting = 'in'
  AND b.created_at > now() - interval '3 days'
GROUP BY b.debiteur_nr, d.naam
ORDER BY berichten DESC;
```
Vergelijk met verwachting: top-5 (BDSK, SB-Möbel BOSS, Hornbach NL, Hammer, Krieger)
zou het grootste volume moeten tonen. **Géén berichten van een actieve partner die
normaal dagelijks bestelt = signaal** (routing in Transus-portaal checken).

### A5. Hangende uitgaande berichten (zit er iets vast?)
```sql
SELECT id, berichttype, status, debiteur_nr, retry_count, created_at, sent_at
FROM edi_berichten
WHERE richting = 'uit'
  AND status IN ('Wachtrij', 'Bezig')
  AND created_at < now() - interval '10 minutes'
ORDER BY created_at;
```
**Goed:** leeg (alles verstuurd binnen een paar minuten).
**Mis:** rijen blijven staan → `transus-send` faalt of `payload_raw` ontbreekt.

---

## B. Dagboek — observaties (handmatig invullen)

| Datum | Wie | Inkomend OK? | Uitgaand OK? | Fouten / bijzonderheden | Actie |
|-------|-----|--------------|--------------|--------------------------|-------|
| 2026-06-03 | — | go-live; nog geen echte partner-order | n.v.t. | test-artefact `tx 249117996` = `Fout` (onschuldig) | watch |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

> Vul per dag één regel in. "Inkomend OK?" = A2/A4 groen. "Uitgaand OK?" = A5 leeg
> + orderbev op `Verstuurd`.

---

## C. Veelvoorkomende acties

### Een fout-bericht opnieuw verwerken (na GLN-fix)
```sql
-- 1. zoek het bericht
SELECT id, debiteur_nr, payload_parsed, error_msg
FROM edi_berichten WHERE status = 'Fout' AND richting = 'in';

-- 2. vul ontbrekende GLN op de debiteur aan
UPDATE debiteuren SET gln_bedrijf = '<gln-uit-bericht>' WHERE debiteur_nr = <nr>;

-- 3. maak alsnog de order aan
SELECT create_edi_order(<bericht_id>, payload_parsed, <debiteur_nr>)
FROM edi_berichten WHERE id = <bericht_id>;
```

### Handmatig één keer pollen (los van de cron)
```bash
curl "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/transus-poll?token=<CRON_TOKEN>"
```
Verwacht JSON met `processed`, `ok`, `orders_created`.

### De ruwe inhoud van een bericht bekijken
```sql
SELECT payload_raw, payload_parsed
FROM edi_berichten WHERE id = <bericht_id>;
```

### Specifiek letten op Duitse leestekens (encoding-watch)
```sql
-- zoek mojibake (ö/ü/ä verkeerd gedecodeerd) in aangemaakte orders
SELECT id, order_nr, afl_naam, afl_plaats
FROM orders
WHERE bron_systeem = 'edi'
  AND (afl_naam ~ '[ÃÂ�]' OR afl_plaats ~ '[ÃÂ�]')
ORDER BY created_at DESC;
```
Treffers (bv. `MÃ¶bel` i.p.v. `Möbel`) → encoding-fix nodig in
`_shared/transus-soap.ts` (CP-1252 vs UTF-8, zie handoff-watch-item).

---

## D. Status — wat werkt, wat moet nog

| Onderdeel | Status | Toelichting |
|-----------|--------|-------------|
| Inkomende orders (M10110 → order) | ✅ Live | `transus-poll` maakt orders aan, ackt via M10300 |
| Cron poll + send (elke minuut) | ✅ Live | mig 305, jobid 8 + 9 |
| Orderbevestiging uit (M10100) | ✅ Live (handmatig) | Bevestig-knop → TransusXML; BDSK groen bevonden |
| **Factuur uit (INVOIC)** | 🔧 Gebouwd, te deployen | Knop "Verstuur via EDI" op factuur-detail (alleen per-order, alleen `factuur_uit && transus_actief`). Edge function `bouw-factuur-edi` moet nog gedeployed worden. ~10 partners met `factuur_uit=true` |
| Verzendbericht (DESADV) | ⏳ V2-backlog | Alleen Hornbach NL; `zendingen` mist SSCC/gewicht/tracking |
| Auto-trigger orderbev/factuur | ⏳ V2-backlog | Nu handmatig; auto-trigger + server-side payload op de backlog |
| Encoding Duitse leestekens | 👀 Watch | Round-trip groen; verifieer bij eerste echte Duitse order (query in §C) |

**Eerste echte partner-order = belangrijkste watch:** moet binnenkomen als
`status='Verwerkt'` met een `order_id`. Komt hij binnen als `Fout` of
`unknown_type` → check `detectBerichttype` op het live-formaat (payload staat in
`payload_raw`).
