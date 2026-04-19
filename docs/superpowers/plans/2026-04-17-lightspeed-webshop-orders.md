# Lightspeed Webshop Orders → RugFlow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orders uit twee Lightspeed eCom webshops (Floorpassion NL + DE) automatisch aanmaken in RugFlow zodra ze betaald zijn, onder één verzameldebiteur (99001), met de particuliere eindkoper als leveradres-snapshot.

**Architecture:** Lightspeed stuurt `orders/paid` webhooks naar een publieke Supabase edge function. Die function verifieert de MD5-signature met het shop-specifieke API-secret, fetcht de volledige order via de Lightspeed REST API (webhook-payload is beperkt), mapt webshop-producten naar RugFlow `artikelnr` (primair op SKU, fallback op productnaam), en schrijft `orders` + `order_regels` in één transactie. Idempotentie via `bron_systeem`/`bron_order_id` op `orders`. Fase 2 (voorraad-sync, levertijden terug) staat buiten deze plan-scope.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), PostgreSQL migration voor bron-tracking, Lightspeed eCom REST API (HTTP Basic auth, EU1-cluster).

---

## File Structure

**Create:**
- `supabase/migrations/092_orders_bron_tracking.sql` — kolommen `bron_systeem TEXT`, `bron_order_id TEXT`, `bron_shop TEXT` op `orders`; partial unique index op `(bron_systeem, bron_order_id)` waar NOT NULL
- `supabase/functions/sync-webshop-order/index.ts` — webhook-handler: verify signature → fetch order → map → insert. Sub-helpers inline klein houden
- `supabase/functions/_shared/lightspeed-client.ts` — auth, fetch wrappers, typing voor order/shippingAddress/orderRows
- `supabase/functions/_shared/lightspeed-verify.ts` — MD5(payload + secret) vs x-signature check
- `supabase/functions/_shared/product-matcher.ts` — resolveer webshop-item → RugFlow `artikelnr` via SKU of naam/type fallback
- `scripts/register-lightspeed-webhooks.mjs` — eenmalig script dat per shop `POST /webhooks.json` uitvoert voor `orders/paid` (en evt. `orders/created`). Idempotent: list first, skip als endpoint al geregistreerd
- `scripts/test-lightspeed-sync-local.mjs` — simuleer een webhook-payload + signature en POST naar lokale edge function

**Modify:**
- `docs/database-schema.md` — sectie `### orders` uitbreiden met 3 bron-kolommen
- `docs/architectuur.md` — nieuwe sectie "Webshop-integratie (Lightspeed eCom)" met flow-diagram + edge-function-pattern
- `docs/data-woordenboek.md` — `Verzameldebiteur`, `Webshop-order`, `Bron-systeem` toevoegen
- `docs/changelog.md` — entry

**Do NOT touch (uit scope):**
- Frontend: webshop-orders verschijnen vanzelf in de bestaande orderlijst omdat ze `orders`-rijen zijn. Geen aparte UI nu
- Voorraad- of prijs-sync richting Lightspeed (fase 2)
- Refunds/returns/cancels — alleen `paid`-orders in deze fase
- Particuliere-klant kortingen/BTW-logica — neem de bedragen uit de Lightspeed-order over als snapshot
- Automatische levertijd-herberekening voor webshop-orders — gebruik wat Lightspeed stuurt + globale defaults

---

## Scope-beslissingen (vastgelegd 2026-04-17)

