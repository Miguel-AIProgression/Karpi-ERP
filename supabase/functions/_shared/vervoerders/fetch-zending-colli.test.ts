// Deno unit tests voor fetch-zending-colli.ts (Zending-colli-seam).
// Borgt het contract dat álle vervoerder-adapters delen: WELKE kolommen
// canoniek bevraagd worden (snapshot, niet de live join), de filter/sortering,
// de artikelnr-platslaging uit de embed, en het foutpad.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { fetchZendingColli } from './fetch-zending-colli.ts';

// Mini chainable mock voor de PostgREST query-builder: registreert de
// .select()/.eq()/.order()-aanroepen en levert een vast resultaat.
type Op = { op: string; args: unknown[] };
// deno-lint-ignore no-explicit-any
function mockSupabase(result: { data: any[] | null; error: { message: string } | null }) {
  const ops: Op[] = [];
  // deno-lint-ignore no-explicit-any
  const b: any = {};
  const chain = (op: string) => (...args: unknown[]) => {
    ops.push({ op, args });
    return b;
  };
  for (const m of ['select', 'eq', 'is', 'order']) b[m] = chain(m);
  b.then = (resolve: (v: unknown) => void) => resolve(result);
  const client = { from: (table: string) => { ops.push({ op: 'from', args: [table] }); return b; } };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, ops };
}

function argOf(ops: Op[], op: string): unknown[] {
  return ops.find((o) => o.op === op)?.args ?? [];
}

Deno.test('fetchZendingColli: bevraagt de canonieke snapshot-kolommen + embed, gefilterd en gesorteerd', async () => {
  const { client, ops } = mockSupabase({ data: [], error: null });
  await fetchZendingColli(client, 42);

  assertEquals(argOf(ops, 'from'), ['zending_colli']);
  const select = String(argOf(ops, 'select')[0]);
  // Snapshot-bron: dims uit zending_colli, NIET uit een live order_regels→producten-join.
  for (const kol of ['colli_nr', 'sscc', 'gewicht_kg', 'lengte_cm', 'breedte_cm', 'omschrijving_snapshot', 'pallet_type']) {
    assertEquals(select.includes(kol), true, `select mist ${kol}`);
  }
  // artikelnr alleen via de expliciete FK-embed (PGRST201-hint).
  assertEquals(select.includes('order_regels:order_regel_id ( artikelnr )'), true);
  assertEquals(select.includes('producten'), false, 'mag geen live product-join doen');
  assertEquals(argOf(ops, 'eq'), ['zending_id', 42]);
  // Mig 418: gebundelde kind-colli (bundel_colli_id NOT NULL) vallen uit het
  // carrier-bericht; alleen losse colli + bundel-rijen blijven over.
  assertEquals(argOf(ops, 'is'), ['bundel_colli_id', null]);
  assertEquals(argOf(ops, 'order'), ['colli_nr', { ascending: true }]);
});

Deno.test('fetchZendingColli: mapt rijen → canonieke shape, artikelnr platgeslagen uit embed', async () => {
  const { client } = mockSupabase({
    data: [
      {
        colli_nr: 1, sscc: '00123', gewicht_kg: 19.8, lengte_cm: 240, breedte_cm: 330,
        omschrijving_snapshot: 'Egyptische Wol 240x330 cm', pallet_type: 'EP',
        order_regels: { artikelnr: 'EGW-240' },
      },
      // Colli zonder order_regel_id → embed null → artikelnr null, geen drop.
      // pallet_type ontbreekt → null (losse colli, mig 485).
      {
        colli_nr: 2, sscc: null, gewicht_kg: null, lengte_cm: null, breedte_cm: null,
        omschrijving_snapshot: null, order_regels: null,
      },
    ],
    error: null,
  });

  const { colli, error } = await fetchZendingColli(client, 1);
  assertEquals(error, null);
  assertEquals(colli.length, 2);
  assertEquals(colli[0], {
    colli_nr: 1, sscc: '00123', gewicht_kg: 19.8, lengte_cm: 240, breedte_cm: 330,
    omschrijving_snapshot: 'Egyptische Wol 240x330 cm', artikelnr: 'EGW-240', pallet_type: 'EP',
  });
  assertEquals(colli[1].artikelnr, null);
  assertEquals(colli[1].sscc, null);
  assertEquals(colli[1].pallet_type, null);
});

Deno.test('fetchZendingColli: query-fout → lege colli + foutmelding (caller beslist)', async () => {
  const { client } = mockSupabase({ data: null, error: { message: 'PGRST116 boom' } });
  const { colli, error } = await fetchZendingColli(client, 7);
  assertEquals(colli, []);
  assertEquals(error, 'PGRST116 boom');
});

Deno.test('fetchZendingColli: geen rijen → lege colli, geen fout', async () => {
  const { client } = mockSupabase({ data: null, error: null });
  const { colli, error } = await fetchZendingColli(client, 9);
  assertEquals(colli, []);
  assertEquals(error, null);
});
