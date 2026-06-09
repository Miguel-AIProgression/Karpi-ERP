// Dunne wrapper rond Microsoft Graph `sendMail` (Microsoft 365 / Outlook).
// Vervangt Resend: karpi.nl is al correct geconfigureerd voor M365 (MX + SPF
// wijzen al naar protection.outlook.com), dus geen extra DNS-records nodig.
// Auth: OAuth2 client-credentials flow met een Entra ID app-registratie
// (API-permissie Mail.Send, application-type, met admin-consent).
// `fetch` is injecteerbaar voor tests.

export interface GraphMailAttachment {
  filename: string
  content: Uint8Array
  contentType?: string
}

export interface GraphMailSendInput {
  tenantId: string
  clientId: string
  clientSecret: string
  /** Mailbox waar vandaan verstuurd wordt, bv. 'facturen@karpi.nl'. De app-registratie moet Mail.Send hebben voor deze mailbox. */
  from: string
  to: string
  replyTo?: string
  subject: string
  html: string
  attachments: GraphMailAttachment[]
}

export interface GraphMailSendResult {
  ok: true
}

type FetchFn = typeof fetch

async function getAccessToken(
  input: Pick<GraphMailSendInput, 'tenantId' | 'clientId' | 'clientSecret'>,
  fetchImpl: FetchFn,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const res = await fetchImpl(`https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { error_description?: string }).error_description ?? `Graph token-fout ${res.status}`
    throw new Error(msg)
  }

  const { access_token } = json as { access_token: string }
  return access_token
}

export async function sendFactuurEmail(
  input: GraphMailSendInput,
  fetchImpl: FetchFn = fetch,
): Promise<GraphMailSendResult> {
  const token = await getAccessToken(input, fetchImpl)

  const message = {
    subject: input.subject,
    body: { contentType: 'HTML', content: input.html },
    toRecipients: [{ emailAddress: { address: input.to } }],
    replyTo: input.replyTo ? [{ emailAddress: { address: input.replyTo } }] : undefined,
    attachments: input.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType ?? 'application/pdf',
      contentBytes: base64Encode(a.content),
    })),
  }

  const res = await fetchImpl(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.from)}/sendMail`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  )

  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    const msg = (json as { error?: { message?: string } }).error?.message ?? `Graph sendMail-fout ${res.status}`
    throw new Error(msg)
  }

  return { ok: true }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
