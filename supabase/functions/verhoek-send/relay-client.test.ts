// Check voor de relay-transport (slice 2): status-mapping + dat beide headers
// (Bearer + Vercel-bypass) meegaan. Stubt globalThis.fetch — geen netwerk.

import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { type RelayConfig, uploadXmlViaRelay } from './relay-client.ts';

const CFG: RelayConfig = { url: 'https://relay.test/api', token: 'TOK', bypassToken: 'BYP' };
const orig = globalThis.fetch;

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(impl(String(u), init ?? {}))) as typeof fetch;
}

Deno.test('relay 200 ok → ok:true + remotePad, beide headers meegestuurd', async () => {
  let seen: Headers | undefined;
  stubFetch((_u, init) => {
    seen = new Headers(init.headers);
    return new Response(JSON.stringify({ ok: true, remotePad: '/in/x.xml' }), { status: 200 });
  });
  try {
    const r = await uploadXmlViaRelay(CFG, 'x.xml', '<xml/>');
    assertEquals(r, { ok: true, remotePad: '/in/x.xml', errorMsg: null });
    assertEquals(seen?.get('authorization'), 'Bearer TOK');
    assertEquals(seen?.get('x-vercel-protection-bypass'), 'BYP');
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test('relay 401 → ok:false met status+reden', async () => {
  stubFetch(() => new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 }));
  try {
    const r = await uploadXmlViaRelay(CFG, 'x.xml', '<xml/>');
    assertEquals(r.ok, false);
    assertMatch(r.errorMsg ?? '', /relay 401: unauthorized/);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test('Vercel-SSO geeft HTML (geen JSON) → ok:false, niet crashen', async () => {
  stubFetch(() => new Response('<html>login</html>', { status: 401 }));
  try {
    const r = await uploadXmlViaRelay(CFG, 'x.xml', '<xml/>');
    assertEquals(r.ok, false);
    assertMatch(r.errorMsg ?? '', /relay 401/);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test('relay onbereikbaar (fetch throwt) → ok:false', async () => {
  stubFetch(() => { throw new Error('ECONNREFUSED'); });
  try {
    const r = await uploadXmlViaRelay(CFG, 'x.xml', '<xml/>');
    assertEquals(r.ok, false);
    assertMatch(r.errorMsg ?? '', /relay onbereikbaar.*ECONNREFUSED/);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test('zonder bypassToken → geen bypass-header', async () => {
  let seen: Headers | undefined;
  stubFetch((_u, init) => {
    seen = new Headers(init.headers);
    return new Response(JSON.stringify({ ok: true, remotePad: '/in/x.xml' }), { status: 200 });
  });
  try {
    await uploadXmlViaRelay({ url: CFG.url, token: 'TOK' }, 'x.xml', '<xml/>');
    assertEquals(seen?.has('x-vercel-protection-bypass'), false);
  } finally {
    globalThis.fetch = orig;
  }
});
