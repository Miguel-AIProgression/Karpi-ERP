// Deno test: `deno test supabase/functions/_shared/resend-client.test.ts`
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { sendFactuurEmail, type ResendSendInput } from './resend-client.ts'

function mockFetch(response: { status: number; body: unknown }) {
  return async (_url: string | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response
  }
}

Deno.test('sendFactuurEmail: success → returnt resend id', async () => {
  const input: ResendSendInput = {
    apiKey: 'test-key',
    from: 'verkoop@karpi.nl',
    to: 'klant@example.nl',
    replyTo: 'administratie@karpi.nl',
    subject: 'Factuur FACT-2026-0001',
    html: '<p>Bijgaand uw factuur.</p>',
    attachments: [
      { filename: 'FACT-2026-0001.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
      { filename: 'algemene-voorwaarden.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    ],
  }
  const fetchMock = mockFetch({ status: 200, body: { id: 'abc-123' } })
  const result = await sendFactuurEmail(input, fetchMock)
  assertEquals(result.id, 'abc-123')
})

Deno.test('sendFactuurEmail: HTTP-fout → gooit met nuttige message', async () => {
  const fetchMock = mockFetch({ status: 422, body: { message: 'Invalid from address' } })
  await assertRejects(
    () => sendFactuurEmail({
      apiKey: 'k', from: 'x', to: 'y', subject: 's', html: '', attachments: [],
    }, fetchMock),
    Error,
    'Invalid from address',
  )
})

Deno.test('sendFactuurEmail: body bevat base64-encoded attachments', async () => {
  let capturedBody: string | undefined
  const fetchMock = async (_url: string | URL, init?: RequestInit) => {
    capturedBody = init?.body as string
    return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
  }
  await sendFactuurEmail({
    apiKey: 'k', from: 'a@b', to: 'c@d', subject: 's', html: '',
    attachments: [{ filename: 'f.pdf', content: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }],
  }, fetchMock)
  const parsed = JSON.parse(capturedBody ?? '{}')
  // %PDF base64 = "JVBERg=="
  assertEquals(parsed.attachments[0].content, 'JVBERg==')
  assertEquals(parsed.attachments[0].filename, 'f.pdf')
})
