# HST fixtures — PLACEHOLDER

> **PLACEHOLDER — vervangen na Fase 0 curl-tests met echte HST acceptatie-omgeving.**

De JSON-bestanden in deze map zijn **niet** afkomstig van een echte HST API-call.
Ze zijn een redelijke gok op basis van wat een typische REST transport-API verwacht
en worden alleen gebruikt om de payload-builder en zijn unit-test draaiend te krijgen
voordat Fase 0 (API-discovery met live HST-credentials) is uitgevoerd.

## Wat moet er gebeuren in Fase 0

Zie [`docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md`](../../../../docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md)
sectie "Fase 0 — API-discovery", taken 0.1 t/m 0.3:

1. **Task 0.1** — OpenAPI/Swagger uit `https://accp.hstonline.nl/restdoc/rest/api/v1#/`
   ophalen en in `docs/logistiek/hst-api/openapi.json` zetten.

2. **Task 0.2** — Live curl tegen ACCP:

   ```bash
   # Username + wachtwoord uit Supabase Vault / 1Password — NIET inline plakken / committen.
   curl -X POST 'https://accp.hstonline.nl/rest/api/v1/TransportOrder' \
     -u "$HST_API_USERNAME:$HST_API_WACHTWOORD" \
     -H 'Content-Type: application/json' \
     -d @example-transportorder-request.json \
     -v
   ```

   Sla de **echte** request op als `example-transportorder-request.json`
   (overschrijf de placeholder) en de **echte** response als
   `example-transportorder-response.json`.

3. **Task 0.3** — Negative-paden documenteren in `docs/logistiek/hst-api/curl-tests.md`.

## Effect op deze codebase

Zodra de echte fixture binnen is:

- `payload-builder.ts` mogelijk aanpassen (veld-namen, package-type-code,
  country-format) tot `payload-builder.test.ts` opnieuw groen draait.
- `types.ts` (`HstTransportOrderPayload`) synchroniseren met de werkelijke shape.
- `hst-client.ts` `transportOrderId`/`trackingNumber`-extractie aanpassen op de
  daadwerkelijke response-paden.

## Huidige placeholder-shape (om te corrigeren)

**Request** — gok-shape met `customerId`, `referenceNumber`, `customerReference`,
`pickupDate`, `shipper{name,address,postalCode,city,country,phone,email}`,
`consignee{name,address,postalCode,city,country}`, `packages[]{type,quantity,weightKg}`,
`remarks`.

**Response** — gok-shape met `transportOrderId`, `trackingNumber`, `status`, `createdAt`.

HST kan andere veld-namen gebruiken (bv. `Address1` i.p.v. `address`,
`HouseNumber` apart van straatnaam, `Weight` zonder `Kg`-suffix, `OrderId` of
`Id` i.p.v. `transportOrderId`). Niets aannemen — alles checken tegen de
OpenAPI-spec uit Task 0.1.
