// Vercel serverless function (Node-runtime) — SFTP-relay voor Verhoek.
//
// Waarom deze relay bestaat: Verhoeks SFTP-server biedt alleen legacy
// CTR/CBC-ciphers. De Supabase edge-runtime (Deno) kan aes256-ctr niet
// instantiëren, dus `verhoek-send` kan principieel niet uploaden. Echte
// Node.js (waar Vercel op draait) onderhandelt aes256-ctr wél — bewezen tegen
// de live server. Daarom doet Supabase alles (XML-bouw, queue, retry, audit,
// monitor) en geeft alleen de byte-push door aan deze relay.
//
// Beveiliging:
//  - Bearer-token (VERHOEK_RELAY_TOKEN): alleen de Supabase edge function mag
//    posten. Zonder geldig token → 401.
//  - SFTP-creds als Vercel env-vars (server-side, nooit in de browser).
//  - Bestandsnaam-whitelist tegen path-traversal.
//  - De XML-body wordt NOOIT gelogd (bevat naam/adres) — alleen bestandsnaam.
//
// Verificatie ná deploy (curl): zie de deploy-checklist in het plan.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import SftpClient from 'ssh2-sftp-client';

const BESTANDSNAAM_OK = /^[A-Za-z0-9._-]+\.(xml|txt|pdf)$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST vereist' });
    return;
  }

  const token = process.env.VERHOEK_RELAY_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const { bestandsnaam, xml } = (req.body ?? {}) as { bestandsnaam?: string; xml?: string };
  if (!bestandsnaam || typeof xml !== 'string' || xml.length === 0) {
    res.status(400).json({ ok: false, error: 'bestandsnaam + xml vereist' });
    return;
  }
  if (!BESTANDSNAAM_OK.test(bestandsnaam)) {
    res.status(400).json({ ok: false, error: 'ongeldige bestandsnaam' });
    return;
  }

  const host = process.env.VERHOEK_SFTP_HOST;
  const user = process.env.VERHOEK_SFTP_USER;
  const password = process.env.VERHOEK_SFTP_PASSWORD;
  if (!host || !user || !password) {
    res.status(500).json({ ok: false, error: 'SFTP-secrets ontbreken op de relay' });
    return;
  }

  const remoteDir = (process.env.VERHOEK_SFTP_REMOTE_DIR ?? '/').replace(/\/+$/, '');
  const remotePad = `${remoteDir}/${bestandsnaam}`;
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host,
      port: Number(process.env.VERHOEK_SFTP_PORT ?? '22'),
      username: user,
      password,
      readyTimeout: 15_000,
    });
    await sftp.put(Buffer.from(xml, 'utf-8'), remotePad);
    res.status(200).json({ ok: true, remotePad });
  } catch (err) {
    // Bewust géén xml-body in de log (naam/adres).
    console.error(`[verhoek-sftp] upload faalde voor ${bestandsnaam}: ${String(err)}`);
    res.status(502).json({ ok: false, error: String(err) });
  } finally {
    await sftp.end().catch(() => {});
  }
}
