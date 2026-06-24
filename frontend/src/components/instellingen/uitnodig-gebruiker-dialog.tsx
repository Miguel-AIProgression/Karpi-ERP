import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useGenereerLoginLink } from '@/hooks/use-gebruikers'
import { useVertegenwoordigers } from '@/hooks/use-medewerkers'
import { ROL_EXTERN_REP } from '@/lib/auth/rol'
import { KopieerLink } from '@/components/instellingen/link-delen'

interface Props {
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function UitnodigGebruikerDialog({ onClose }: Props) {
  const [email, setEmail] = useState('')
  const [isRep, setIsRep] = useState(false)
  const [vertegenwCode, setVertegenwCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resultaat, setResultaat] = useState<{ email: string; link: string } | null>(null)

  const genereerMut = useGenereerLoginLink()
  const { data: vertegenwoordigers } = useVertegenwoordigers()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      setError('E-mailadres is verplicht')
      return
    }
    if (isRep && !vertegenwCode) {
      setError('Kies de vertegenwoordiger voor dit account')
      return
    }
    try {
      const { link } = await genereerMut.mutateAsync({
        email: trimmed,
        rolToewijzing: isRep
          ? { rol: ROL_EXTERN_REP, vertegenw_code: vertegenwCode }
          : undefined,
      })
      setResultaat({ email: trimmed, link })
      setEmail('')
      setIsRep(false)
      setVertegenwCode('')
    } catch (err) {
      console.error('[UitnodigGebruikerDialog]', err)
      const e = err as { message?: unknown } | null
      setError(typeof e?.message === 'string' ? e.message : 'Onbekende fout — zie console')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Gebruiker toevoegen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        {resultaat ? (
          <div className="px-6 py-5 space-y-4">
            <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-[var(--radius-sm)] text-sm text-emerald-800">
              Account aangemaakt voor <strong>{resultaat.email}</strong>. Stuur onderstaande
              link naar deze collega — daarmee stelt diegene zelf een wachtwoord in en kan
              vervolgens inloggen.
            </div>
            <KopieerLink link={resultaat.link} />
            <p className="text-xs text-slate-400">
              De link is persoonlijk en beperkt geldig. Verlopen? Genereer 'm opnieuw via de
              sleutel-knop in het overzicht.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 -mx-6 px-6 -mb-5 pb-5">
              <button
                type="button"
                onClick={() => setResultaat(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Nog iemand toevoegen
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
              >
                Sluiten
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                E-mailadres <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@karpi.nl"
                className={inputClasses}
                required
                autoFocus
              />
              <p className="text-xs text-slate-400 mt-1">
                Het account wordt aangemaakt en je krijgt een link die je zelf naar de collega
                stuurt (geen e-mail vanuit het systeem nodig).
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isRep}
                  onChange={(e) => setIsRep(e.target.checked)}
                  className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
                />
                Externe vertegenwoordiger (read-only, alleen eigen klanten)
              </label>
              {isRep && (
                <div className="mt-2">
                  <label className="block text-sm text-slate-600 mb-1">
                    Vertegenwoordiger <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={vertegenwCode}
                    onChange={(e) => setVertegenwCode(e.target.value)}
                    className={inputClasses}
                    required
                  >
                    <option value="">— Kies vertegenwoordiger —</option>
                    {(vertegenwoordigers ?? []).map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.naam} ({v.code})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Het account ziet uitsluitend orders, klanten en facturen van deze
                    vertegenwoordiger en kan niets wijzigen.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)]">
                {error}
              </div>
            )}

            <footer className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 -mx-6 px-6 -mb-5 pb-5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={genereerMut.isPending}
                className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
              >
                {genereerMut.isPending ? 'Bezig…' : 'Aanmaken & link genereren'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  )
}
