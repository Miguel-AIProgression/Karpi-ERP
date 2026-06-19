// Supabase Edge Function: verhoek-send
//
// Cron-driven sender voor Verhoek-XML's (ADR-0031). Claimt 'Wachtrij'-rijen
// uit de gedeelde `verzend_wachtrij` (vervoerder_code='verhoek_sftp', ADR-0038),
// bouwt per zending een AA2.0-XML en levert
// die via SFTP aan bij Verhoek. Audit: externe_payloads (kanaal 'verhoek',
// elke poging een rij) + XML-kopie in storage (order-documenten/verhoek-xml/).
//
// DRY-RUN (secret VERHOEK_DRY_RUN, default 'true'): hele keten draait —
// XML, preflight, storage, audit, markeer — maar de SFTP-upload wordt
// overgeslagen. Go-live = VERHOEK_DRY_RUN=false + SFTP-secrets + config.
//
// Auth: Bearer-CRON_TOKEN-header (zelfde patroon als hst-send).
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { type SftpConfig } from '../_shared/sftp-client.ts';
import { capabilityVoor } from '../_shared/vervoerders/capabilities.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { VerhoekOpties } from './types.ts';
import {
  type SendSummary,
  type VerhoekTransportOrderRow,
  verwerkRow,
} from './verwerk-row.ts';

const MAX_PER_RUN = capabilityVoor('verhoek_sftp')?.maxPerRun ?? 25;

Deno.serve(async (req) => {
  const expectedToken = Deno.env.get('CRON_TOKEN');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResp({ error: 'SUPABASE_URL / SERVICE_ROLE_KEY ontbreken' }, 500);
  }

  // Dry-run default AAN: zonder expliciete VERHOEK_DRY_RUN=false gaat er
  // niets de deur uit. Veilige standaard tot de go-live-checklist (Fase 2).
  const dryRun = (Deno.env.get('VERHOEK_DRY_RUN') ?? 'true').toLowerCase() !== 'false';

  let sftpConfig: SftpConfig | null = null;
  if (!dryRun) {
    const host = Deno.env.get('VERHOEK_SFTP_HOST');
    const user = Deno.env.get('VERHOEK_SFTP_USER');
    const password = Deno.env.get('VERHOEK_SFTP_PASSWORD');
    if (!host || !user || !password) {
      return jsonResp({ error: 'VERHOEK_DRY_RUN=false maar VERHOEK_SFTP_HOST / USER / PASSWORD ontbreken' }, 500);
    }
    sftpConfig = {
      host,
      port: Number(Deno.env.get('VERHOEK_SFTP_PORT') ?? '22'),
      username: user,
      password,
      remoteDir: Deno.env.get('VERHOEK_SFTP_REMOTE_DIR') ?? '/',
    };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Runtime-config (mig 374): antwoorden van Verhoek landen hier — per run
  // gelezen, dus een config-UPDATE werkt zonder redeploy.
  const { data: cfgRow } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'verhoek').single();
  const opties: VerhoekOpties = { ...DEFAULT_VERHOEK_OPTIES, ...((cfgRow?.waarde ?? {}) as Partial<VerhoekOpties>) };

  // Zelfhelend (mig 375-reaper): herstel rijen die vastliepen in 'Bezig'.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_verzending', { p_vervoerder_code: 'verhoek_sftp', p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[verhoek-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) terug naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[verhoek-send] reaper faalde: ${String(e)}`);
  }

  const summary: SendSummary = { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: dryRun, details: [] };

  const runStart = Date.now();
  for (let i = 0; i < MAX_PER_RUN; i++) {
    // Tijdsbudget (review-I2): ruim binnen de edge-wall-clock blijven; de
    // rest van de wachtrij pakt de volgende cron-run (elke minuut) op.
    if (Date.now() - runStart > 60_000) break;
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_volgende_transportorder', { p_vervoerder_code: 'verhoek_sftp' });
    if (claimErr) return jsonResp({ error: `claim-rpc fout: ${claimErr.message}` }, 500);
    const row = claimed as VerhoekTransportOrderRow | null;
    if (!row || !row.id) {
      summary.empty_queue = true;
      break;
    }
    summary.processed += 1;

    try {
      await verwerkRow(supabase, row, { sftpConfig, opties, dryRun }, summary);
    } catch (err) {
      summary.failed += 1;
      summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: String(err) });
      const { error: catchMarkErr } = await supabase.rpc('markeer_transportorder_fout', { p_id: row.id, p_error: `Onverwachte exception: ${String(err)}`, p_max_retries: 3 });
      if (catchMarkErr) console.error(`[verhoek-send] markeer_transportorder_fout faalde voor rij ${row.id}: ${catchMarkErr.message}`);
    }
  }

  return jsonResp(summary, 200);
});

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