- **Webhook-event:** alleen `orders/paid` (betaald = echte order). `orders/created` laten we weg: een aangemaakte maar niet-betaalde order hoort niet in productie.
- **Debiteur:** alle orders (NL + DE) onder `debiteur_nr = 99001` (migratie 091). Shop-herkomst leggen we in `bron_shop` vast (`'floorpassion_nl'` / `'floorpassion_de'`) voor rapportage.
- **Product-matching:** (1) SKU == `artikelnr` exacte match, (2) anders productnaam-match op producten.naam/type-veld (case-insensitive), (3) anders: order wél aanmaken, orderregel met `artikelnr = NULL` + `omschrijving = "[UNMATCHED] <webshop-naam>"` + flag → handmatig reviewen. Niet blokkeren: webshop-klant heeft al betaald.
- **Adres-snapshot:** particuliere naam/adres/postcode/plaats/land uit Lightspeed `shippingAddress` landen in `orders.leveradres_*`-velden (bestaande snapshot-architectuur). Factuuradres idem voor factuurvelden als afwijkend.
- **Idempotentie:** (bron_systeem, bron_order_id) unique. Dubbele webhooks → `ON CONFLICT DO NOTHING` op orders-insert, edge function geeft 200 terug (anders blijft Lightspeed retryen).
- **Signature-validatie:** verplicht. Ongeldige signature → 401, geen insert. Secret uit env per shop.
- **Retry & timeout:** Lightspeed verwacht 2xx binnen 5s. Dus: signature-check synchroon, maar API-fetch + DB-insert kunnen doorlopen. Voor nu doen we het synchroon — edge function is snel genoeg — en kijken we na livegang of het moet splitsen (200 teruggeven, background task).

---

## Task 1: Migratie 092 — bron-tracking op orders

- [ ] Schrijf migratie die `bron_systeem`, `bron_order_id`, `bron_shop` toevoegt
- [ ] Partial unique index: `(bron_systeem, bron_order_id) WHERE bron_systeem IS NOT NULL`
- [ ] `COMMENT ON COLUMN` voor elk veld (wat, voorbeelden, nullable-semantiek)
- [ ] Idempotent: `ADD COLUMN IF NOT EXISTS`
- [ ] Smoke-test in psql (BEGIN/ROLLBACK): twee inserts met zelfde bron-id moeten falen

## Task 2: Lightspeed-client helper

- [ ] `_shared/lightspeed-client.ts` exporteert `createClient({shop: 'nl' | 'de'})` dat env-vars leest
- [ ] HTTP Basic auth via `Authorization: Basic base64(key:secret)`
- [ ] Functies: `getOrder(id)`, `getOrderProducts(orderId)`, `getCustomer(id)` — typed responses (minimaal, geen volledige SDK)
- [ ] Base URL uit env `LIGHTSPEED_{NL|DE}_CLUSTER_URL`
- [ ] Fouthandling: 4xx → gooi error met body, 5xx → retry (1×, exponentieel) en gooi dan

## Task 3: Webhook signature verifier

- [ ] `_shared/lightspeed-verify.ts` met `verify(payload: string, signature: string, secret: string): boolean`
- [ ] MD5-implementatie via Web Crypto (SubtleCrypto is sha-only; gebruik `node:crypto` via Deno compat of een kleine MD5-helper — check Deno std)
- [ ] Constante-tijd-vergelijking (`timingSafeEqual`-equivalent) om timing-attacks te voorkomen
- [ ] Unit test: correcte signature → true, 1-byte-flip → false

## Task 4: Product-matcher

- [ ] `_shared/product-matcher.ts` exporteert `matchProduct(supabase, webshopItem): Promise<{artikelnr: string | null, matchedOn: 'sku' | 'naam' | 'geen'}>`
- [ ] Query 1: `select artikelnr from producten where artikelnr = ?` (SKU)
- [ ] Query 2: `select artikelnr from producten where lower(naam) = lower(?) limit 2` — als precies 1 match → gebruik; bij 0 of >1 → fallback
- [ ] Return `{artikelnr: null, matchedOn: 'geen'}` bij niet-matchen (caller maakt placeholder-regel)
- [ ] Edge-case test: SKU met spaties/case, naam met diakrieten

## Task 5: Edge function `sync-webshop-order`

