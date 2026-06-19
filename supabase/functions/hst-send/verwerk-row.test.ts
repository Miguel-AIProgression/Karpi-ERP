// Karakterisatie-test voor de HST-verwerkRow (ADR-0035 slice 0). HST is het
// LIVE pad en het enige REST-transport: `postTransportOrder` doet een echte
// `fetch`, die hier gestubd wordt. De test legt de side-effect-sequence vast —
// log_externe_payload (carrier-audit), PDF-storage-upload, markeer_hst_*.
//
// Cruciale HST-eigenheden t.o.v. de SFTP-carriers: geen dry-run, geen
// bestandsnaam-dedup, PDF naar storage i.p.v. XML, en markeer_hst_verstuurd met
// transport_order_id/tracking/pdf-velden.

import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { asClient, FakeSupabase, type FakeSupabaseConfig } from '../_shared/__tests__/fake-supabase.ts';
import { type HstSecrets, type HstTransportOrderRow, type SendSummary, verwerkRow } from './verwerk-row.ts';

const SECRETS: HstSecrets = {
  hstBaseUrl: 'https://hst.example',
  hstUsername: 'user',
  hstWachtwoord: 'pass',
  hstCustomerId: 'CUST123',
};

function legeSummary(): SendSummary {
  return { processed: 0, succeeded: 0, failed: 0, empty_queue: false, details: [] };
}

function rij(overrides: Partial<HstTransportOrderRow> = {}): HstTransportOrderRow {
  return { id: 3, zending_id: 55, debiteur_nr: 1234, status: 'Bezig', is_test: false, ...overrides };
}

const ZENDING_OK = {
  zending_nr: 'ZEND-2026-0009',
  order_id: 77,
  afl_naam: 'Klant BV',
  afl_adres: 'Straatweg 12',
  afl_postcode: '1234AB',
  afl_plaats: 'Amsterdam',
  afl_land: 'NL',
  afl_telefoon: '0612345678',
  afl_email: 'klant@example.nl',
  totaal_gewicht_kg: 10,
  aantal_colli: 1,
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
  gewicht_kg: 10,
  lengte_cm: 160,
  breedte_cm: 90,
  omschrijving_snapshot: 'Tapijt 160x90',
  order_regels: { artikelnr: 'ABC' },
}];

function configOk(extra: Partial<FakeSupabaseConfig['tables']> = {}): FakeSupabaseConfig {
  return {
    tables: {
      zendingen: { single: { data: ZENDING_OK, error: null } },
      orders: { single: { data: { order_nr: 'ORD-2026-0077' }, error: null } },
      app_config: { single: { data: { waarde: BEDRIJF }, error: null } },
      zending_colli: { list: { data: COLLI_OK, error: null } },
      ...extra,
    },
  };
}

