// Transus SOAP-client — drie methodes uit de Transus API Implementation Guide v3.3.
//
// Endpoint: https://webconnect.transus.com/exchange.asmx
//
// M10100  — Verstuur bericht naar Transus
// M10110  — Ontvang bericht van Transus (poll-based, geen webhook)
// M10300  — Bevestig ontvangst (anders krijg je hetzelfde bericht eindeloos terug)
//
// Auth: ClientID + ClientKey (uit Transus Online → Connect-tegel → Transus API).
// Throughput-limieten:
//   - Max 1 simultane request per methode
//   - Min 1s tussen requests
//   - M10110: min 1 minuut tussen requests als de queue leeg was

const ENDPOINT = 'https://webconnect.transus.com/exchange.asmx';
const NS = 'https://webconnect.transus.com/';

export type ExitCode = number;

export interface TransusCredentials {
  clientId: string;
  clientKey: string;
}

export interface SendResult {
  transactionId: string;
  exitCode: ExitCode;
}

export interface ReceiveResult {
  transactionId: string | null;
  message: string | null; // base64-encoded payload, null als queue leeg
  exitCode: ExitCode;
}

export interface ConfirmResult {
  exitCode: ExitCode;
}

// Exit codes per de Implementation Guide v3.3
export const EXIT_OK = 0;
export const EXIT_AUTH_INVALID = 10;
export const EXIT_ACCESS_DENIED = 20;
export const EXIT_INVALID_TX_ID = 30; // alleen M10300
export const EXIT_RATE_LIMIT = 90;
export const EXIT_SIZE_LIMIT = 95;
export const EXIT_GENERIC_ERROR = 99;

export function exitCodeMessage(code: ExitCode): string {
  switch (code) {
    case EXIT_OK:
      return 'Successful completion';
    case EXIT_AUTH_INVALID:
      return 'Client ID, Client Key or IP address invalid';
    case EXIT_ACCESS_DENIED:
      return 'Access denied for this client';
    case EXIT_INVALID_TX_ID:
      return 'Invalid transaction ID';
    case EXIT_RATE_LIMIT:
      return 'Rate-limit / connection restriction';
    case EXIT_SIZE_LIMIT:
      return 'Size restriction (>10MB)';
    case EXIT_GENERIC_ERROR:
      return 'Generic error';
    default:
      return `Unknown exit code ${code}`;
  }
}

/**
 * Verstuur een bericht naar Transus (M10100).
 *
 * @param creds  ClientID + ClientKey
 * @param message  De ruwe bericht-content (XML / CSV / EDIFACT / fixed-width).
 *                 Wordt door deze functie base64-encoded.
 */
export async function sendMessage(
  creds: TransusCredentials,
  message: string,
): Promise<SendResult> {
  const messageB64 = btoa(unescape(encodeURIComponent(message)));

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <M10100 xmlns="${NS}">
      <ClientID>${escapeXml(creds.clientId)}</ClientID>
      <ClientKey>${escapeXml(creds.clientKey)}</ClientKey>
      <Message>${messageB64}</Message>
    </M10100>
  </soap12:Body>
</soap12:Envelope>`;

  const responseText = await postSoap(envelope);
  const transactionId = extractTag(responseText, 'TransactionID') ?? '';
  const exitCode = parseInt(extractTag(responseText, 'ExitCode') ?? '99', 10);
  return { transactionId, exitCode };
}

/**
 * Ontvang het volgende bericht uit de queue (M10110).
 *
 * Returnt `message=null` als de queue leeg is. Bij een leeg-queue-result moet de
 * caller minimaal 1 minuut wachten voor de volgende poll. Bij een non-leeg result
 * is min 1 seconde wachten voldoende — dan kun je de queue snel leegmaken.
 */
export async function receiveMessage(
  creds: TransusCredentials,
): Promise<ReceiveResult> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <M10110 xmlns="${NS}">
      <ClientID>${escapeXml(creds.clientId)}</ClientID>
      <ClientKey>${escapeXml(creds.clientKey)}</ClientKey>
    </M10110>
  </soap12:Body>
</soap12:Envelope>`;

  const responseText = await postSoap(envelope);
  const transactionId = extractTag(responseText, 'TransactionID');
  const messageB64 = extractTag(responseText, 'Message');
  const exitCode = parseInt(extractTag(responseText, 'ExitCode') ?? '99', 10);

  // Lege queue: TransactionID/Message leeg of helemaal niet aanwezig.
  const hasMessage = transactionId !== null && transactionId !== '' && messageB64 !== null && messageB64 !== '';

  return {
    transactionId: hasMessage ? transactionId : null,
    message: hasMessage ? decodeBase64(messageB64!) : null,
    exitCode,
  };
}

/**
 * Bevestig ontvangst van een bericht (M10300).
 *
 * Status: 0 = Delivered (bericht verwerkt), 1 = Delivery error, 2 = Pending.
 * Zonder bevestiging blijft Transus hetzelfde bericht teruggeven via M10110.
 */
export async function confirmMessage(
  creds: TransusCredentials,
  transactionId: string,
  status: 0 | 1 | 2,
  statusDetails: string = '',
): Promise<ConfirmResult> {
  // statusDetails is max 250 chars; HTML-escape SOAP-special chars
  const detailsTrimmed = statusDetails.slice(0, 250);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <M10300 xmlns="${NS}">
      <ClientID>${escapeXml(creds.clientId)}</ClientID>
      <ClientKey>${escapeXml(creds.clientKey)}</ClientKey>
      <TransactionID>${escapeXml(transactionId)}</TransactionID>
      <Status>${status}</Status>
      <StatusDetails>${escapeXml(detailsTrimmed)}</StatusDetails>
    </M10300>
  </soap12:Body>
</soap12:Envelope>`;

  const responseText = await postSoap(envelope);
  const exitCode = parseInt(extractTag(responseText, 'ExitCode') ?? '99', 10);
  return { exitCode };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function postSoap(envelope: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      body: envelope,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Transus SOAP HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractTag(xml: string, tag: string): string | null {
  // Robust enough for Transus-stijl envelopes: tags zonder namespace-prefix in body.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeBase64(b64: string): string {
  // Transus stuurt CP-1252-payloads default; voor onze fixed-width-formaten zit
  // de meeste content in ASCII-range. Voor exotische tekens (umlauts in NAD-segmenten)
  // wordt CP-1252 → UTF-8 gedecodeerd door de format-specifieke parser.
  // Hier returneren we de raw bytes als string in latin1.
  const bin = atob(b64.trim());
  // Convert binary string to UTF-8 by treating bytes as cp1252 → unicode.
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('windows-1252').decode(bytes);
}
