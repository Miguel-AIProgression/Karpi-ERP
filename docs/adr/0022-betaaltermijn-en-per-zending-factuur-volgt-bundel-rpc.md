# ADR-0022 — Betaaltermijn uit `betaalcondities`-tabel + per_zending-factuur volgt de bundel-RPC

- **Status:** Voorgesteld
- **Datum:** 2026-05-15
- **Context-trigger:** Productie-observatie op FACT-2026-0020/0021/0022 (pickronde van 3 carpetten, debiteuren TRENDHOPPER BREDA / JANSEN TOTAAL WONEN / MEUBILEX BV).

## Context

Drie symptomen op verse concept-facturen, uit één pickronde:

1. **Vervaldatum klopt niet.** FACT-0021 (TRENDHOPPER, betaalconditie `"02 - 30 dagen netto, 8 dagen 2%"`): factuurdatum 15-05, vervaldatum **17-05** = 2 dagen. FACT-0020 (JANSEN, code `03`): 3 dagen. FACT-0022 (MEUBILEX, code `30`): 30 dagen — correct, maar **alleen toevallig** omdat de code gelijk is aan de termijn.
2. **Dubbele verzendkosten op een bundel-factuur.** FACT-0021 bundelt ORD-2026-2051 + ORD-2026-2052; beide dragen een eigen `VERZEND`-regel van € 35 → 2× € 35 voor één fysieke transportbeweging.
3. **Drempel "gratis verzending boven € 500" niet toegepast.** TRENDHOPPER heeft `verzend_drempel = € 500`; het bundel-subtotaal (2× € 419,88 = € 839,76) ligt erboven, maar er wordt toch € 70 verzendkosten gerekend.

### Oorzaak-analyse

**Issue 1 — gedeelde bug in álle factuur-RPC's.** `genereer_factuur` (mig 119/227), `genereer_factuur_voor_week` (mig 232) en `genereer_factuur_voor_bundel` (mig 234) bepalen de betaaltermijn met:

```sql
IF v_debiteur.betaalconditie ~ '^\d+' THEN
  v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
END IF;
```

`debiteuren.betaalconditie` heeft het formaat `"{code} - {naam}"` (mig 202). Het leidende getal is dus de **code**, niet de termijn. Sinds mig 202/203 bestaat er een correct geparste `betaalcondities.dagen`-kolom (code `02` → `dagen = 30`), maar geen enkele RPC is daar ooit op overgezet. De mig 202-comment voorspelde dit expliciet: *"RPC valt dan terug op default (30)."*

**Issues 2 & 3 — niet de code, maar de migratie-staat.** `genereer_factuur_voor_bundel` (mig 234) lost beide al op: het strípt `VERZEND`-orderregels en voegt exact één `VERZEND`-regel toe via `verzendkosten_voor_bundel` (afhalen / klant-gratis / drempel / betaald). De waargenomen factuur gedraagt zich echter als de **legacy `genereer_factuur`** (kopieert order_regels 1-op-1, geen drempel-logica). De `factuur-verzenden` edge function dispatcht op `item.zending_id`:

```
item.zending_id != null  → genereer_factuur_voor_bundel   (mig 234 — correct)
type === 'wekelijks'     → genereer_factuur_voor_week
else                     → genereer_factuur                (legacy — verklaart 2+3)
```

Eén factuur met twee orders + per-order `VERZEND` + geen drempel = legacy `genereer_factuur(order_ids=[2051,2052])`, wat betekent dat de queue-rij wél bundel-brede `order_ids` had maar **`zending_id` NULL** was. Dat wijst op een productie-migratie-staat waarin mig 234 en/of 252 niet (volledig) is toegepast. CLAUDE.md/memory bevestigen het risico: migraties worden handmatig toegepast en mig 235/240 zijn op deze installatie bewust níet gedraaid.

## Besluit

1. **Eén bron-van-waarheid voor betaaltermijn.** Introduceer pure SQL-functie `betaaltermijn_dagen(p_betaalconditie TEXT) → INTEGER`: extraheer de code-prefix, zoek `betaalcondities.dagen`, val terug op 30 bij NULL/onbekend/niet-standaard-formaat. Alle vier RPC's consumeren deze functie i.p.v. de eigen regex.
2. **Per_zending-pad volgt structureel de bundel-RPC.** De juiste eindtoestand is dat élke event-driven factuur via `genereer_factuur_voor_bundel` loopt (mig 234 ontwerp). Fase-0-diagnose stelt de werkelijke productie-staat vast; daarna wordt mig 234/252 (her)toegepast en worden bestaande `factuur_queue`-rijen op `zending_id` gebackfild.
3. **Legacy `genereer_factuur` krijgt een vangnet.** Zolang het legacy-pad bereikbaar is, mag het geen verkeerde factuur meer produceren: het stript voortaan óók `VERZEND`-orderregels en past `verzendkosten_voor_bundel` toe op de som van de meegegeven orders. Zo is het gedrag identiek aan de bundel-RPC, ongeacht welk pad geraakt wordt.
4. **Bestaande foute concept-facturen worden geremedieerd**, niet alleen vooruit gefixt — ze zijn nog `Concept` (niet verstuurd), dus veilig te herzien.

## Gevolgen

- **Positief:** elke factuur (legacy of bundel) krijgt dezelfde, correcte betaaltermijn, verzendkosten en drempel-toets. Eén testbare helper. De divergentie tussen codebase- en productie-migratie-staat wordt zichtbaar gemaakt en gedicht.
- **Negatief / risico:** fase 0 vereist handmatige SQL-inspectie op productie (geen MCP-toegang). Remediatie van bestaande facturen muteert `order_regels.gefactureerd` — moet idempotent en achter expliciete bevestiging.
- **Niet in scope:** drop van de legacy-RPC's (mig 235/237/240-cutover blijft bewust uitgesteld). Wekelijkse-verzamelfactuur-drempel-logica was al correct (mig 232) en wordt alleen op de betaaltermijn-helper aangesloten.

## Alternatieven overwogen

- *Alleen issue 1 fixen, 2+3 als V2 laten.* Verworpen: 2+3 zijn geen ontbrekende feature maar een deploy-gat in reeds geschreven code; klanten worden nú dubbel verzendkosten berekend.
- *Legacy-pad direct droppen (mig 235/237).* Verworpen: te grote cutover voor een hotfix; vangnet-hardening geeft dezelfde correctheid met lager risico.
