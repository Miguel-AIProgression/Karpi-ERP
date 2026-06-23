# Deelzending correct maken: override, pakbon, facturatie-timing, DESADV-per-zending

## Context

Tijdens het lokaal testen van een deelzending (ORD-2026-0788, FRIEDHELM SCHAFFRATH) bleek `start_deelzending` te falen omdat de klant `deelleveringen_toegestaan=false` heeft. Bij het doorvragen "wat gebeurt er dan verder" zijn met directe code-/DB-verificatie (geen aannames) twee structurele gaten gevonden naast de ontbrekende override:

1. **Geen handmatige override-mogelijkheid** voor `deelleveringen_toegestaan` — de guard in `start_deelzending` is hard, geen escape hatch.
2. **Pakbon toont nergens dat het een deelzending is** — `is_deelzending` wordt nergens gelezen buiten waar hij gezet wordt (geverifieerd: nul andere matches).
3. **Facturatie wacht op de hele order** — `enqueue_factuur_voor_event()` (mig 252/423) filtert op `event_type='pickronde_voltooid' AND status_na='Verzonden'`. Een voltooide deelzending zet de order op `'Deels verzonden'` via `markeer_deels_verzonden()`, die een ANDER `event_type` logt (`'deels_verzonden'`, geverifieerd in de mig-218/258-broncode) — de trigger vangt dat dus niet. Resultaat: bij een vertraagde laatste regel krijgt de klant maanden geen factuur voor allang geleverde goederen.
4. **DESADV (EDI-verzendbericht) is per ORDER, niet per fysieke zending** — `bouw-verzendbericht-edi` zoekt op `orders.status='Verzonden'`, pakt willekeurig de EERSTE zending (`haalZendingOp`, `.limit(1)` zonder ORDER BY) voor `zendingNr`/`verzenddatum`, maar bouwt de regel-lijst uit **alle** `order_regels` (niet zending-gescoped) met het volledige bestelde aantal (`orderaantal`, niet het werkelijk-verzonden `zending_regels.aantal`). Voor ORD-2026-0788 (een EDI-order) zou dit later één DESADV opleveren met alle 44 regels alsof ze in één keer verzonden zijn, terwijl het fysiek twee zendingen op twee data waren.

Belangrijkste ontwerprestrictie: **voor elke order zonder deelzending (de overgrote meerderheid) moet het gedrag van facturatie en DESADV exact hetzelfde blijven.** Beide herontwerpen zijn zo gekozen dat ze voor het bestaande (niet-deelzending) pad een no-op zijn.

---

## Deel 1 — Handmatige override van `deelleveringen_toegestaan`

**RPC:** `start_deelzending` krijgt een nieuwe parameter `p_override_reden TEXT DEFAULT NULL`. Guard (d) wordt overgeslagen zodra `p_override_reden` gevuld is, en de reden wordt mee-gelogd in de bestaande `order_events`-rij `'deelzending_gestart'` (kolom `metadata`).

**Nieuwe read-only RPC `kan_deelzending(p_order_id BIGINT) RETURNS BOOLEAN`** — exact dezelfde voorwaarde als guard (d), los gehaald zodat de frontend 'm vooraf kan checken zonder te gokken op een foutmelding-string.

**Frontend (`deelzending-dialog.tsx`):** bij openen de RPC aanroepen; als `false` een amber waarschuwingsblok tonen met een verplicht tekstveld "Reden voor overrulen". De bevestigknop blijft disabled tot dat veld gevuld is.

**Bijvangst:** `start_deelzending`'s audit-insert had altijd al een latente bug (kolom `payload` i.p.v. de echte kolom `metadata`) — gefixt incidenteel in dezelfde migratie.

Geïmplementeerd in migratie 473.

---

## Deel 2 — "Deelzending"-indicator op de pakbon

Eén canonieke builder (`bouwPakbonDocument` in `supabase/functions/_shared/pakbon/pakbon-document.ts`), cross-root geïmporteerd door zowel de React-component als de server-side PDF (ADR-0033). `PakbonZendingInput.is_deelzending` → `PakbonDocument.isDeelzending` → badge op beide renderers (browser-pakbon + server-PDF), alleen zichtbaar bij een deelzending.

Geïmplementeerd zonder migratie (puur TS, kolom `zendingen.is_deelzending` bestond al).

---

## Deel 3 — Facturatie reageert op een voltooide deelzending

**Root cause:** `markeer_deels_verzonden()` (mig 258) roept `_apply_transitie(..., p_event_type:='deels_verzonden', p_status_na:='Deels verzonden')` — een ANDER event_type dan `markeer_verzonden()`'s `'pickronde_voltooid'`. De trigger-conditie in `enqueue_factuur_voor_event()` dekt nu BEIDE combinaties:

