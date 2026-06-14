// Karakterisatie-test voor de Verhoek-verwerkRow (ADR-0035 slice 0). Legt de
// HUIDIGE side-effect-sequence vast (markeer_*/log_externe_payload/storage/
// update) zodat de skeleton-migratie (slice 1) gedragsneutraliteit kan bewijzen:
// dezelfde rpc-aanroepen met dezelfde argumenten, in dezelfde volgorde.
//
// Determinisme: in het succes-pad krijgt de rij een vooraf-gezette bestandsnaam
// (de retry-tak) zodat de `new Date()`-timestamp in `bouwVerhoekBestandsnaam`
// het contract niet flaky maakt. Een aparte test dekt de genereer-tak
// structureel (er volgt een update met een bestandsnaam).

import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { asClient, FakeSupabase, type FakeSupabaseConfig } from '../_shared/__tests__/fake-supabase.ts';
import { type SendSummary, type VerhoekTransportOrderRow, verwerkRow } from './verwerk-row.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';

const VASTE_BESTANDSNAAM = 'Karpi_20260614120000_ZEND-2026-0001.xml';

function legeSummary(): SendSummary {
  return { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: true, details: [] };
}

function rij(overrides: Partial<VerhoekTransportOrderRow> = {}): VerhoekTransportOrderRow {
  return {
    id: 7,
    zending_id: 101,
    debiteur_nr: 600556,
    status: 'Bezig',
    is_test: false,
    bestandsnaam: VASTE_BESTANDSNAAM,
    ...overrides,
  };
}

const ZENDING_OK = {
  zending_nr: 'ZEND-2026-0001',
  order_id: 42,
  afl_naam: 'Klant BV',
  afl_adres: 'Straatweg 1',
  afl_postcode: '1234AB',
  afl_plaats: 'Amsterdam',
  afl_land: 'Nederland',
  afl_telefoon: '0612345678',
  afl_email: 'klant@example.nl',
  opmerkingen: null,
  verzenddatum: '2026-06-14',
};

const BEDRIJF = {
  bedrijfsnaam: 'Karpi',
  adres: 'Tweede Broekdijk 10',
  postcode: '7122 JD',
  plaats: 'Aalten',
  land: 'Nederland',
  telefoon: '0543123456',
  email: 'info@karpi.nl',
};

const COLLI_OK = [{
  colli_nr: 1,
  sscc: '012345678901234567',
  gewicht_kg: 5,
  lengte_cm: 160,
  breedte_cm: 90,
  omschrijving_snapshot: 'Tapijt 160x90',
  order_regels: { artikelnr: 'ABC123' },
}];

function configOk(extra: Partial<FakeSupabaseConfig['tables']> = {}): FakeSupabaseConfig {
  return {
    tables: {
      zendingen: { single: { data: ZENDING_OK, error: null } },
      orders: { single: { data: { order_nr: 'ORD-2026-0042' }, error: null } },
      app_config: { single: { data: { waarde: BEDRIJF }, error: null } },
      zending_colli: { list: { data: COLLI_OK, error: null } },
      verhoek_transportorders: { update: { error: null } },
      ...extra,
    },
  };
}

Deno.test('Verhoek succes (dry-run, bestandsnaam preset) → audit + markeer_verstuurd', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_VERHOEK_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['log_externe_payload', 'markeer_verhoek_verstuurd']);

  const ops = fake.calls.map((c) => c.op);
  assertEquals(ops, ['rpc', 'storage_upload', 'rpc']);

  const audit = fake.rpcCalls()[0];
  assertEquals(audit.args.p_kanaal, 'verhoek');
  assertEquals(audit.args.p_richting, 'out');
  assertEquals(audit.args.p_order_id, 42);
  assertEquals(audit.args.p_status, 'verwerkt');
  assertEquals(audit.args.p_externe_id, VASTE_BESTANDSNAAM);

  const upload = fake.calls.find((c) => c.op === 'storage_upload')!;
  assertEquals(upload.bucket, 'order-documenten');
  assertEquals(upload.path, `verhoek-xml/${VASTE_BESTANDSNAAM}`);

  const markeer = fake.rpcCalls()[1];
  assertEquals(markeer.args.p_id, 7);
  assertEquals(markeer.args.p_bestandsnaam, VASTE_BESTANDSNAAM);
  // afl_email niet-leeg → track_trace_id = zending_nr.
  assertEquals(markeer.args.p_track_trace_id, 'ZEND-2026-0001');

  assertEquals(summary.succeeded, 1);
  assertEquals(summary.failed, 0);
});

Deno.test('Verhoek succes zonder bestandsnaam → eerst update (genereer-tak), dan audit + markeer', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij({ bestandsnaam: null }), { sftpConfig: null, opties: DEFAULT_VERHOEK_OPTIES, dryRun: true }, summary);

  assertEquals(fake.calls.map((c) => c.op), ['update', 'rpc', 'storage_upload', 'rpc']);
  const update = fake.calls[0];
  assertEquals(update.table, 'verhoek_transportorders');
  assertEquals(update.match, { id: 7 });
  assertMatch((update.values as { bestandsnaam: string }).bestandsnaam, /^Karpi_\d+_ZEND-2026-0001\.xml$/);
  assertEquals(fake.rpcNames(), ['log_externe_payload', 'markeer_verhoek_verstuurd']);
  assertEquals(summary.succeeded, 1);
});

Deno.test('Verhoek preflight-fout (leeg afl_adres) → alleen markeer_fout, geen audit/upload', async () => {
  const zonderAdres = { ...ZENDING_OK, afl_adres: '' };
  const fake = new FakeSupabase(configOk({ zendingen: { single: { data: zonderAdres, error: null } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_VERHOEK_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_verhoek_fout']);
  const fout = fake.rpcCalls()[0];
  assertEquals(fout.args.p_id, 7);
  assertMatch(fout.args.p_error, /^Pre-flight: /);
  assertEquals(summary.failed, 1);
  assertEquals(summary.succeeded, 0);
});

Deno.test('Verhoek 0-colli → markeer_fout met colli-reden', async () => {
  const fake = new FakeSupabase(configOk({ zending_colli: { list: { data: [], error: null } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_VERHOEK_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_verhoek_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /Geen zending_colli/);
  assertEquals(summary.failed, 1);
});

Deno.test('Verhoek zending niet gevonden → markeer_fout, geen verdere reads', async () => {
  const fake = new FakeSupabase(configOk({ zendingen: { single: { data: null, error: { message: 'not found' } } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_VERHOEK_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_verhoek_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /niet gevonden/);
  assertEquals(summary.failed, 1);
});
