---
status: accepted
date: 2026-05-08
---

# Vervoerder-Keuze als deep Module — klant-fallback vervalt, regels worden leidend

## Context

Het concept *"welke vervoerder geldt voor X"* is in de huidige codebase fundamenteel **shallow**. Vier feitelijke bronnen leven naast elkaar — `vervoerders.actief` (globaal-actief fallback), `vervoerder_selectie_regels` (regel-evaluator, mig 208/210), `edi_handelspartner_config.vervoerder_code` (klant-fallback, mig 170), `order_regels.vervoerder_code` (per-regel-override, mig 219) — en worden door **drie verschillende RPCs** met **drie verschillende fallback-volgordes** geconsumeerd:

- [`preview_vervoerder_voor_order`](../../supabase/migrations/215_preview_vervoerder_voor_order.sql) (mig 215): `regel → geen` (geen klant-fallback)
- [`effectieve_vervoerder_per_orderregel`](../../supabase/migrations/219_orderregel_vervoerder_override.sql) (mig 219): `override → regel → klant_fallback → geen`
- [`selecteer_vervoerder_voor_zending`](../../supabase/migrations/210_selecteer_vervoerder_via_regels.sql) (mig 210): `regel → klant_fallback → geen`

De UI-component [`VervoerderInlineSelect`](../../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx) voegt nóg een vierde ladder toe: `regel-preview → klant → globaal-actief → geen`. Vier ladders voor één concept.

Een operator-bug op 2026-05-08 maakte dit zichtbaar: het kiezen van DPD in de pill voor een order-rij bleek niet "aan te komen" omdat de upsert-keten naar `edi_handelspartner_config` (a) silent faalt zonder error-toast, (b) niet alle preview-cache-keys invalideert, en (c) op een tabel schrijft die conceptueel over Transus-EDI-toggles gaat — niet over vervoerder-keuze.

Twee diepere observaties uit het onderzoek:

1. **Klant-fallback dupliceert wat de regel-engine al kan.** Een regel met conditie `{debiteur_nrs: [X]}` (al ondersteund in `matcht_regel`, mig 214) doet exact hetzelfde als een rij in `edi_handelspartner_config.vervoerder_code`, maar zit in de juiste tabel met expliciete prio-volgorde t.o.v. andere regels. De klant-fallback heeft **geen meerwaarde boven een verzendregel** — alleen een snellere upsert-flow.

2. **Order-niveau preview liegt bij multi-vervoerder splitsing.** [`preview_vervoerder_voor_order`](../../supabase/migrations/215_preview_vervoerder_voor_order.sql) draait de evaluator één keer met order-aggregaten (`MAX(LEAST(L,B))`, `SUM(gewicht)`). Een order met één klein pakje (UPS) + één pallet (DPD) levert per-regel `[UPS, DPD]` op, maar order-niveau-preview returnt één code. [`start_pickronden_voor_order`](../../supabase/migrations/220_start_pickronden_per_vervoerder.sql) (mig 220) splitst die order toch in twee zendingen — de pill toonde dus een belofte die de werkelijke flow al niet meer waarmaakte.

## Beslissing

Maak van vervoerder-keuze een **deep Module** met één bron-van-waarheid: de **orderregel**. De ladder wordt versimpeld naar drie niveaus:

```
override (per regel)  →  regel-evaluator  →  geen
```

Order-niveau is een **afgeleide aggregatie**: alle regels gelijk → die code; mix → "Mix · UPS+DPD"; geen → "Geen regel" (link naar `/verzendregels`). Geen aparte order-niveau-resolver-RPC meer.

### Klant-fallback vervalt

Kolom `edi_handelspartner_config.vervoerder_code` (mig 170) wordt **gedropt**. `edi_handelspartner_config` keert terug naar zijn oorspronkelijke concern: Transus-EDI-toggles per partner.

Bestaande klant-vervoerder-data wordt **eenmalig gemigreerd** naar `vervoerder_selectie_regels`: voor elke `(debiteur_nr, vervoerder_code)`-combo wordt één regel ingevoegd met conditie `{debiteur_nrs: [debiteur_nr]}`, prio `9000` (laag in de stack zodat specifiekere regels op land/gewicht voorgaan), `actief = TRUE`, met notitie `'Auto-gemigreerd uit klant-fallback (ADR-0008)'`. Geen functioneel verlies; operator ziet z'n bestaande keuze terug onder `/verzendregels` en kan 'm aanpassen, dempen of vervangen.

