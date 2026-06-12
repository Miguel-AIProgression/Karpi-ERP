// WEGWERP-spike: test de SFTP-verbinding met Rhenus' server (Fase 2).
// Default: read-only connect+list met de RHENUS_SFTP_*-secrets (fallback
// test.rebex.net zolang die niet gezet zijn — runtime-bewijs voor ssh2 is al
// geleverd door verhoek-sftp-spike). Met ?upload=1 uploadt hij een
// spike-bestand naar RHENUS_SFTP_REMOTE_DIR (zet die tijdens de rondreis
// eerst op de testmap). Verwijderen ná Fase 2. Auth: CRON_TOKEN-header.
// Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
import { testSftpVerbinding, uploadXmlViaSftp } from '../_shared/sftp-client.ts';

Deno.serve(async (req) => {
  const expected = Deno.env.get('CRON_TOKEN');
  if (!expected || req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const cfg = {
    host: Deno.env.get('RHENUS_SFTP_HOST') ?? 'test.rebex.net',
    port: Number(Deno.env.get('RHENUS_SFTP_PORT') ?? '22'),
    username: Deno.env.get('RHENUS_SFTP_USER') ?? 'demo',
    password: Deno.env.get('RHENUS_SFTP_PASSWORD') ?? 'password',
  };

  const doUpload = new URL(req.url).searchParams.get('upload') === '1';
  const result = doUpload
    ? await uploadXmlViaSftp(
      { ...cfg, remoteDir: Deno.env.get('RHENUS_SFTP_REMOTE_DIR') ?? '/in' },
      `RHE_SPIKE_${crypto.randomUUID().slice(0, 8)}.xml.test`,
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?><!-- Karpi SFTP-spike, mag genegeerd/verwijderd worden -->',
    )
    : await testSftpVerbinding(cfg);

  return new Response(JSON.stringify({ host: cfg.host, ...result }), {
    status: result.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
});
