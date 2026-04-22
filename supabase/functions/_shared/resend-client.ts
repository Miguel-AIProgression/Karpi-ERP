// Dunne wrapper rond Resend API. `fetch` is injecteerbaar voor tests.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

export interface ResendAttachment {
  filename: string
  content: Uint8Array
}

export interface ResendSendInput {
  apiKey: string
  from: string
  to: string
  replyTo?: string
  subject: string
  html: string
  attachments: ResendAttachment[]
}

export interface ResendSendResult {
  id: string
}

type FetchFn = typeof fetch

export async function sendFactuurEmail(
  input: ResendSendInput,
  fetchImpl: FetchFn = fetch,
): Promise<ResendSendResult> {
  const body = {
    from: input.from,
    to: [input.to],
    reply_to: input.replyTo,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: base64Encode(a.content),
    })),
  }

  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { message?: string }).message ?? `Resend error ${res.status}`
    throw new Error(msg)
  }
  return { id: (json as { id: string }).id }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