### Bulk-override op order-niveau blijft als UX-affordance

[`VervoerderInlineSelect`](../../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx) blijft klikbaar — maar schrijft niet meer naar een klant-config-tabel. In plaats daarvan zet de selectie via één RPC `set_orderregel_vervoerder_override_voor_order(p_order_id, p_code)` de override op alle regels van de betreffende order tegelijk (intern: bulk-`UPDATE order_regels SET vervoerder_code = p_code WHERE order_id = p_order_id`, met respect voor de lock-trigger uit mig 219). De operator behoudt z'n één-klik-flow, het concept "vervoerder voor deze order" wordt expliciet *override op alle regels* en niet *fallback voor een onzichtbare klant-instelling*.

### Module-interface (smal)

`modules/logistiek/` exporteert via barrel:

- **Hooks** — `useVervoerderKeuzePerOrderregel(orderId)`, `useVervoerderKeuzeVoorOrder(orderId)` (afgeleide aggregatie, dunne TS-laag), `useSetOrderregelVervoerderOverride()`, `useSetOrderVervoerderOverride()` (bulk).
- **Components** — `VervoerderInlineSelect` (refactor: bulk-write + "Geen regel"-affordance), `VervoerderOrderregelPill` (bestaand, refactor naar nieuwe hook).
- **Types** — `VervoerderKeuze`, `VervoerderKeuzeBron = 'override' | 'regel' | 'geen' | 'afhalen'`.

Verwijderd uit publieke interface (en uit codebase): `useKlantVervoerderConfig`, `useUpsertKlantVervoerderConfig`, `useVervoerderPerOrder`, `useVervoerderPreview`, `fetchKlantVervoerderConfig`, `upsertKlantVervoerderConfig`, `updateZendingVervoerderVoorOrder`. Dat is een breed surface-verlies — bewust: deze hooks zijn shallow wrappers die de divergentie veroorzaakten.

### DB-laag (drie migraties als één keten)

Volgnummers 224 → 225 → 226 (220-223 zijn bezet).

1. **Mig 224 — auto-migreer klant-fallback naar verzendregels.** Idempotent INSERT in `vervoerder_selectie_regels` voor elke niet-NULL `edi_handelspartner_config.vervoerder_code`. Bevat een DO-block-assertie die op herhaling een exception gooit als duplicaat-rijen ontstaan.
2. **Mig 225 — vereenvoudig ladder in bestaande RPCs.** Vertrekt van de canonieke body in [mig 221](../../supabase/migrations/221_orderregel_vervoerder_is_locked.sql) (NIET mig 219) — die voegde `is_locked BOOLEAN` aan de signature toe. `effectieve_vervoerder_per_orderregel`, `selecteer_vervoerder_voor_zending` (mig 210), trigger uit mig 172, stats-query uit mig 174, en afhaal-skip uit mig 205 verliezen hun klant-fallback-tak en lezen niet meer uit `edi_handelspartner_config.vervoerder_code`. `is_locked` blijft behouden.
3. **Mig 227 — drop kolom + nieuwe RPCs.** *(Mig 226 was op dezelfde branch bezet door een facturatie-drain-cron-hotfix; de vervoerder-keuze-slot kreeg daardoor 227.)* `SET LOCAL lock_timeout = '3s'` + `ALTER TABLE edi_handelspartner_config DROP COLUMN vervoerder_code`. Drop `preview_vervoerder_voor_order` (mig 215). Maak `set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT)`.
4. **Hernoem (optioneel, latere PR)** — `effectieve_vervoerder_per_orderregel` → `vervoerder_keuze_per_orderregel` voor lexicale consistentie. Niet load-bearing; kan ook als alias.

## Overwogen alternatieven

- **Klant-fallback verhuizen naar `debiteuren.standaard_vervoerder_code`** (originele kandidaat 2 uit het architectuur-onderzoek). Lost de misnoemde-tabel-friction op maar conserveert het concept van een aparte ladder-bron — terwijl de regel-engine al precies dit kan. **Gebruiker koos expliciet "regels leidend, klant-fallback vervalt"** tijdens grilling-loop op 2026-05-08. Dat is rigoureuzer en geeft één bron i.p.v. twee.

