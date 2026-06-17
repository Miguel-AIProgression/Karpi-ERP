// WEGWERP-spike: bewijst of npm:ssh2-sftp-client werkt in de Supabase Edge
// Runtime. Default: read-only connect+list tegen test.rebex.net (publieke
// demo-server) — geen Verhoek-credentials nodig. Met VERHOEK_SFTP_*-secrets
// gezet test hij Verhoeks server (Fase 2, incl. upload als ?upload=1).
//
// LET OP — connectie-test-upload gebruikt een .TXT-bestand: Verhoeks live-flow
// in karpi_to_verhoek pakt alleen .xml/.pdf op (mail 16-06-2026), dus een .txt
// test de verbinding zonder per ongeluk verwerkt te worden. Voor échte data-
// tests stuurt Verhoek liever de XML per e-mail (niet via SFTP).
// Verwijderen ná Fase 2. Auth: CRON_TOKEN-header.
import { testSftpVerbinding, uploadXmlViaSftp } from '../_shared/sftp-client.ts';

Deno.serve(async (req) => {
  const expected = Deno.env.get('CRON_TOKEN');
  if (!expected || req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const cfg = {
    host: Deno.env.get('VERHOEK_SFTP_HOST') ?? 'test.rebex.net',
    port: Number(Deno.env.get('VERHOEK_SFTP_PORT') ?? '22'),
    username: Deno.env.get('VERHOEK_SFTP_USER') ?? 'demo',
    password: Deno.env.get('VERHOEK_SFTP_PASSWORD') ?? 'password',
  };

  const doUpload = new URL(req.url).searchParams.get('upload') === '1';
  const result = doUpload
    ? await uploadXmlViaSftp(
      { ...cfg, remoteDir: Deno.env.get('VERHOEK_SFTP_REMOTE_DIR') ?? '/' },
      // .txt: connectie/schrijf-test zonder dat Verhoeks live-flow het oppakt.
      `Karpi_SPIKE_${crypto.randomUUID().slice(0, 8)}.txt`,
      'Verbindingstest Karpi -> Verhoek. Dit bestand mag genegeerd worden.\n',
    )
    : await testSftpVerbinding(cfg);

  return new Response(JSON.stringify({ host: cfg.host, ...result }), {
    status: result.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
});
