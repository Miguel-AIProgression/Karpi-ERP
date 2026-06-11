import { describe, expect, it } from 'vitest'
import { bouwCommunicatieTijdlijn, type EdiTijdlijnBron } from './communicatie-tijdlijn'
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

const email = (id: number, op: string): VerstuurdeEmail => ({
  id, order_id: 1, factuur_id: null, soort: 'orderbevestiging',
  onderwerp: `Mail ${id}`, verzonden_aan: 'klant@x.nl', verzonden_op: op,
  html: null, bijlagen: [],
})
const edi = (id: number, created: string, sent: string | null, status = 'Verstuurd'): EdiTijdlijnBron => ({
  id, berichttype: 'orderbev', status, is_test: false, sent_at: sent, created_at: created,
})

describe('bouwCommunicatieTijdlijn', () => {
  it('merget e-mails en EDI-berichten gesorteerd nieuwste-eerst', () => {
    const items = bouwCommunicatieTijdlijn(
      [email(1, '2026-06-10T10:00:00Z')],
      [edi(5, '2026-06-11T08:00:00Z', '2026-06-11T08:01:00Z')],
    )
    expect(items.map((i) => i.key)).toEqual(['edi-5', 'email-1'])
    expect(items[0].soort).toBe('edi')
    expect(items[1].soort).toBe('email')
  })

  it('EDI-item gebruikt sent_at als tijdstip, met created_at als fallback (Wachtrij/Fout)', () => {
    const [wachtrij] = bouwCommunicatieTijdlijn([], [edi(7, '2026-06-11T09:00:00Z', null, 'Wachtrij')])
    expect(wachtrij.tijdstip).toBe('2026-06-11T09:00:00Z')
    expect(wachtrij.ediStatus).toBe('Wachtrij')
  })

  it('berichttype-labels zijn Nederlands', () => {
    const [item] = bouwCommunicatieTijdlijn([], [edi(9, '2026-06-11T09:00:00Z', null, 'Wachtrij')])
    expect(item.label).toBe('Orderbevestiging')
  })
})
