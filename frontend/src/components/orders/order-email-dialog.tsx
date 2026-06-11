import { useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/formatters'
import {
  getEmailBijlageSignedUrl,
  type EmailBijlage,
  type VerstuurdeEmail,
} from '@/lib/supabase/queries/verstuurde-emails'
import { EmailSoortBadge } from './order-emails-badge'

interface Props {
  email: VerstuurdeEmail
  onClose: () => void
}

/**
 * In-app weergave van een verstuurde e-mail. De body wordt in een sandboxed
 * iframe gerenderd (sandbox="") zodat mail-HTML nooit scripts kan draaien of
 * kan navigeren binnen RugFlow. Bijlagen openen via een signed URL (10 min)
 * in een nieuw tabblad — zelfde patroon als de facturen-PDF.
 */
export function OrderEmailDialog({ email, onClose }: Props) {
  const [bijlageError, setBijlageError] = useState<string | null>(null)

  async function openBijlage(bijlage: EmailBijlage) {
    setBijlageError(null)
    try {
      const url = await getEmailBijlageSignedUrl(bijlage)
      window.open(url, '_blank', 'noopener')
    } catch {
      setBijlageError(`Bijlage '${bijlage.filename}' kon niet geopend worden (bestand niet gevonden in storage).`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <EmailSoortBadge soort={email.soort} />
              <span className="text-xs text-slate-400">{formatDateTime(email.verzonden_op)}</span>
            </div>
            <h2 className="font-medium text-lg text-slate-800 truncate">{email.onderwerp}</h2>
            <p className="text-sm text-slate-500 truncate">Aan: {email.verzonden_aan}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0 mt-1">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 min-h-0 px-6 py-4 overflow-y-auto">
          {email.html ? (
            <iframe
              sandbox=""
              srcDoc={email.html}
              title={`E-mail ${email.onderwerp}`}
              className="w-full h-[50vh] border border-slate-100 rounded bg-white"
            />
          ) : (
            <p className="text-sm text-slate-400 italic py-6 text-center">
              Inhoud niet bewaard (verstuurd vóór de e-mailtijdlijn).
            </p>
          )}
        </div>

        {email.bijlagen.length > 0 && (
          <footer className="px-6 py-3 border-t border-slate-100">
            <div className="flex flex-wrap gap-2">
              {email.bijlagen.map((b) => (
                <button
                  key={`${b.bucket}/${b.path}/${b.filename}`}
                  onClick={() => void openBijlage(b)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                >
                  <Paperclip size={13} className="text-slate-400" />
                  {b.filename}
                </button>
              ))}
            </div>
            {bijlageError && <p className="mt-2 text-xs text-red-600">{bijlageError}</p>}
          </footer>
        )}
      </div>
    </div>
  )
}