- [ ] `serve` handler leest raw body + headers, parset shop uit path-parameter of header (`X-Shop: nl|de`)
- [ ] Signature-check tegen shop-specifiek secret uit env → 401 bij falen
- [ ] Parse webhook-payload (min. `id` en `number`)
- [ ] Fetch volledige order via Lightspeed-client (webhook bevat vaak alleen top-level)
- [ ] Bouw `orders`-row: `debiteur_nr = 99001`, `bron_systeem='lightspeed'`, `bron_shop`, `bron_order_id`, leveradres-snapshot, factuuradres-snapshot, totaalbedragen uit order, valuta, referentie = webshop ordernummer
- [ ] Voor elke `orderRow`: resolve artikelnr via product-matcher, bouw `order_regels`-row met prijs/aantal/omschrijving
- [ ] DB-insert in één transactie (RPC of sequential met ON CONFLICT op orders)
- [ ] Op conflict (dubbele webhook): log, return 200 zonder opnieuw te inserten
- [ ] Return 200 met `{order_nr: '...', matched: N, unmatched: M}`
- [ ] Log-regel met shop + bron_order_id + aantal unmatched

## Task 6: Webhook-registratie script

- [ ] `scripts/register-lightspeed-webhooks.mjs` gebruikt envs uit `supabase/functions/.env`
- [ ] Per shop: `GET /webhooks.json` — check of endpoint al geregistreerd
- [ ] Anders `POST /webhooks.json` met `itemGroup='orders'`, `itemAction='paid'`, `format='json'`, `address=<edge-function-URL>`, `language=nl|de`, `isActive=true`
- [ ] Print uitkomst (aangemaakt / overgeslagen)
- [ ] Vereist dat edge function al gedeployed is — docs vermelden volgorde

## Task 7: Lokale smoke-test

- [ ] `scripts/test-lightspeed-sync-local.mjs` bouwt fake webhook-payload + berekent geldige signature
- [ ] POST naar `http://localhost:54321/functions/v1/sync-webshop-order?shop=nl`
- [ ] Asserts: 200-respons, order-row bestaat in DB, bron_order_id gezet, alle regels aangemaakt of als UNMATCHED gemarkeerd
- [ ] Tweede POST → 200, geen duplicate (idempotentie)

## Task 8: Productie-deploy

- [ ] `supabase secrets set --env-file supabase/functions/.env` (alle LIGHTSPEED_* + FLOORPASSION_DEBITEUR_NR)
- [ ] `supabase functions deploy sync-webshop-order --no-verify-jwt` (webhooks dragen geen JWT; auth via signature)
- [ ] Draai `register-lightspeed-webhooks.mjs` voor beide shops
- [ ] Plaats 1 testbestelling per shop (of gebruik Lightspeed's test-webhook-trigger) en verifieer dat de order in RugFlow landt
- [ ] Monitor edge-function-logs 48h na livegang

## Task 9: Docs bijwerken

- [ ] `docs/database-schema.md` — orders-sectie + bron-kolommen
- [ ] `docs/architectuur.md` — webshop-integratie sectie
- [ ] `docs/data-woordenboek.md` — 3 nieuwe begrippen
- [ ] `docs/changelog.md` — entry met migratie 091+092 en edge function

---

## Open vragen voor tijdens implementatie

- Exacte Lightspeed order-veld-namen (is het `shippingAddress.zipcode` of `shipping_zipcode`?) — eerst API-doc checken bij Task 2
- Bestaat `producten.naam` of heet het `omschrijving` / `type`? — schema checken bij Task 4
- Hoe gaat RugFlow om met BTW-shift NL vs DE? — voor nu: neem bedragen 1-op-1 uit Lightspeed over, geen eigen herberekening
- `--no-verify-jwt` alleen op deze function, niet globaal — verifiëren bij Task 8

## Validatie-criteria

De plan is klaar als:
- Eén testorder per shop (NL + DE) verschijnt automatisch in de orderlijst van RugFlow
- Order heeft `debiteur_nr=99001`, correcte `bron_shop`, unieke `bron_order_id`
- Matched producten hebben een geldig `artikelnr` op de regel; unmatched producten hebben `[UNMATCHED]` prefix en NULL artikelnr
- Dezelfde webhook twee keer afvuren produceert geen duplicate order
- Signature-check: verkeerd secret → 401, edge function logt de poging
