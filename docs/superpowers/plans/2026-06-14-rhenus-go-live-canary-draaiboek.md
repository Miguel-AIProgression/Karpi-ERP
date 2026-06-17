# Rhenus go-live — canary-draaiboek

**Doel:** vandaag de Rhenus-koppeling van inactief → productief zetten met een **gecontroleerde blast-radius van precies één zending**, die zending écht naar Rhenus' `/in`-map sturen, en via het Rhenus Mandantenportal verifiëren dat het bericht correct binnenkomt en verwerkt wordt. Bij succes morgen de volledige automatische cutover (DE-selectie-regels aan).

**Status-bron:** geverifieerd tegen de live DB + edge-deploy op 2026-06-14 (zie §1). Dit draaiboek vervangt het canary-deel (item 3) uit de handoff van 12-06.

**Gekozen aanpak (Miguel, 14-06):** (1) **synthetische testorder** naar een gecontroleerd DE-adres (geen echte klantorder ompinnen); (2) **direct naar `/in`** — volledige canary vandaag, Rhenus verwerkt + portaal-check + mogelijke fysieke ophaling.

---

## 1. Geverifieerde uitgangsstand (vandaag gecheckt)

| Wat | Stand | Gevolg |
|---|---|---|
| **Gewicht-fix mig 383** | **Toegepast** (548120001 = 14,5 kg, `gewicht_uit_kwaliteit=true`) | colli krijgen echt gewicht → preflight blokkeert niet meer op gewicht |
| `vervoerders.rhenus_sftp.actief` | **FALSE** | er routeert nu niets naar Rhenus; queue leeg |
| Rhenus-selectie-regels | id **1** (DE ≤30 kg, ≥131 cm, prio 10), id **9** (debiteur 99001), id **11** (debiteur 640505) — **alle `actief=true`** | zodra de vervoerder actief wordt, routeren deze automatisch |
| `rhenus_transportorders` | leeg op 1 oude `Geannuleerd`-testrij na (preflight-fout van vóór mig 383) | schone start |
| Edge functions | `rhenus-send` v5 + `rhenus-sftp-spike` v3 **ACTIVE** (rhenus-send herdeployed 13-06) | geen redeploy nodig |
| Cron | `rhenus-send` elke minuut (mig 381), auth via vault-`cron_token` | zending gaat vanzelf binnen ≤1 min de deur uit zodra hij in de wachtrij staat |
| Secrets (Piet-Hein, 12-06) | `RHENUS_SFTP_*` gezet, `RHENUS_DRY_RUN=false`, `RHENUS_SFTP_REMOTE_DIR=/test` | **REMOTE_DIR moet naar `/in`** (zie §3) — anders verwerkt Rhenus niets en verschijnt er niets in het portaal |
| Preflight-eisen Rhenus (capability-registry) | adresvelden (naam/adres/postcode/plaats) verplicht; **telefoon NIET**; per colli `sscc` + `gewicht_kg>0` + `lengte_cm>0`; ≥1 colli | DE-orders zonder telefoonnummer zijn bruikbaar |

**Conclusie:** de enige nog-openstaande infra-stap is de secret `RHENUS_SFTP_REMOTE_DIR` van `/test` → `/in`. Al het andere is klaar.

---

## 2. Veiligheidsmodel — hoe we de blast-radius op 1 zending houden

De resolver (`effectieve_vervoerder_per_orderregel`, mig 219) en de dispatcher (`enqueue_zending_naar_vervoerder`, mig 380) slaan **beide** een Rhenus-route over zolang `vervoerders.rhenus_sftp.actief=FALSE`. Activeren we de vervoerder maar laten we de selectie-regels (id 1/9/11) **uit** staan, dan:

- routeert **geen enkele** automatische DE-order naar Rhenus (geen matchende actieve regel → `bron='geen'` → blijft op "handmatig kiezen", precies zoals nu);
- routeert **alleen** de canary-order, die we via een **expliciete orderregel-override** (`order_regels.vervoerder_code='rhenus_sftp'`) op Rhenus zetten.

Een override naar een inactieve vervoerder wordt bij dispatch geweigerd (`'vervoerder_inactief'`), dus de volgorde is hard: **eerst regels uit → dan vervoerder actief → dan de ene order via override**. Na een geslaagde canary zetten we de regels weer aan = volledige cutover.

**Noodrem (op elk moment):** `UPDATE vervoerders SET actief=FALSE WHERE code='rhenus_sftp';` → alle Rhenus-routing stopt direct. De wachtrij/reaper is idempotent.

---

## 3. Rolverdeling & afhankelijkheden

