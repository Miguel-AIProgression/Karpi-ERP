# Runbook: EDI Transus cutover (Windows Connect → API)

> **Doel:** Windows Connect op `MITS-CA-01-009` uitzetten en alle EDI-verkeer via de
> Transus WebConnect-API door RugFlow laten lopen. Inkomend automatisch (orders),
> uitgaand orderbevestiging handmatig. Big-bang voor alle partners.
>
> **Constraint:** Windows Connect en de API mogen NOOIT tegelijk dezelfde queue
> consumeren. Volgorde hieronder strikt aanhouden.

Project-ref: `wqzeevfobwauxkalagtn` · Endpoint: `https://webconnect.transus.com/exchange.asmx`

---

## 0. Pre-flight — vóór je iets omzet (geen impact)

Vink af. Pas verder als ALLES groen is.

- [ ] **Secrets gezet** (door admin/Piet-Hein) in Supabase → Edge Functions → Secrets:
      `TRANSUS_CLIENT_ID=10781130`, `TRANSUS_CLIENT_KEY=JTCDH5LJHSQA`, `CRON_TOKEN=<token>`.
- [ ] **Edge functions gedeployed**: `transus-poll` + `transus-send` (zichtbaar in
      Dashboard → Functions). ✅ gedaan 2026-06-03.
- [ ] **Migraties toegepast**: `156` t/m `166` (NIET 305 — die komt in stap 2).
- [ ] **Vault cron_token** bestaat en is gelijk aan het `CRON_TOKEN`-secret:
      ```sql
      SELECT name FROM vault.decrypted_secrets WHERE name = 'cron_token';
      -- bestaat niet? eenmalig:
      SELECT vault.create_secret('<zelfde-token-als-secret>', 'cron_token',
        'Voor pg_cron -> transus-poll / transus-send / hst-send');
      ```
- [ ] **Auth-check** (mag nu al, pollt NIET de echte queue bij verkeerde token):
      ```bash
      # Verwacht: 401 Unauthorized
      curl -s -o /dev/null -w "%{http_code}\n" \
        "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/transus-poll?token=fout"
      ```
      Krijg je `401`, dan staat de function live en werkt de token-check.

⚠️ Trigger de poll met de JUISTE token nog NIET — Windows Connect draait nog.

---

## 1. Windows Connect deactiveren

1. Log in op **Transus Online** → Instellingen → Communicatie.
2. Open het blok **WebConnect — Windows Connect** (computernaam `MITS-CA-01-009`,
   directories `E:\edi\edi_in\` / `E:\edi\edi_uit\`).
3. **Deactiveer** dit blok (of stop de "Transus Connect"-service op de machine
   `MITS-CA-01-009` zelf). Status moet van *Verbonden* af.
4. Laat het blok **WebConnect — Transus API** (Client ID `10781130`) **actief**.

> Vanaf nu stapelen inkomende orders zich op in de Transus-queue — ze gaan NIET
> verloren, ze wachten tot onze poll ze ophaalt (volgende stap). Ook al het
> oude UITGAANDE EDI (facturen via `E:\edi\edi_uit\`) ligt nu stil — orderbev
> doen we handmatig, factuur-EDI volgt deze week (zie onderaan).

---

## 2. Cron activeren (migratie 305)

Pas nu toe:

```
supabase/migrations/305_transus_poll_send_cron.sql
```

Dit schedulet `transus-poll-elke-minuut` + `transus-send-elke-minuut`. Vanaf nu
trekt de poll elke minuut de inbox leeg.

Controleer dat de jobs staan:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname LIKE 'transus-%';
```

---

## 3. Eerste rondreis verifiëren

Trigger de poll één keer handmatig (of wacht 1 minuut op de cron):
```bash
curl "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/transus-poll?token=<CRON_TOKEN>"
```
Verwacht JSON met o.a. `"processed"`, `"ok"`, `"orders_created"`.

Controleer in de DB:
```sql
-- Recent ontvangen berichten
SELECT id, transactie_id, richting, berichttype, status, debiteur_nr, order_id,
       error_msg, created_at
FROM edi_berichten
WHERE richting = 'in'
ORDER BY created_at DESC
LIMIT 20;

-- Automatisch aangemaakte orders
SELECT id, order_nr, debiteur_nr, status, bron_systeem, bron_order_id, created_at
FROM orders
WHERE bron_systeem = 'edi'
ORDER BY created_at DESC
LIMIT 20;
```

Verwacht: bericht `status='Verwerkt'` met een `order_id`, en een corresponderende
order met `bron_systeem='edi'`, `status='Nieuw'`.

**Bij `status='Fout'` op een bericht:** lees `error_msg`.
- *"Geen debiteur gematcht op GLN"* → de afzender-GLN staat niet op een debiteur.
  Vul `debiteuren.gln_bedrijf` aan en herdraai:
  ```sql
  SELECT create_edi_order(<bericht_id>, payload_parsed, <debiteur_nr>)
  FROM edi_berichten WHERE id = <bericht_id>;
  ```
- Andere fout → payload staat veilig in `payload_raw`; geen order verloren.

---

## 4. Uitgaande orderbevestiging testen (handmatig)

1. Open een binnengekomen EDI-order in RugFlow → bericht-detail.
2. Klik **Bevestigen** → er komt een `richting='uit', berichttype='orderbev'`-rij
   op `Wachtrij`.
3. `transus-send` (cron, elke minuut) pakt hem op en verstuurt via M10100.
4. Controleer:
   ```sql
   SELECT id, berichttype, status, transactie_id, error_msg, sent_at
   FROM edi_berichten WHERE richting = 'uit'
   ORDER BY created_at DESC LIMIT 10;
   ```
   Verwacht `status='Verstuurd'` met een `transactie_id`.

---

## 5. Monitoring eerste 48u

Draai periodiek; let extra op top-5 (BDSK, SB-Möbel BOSS, Hornbach NL, Hammer, Krieger):
```sql
-- Alles wat aandacht nodig heeft
SELECT richting, berichttype, status, count(*)
FROM edi_berichten GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Foutgevallen
SELECT id, richting, berichttype, debiteur_nr, error_msg, created_at
FROM edi_berichten WHERE status = 'Fout' ORDER BY created_at DESC;
```
Fout = handmatig fixen/acken; geen automatische blocker.

---

## Rollback (als de API faalt)

1. Cron uitzetten:
   ```sql
   SELECT cron.unschedule('transus-poll-elke-minuut');
   SELECT cron.unschedule('transus-send-elke-minuut');
   ```
2. Windows Connect op `MITS-CA-01-009` opnieuw activeren / service herstarten
   (eventueel via "Connect installeren" in het portaal).
3. Nooit beide tegelijk actief laten.

---

## Bekende gaten (na cutover, deze week)

- **Factuur via EDI**: nog geen automatisch pad. Builder staat klaar; trigger +
  queue-koppeling volgt. ~10 partners met `factuur_uit=true`. Facturen gaan pas
  ná levering uit → een paar dagen runway. **Prioriteit deze week.**
- **Verzendbericht (DESADV)**: niet gebouwd (alleen Hornbach NL). V2 — `zendingen`
  mist SSCC/gewicht/tracking.
- **Automatische orderbev/factuur-triggers**: nu handmatig; auto-trigger +
  server-side payload-bouw staat op de fase-2-backlog.
