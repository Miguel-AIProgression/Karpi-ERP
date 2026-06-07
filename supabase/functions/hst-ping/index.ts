// WEGWERP diagnostische edge function: hst-ping
//
// Enig doel: bewijzen of de Supabase edge-runtime HST kan BEREIKEN — dezelfde
// egress-IP's + dezelfde secrets als de echte `hst-send`. Beantwoordt de vraag:
// "wordt onze Supabase-infra door HST's firewall/IP-whitelist toegelaten?"
//
// Doet GEEN DB-toegang, raakt geen zendingen/colli. Post puur de bekende-goede
// voorbeeld-payload naar HST en geeft de HTTP-status + (gestripte) body terug.
//
// NA DE TEST VERWIJDEREN:  npx supabase functions delete hst-ping
//
// Deploy (geen JWT-check, zodat je 'm simpel kunt aanroepen):
//   npx supabase functions deploy hst-ping --no-verify-jwt --project-ref wqzeevfobwauxkalagtn

const PAYLOAD = {
  CustomerReference: 'KARPI-PING-TEST',
  TransportInstruction: 'Connectiviteitstest Supabase -> HST',
  OrderType: 'DELIVERY_LARGE',
  TransportOrderLines: [
    {
      Quantity: 1,
      GoodsOnPallet: 0,
      GoodsDescription: 'Ping test',
      ExchangePacking: false,
      Length: 120,
      Width: 80,
      Height: 20,
      Weight: 1,
      BarCode: { BarCode: '' },
      PackageUnitID: 'SP',
    },
  ],
  ShippingServices: [{ ShippingServiceID: 'FFBL', ExtraInformation: 'PING' }],
  ToAddress: {
    CustomerCode: 'NL1', Name: 'Ping ontvanger', NameAddition: '',
    Street: 'Koningin Wilhelminaweg', StreetNumber: '257', StreetNumberAddition: '',
    ZipCode: '1111AA', City: 'Diemen', PhoneNumber: '', Email: '', Country: 'NL',
  },
  FromAddress: {
    CustomerCode: '', Name: 'Karpi B.V.', NameAddition: '',
    Street: 'Tweede Broekdijk', StreetNumber: '10', StreetNumberAddition: '',
    ZipCode: '7122LB', City: 'Aalten', PhoneNumber: '', Email: '', Country: 'NL',
  },
  CustomerID: '038267',
};

Deno.serve(async () => {
  const baseUrl = Deno.env.get('HST_API_BASE_URL');
  const username = Deno.env.get('HST_API_USERNAME');
  const wachtwoord = Deno.env.get('HST_API_WACHTWOORD');
  const customerId = Deno.env.get('HST_API_CUSTOMER_ID');

  // Diagnose 1: zijn de secrets überhaupt gezet op de gedeployde functie?
  const secretsAanwezig = {
    HST_API_BASE_URL: Boolean(baseUrl),
    HST_API_USERNAME: Boolean(username),
    HST_API_WACHTWOORD: Boolean(wachtwoord),
    HST_API_CUSTOMER_ID: Boolean(customerId),
  };
  if (!baseUrl || !username || !wachtwoord) {
    return json({
      reachable: false,
      conclusie: 'SECRETS ONTBREKEN op de edge function — eerst HST_API_* secrets zetten.',
      secretsAanwezig,
    }, 200);
  }

  const payload = { ...PAYLOAD, CustomerID: customerId ?? PAYLOAD.CustomerID };
  const auth = btoa(`${username}:${wachtwoord}`);
  const url = `${baseUrl.replace(/\/$/, '')}/TransportOrder`;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get('Content-Type') ?? '';
    // deno-lint-ignore no-explicit-any
    let body: any = ct.includes('json') ? await res.json() : await res.text();
    // PDF strippen zodat het antwoord compact blijft.
    if (body && typeof body === 'object' && body.PDFDocument) {
      body = { ...body, PDFDocument: '<base64 PDF gestript>' };
    }

    return json({
      reachable: true,
      conclusie: res.status === 201
        ? '✅ Supabase BEREIKT HST en kreeg HTTP 201 — egress is gewhitelist, productie-pad werkt.'
        : `Supabase bereikt HST (HTTP ${res.status}) — verbinding OK, maar geen 201. Check body.`,
      httpStatus: res.status,
      durationMs: Date.now() - start,
      secretsAanwezig,
      endpoint: url,
      body,
    }, 200);
  } catch (err) {
    // Geen HTTP-respons = netwerk/firewall blokkeert Supabase -> HST.
    return json({
      reachable: false,
      conclusie: '❌ Supabase KAN HST NIET BEREIKEN — netwerk/firewall blokkeert. '
        + 'Vrijwel zeker IP-whitelist bij HST: Supabase egress-IP staat niet op de lijst.',
      durationMs: Date.now() - start,
      secretsAanwezig,
      endpoint: url,
      error: String(err),
    }, 200);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
