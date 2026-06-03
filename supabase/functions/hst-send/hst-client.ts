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

  if (!res.ok) {
    return {
      ok: false,
      httpCode: res.status,
      body,
      transportOrderId: null,
      trackingNumber: null,
      pdfBase64: null,
      errorMsg: extractErrorMsg(body, res.status),
    };
  }

  // HST 201-pad: Success-veld + OrderNumber + optionele PDF.
  // Splits PDF af zodat we 'm niet onnodig in `response_payload` opslaan
  // (~14KB base64 per zending zou de hst_transportorders-tabel snel laten groeien).
  const typed = body as Partial<HstTransportOrderResponseBody> | null;
  const orderNumber = typed?.OrderNumber ?? null;
  const pdfBase64 = typed?.PDFDocument?.Contents ?? null;

  // Defensief: HST kan in een edge-case 200 sturen met Success=false.
  if (typed?.Success === false) {
    return {
      ok: false,
      httpCode: res.status,
      body: stripPdf(body),
      transportOrderId: null,
      trackingNumber: null,
      pdfBase64: null,
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
