import { useState } from 'react'
import { Mail, ArrowLeftRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/utils/formatters'
import { useEmailsVoorOrder } from '@/hooks/use-verstuurde-emails'
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'
import { OrderEmailDialog } from './order-email-dialog'
import { EmailSoortBadge } from './order-emails-badge'
import { fetchUitgaandeEdiBerichtenVoorOrder } from '@/modules/edi'
import { bouwCommunicatieTijdlijn } from '@/lib/orders/communicatie-tijdlijn'

interface Props {
  orderId: number
}

/**
 * Tijdlijn van alle voor deze order verstuurde communicatie: e-mails
 * (facturen + orderbevestigingen, mig 366) én uitgaande EDI-berichten
 * (orderbev/factuur/verzendbericht). Klik op een e-mail-onderwerp opent de
 * volledige mail in een dialog; EDI-items linken door naar het bericht-detail.
 * Toont een lege staat zolang er niets verstuurd is — zelfde conventie als
 * de Facturatie-sectie ernaast.
 */
export function OrderEmails({ orderId }: Props) {
  const { data: emails, isLoading } = useEmailsVoorOrder(orderId)
  const { data: ediBerichten, isLoading: ediLoading } = useQuery({
    queryKey: ['edi-uitgaand-voor-order', orderId],
    queryFn: () => fetchUitgaandeEdiBerichtenVoorOrder(orderId),
  })
  const [openEmail, setOpenEmail] = useState<VerstuurdeEmail | null>(null)

  if (isLoading || ediLoading) return null

  const items = bouwCommunicatieTijdlijn(emails ?? [], ediBerichten ?? [])

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Mail size={15} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Communicatie
        </h2>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Nog geen communicatie verstuurd</p>
      ) : (
      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          item.soort === 'email' ? (
            <li key={item.key}>
              <button
                onClick={() => setOpenEmail(item.email!)}
                className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-xs text-slate-400 whitespace-nowrap w-28 shrink-0">
                  {formatDateTime(item.tijdstip)}
                </span>
                <EmailSoortBadge soort={item.email!.soort} onderwerp={item.email!.onderwerp} />
                <span className="text-sm text-terracotta-500 hover:underline truncate">
                  {item.email!.onderwerp}
                </span>
                <span className="text-xs text-slate-400 truncate ml-auto hidden sm:inline">
                  {item.email!.verzonden_aan}
                </span>
              </button>
            </li>
          ) : (
            <li key={item.key}>
              <Link
                to={`/edi/berichten/${item.ediBerichtId}`}
                className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-xs text-slate-400 whitespace-nowrap w-28 shrink-0">
                  {formatDateTime(item.tijdstip)}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                  <ArrowLeftRight size={11} /> EDI
                </span>
                <span className="text-sm text-terracotta-500 hover:underline truncate">
                  {item.label}{item.isTest ? ' (test)' : ''}
                </span>
                <span className={`text-xs ml-auto ${item.ediStatus === 'Fout' ? 'text-rose-600 font-medium' : item.ediStatus === 'Verstuurd' ? 'text-green-600' : 'text-slate-400'}`}>
                  {item.ediStatus}
                </span>
              </Link>
            </li>
          )
        ))}
      </ul>
      )}

      {openEmail && <OrderEmailDialog email={openEmail} onClose={() => setOpenEmail(null)} />}
    </div>
  )
}
