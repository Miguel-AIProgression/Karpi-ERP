// Karakterisatie-test voor de Rhenus-verwerkRow (ADR-0035 slice 0; RPC's
// generiek sinds ADR-0038). Spiegelt de Verhoek-test maar legt de Rhenus-
// specifieke side-effects vast: markeer_transportorder_* met vervoerder_code
// rhenus_sftp, kanaal 'rhenus', track_trace NULL bij verstuurd, en — cruciaal — de
// 0-colli-zending die bij Rhenus via de preflight (valideerRhenusColli,
// incident 0455395) loopt i.p.v. een aparte length-check.

import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { asClient, FakeSupabase, type FakeSupabaseConfig } from '../_shared/__tests__/fake-supabase.ts';
import { type RhenusTransportOrderRow, type SendSummary, verwerkRow } from './verwerk-row.ts';
import { DEFAULT_RHENUS_OPTIES } from './types.ts';

const VASTE_BESTANDSNAAM = 'RHE_20260614120000_ZEND-2026-0004.xml';

function legeSummary(): SendSummary {
  return { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: true, details: [] };
}

function rij(overrides: Partial<RhenusTransportOrderRow> = {}): RhenusTransportOrderRow {
  return {
    id: 9,
    zending_id: 204,
    debiteur_nr: 600556,
    status: 'Bezig',
    is_test: false,
    extern_referentie: VASTE_BESTANDSNAAM,
    ...overrides,
  };
}

const ZENDING_OK = {
  zending_nr: 'ZEND-2026-0004',
  order_id: 88,
  afl_naam: 'Möbel GmbH',
  afl_adres: 'Hauptstraße 5',
  afl_postcode: '40210',
  afl_plaats: 'Düsseldorf',
  afl_land: 'Duitsland',
  afl_telefoon: '+49211123456',
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

// Rhenus eist sscc + gewicht + lengte (geen breedte).
const COLLI_OK = [{
  colli_nr: 1,
  sscc: '012345678901234567',
  gewicht_kg: 12.5,
  lengte_cm: 200,
  breedte_cm: null,
  omschrijving_snapshot: 'Rol 200',
  order_regels: { artikelnr: 'XYZ' },
}];

function configOk(extra: Partial<FakeSupabaseConfig['tables']> = {}): FakeSupabaseConfig {
  return {
    tables: {
      zendingen: { single: { data: ZENDING_OK, error: null } },
      orders: { single: { data: { order_nr: 'ORD-2026-0088', klant_referentie: 'KREF-1' }, error: null } },
      app_config: { single: { data: { waarde: BEDRIJF }, error: null } },
      zending_colli: { list: { data: COLLI_OK, error: null } },
      verzend_wachtrij: { update: { error: null } },
      ...extra,
    },
  };
}

Deno.test('Rhenus succes (dry-run, bestandsnaam preset) → audit + markeer_verstuurd zonder track_trace', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_RHENUS_OPTIES, dryRun: true }, summary);

  // Idempotentie-anker (mig 429) gaat als éérste rpc, vóór audit/upload/markeer.
  assertEquals(fake.rpcNames(), ['markeer_transport_bevestigd', 'log_externe_payload', 'markeer_transportorder_verstuurd']);
  assertEquals(fake.calls.map((c) => c.op), ['rpc', 'rpc', 'storage_upload', 'rpc']);

  const anker = fake.rpcCalls()[0];
  assertEquals(anker.args.p_id, 9);
  assertEquals(anker.args.p_extern_referentie, VASTE_BESTANDSNAAM);

  const audit = fake.rpcCalls()[1];
  assertEquals(audit.args.p_kanaal, 'rhenus');
  assertEquals(audit.args.p_order_id, 88);
  assertEquals(audit.args.p_status, 'verwerkt');

  const upload = fake.calls.find((c) => c.op === 'storage_upload')!;
  assertEquals(upload.path, `rhenus-xml/${VASTE_BESTANDSNAAM}`);

  const markeer = fake.rpcCalls()[2];
  assertEquals(markeer.args.p_id, 9);
  assertEquals(markeer.args.p_extern_referentie, VASTE_BESTANDSNAAM);
  // Rhenus heeft GEEN T&T → de generieke markeer krijgt p_track_trace = null
  // (markeer_transportorder_verstuurd laat zending.track_trace dan ongemoeid).
  assertEquals(markeer.args.p_track_trace, null);

  assertEquals(summary.succeeded, 1);
});

Deno.test('Rhenus zonder bestandsnaam → eerst update (genereer-tak)', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij({ extern_referentie: null }), { sftpConfig: null, opties: DEFAULT_RHENUS_OPTIES, dryRun: true }, summary);

  assertEquals(fake.calls.map((c) => c.op), ['update', 'rpc', 'rpc', 'storage_upload', 'rpc']);
  const update = fake.calls[0];
  assertEquals(update.table, 'verzend_wachtrij');
  assertMatch((update.values as { extern_referentie: string }).extern_referentie, /^RHE_\d+_ZEND-2026-0004\.xml$/);
});

Deno.test('Rhenus preflight-fout (leeg afl_naam) → alleen markeer_fout', async () => {
  const zonderNaam = { ...ZENDING_OK, afl_naam: '' };
  const fake = new FakeSupabase(configOk({ zendingen: { single: { data: zonderNaam, error: null } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_RHENUS_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /^Pre-flight: /);
  assertEquals(summary.failed, 1);
});

Deno.test('Rhenus 0-colli → markeer_fout via preflight (incident 0455395), GEEN aparte length-check', async () => {
  const fake = new FakeSupabase(configOk({ zending_colli: { list: { data: [], error: null } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_RHENUS_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  // 0-colli loopt via de preflight-tak, dus de melding draagt de Pre-flight-prefix.
  assertMatch(fake.rpcCalls()[0].args.p_error, /^Pre-flight: /);
  assertEquals(summary.failed, 1);
});

Deno.test('Rhenus order niet gevonden → markeer_fout', async () => {
  const fake = new FakeSupabase(configOk({ orders: { single: { data: null, error: { message: 'x' } } } }));
  const summary = legeSummary();
  await verwerkRow(asClient(fake), rij(), { sftpConfig: null, opties: DEFAULT_RHENUS_OPTIES, dryRun: true }, summary);

  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /Order 88 niet gevonden/);
});