// Vervangt globalThis.fetch tijdens `fn` en herstelt 'm daarna. `responder`
// krijgt geen args en levert de Response (of gooit → netwerkfout-pad).
async function metFetchStub(
  responder: () => Response,
  fn: () => Promise<void>,
): Promise<{ aangeroepen: number }> {
  const origineel = globalThis.fetch;
  let aangeroepen = 0;
  globalThis.fetch = ((..._args: unknown[]) => {
    aangeroepen += 1;
    return Promise.resolve(responder());
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = origineel;
  }
  return { aangeroepen };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.test('HST succes (HTTP 201 + PDF) → audit + PDF-upload + markeer_verstuurd', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();
  const pdfBase64 = btoa('PDFDATA');

  const { aangeroepen } = await metFetchStub(
    () => jsonResponse({ Success: true, OrderNumber: 'T75038267000180', PDFDocument: { Contents: pdfBase64 } }, 201),
    () => verwerkRow(asClient(fake), rij(), SECRETS, summary),
  );

  assertEquals(aangeroepen, 1); // precies één POST naar HST
  // Idempotentie-anker (mig 429) gaat als ÉÉRSTE rpc, vóór de faalbare audit/
  // upload/markeer — zodat een crash daarna geen reaper-re-POST veroorzaakt.
  assertEquals(fake.calls.map((c) => c.op), ['rpc', 'rpc', 'storage_upload', 'rpc']);
  assertEquals(fake.rpcNames(), ['markeer_transport_bevestigd', 'log_externe_payload', 'markeer_transportorder_verstuurd']);

  const anker = fake.rpcCalls()[0];
  assertEquals(anker.args.p_id, 3);
  assertEquals(anker.args.p_extern_referentie, 'T75038267000180');

  const audit = fake.rpcCalls()[1];
  assertEquals(audit.args.p_kanaal, 'hst');
  assertEquals(audit.args.p_order_id, 77);
  assertEquals(audit.args.p_status, 'verwerkt');
  // http_code leeft sinds ADR-0038 in de audit-payload (externe_payloads), niet
  // meer op de wachtrij-rij.
  assertEquals((audit.args.p_payload_json as { http_code: number }).http_code, 201);

  const upload = fake.calls.find((c) => c.op === 'storage_upload')!;
  assertEquals(upload.bucket, 'order-documenten');
  assertEquals(upload.path, 'hst-vrachtbrieven/ZEND-2026-0009.pdf');

  const markeer = fake.rpcCalls()[2];
  assertEquals(markeer.args.p_id, 3);
  assertEquals(markeer.args.p_extern_referentie, 'T75038267000180');
  // Geen tracking_number in de response → track_trace valt terug op de
  // transportOrderId (COALESCE-gedrag van markeer_hst_verstuurd, nu expliciet).
  assertEquals(markeer.args.p_track_trace, 'T75038267000180');
  assertEquals(markeer.args.p_document_pad, 'hst-vrachtbrieven/ZEND-2026-0009.pdf');

  assertEquals(summary.succeeded, 1);
});

Deno.test('HST HTTP 400 → audit + markeer_fout, geen PDF-upload', async () => {
  const fake = new FakeSupabase(configOk());
  const summary = legeSummary();

  await metFetchStub(
    () => jsonResponse({ ErrorMessage: 'Bellen voor aflevering' }, 400),
    () => verwerkRow(asClient(fake), rij(), SECRETS, summary),
  );

  assertEquals(fake.calls.map((c) => c.op), ['rpc', 'rpc']); // log + markeer_fout, geen storage
  assertEquals(fake.rpcNames(), ['log_externe_payload', 'markeer_transportorder_fout']);
  const fout = fake.rpcCalls()[1];
  assertEquals(fout.args.p_id, 3);
  assertEquals(fout.args.p_error, 'Bellen voor aflevering');
  // http_code zit in de audit-payload, niet meer op markeer_fout.
  assertEquals((fake.rpcCalls()[0].args.p_payload_json as { http_code: number }).http_code, 400);
  assertEquals(summary.failed, 1);
});

// NB: telefoon is sinds commit d40d97a NIET meer verplicht voor HST (FFBL uit),
// dus een leeg adresveld is nu de juiste preflight-blocker (ADRESVELD_LEEG).
Deno.test('HST preflight-fout (leeg afl_adres) → markeer_fout, GEEN HST-call', async () => {
  const zonderAdres = { ...ZENDING_OK, afl_adres: '' };
  const fake = new FakeSupabase(configOk({ zendingen: { single: { data: zonderAdres, error: null } } }));
  const summary = legeSummary();

  const { aangeroepen } = await metFetchStub(
    () => { throw new Error('fetch had niet aangeroepen mogen worden'); },
    () => verwerkRow(asClient(fake), rij(), SECRETS, summary),
  );

  assertEquals(aangeroepen, 0); // preflight short-circuit: geen kansloze POST
  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /^Pre-flight: /);
  assertEquals(summary.failed, 1);
});

Deno.test('HST 0-colli → markeer_fout, GEEN HST-call', async () => {
  const fake = new FakeSupabase(configOk({ zending_colli: { list: { data: [], error: null } } }));
  const summary = legeSummary();

  const { aangeroepen } = await metFetchStub(
    () => { throw new Error('fetch had niet aangeroepen mogen worden'); },
    () => verwerkRow(asClient(fake), rij(), SECRETS, summary),
  );

  assertEquals(aangeroepen, 0);
  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /Geen zending_colli/);
  assertEquals(summary.failed, 1);
});

Deno.test('HST zending niet gevonden → markeer_fout', async () => {
  const fake = new FakeSupabase(configOk({ zendingen: { single: { data: null, error: { message: 'weg' } } } }));
  const summary = legeSummary();

  await metFetchStub(
    () => { throw new Error('niet aanroepen'); },
    () => verwerkRow(asClient(fake), rij(), SECRETS, summary),
  );

  assertEquals(fake.rpcNames(), ['markeer_transportorder_fout']);
  assertMatch(fake.rpcCalls()[0].args.p_error, /niet gevonden/);
});
