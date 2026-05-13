# Vervolg: orderregel-mirror op bundel-facturen — claim-keten recursiebug

> **Doel handoff:** beschrijven wat er in sessie 2026-05-13 is gedaan voor de bundel-korting-feature, waarom de orderregel-mirror is uitgezet, en hoe een latere sessie hem definitief kan herintroduceren.

## Wat de feature beoogt

Bij een bundel-zending (2+ orders samen verzonden) moet de klant maar 1× verzendkosten betalen, en bij overschrijden van een drempel zelfs 0×. Op de factuur is dat **volledig opgelost** sinds 2026-05-13 deploy van mig 262:

- Factuur kopieert VERZEND-orderregels per order (N× regels)
- Voegt 1× `BUNDELKORTING` toe met bedrag `−(N−1) × verzendkosten`
- Voegt 1× `DREMPELKORTING` toe bij `gratis_drempel`-status met bedrag `−1 × verzendkosten`
- Klant ziet correcte rich-omschrijvingen, totaal klopt

**Wat NIET werkt:** de spiegeling van die kortingen als orderregels op de bundle-orders. Daardoor blijft `SUM(orderregels per order) > factuur-totaal` — sales-rapportage telt verzendkosten dubbel.

Concreet voorbeeld FACT-2026-0019:
- ORD-2026-2057: product € 351,60 + VERZEND € 35 = € 386,60
- ORD-2026-2058: product € 376,32 + VERZEND € 35 = € 411,32
- Som orders: € 797,92
- Factuur (correct): € 727,92 ex BTW
- **Discrepantie: € 70**

## Wat in deze sessie is gedaan

Chronologisch in 8 commits:

| Commit | Wat | Status in productie |
|---|---|---|
| `2af573d` | Mig 256 — BUNDELKORTING 2-regel-vorm op factuur (originele D2-keuze) | Vervangen door mig 262 |
| `258dc2f` | Legacy-feitenlijst-script (E1-besluit) | Eenmalig gebruikt |
| `d3dac7e` + `f665c54` | Frontend `fetchBundelInfoVoorFactuur` + 4 vitest-tests | Actief |
| `b36f550` | `useBundelInfoVoorFactuur`-hook + barrel | Actief |
| `c3de125` | `BundelKortingBanner` V2-component | Actief |
| `4e95a1a` | Integratie in `OrderFacturen` | Actief |
| `900c07a` | Docs (changelog, architectuur, woordenboek) | Actief |
| `660dbdb` | Frontend fixes: strikter detect + `bespaart`-formule (3+ orders) | Actief |
| `00163e3` | Mig-256-clash: rename `256_reservering_trigger_verzonden_release` → 259 | Actief |
| `0193edf` | Mig 260 — BUNDELKORTING-orderregel op hoofdorder | Vervangen door mig 262 (nooit live geactiveerd) |
| `7f68d4d` | Mig 261 — V2-layout: N× VERZEND + 2 korting-factuur-regels + orderregel-mirror | Vervangen door mig 262 |
| `71ce9af` | Frontend banner-detect op V2-vorm + tekst-aanpassing | Actief |
| `45399f4` | **Mig 262** — V2-layout op factuur zónder orderregel-mirror | **Huidige live versie** |
| `a40b49c` | Mig 263 — filter admin-artikelnrs in `herwaardeer_claims_voor_order` | Live, maar niet voldoende |
| `d66f260` | Mig 264 — orderregel-mirror gespreid (1e=DREMPEL, overige=BUNDEL) | Gedeployd maar teruggerold door 2e mig 262 deploy |
| `c077421` | Retroactief-script orderregels voor FACT-2026-0019 | Niet succesvol uitgevoerd |

## De productie-keten van vandaag

