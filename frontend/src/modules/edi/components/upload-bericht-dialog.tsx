import { useState, type FormEvent, type ChangeEvent } from 'react'
import { X, Loader2, Check, Upload, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { verwerkUploadInkomend, type UploadResult } from '@/modules/edi/lib/upload-helper'

const KARPI_GLN_DEFAULT = '8715954999998'

interface Props {
  open: boolean
  onClose: () => void
}

export function UploadBerichtDialog({ open, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [karpiGln, setKarpiGln] = useState(KARPI_GLN_DEFAULT)
  const [forceerNieuw, setForceerNieuw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)

  const qc = useQueryClient()

  if (!open) return null

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Kies eerst een bestand.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await verwerkUploadInkomend(file, { karpiGln, forceerNieuw })
      setResult(res)
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
    setFile(null)
    setForceerNieuw(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">Bericht uploaden</h2>
            <p className="text-sm text-slate-500">
              Upload een echt <code>.inh</code>-bestand uit Transus' archief om de parser, debiteur-match
              en order-creatie te valideren. Geen Transus-API-call.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Sluiten">
            <X size={18} />
          </button>
        </header>

        {!result ? (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 text-sm">
            <div>
              <label className="block font-medium text-slate-800 mb-1">Bestand</label>
              <input
                type="file"
                accept=".inh,.txt"
                onChange={handleFile}
                className="w-full py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
              {file && (
                <p className="text-xs text-slate-500 mt-1">
                  Geselecteerd: <code>{file.name}</code> ({file.size} bytes)
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Karpi-fixed-width <code>.inh</code> (zoals Transus die naar Karpi levert via M10110).
                EDIFACT-bestanden worden niet ondersteund — die zijn alleen de bron.
              </p>
            </div>

            <div>
              <label className="block font-medium text-slate-800 mb-1">Karpi-GLN (afzender)</label>
              <input
                type="text"
                value={karpiGln}
                onChange={(e) => setKarpiGln(e.target.value)}
                className="w-full py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
            </div>

            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={forceerNieuw}
                onChange={(e) => setForceerNieuw(e.target.checked)}
                className="mt-1"
              />
              <span className="text-xs text-slate-600">
                Forceer als nieuw bericht (negeer dedupe op payload-hash). Gebruik dit alleen als je
                een aangepaste versie van een eerder geüpload bestand opnieuw wilt testen.
              </span>
            </label>

            {error && (
              <div className="p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50"
                disabled={busy}
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={busy || !file}
                className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Verwerk bestand
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5 space-y-4 text-sm">
            <div className="p-3 rounded-[var(--radius-sm)] border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm flex items-start gap-2">
              <Check size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium">
                  {result.reedsBekend
                    ? 'Bestand al eerder geüpload'
                    : 'Bestand verwerkt'}
                </div>
                <div className="text-xs text-emerald-600 mt-1">
                  {result.reedsBekend
                    ? 'Hetzelfde bestand is eerder al verwerkt — we tonen het bestaande bericht. Vink "Forceer als nieuw" aan voor een herhaling.'
                    : result.orderId
                      ? 'Inkomend bericht en order zijn aangemaakt. Open het bericht en klik "Bevestig + verstuur orderbev" om de orderbevestiging op de wachtrij te zetten.'
                      : 'Inkomend bericht aangemaakt. Order-creatie overgeslagen — zie reden hieronder.'}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 text-xs space-y-1">
              <div>
                <span className="text-slate-500">Klantordernummer:</span>{' '}
                <code className="bg-white px-1 rounded">{result.parsed.header.ordernummer}</code>
              </div>
              <div>
                <span className="text-slate-500">Leverdatum:</span>{' '}
                {result.parsed.header.leverdatum ?? <em className="text-slate-400">leeg</em>}
              </div>
              <div>
                <span className="text-slate-500">GLN's:</span> BY=
                <code className="bg-white px-1 rounded">{result.parsed.header.gln_besteller ?? '—'}</code>{' '}
                IV=<code className="bg-white px-1 rounded">{result.parsed.header.gln_gefactureerd ?? '—'}</code>{' '}
                DP=<code className="bg-white px-1 rounded">{result.parsed.header.gln_afleveradres ?? '—'}</code>
              </div>
              <div>
                <span className="text-slate-500">Regels:</span> {result.parsed.regels.length} ×{' '}
                {result.parsed.regels.map((r) => r.gtin).join(', ')}
              </div>
            </div>

            {result.orderSkippedReason && (
              <div className="p-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                <div className="font-medium mb-1">Order niet aangemaakt</div>
                <div>{result.orderSkippedReason}</div>
              </div>
            )}

            <ul className="space-y-2">
              <li>
                <Link
                  to={`/edi/berichten/${result.inkomendId}`}
                  onClick={onClose}
                  className="block p-3 rounded-[var(--radius-sm)] border border-slate-200 hover:border-terracotta-400 hover:bg-slate-50"
                >
                  <div className="text-xs text-slate-500">Inkomend bericht</div>
                  <div className="font-medium text-slate-800">
                    Order in — {result.inkomendPayload.length} bytes
                  </div>
                </Link>
              </li>
              {result.orderId && (
                <li>
                  <Link
                    to={`/orders/${result.orderId}`}
                    onClick={onClose}
                    className="block p-3 rounded-[var(--radius-sm)] border border-slate-200 hover:border-terracotta-400 hover:bg-slate-50"
                  >
                    <div className="text-xs text-slate-500">Aangemaakte order in RugFlow</div>
                    <div className="font-medium text-slate-800">Order #{result.orderId}</div>
                  </Link>
                </li>
              )}
            </ul>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50"
              >
                Nog eentje
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600"
              >
                Sluiten
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
