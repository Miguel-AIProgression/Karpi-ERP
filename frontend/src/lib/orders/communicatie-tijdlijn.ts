// Voegt de twee communicatie-bronnen van een order samen tot één tijdlijn:
//   - verstuurde_emails (mig 366) — e-mails, altijd 'verstuurd'
//   - edi_berichten richting='uit' — EDI, asynchroon (Wachtrij → Verstuurd/Fout)
// Bewust GEEN dubbel-loggen: elke bron blijft z'n eigen bron-van-waarheid;
// deze helper is puur presentatie-merge (testbaar zonder Supabase).
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

export interface EdiTijdlijnBron {
  id: number
  berichttype: string
  status: string
  is_test: boolean
  sent_at: string | null
  created_at: string
}

export interface CommunicatieItem {
  key: string
  soort: 'email' | 'edi'
  label: string
  tijdstip: string
  /** Alleen voor EDI: Wachtrij | Bezig | Verstuurd | Fout. */
  ediStatus: string | null
  isTest: boolean
  email: VerstuurdeEmail | null
  ediBerichtId: number | null
}

const EDI_LABELS: Record<string, string> = {
  orderbev: 'Orderbevestiging',
  factuur: 'Factuur',
  verzendbericht: 'Verzendbevestiging',
}

const EMAIL_LABELS: Record<string, string> = {
  factuur: 'Factuur',
  orderbevestiging: 'Orderbevestiging',
}

export function bouwCommunicatieTijdlijn(
  emails: VerstuurdeEmail[],
  ediBerichten: EdiTijdlijnBron[],
): CommunicatieItem[] {
  const emailItems: CommunicatieItem[] = emails.map((e) => ({
    key: `email-${e.id}`,
    soort: 'email',
    label: EMAIL_LABELS[e.soort] ?? e.soort,
    tijdstip: e.verzonden_op,
    ediStatus: null,
    isTest: false,
    email: e,
    ediBerichtId: null,
  }))
  const ediItems: CommunicatieItem[] = ediBerichten.map((b) => ({
    key: `edi-${b.id}`,
    soort: 'edi',
    label: EDI_LABELS[b.berichttype] ?? b.berichttype,
    tijdstip: b.sent_at ?? b.created_at,
    ediStatus: b.status,
    isTest: b.is_test,
    email: null,
    ediBerichtId: b.id,
  }))
  return [...emailItems, ...ediItems].sort((a, b) => b.tijdstip.localeCompare(a.tijdstip))
}
