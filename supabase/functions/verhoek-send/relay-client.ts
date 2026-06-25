// Verhoek byte-push via de Vercel Node-relay (ADR-0031, slice 2).
//
// Waarom: Verhoeks SFTP biedt alleen legacy aes256-ctr; de Supabase edge-runtime
// (Deno) kan die cipher niet instantiëren, dus `verhoek-send` kan zelf niet
// uploaden. Echte Node.js (Vercel) wél. Daarom doet deze edge function alles
// (XML-bouw, queue, retry, audit, monitor) en geeft alleen de byte-push door aan
// `frontend/api/verhoek-sftp.ts` (de relay). Rhenus blijft directe edge-SFTP
// (GCM werkt daar wél) — die deelt deze module bewust NIET.
//
// Deze helper is een 1-op-1 vervanger van `uploadXmlViaSftp`: zelfde 3 args,
// zelfde return-shape, nooit-throw. Zo blijft de adapter-`transport`-hook een
// triviale substitutie en raakt de orchestrator-skeleton (ADR-0035) niet.

export interface RelayConfig {
  url: string;
  token: string;
  // Vercel SSO blokkeert álle *.vercel.app-requests; server-to-server komt alleen
  // langs met deze Protection-Bypass-header. null = geen SSO (header weggelaten).
  bypassToken?: string | null;
}

export interface RelayResultaat {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export async function uploadXmlViaRelay(
  cfg: RelayConfig,
  bestandsnaam: string,
  xml: string,
): Promise<RelayResultaat> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
  };
  if (cfg.bypassToken) headers['x-vercel-protection-bypass'] = cfg.bypassToken;

  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bestandsnaam, xml }),
    });
    // Vercel-SSO geeft bij een mislukte bypass HTML i.p.v. JSON → tolereren.
    let body: { ok?: boolean; remotePad?: string; error?: string } = {};
    try {
      body = await resp.json();
    } catch {
      body = {};
    }
    if (resp.ok && body.ok) {
      return { ok: true, remotePad: body.remotePad ?? null, errorMsg: null };
    }
    // HTTP-status + relay-error samenvouwen zodat markeer_transportorder_fout /
    // de audit een diagnosticeerbare melding krijgt (anders verlies je context
    // die uploadXmlViaSftp wél gaf).
    return {
      ok: false,
      remotePad: null,
      errorMsg: `relay ${resp.status}: ${body.error ?? 'geen JSON-body (Vercel-SSO?)'}`,
    };
  } catch (err) {
    return { ok: false, remotePad: null, errorMsg: `relay onbereikbaar: ${String(err)}` };
  }
}
