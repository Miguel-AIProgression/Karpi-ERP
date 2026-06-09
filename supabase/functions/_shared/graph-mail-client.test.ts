// Deno test: `deno test supabase/functions/_shared/graph-mail-client.test.ts`
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { sendFactuurEmail, type GraphMailSendInput } from './graph-mail-client.ts'

function mockFetch(responses: { status: number; body: unknown }[]) {
  let i = 0
  return async (_url: string | URL, _init?: RequestInit) => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response
  }
}

const baseInput: GraphMailSendInput = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  from: 'facturen@karpi.nl',
  to: 'klant@example.nl',
  replyTo: 'administratie@karpi.nl',
  subject: 'Factuur FACT-2026-0001',
  html: '<p>Bijgaand uw factuur.</p>',
  attachments: [
    { filename: 'FACT-2026-0001.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  ],
}

Deno.test('sendFactuurEmail: success → haalt token op en verstuurt mail', async () => {
  const fetchMock = mockFetch([
    { status: 200, body: { access_token: 'tok-123', expires_in: 3600 } },
    { status: 202, body: {} },
  ])
  const result = await sendFactuurEmail(baseInput, fetchMock)
  assertEquals(result.ok, true)
})

Deno.test('sendFactuurEmail: token-fout → gooit met nuttige message', async () => {
  const fetchMock = mockFetch([
    { status: 401, body: { error_description: 'Invalid client secret' } },
  ])
  await assertRejects(
    () => sendFactuurEmail(baseInput, fetchMock),
    Error,
    'Invalid client secret',
  )
})

Deno.test('sendFactuurEmail: sendMail-fout → gooit met nuttige message', async () => {
  const fetchMock = mockFetch([
    { status: 200, body: { access_token: 'tok-123', expires_in: 3600 } },
    { status: 403, body: { error: { message: 'Access denied' } } },
  ])
  await assertRejects(
    () => sendFactuurEmail(baseInput, fetchMock),
    Error,
    'Access denied',
  )
})

Deno.test('sendFactuurEmail: body bevat base64-encoded attachments en juiste structuur', async () => {
  let capturedBody: string | undefined
  let capturedUrl: string | undefined
  const fetchMock = async (url: string | URL, init?: RequestInit) => {
    const u = url.toString()
    if (u.includes('/oauth2/')) {
      return new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), { status: 200 })
    }
    capturedUrl = u
    capturedBody = init?.body as string
    return new Response('', { status: 202 })
  }
  await sendFactuurEmail(baseInput, fetchMock)
  const parsed = JSON.parse(capturedBody ?? '{}')
  assertEquals(capturedUrl, 'https://graph.microsoft.com/v1.0/users/facturen%40karpi.nl/sendMail')
  // %PDF base64 = "JVBERg=="
  assertEquals(parsed.message.attachments[0].contentBytes, 'JVBERg==')
  assertEquals(parsed.message.attachments[0].name, 'FACT-2026-0001.pdf')
  assertEquals(parsed.message.toRecipients[0].emailAddress.address, 'klant@example.nl')
  assertEquals(parsed.message.replyTo[0].emailAddress.address, 'administratie@karpi.nl')
})
