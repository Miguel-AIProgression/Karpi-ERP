import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreateVervoerder } from '@/modules/logistiek/hooks/use-vervoerders'
import type { VervoerderType } from '@/modules/logistiek/queries/vervoerders'

interface Props {
  onClose: () => void
  onCreated?: (code: string) => void
}

const inputClass =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

const TYPE_OPTIES: Array<{ value: VervoerderType; label: string; uitleg: string }> = [
  {
    value: 'api',
    label: 'API',
    uitleg: 'REST-koppeling (HST-stijl). Karpi pusht transportorders direct.',
  },
  {
    value: 'edi',
    label: 'EDI',
    uitleg: 'EDIFACT via Transus (bv. Rhenus, Verhoek). Bericht-uitwisseling.',
  },
  {
    value: 'print',
    label: 'Print',
    uitleg: 'Lokale label-printer (bv. DPD via Zebra). Geen externe dispatch.',
  },
]

function normaliseerCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function VervoerderCreateDialog({ onClose, onCreated }: Props) {
  const [code, setCode] = useState('')
  const [displayNaam, setDisplayNaam] = useState('')
  const [type, setType] = useState<VervoerderType>('api')
  const [notities, setNotities] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMut = useCreateVervoerder()

  const genormaliseerd = normaliseerCode(code)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const naam = displayNaam.trim()
    if (!genormaliseerd) {
      setError('Code is verplicht')
      return
    }
    if (!naam) {
      setError('Display-naam is verplicht')
      return
    }

    try {
      await createMut.mutateAsync({
        code: genormaliseerd,
        display_naam: naam,
        type,
        notities: notities.trim() || null,
      })
      onCreated?.(genormaliseerd)
      onClose()
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err)
      setError(msg)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Nieuwe vervoerder</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Display-naam <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={displayNaam}
              onChange={(e) => setDisplayNaam(e.target.value)}
              placeholder="bv. PostNL, GLS, Bpost"
              className={inputClass}
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Code <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="bv. postnl, gls, edi_partner_c"
              className={`${inputClass} font-mono text-xs`}
              required
            />
            {genormaliseerd && genormaliseerd !== code && (
              <p className="text-xs text-slate-400 mt-1">
                Wordt opgeslagen als{' '}
                <code className="px-1 bg-slate-100 rounded">{genormaliseerd}</code>
              </p>
            )}
            <p className="text-xs text-slate-400 mt-1">
              Unieke sleutel — kleine letters, cijfers en underscores. Niet meer wijzigbaar
              na aanmaken.
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Type <span className="text-rose-500">*</span>
            </label>
            <div className="space-y-2">
              {TYPE_OPTIES.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 px-3 py-2 rounded-[var(--radius-sm)] border cursor-pointer ${
                    type === opt.value
                      ? 'border-terracotta-400 bg-terracotta-50/40'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="vervoerder-type"
                    value={opt.value}
                    checked={type === opt.value}
                    onChange={() => setType(opt.value)}
                    className="mt-0.5 text-terracotta-500 focus:ring-terracotta-400"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700">{opt.label}</div>
                    <div className="text-xs text-slate-500">{opt.uitleg}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Notities (optioneel)</label>
            <textarea
              value={notities}
              onChange={(e) => setNotities(e.target.value)}
              placeholder="Vrije aantekening, bv. contractnummer of contactpersoon."
              className={`${inputClass} min-h-[60px]`}
            />
          </div>

          <div className="px-3 py-2 bg-slate-50 border border-slate-100 text-xs text-slate-500 rounded-[var(--radius-sm)]">
            De vervoerder wordt aangemaakt als <strong>inactief</strong>. Configureer eerst
            API-/print-instellingen en verzendregels in de detailpagina, en zet daarna pas
            actief.
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
              disabled={createMut.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {createMut.isPending ? 'Aanmaken…' : 'Aanmaken'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