- **Piet-Hein (owner/admin — enige met secret-rechten):** `RHENUS_SFTP_REMOTE_DIR=/test` → `/in` zetten (Fase 1). Dit is de enige externe afhankelijkheid vandaag.
- **Miguel:** GO/NO-GO op elke irreversibele stap; CRON_TOKEN aanleveren als we `rhenus-send`/spike handmatig willen triggeren (token staat in de vault: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_token';`). Rhenus-portaal-login (zie §6 — checken of die er is).
- **Agent (met service-key uit `import/.env`):** voert de DB-mutaties uit (regels uit/aan, override, pickronde starten, monitoring-queries) — **stap voor stap, alleen op Miguels expliciete GO bij de irreversibele acties** (pickronde-start = het moment dat de XML echt naar Rhenus gaat).

---

## 4. Stappenplan

### Fase 0 — Canary-order kiezen & klaarzetten (vóór activatie)

- [ ] **0.1 Maak de synthetische testorder aan via de RugFlow-UI** (Orders → nieuwe order). De UI-intake regelt order_nr, status-transities, gewicht-derivatie en colli correct — veiliger dan een handmatige SQL-insert. Vul:
  - **Afleveradres:** een echt, door Karpi gecontroleerd **DE-adres** (door Miguel aan te leveren — Rhenus levert hier fysiek af).
  - **Debiteur:** een test-/eigen debiteur naar keuze.
  - **Eén regel** met een simpel **vast** product met gewicht>0 én `lengte_cm`>0 (bv. een klein karpet zoals artikel 526230206 ≈ 0,68 kg, of een ander voorradig vast artikel). Geen maatwerk (vermijdt snijplanning).
  - Zet/breng de order naar **"Klaar voor picken"** (voorraad aanwezig, geen tekort).
- [ ] **0.2 Geef het ordernummer door;** agent verifieert preflight-volledigheid: afl_naam/afl_adres/afl_postcode/afl_plaats gevuld, regel met gewicht>0 en product-`lengte_cm`>0, status "Klaar voor picken", nog géén `zending_orders`-rij (anders is de override-lock al actief).

### Fase 1 — Secret omzetten (Piet-Hein)

- [ ] **1.1** `RHENUS_SFTP_REMOTE_DIR=/test` → `/in`:
  ```
  supabase secrets set --project-ref wqzeevfobwauxkalagtn RHENUS_SFTP_REMOTE_DIR=/in
  ```
  Bevestig dat `RHENUS_DRY_RUN=false` blijft staan. (Geen redeploy nodig — edge leest env per run.)

### Fase 2 — Connectiviteit-sanity (optioneel maar aanbevolen)

- [ ] **2.1** Read-only SFTP-listing van `/in` via de spike, om te bevestigen dat host/user/wachtwoord ná de secret-wijziging nog werken:
  ```
  curl -X POST https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/rhenus-sftp-spike \
    -H "Authorization: Bearer <CRON_TOKEN>" -H "Content-Type: application/json" -d '{}'
  ```
  Verwacht: verbinding ok + maplijst. Faalt dit → stoppen, secret/host nakijken (niets verzonden).

### Fase 3 — Rhenus activeren met dichte regels (blast-radius = 0 automatisch)

- [ ] **3.1** Selectie-regels tijdelijk uit:
  ```sql
  UPDATE vervoerder_selectie_regels SET actief=false WHERE id IN (1, 9, 11);
  ```
- [ ] **3.2** Vervoerder activeren:
  ```sql
  UPDATE vervoerders SET actief=true WHERE code='rhenus_sftp';
  ```
- [ ] **3.3** Verifieer: een willekeurige open DE-order resolvet nu nog steeds naar `bron='geen'` (geen auto-route). Agent checkt via `effectieve_vervoerder_per_orderregel`.

### Fase 4 — Canary-order op Rhenus zetten

- [ ] **4.1** Override op de orderregel(s) van de canary-order:
  ```sql
  UPDATE order_regels SET vervoerder_code='rhenus_sftp'
   WHERE order_id=<canary_order_id> AND artikelnr <> 'VERZEND';
  ```
- [ ] **4.2** Verifieer dat `effectieve_vervoerder_per_orderregel(<order_id>)` nu `effectief_code='rhenus_sftp'`, `bron='override'` geeft.

### Fase 5 — Verzenden (IRREVERSIBEL — expliciete GO van Miguel)

> Vanaf hier gaat er een echt bericht naar Rhenus en kan een fysieke ophaling volgen.

- [ ] **5.1** Pickronde starten voor de canary-order (maakt zending + colli + SSCC, enqueue't Rhenus-transportorder):
  - via UI ("Verzendset" op Pick & Ship voor die ene order), óf
  - via RPC `start_pickronden(ARRAY[<order_id>], <picker_id>)`.
- [ ] **5.2** Controleer dat er **precies één** `rhenus_transportorders`-rij bijkomt (status `Wachtrij`), en dat de colli `sscc` + `gewicht_kg>0` + `lengte_cm` dragen.
- [ ] **5.3** Wachten op de cron (≤1 min) óf handmatig `rhenus-send` triggeren (zelfde curl als 2.1, endpoint `rhenus-send`). Rij → `Verstuurd`.

### Fase 6 — Verifiëren

- [ ] **6.1 DB-audit:** `rhenus_transportorders`-rij = `Verstuurd`, `sent_at` gevuld, `bestandsnaam` `RHE_<datum>_<zending_nr>.xml` (alleen datum, géén tijd — Rhenus-akkoord 2026-06-17); `externe_payloads` (kanaal `rhenus`, richting `out`) rij met `ok=true`; XML-kopie in storage `order-documenten/rhenus-xml/`. `rhenus_verzend_monitor` toont `verstuurd_vandaag=1`, `fout_open=0`.
- [ ] **6.2 XML-inhoud:** open de opgeslagen XML; controleer afzender/ontvanger-adres, `totalGrossWeight` (kg met decimalen), per item `sscc` (AI(00)+SSCC = exact het label), `depth` (lengte in cm), `entityIdentification` = zending_nr, `Freetext` = "Order …".
- [ ] **6.3 Rhenus Mandantenportal:** inloggen op https://mandantenportal.rhenus-hd.de/tat/ en zoeken op **Referentie = zending_nr**. Controleer: transportopdracht aangemaakt, adres/gewicht/afmetingen/SSCC kloppen, geen error-status. *(Vooraf checken of er een portaal-login bestaat — Miguel/Piet-Hein.)*
- [ ] **6.4 `/out`-map** (statusterugkoppeling) in de gaten houden + fysieke ophaling bevestigen (kan morgen). **Let op:** SFTP is fire-and-forget — er is géén API-ack; fouten landen bij Rhenus en werden voorheen per mail gemeld (incident 0455395).

### Fase 7 — Beslissing

- [ ] **7.1 Canary OK** → volledige cutover:
  ```sql
  UPDATE vervoerder_selectie_regels SET actief=true WHERE id IN (1, 9, 11);
  ```
  Vanaf nu routeren DE-orders ≤30 kg / ≥131 cm automatisch naar Rhenus. → werkt morgen.
- [ ] **7.2 Canary NIET OK** → `UPDATE vervoerders SET actief=false WHERE code='rhenus_sftp';` (noodrem), regels laten uitstaan, fout analyseren (XML-builder + unit-test), opnieuw.

### Fase 8 — Nazorg

- [ ] **8.1** Changelog + memory (`project_rhenus_cutover.md`) bijwerken met de canary-uitkomst.
- [ ] **8.2** De 78 wachtende DE-orders verwerken zodra de cutover staat (zij krijgen nu automatisch Rhenus).

---

## 5. Open punten / risico's om te kennen

1. **Geen format-akkoord van Rhenus** (contactpersoon 2 weken afwezig). De canary ís de validatie — daarom portal-check + fysieke ophaling vóór de brede cutover. Geaccepteerd risico (Miguel).
2. **NL-debiteur-pins op Rhenus (id 9 = Floorpassion NL, id 11 = Whoon Oisterwijk NL).** Rhenus is een DE-wegvervoerder; deze pins naar een NL-klant ogen als een legacy-migratie-artefact. **Vóór 7.1 beslissen** of id 9/11 überhaupt weer áán moeten — anders routeren NL-orders van die debiteuren straks naar een DE-vervoerder. Veiligst: bij de cutover alléén id 1 (de DE-regel) aanzetten en id 9/11 uit laten tot bevestigd is dat ze kloppen.
3. **Geen ack-/statuskanaal** — `/out`-map-terugkoppeling staat op de V2-backlog; vandaag dus handmatige portal- en fysieke verificatie.
4. **Synthetische testorder + `/in`** = Rhenus stuurt alsnog een echte ophaling. Een fake adres kan niet geleverd worden; bij optie B dus een gecontroleerd, echt DE-adres gebruiken.

---

## 6. Snelle commando-/query-bijlage (agent voert uit op GO)

- Resolver-check order: `SELECT * FROM effectieve_vervoerder_per_orderregel(<order_id>);`
- Queue na pickronde: `rhenus_transportorders?zending_id=eq.<id>` (PostgREST) of `SELECT * FROM rhenus_verzend_monitor;`
- Noodrem: `UPDATE vervoerders SET actief=false WHERE code='rhenus_sftp';`
- Regels-stand: `SELECT id, vervoerder_code, prio, actief, conditie FROM vervoerder_selectie_regels WHERE vervoerder_code='rhenus_sftp';`