1. Pre-existing pseudo-producten `VERZEND` in `producten`
2. Pseudo-producten `BUNDELKORTING` + `DREMPELKORTING` toegevoegd in `producten` (handmatige INSERT, niet in een migratie — zie [risico hieronder](#openstaande-data-risicos))
3. Mig 252 deployed (queue-rijen krijgen `zending_id` — was untracked, gecommit als `ae890bd`)
4. Mig 262 deployed (RPC met factuur-V2-layout, geen orderregels)
5. Mig 263 deployed (claim-keten filter — niet meer nodig zonder orderregels, maar staat erin)
6. Retroactief: FACT-2026-0018 (mig 256-vorm) → DELETE + regenereer → FACT-2026-0019 (V2-vorm)
7. Frontend deployed via reguliere CI

Resultaat: factuur correct, banner correct, orderregels niet gespiegeld.

## De bug — N²-recursie in de claim-keten

Bij INSERT van een nieuwe orderregel (specifiek admin-regels zoals BUNDELKORTING) fired een trigger die een keten oproept die zichzelf oneindig herhaalt tot `max_stack_depth` (2048kB) bereikt is.

### De keten

```
INSERT INTO order_regels (artikelnr='BUNDELKORTING', ...)
  ↓
trg_orderregel_herallocateer (mig 146)
  → PERFORM herallocateer_orderregel(NEW.id)        ← directe call, geen filter
       ↓
       PERFORM herwaardeer_order_status(v_order_id)
            ↓
            PERFORM herwaardeer_claims_voor_order(p_order_id)  (mig 254)
                 ↓
                 FOR v_regel_id IN SELECT id FROM order_regels WHERE order_id = p_order_id
                     ↓ (per product-regel)
                     PERFORM herallocateer_orderregel(v_regel_id)
                          ↓
                          PERFORM herwaardeer_order_status(v_order_id)
                               ↓
                               ... ad infinitum, N² explosie
```

### Waarom mig 263 niet voldoende was

Mig 263 voegde een filter toe in `herwaardeer_claims_voor_order`:
```sql
WHERE order_id = p_order_id
  AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
```

Dat fixte: admin-regels triggeren geen `herallocateer_orderregel` meer **vanuit deze functie**.

Maar de keten heeft **twee bronnen**:
- ✅ Pad 1: `herwaardeer_claims_voor_order` → `herallocateer_orderregel` (gefixed door mig 263)
- ❌ Pad 2: `trg_orderregel_herallocateer`-trigger → `herallocateer_orderregel(NEW.id)` (NIET gefixed)

Pad 2 fired bij de INSERT zelf. De trigger-functie heeft geen artikelnr-filter:
```sql
-- mig 146:24-29
IF TG_OP = 'INSERT' OR
   OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
   OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
   OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
  PERFORM herallocateer_orderregel(NEW.id);
END IF;
```

Zodra de admin-regel-INSERT door deze trigger via `herallocateer_orderregel(NEW.id)` belandt, vuren `herwaardeer_order_status` en `herwaardeer_claims_voor_order` voor de **product-regels** van die order. De N² explosie zit dáár — niet in de admin-regels.

**Diepere observatie:** zelfs zonder admin-regel-INSERT zou een gewone product-regel-INSERT ook deze keten triggeren. Dat werkt nu omdat de keten convergeert (status verandert niet meer). Maar bij admin-regels mismatchen iets zodat de loop niet convergeert — vermoedelijk omdat `herwaardeer_order_status` op basis van het nieuw-aangemaakte orderregel-totaal een nieuwe status afleidt die direct `herwaardeer_claims_voor_order` weer triggert.

Dit is een **fundamenteel architectuur-probleem in de claim-keten** dat een echte refactor verdient, niet alleen een filter.

## De fix — twee opties voor latere sessie

### Optie 1 — Pragmatisch (snel, klein risico)

Voeg admin-artikelnr-filter toe in beide trigger-functies:

**Patch [`trg_orderregel_herallocateer`](../../supabase/migrations/146_order_reserveringen_triggers.sql) — mig 146:14-33:**
```sql
CREATE OR REPLACE FUNCTION trg_orderregel_herallocateer()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Skip admin-regels — die hebben geen claim-allocatie nodig en triggeren
  -- de N²-recursie. Zie 2026-05-13-vervolg-orderregel-mirror-recursiebug.md
  IF COALESCE(NEW.artikelnr, '') IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Patch [`trg_order_status_herallocateer`](../../supabase/migrations/146_order_reserveringen_triggers.sql) — mig 146:45-62:**
```sql
-- In de FOR-loop:
FOR v_regel_id IN
  SELECT id FROM order_regels
   WHERE order_id = NEW.id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
LOOP
  ...
```

Daarna mig 264 opnieuw deployen (CREATE OR REPLACE FUNCTION → orderregel-mirror keert terug) plus het retroactief-script [`scripts/retroactief-orderregels-fact-2026-0019.sql`](../../scripts/retroactief-orderregels-fact-2026-0019.sql) runnen voor ORD-2057/2058.

### Optie 2 — Diepere refactor (groter, schoner)

De claim-keten heeft fundamenteel geen termination-guarantee. Mogelijke aanpakken:

- **Advisory lock** in `herallocateer_orderregel` — als al bezig, skip
- **Transition table** in trigger — verzamel alle wijzigingen, verwerk eenmaal aan het eind van de statement
- **Separation of concerns** — claim-allocatie en status-herwaardering uit elkaar trekken, niet in cirkel laten aanroepen

Dit is een week werk. Buiten scope van de bundel-korting-feature.

## Aanbeveling

**Doe Optie 1 in een korte focused sessie.** De claim-keten heeft N²-recursie maar werkt in praktijk omdat normale flows convergeren. Admin-orderregels brengen 'm pas in problemen, en die kunnen we netjes wegfilteren bij de twee bronnen (mig 146 trigger-functies). Optie 2 is een refactor die zelf eigen risico introduceert en niet nodig is voor de bundel-feature.

## Openstaande data-risico's

1. **Pseudo-producten** `BUNDELKORTING` en `DREMPELKORTING` zijn handmatig in `producten` ingevoegd, niet via migratie. Bij een fresh deploy ontbreken ze, en bij eerste bundel-zending crasht `genereer_factuur_voor_bundel` op de FK-constraint. **Fix:** maak `supabase/migrations/265_pseudo_producten_bundelkorting.sql` met idempotente INSERT.
2. **FACT-2026-0019 vs orderregels** ORD-2057/2058: orderregels missen admin-correctie. Som € 797,92, factuur € 727,92, **discrepantie € 70**. Bij rapportages of EDI-uitvoer op order-niveau levert dit foute cijfers op.
3. **Frontend banner** rendert nog correct want hij detecteert via factuur, niet via orderregels. Geen UI-impact.

## Bestanden die je waarschijnlijk wilt openen

- [`supabase/migrations/146_order_reserveringen_triggers.sql`](../../supabase/migrations/146_order_reserveringen_triggers.sql) — bron van beide triggers
- [`supabase/migrations/254_reservering_module_split.sql`](../../supabase/migrations/254_reservering_module_split.sql) — `herwaardeer_claims_voor_order` en `herwaardeer_order_status`
- [`supabase/migrations/263_claims_skip_admin_artikelnrs.sql`](../../supabase/migrations/263_claims_skip_admin_artikelnrs.sql) — eerdere (deel)fix als referentie
- [`supabase/migrations/264_factuur_v2_orderregels_gespreid.sql`](../../supabase/migrations/264_factuur_v2_orderregels_gespreid.sql) — RPC met orderregel-mirror, klaar voor heractivatie
- [`supabase/migrations/262_factuur_v2_zonder_orderregel_mirror.sql`](../../supabase/migrations/262_factuur_v2_zonder_orderregel_mirror.sql) — huidige live versie
- [`scripts/retroactief-orderregels-fact-2026-0019.sql`](../../scripts/retroactief-orderregels-fact-2026-0019.sql) — pakt ORD-2057/2058 retroactief op na fix

## Acceptatie-criteria voor de fix

- Mig 265 (pseudo-producten) deployt zonder error op een fresh DB
- Mig 266 (trigger-patch) deployt zonder error
- Mig 264 re-deploy: `genereer_factuur_voor_bundel(zending_id)` aanroep op een test-bundel maakt zowel factuur-regels als orderregels zonder stack-depth-error
- Retroactief-script runt zonder error en commit succesvol
- Som van orderregels per order = factuur-bedrag dat aan die order is toe te schrijven, na de fix
- Geen regressie in andere claim-flows (test: gewone single-order INSERT/UPDATE blijft werken)
