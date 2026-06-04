import { useState } from 'react'
import { X, Copy, Check } from 'lucide-react'

/** Readonly link-veld met een kopieer-knop. */
export function KopieerLink({ link }: { link: string }) {
  const [gekopieerd, setGekopieerd] = useState(false)

  const kopieer = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setGekopieerd(true)
      setTimeout(() => setGekopieerd(false), 2000)
    } catch {
      // Clipboard geweigerd (bv. geen https) — selecteer als fallback.
      const el = document.getElementById('deel-link') as HTMLInputElement | null
      el?.select()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        id="deel-link"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-xs font-mono text-slate-600 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
      />
      <button
        type="button"
        onClick={kopieer}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 shrink-0"
      >
        {gekopieerd ? <Check size={16} /> : <Copy size={16} />}
        {gekopieerd ? 'Gekopieerd' : 'Kopieer'}
      </button>
    </div>
  )
}

interface DialogProps {
  titel: string
  beschrijving: string
  link: string
  onClose: () => void
}

/** Modaal venster dat een gegenereerde link toont om te delen. */
export function LinkDelenDialog({ titel, beschrijving, link, onClose }: DialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">{titel}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600">{beschrijving}</p>
          <KopieerLink link={link} />
          <p className="text-xs text-slate-400">
            Deze link is persoonlijk en beperkt geldig (verloopt na verloop van tijd).
            Genereer 'm opnieuw als hij verlopen is.
          </p>
          <div className="flex items-center justify-end pt-2 border-t border-slate-100 -mx-6 px-6 -mb-5 pb-5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
            >
              Klaar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