- **Klant-fallback omzetten in impliciete verzendregel bij elke upsert** (synchronisatie i.p.v. eenmalige migratie). Afgewezen: tweede bron-van-waarheid die continu in sync moet blijven; alle drift-risico's blijven bestaan.

- **Twee concepten naast elkaar laten** (per-regel + order-niveau-preview behouden via `optionele orderregel_id` parameter op één RPC). Pragmatisch — bewaart huidige UX zonder UI-wijziging — maar conserveert de "liegende pill" bij multi-vervoerder splitsing. Niet diep; verzwakt de leverage van de Module.

- **Per-zending als bron-van-waarheid** (vervoerder leeft alleen op `zendingen`, geen `vervoerder_code` op `order_regels`). Radicaal en consistent met "vervoerder is een eigenschap van een zending, niet van een regel". Afgewezen: maakt per-regel-override onmogelijk vóór zending bestaat — terwijl de operator juist op pick-card vóór verzendset wil kunnen sturen.

- **`VervoerderInlineSelect` weghalen** ten faveure van alleen de per-regel-pill. Maximaal puristisch, maar kost de operator één klik (uitklappen) per order-rij. Bulk-override behoudt de UX-snelheid zonder een nieuw concept te introduceren.

## Consequenties

- **Geen `vervoerder_code` meer op `edi_handelspartner_config`.** Alle 4 DB-RPCs en 6 frontend-files die deze kolom lezen worden geraakt. RLS-policies blijven ongewijzigd.

- **Smalle Module-interface, brede interne refactor.** De publieke barrel verliest 7 exports en wint er 4 — netto smaller. De interne implementatie (RPCs, regel-evaluator, lock-trigger) wordt simpeler doordat de ladder één niveau korter is.

- **Bulk-override = N rijen overschreven in één RPC.** De lock-trigger uit mig 219 (`trg_lock_orderregel_vervoerder`) blokkeert wijziging zodra een regel al in een open zending zit; de bulk-RPC moet dat als typed error teruggeven (`restrict_violation` met lijst van regels die niet konden). UI toont welke regels niet zijn aangepast.

- **Migratie-veiligheid.** Mig N+1 (auto-genereer regels) is idempotent en non-destructief — kan in productie zonder downtime. Mig N+2 (RPCs aanpassen) breekt geen bestaand gedrag voor klanten zonder klant-fallback. Mig N+3 (DROP COLUMN) komt pas na verificatie dat alle leeskanten gemigreerd zijn.

- **Tests**:
  - Bestaande tests op `effectieve_vervoerder_per_orderregel` updaten: klant_fallback_code-veld vervalt, prio-volgorde wijzigt.
  - Nieuwe contract-test: bulk-override-RPC respecteert lock-trigger en returnt geblokkeerde regels.
  - Frontend: `VervoerderInlineSelect` krijgt unit-test op `onError`-pad (toast bij `restrict_violation`).
  - Data-migratie krijgt een idempotentie-test: tweemaal draaien levert dezelfde set regels op.

- **Documenten**:
  - [`data-woordenboek.md`](../data-woordenboek.md) — term *Vervoerderselectie* update + nieuwe term *Vervoerder-Keuze (per orderregel)*.
  - [`architectuur.md`](../architectuur.md) — "Logistiek-Module"-sectie aanvullen met de nieuwe interface; verwijderen wat over klant-fallback ging.
  - [`changelog.md`](../changelog.md) — entry voor 2026-05-08 met migratie-keten en breaking-change-melding (publieke barrel).

- **Open kandidaten op de backlog**:
  - Service-keuze (`gekozen_service_code`) krijgt nog geen aparte bulk-RPC; vandaag wordt 'm in de zending bepaald via de regel-evaluator. Als operators ook handmatig service willen overrulen — toekomstige uitbreiding.
  - Zending-niveau "wisselen van vervoerder na pickronde-start" blijft geblokkeerd door lock-trigger; aparte ADR als operator dat in V2 wel wil kunnen.