```sql
IF NOT (
  (NEW.event_type = 'pickronde_voltooid' AND NEW.status_na = 'Verzonden') OR
  (NEW.event_type = 'deels_verzonden'    AND NEW.status_na = 'Deels verzonden')
) THEN
  RETURN NEW;
END IF;
```

De rest van de functie (mig-423-vertragingslogica, de `INSERT ... ON CONFLICT (zending_id) DO NOTHING`) is ongewijzigd — dat dekt dit al correct: bij de deelzending-completion is er nog maar 1 zending om over te loopen (wordt nu wél ingequeued); bij de latere order-completion wordt de al-ingequeuede deelzending door de ON CONFLICT overgeslagen.

Geïmplementeerd + verifieerd (rolled-back transactie, order 2487/zending 57) in migratie 474.

---

## Deel 4 — DESADV per fysieke zending i.p.v. per order

Grootste, risicovolste wijziging — raakt een live EDI-koppeling (Hornbach, BDSK).

**Herontwerp — eenheid wordt de zending, niet de order:**

1. `zoekKandidaten()` zoekt voortaan op `zendingen.gereed_op IS NOT NULL` (eerste moment 'Klaar voor verzending', blijft staan ook als de status later naar Onderweg/Afgeleverd gaat) i.p.v. `orders.status='Verzonden'` + `orders.verzonden_at`. Bewust NIET gefilterd op orders.status — een deelzending bereikt dat moment vaak terwijl de order nog 'Deels verzonden' is.
2. Idempotentie-sleutel wordt `(order_id, zending_id)` — de twee dedicated kolommen op `edi_berichten` (`zending_id` bestond al, was tot nu altijd NULL voor dit berichttype). Nieuwe partial unique index `uk_edi_berichten_verzendbericht_actief` (mig 475); de oude `uk_edi_berichten_uitgaand_actief` is verengd tot `berichttype <> 'verzendbericht'` zodat de andere berichttypes (order/orderbev/factuur) ongewijzigd blijven.
3. `verwerkOrder(orderId)` → `verwerkZendingOrder(zendingId, orderId)`: regels komen uit `zending_regels` (gejoind naar `order_regels`/`producten` voor regelnummer/omschrijving/GTIN — DESADV toont nog steeds het ORIGINELE artikel, omsticker blijft intern), met `aantal = SUM(zending_regels.aantal)` per order_regel (een regel kan over meerdere zending_regels-rijen verdeeld zijn, bv. meerdere rollen) i.p.v. `order_regels.orderaantal`.
4. Bundel-zendingen (mig 222) blijven ongewijzigd qua granulariteit: per order in de zending één DESADV-bericht, nu met de juiste regel-subset per zending i.p.v. de hele order.
5. Targeted POST-modus wijzigt van `{order_id}` naar `{zending_id}` (verwerkt alle betrokken orders van die zending) — geverifieerd dat geen enkele bestaande caller (cron draait altijd sweep-modus `{}`) van de oude vorm afhankelijk was.

**Backwards-compatibiliteit:** een normale order heeft precies 1 zending → dit levert exact 1 DESADV met alle regels op, identiek aan vandaag. Geverifieerd op echte data (order 2487/zending 57): oude `order_regels.orderaantal`-query en nieuwe `SUM(zending_regels.aantal)`-query geven byte-identieke regel-inhoud. Het gedragsverschil is uitsluitend zichtbaar bij orders met ≥2 zendingen — geverifieerd via een gefabriceerde, rolled-back deelzending-split van een echte 10-regelige EDI-order (3780/zending 177 → 7 regels blijven op 177, 3 regels verhuizen naar een nieuwe zending 222; kandidaten-query herkent 177 correct als `al_aanwezig` en 222 correct als nieuwe kandidaat, geen dubbele/gemiste regels).

Geïmplementeerd in migratie 475 + herschreven `supabase/functions/bouw-verzendbericht-edi/index.ts`.

**Niet meegenomen (bewust, te riskant zonder expliciete vraag):** wijzigingen aan `bouw-factuur-edi` (factuur-DESADV is een ander documenttype) en aan de EDI-orderbevestiging-flow.

---

## Branch & deploy

Eén branch `feat/deelzending-correctheid`, 4 losse commits (1→2→3→4). Migraties 473-475 zijn rechtstreeks op de live DB toegepast (project-conventie: migraties zijn directe DB-wijzigingen, geen apart deploy-moment). De edge function-wijziging (Deel 4) is een EXTRA, apart bevestigingsmoment vóór deploy — de cron (`verzendbericht-edi-sweep`, elke 15 min) stuurt na deploy binnen 15 minuten echte DESADV-berichten naar live handelspartners (Hornbach, BDSK); dat is bewust niet automatisch meegenomen met de migraties.
