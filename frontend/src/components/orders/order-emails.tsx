import { useState } from 'react'
import { Mail } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/formatters'
import { useEmailsVoorOrder } from '@/hooks/use-verstuurde-emails'
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'
import { OrderEmailDialog } from './order-email-dialog'
import { EmailSoortBadge } from './order-emails-badge'

interface Props {
  orderId: number
}

/**
 * Tijdlijn van alle voor deze order verstuurde e-mails (facturen +
 * orderbevestigingen, mig 365). Klik op het onderwerp opent de volledige
 * mail in een dialog. Toont een lege staat zolang er niets verstuurd is —
 * zelfde conventie als de Facturatie-sectie ernaast.
 */
export function OrderEmails({ orderId }: Props) {
  const { data: emails, isLoading } = useEmailsVoorOrder(orderId)
  const [openEmail, setOpenEmail] = useState<VerstuurdeEmail | null>(null)

  if (isLoading) return null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Mail size={15} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          E-mails
        </h2>
      </div>

      {!emails || emails.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Nog geen e-mails verstuurd</p>
      ) : (
      <ul className="divide-y divide-slate-100">
        {emails.map((email) => (
          <li key={email.id}>
            <button
              onClick={() => setOpenEmail(email)}
              className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded text-left hover:bg-slate-50 transition-colors"
            >
              <span className="text-xs text-slate-400 whitespace-nowrap w-28 shrink-0">
                {formatDateTime(email.verzonden_op)}
              </span>
              <EmailSoortBadge soort={email.soort} />
              <span className="text-sm text-terracotta-500 hover:underline truncate">
                {email.onderwerp}
              </span>
              <span className="text-xs text-slate-400 truncate ml-auto hidden sm:inline">
                {email.verzonden_aan}
              </span>
            </button>
          </li>
        ))}
      </ul>
      )}

      {openEmail && <OrderEmailDialog email={openEmail} onClose={() => setOpenEmail(null)} />}
    </div>
  )
}
