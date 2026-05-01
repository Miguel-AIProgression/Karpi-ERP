// HTTP-client voor de HST TransportOrder-endpoint.
//
// Single responsibility: één Basic-auth POST naar /TransportOrder en respons
// in een uniforme HstResponse-shape teruggeven. Geen retry-logica (die zit
// in `markeer_hst_fout`-RPC), geen DB-toegang.
//
// LET OP veld-paden in de respons-extractie: deze zijn een gok tot Fase 0
// curl-tests de werkelijke HST-respons-shape vastleggen.
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md (Task 2.3)

import type { HstResponse, HstTransportOrderPayload } from './types.ts';

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
    // Netwerk-fout vóór HTTP-respons: returneer een synthetische 0-respons
    // zodat de orchestrator markeer_hst_fout kan bellen met retry.
    return {
      ok: false,
      httpCode: 0,
      body: null,
      transportOrderId: null,
      trackingNumber: null,
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
      errorMsg: extractErrorMsg(body, res.status),
    };
  }

  return {
    ok: true,
    httpCode: res.status,
    body,
    // LET OP: pas deze veld-paden aan zodra Fase 0 de werkelijke HST-respons
    // heeft vastgelegd. Mogelijk: `id`, `orderId`, `transportOrder.id`, etc.
    transportOrderId: extractTransportOrderId(body),
    trackingNumber: extractTrackingNumber(body),
    errorMsg: null,
  };
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// deno-lint-ignore no-explicit-any
function extractTransportOrderId(body: any): string | null {
  if (!body || typeof body !== 'object') return null;
  return (
    body.transportOrderId ??
    body.transportOrderID ??
    body.orderId ??
    body.id ??
    null
  );
}

// deno-lint-ignore no-explicit-any
function extractTrackingNumber(body: any): string | null {
  if (!body || typeof body !== 'object') return null;
  return (
    body.trackingNumber ??
    body.trackingNo ??
    body.tracking ??
    body.barcode ??
    null
  );
}

// deno-lint-ignore no-explicit-any
function extractErrorMsg(body: any, status: number): string {
  if (body && typeof body === 'object') {
    return (
      body.message ??
      body.error ??
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
