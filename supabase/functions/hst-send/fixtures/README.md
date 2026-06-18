# HST fixtures — werkelijke ACCP-rondreis

Bron: live curl-test tegen `https://accp.hstonline.nl/rest/api/v1/TransportOrder`
op **2026-05-27** met de credentials uit de mail van Niek Zandvoort (HST):

```
Username:   karpi_api_user
CustomerID: 038267
```

## Request

[`example-transportorder-request.json`](./example-transportorder-request.json)
is het door HST aangeleverde voorbeeldbestand (mail-bijlage 2026-05-27). HST
gebruikt PascalCase, `TransportOrderLines[]`, `ToAddress`/`FromAddress` (met
`Street`/`StreetNumber` apart), `ShippingServices[]`, en een top-level
`CustomerID`.

### Bekende enum-waarden

- `OrderType`: `"DELIVERY_LARGE"`
- `PackageUnitID`:
  - `"SP"` = Wegwerp pallet (uit het HST-voorbeeldbestand)
  - `"col"` = **Colli** (kleine letters!) — Karpi's standaard sinds 2026-06-18,
    bevestigd via een live test (`T75038267004386`). HST's OpenAPI definieert
    `PackageUnitID` als vrij stringveld zónder enum-lijst; onbekende codes geven
    HTTP 400 *"Regel nummer 1 heeft geen verzendeenheid"*.
- `ShippingServiceID`:
  - `"FFBL"` = "Bellen voor aflevering" (vereist een telefoonnummer in
    `ExtraInformation`). Karpi stuurt deze service **niet** meer — `ShippingServices`
    is leeg zodat het bel-vinkje uit blijft.

Andere `PackageUnitID`-/`ShippingServiceID`-waarden zijn nog niet bevestigd —
vragen bij HST wanneer Karpi meer eenheden/service-niveaus wil ontsluiten.

## Response

[`example-transportorder-response.json`](./example-transportorder-response.json)
toont de shape; HST gaf bij de live test **HTTP 201** met:

```json
{
  "Success": true,
  "OrderNumber": "T75038267000180",
  "PDFDocument": { "Contents": "<base64-PDF van ~14KB>" }
}
```

- `OrderNumber` is het tracking-/transportorder-id dat in het HST-portaal en op
  de vrachtbrief verschijnt. Wij slaan dit op in
  `hst_transportorders.extern_transport_order_id` én promoten het naar
  `zendingen.track_trace`.
- `PDFDocument.Contents` is base64-PDF (vrachtbrief/label van HST). V1 logt
  deze NIET in `response_payload` (zou de DB-rij onnodig opblazen); een
  optionele storage-flow voor het label komt in fase 2.

## Negative-paden

Nog niet systematisch getest. Vervolg-tasks:

1. Foute Basic-auth → verwacht 401.
2. Lege body → verwacht 400.
3. Verplicht veld weglaten (bv. `CustomerID`) → welke error-shape?
4. Onbekende `OrderType`-enum-waarde.

Documenteer de resultaten in `docs/logistiek/hst-api/curl-tests.md` (wordt
later aangelegd; nu nog geen bestand omdat we eerst het happy-path live wilden
zien).
