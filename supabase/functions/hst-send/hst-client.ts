// HTTP-client voor de HST TransportOrder-endpoint.
//
// Single responsibility: één Basic-auth POST naar /TransportOrder en respons
// in een uniforme HstResponse-shape teruggeven. Geen retry-logica (die zit
// in `markeer_hst_fout`-RPC), geen DB-toegang.
//
// Response-shape bevestigd via live test 2026-05-27 (HTTP 201):
//   { Success: true, OrderNumber: "T75038267000180", PDFDocument: { Contents: "<base64>" } }
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md

import type {
  HstResponse,
  HstTransportOrderPayload,
  HstTransportOrderResponseBody,
} from './types.ts';

export interface PostTransportOrderArgs {
  baseUrl: string;
  username: string;
  wachtwoord: string;
  payload: HstTransportOrderPayload;
}

export async function postTransportOrder(
  args: PostTransportOrderArgs,
): Promise<HstResponse> {
  const { baseUrl, username, wachtwoord, payload } = args;
  const auth = btoa(`${username}:${wachtwoord}`);

  const url = `${stripTrailingSlash(baseUrl)}/TransportOrder`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      httpCode: 0,
      body: null,
      transportOrderId: null,
      trackingNumber: null,
      pdfBase64: null,
      errorMsg: `Netwerkfout: ${String(err)}`,
    };
  }

  // deno-lint-ignore no-explicit-any
  let body: any = null;
  const contentType = res.headers.get('Content-Type') ?? '';
  try {
    body = contentType.includes('application/json')
      ? await res.json()
      : await res.text();
  } catch {
    body = null;
  }

  // HST 201-pad: Success-veld + OrderNumber + optionele PDF.
  // Splits PDF af zodat we 'm niet onnodig in `response_payload` opslaan
  // (~14KB base64 per zending zou de hst_transportorders-tabel snel laten groeien).
  // OrderNumber-parse staat bewust VÓÓR de !res.ok-tak: HST keurt de
  // datum-validatiefout in de praktijk af met HTTP 400 (niet 200) MÉT een
  // OrderNumber — en maakt de order tóch server-side aan ("Niet valide" in de
  // Portal). Terminaal-detectie moet dus op "OrderNumber aanwezig" staan,
  // onafhankelijk van de HTTP-status (retry 19-06, T75038267004442/4443/4444).
  const typed = body as Partial<HstTransportOrderResponseBody> | null;
  const orderNumber = typed?.OrderNumber ?? null;
  const pdfBase64 = typed?.PDFDocument?.Contents ?? null;

  if (!res.ok) {
    // 400 MÉT OrderNumber = de order is server-side al aangemaakt → behoud het
    // OrderNumber en markeer TERMINAAL (een re-POST zou een DUPLICAAT geven; HST =
    // POST-only). Een 400 ZÓNDER OrderNumber is een echte pre-creatie-afwijzing
    // (bv. "Bellen voor aflevering") en blijft retrybaar.
    return {
      ok: false,
      httpCode: res.status,
      body: stripPdf(body),
      transportOrderId: orderNumber,
      trackingNumber: null,
      pdfBase64: null,
      aangemeldMaarFout: orderNumber != null,
      errorMsg: extractErrorMsg(body, res.status),
    };
  }

  // HST kan HTTP 200/201 sturen met Success=false ÉN een OrderNumber: de order is
  // dan WÉL aangemaakt (Portal-status "Niet valide", bv. mislukte datumberekening).
  // We behouden het OrderNumber en markeren de poging TERMINAAL — een retry/re-POST
  // zou een duplicaat aanmaken (HST = POST-only). Een Success=false ZÓNDER
  // OrderNumber is een echte pre-creatie-afwijzing en blijft retrybaar.
  if (typed?.Success === false) {
    return {
      ok: false,
      httpCode: res.status,
      body: stripPdf(body),
      transportOrderId: orderNumber,
      trackingNumber: null,
      pdfBase64: null,
      aangemeldMaarFout: orderNumber != null,
      errorMsg: extractErrorMsg(body, res.status),
    };
  }

  return {
    ok: true,
    httpCode: res.status,
    body: stripPdf(body),
    transportOrderId: orderNumber,
    // HST levert (nog) geen apart tracking-nummer; OrderNumber dient als tracking-id.
    trackingNumber: orderNumber,
    pdfBase64,
    errorMsg: null,
  };
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Vervangt PDF-base64 door een placeholder zodat de body compact in de
// audit-tabel kan staan. Het origineel kan later via een storage-flow
// (fase 2: vrachtbrief opslaan) bewaard worden.
// deno-lint-ignore no-explicit-any
function stripPdf(body: any): any {
  if (!body || typeof body !== 'object') return body;
  if (!body.PDFDocument || typeof body.PDFDocument !== 'object') return body;
  const len = typeof body.PDFDocument.Contents === 'string'
    ? body.PDFDocument.Contents.length
    : 0;
  return {
    ...body,
    PDFDocument: { Contents: `<base64 PDF (${len} chars) niet meegeschreven>` },
  };
}

// deno-lint-ignore no-explicit-any
function extractErrorMsg(body: any, status: number): string {
  if (body && typeof body === 'object') {
    return (
      body.ErrorMessage ??   // HST gebruikt dit veld (PascalCase) — zónder dit kreeg de operator kaal "HTTP 400"
      body.message ??
      body.Message ??
      body.error ??
      body.Error ??
      body.detail ??
      body.errorMessage ??
      `HTTP ${status}`
    );
  }
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.slice(0, 500);
  }
  return `HTTP ${status}`;
}

// Test-alias: extractErrorMsg is bewust module-privé; deze export ontsluit 'm
// puur voor de unit-test zonder de publieke API te vergroten.
export function extractErrorMsgVoorTest(body: unknown, status: number): string {
  // deno-lint-ignore no-explicit-any
  return extractErrorMsg(body as any, status);
}
