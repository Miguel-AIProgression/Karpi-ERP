import { useState, type FormEvent } from 'react'
import { X, Loader2, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { genereerDemoBerichten, type DemoTemplate, type DemoResult } from '@/modules/edi/lib/demo-helper'

const KARPI_GLN_DEFAULT = '8715954999998'

interface Props {
  open: boolean
  onClose: () => void
}

export function DemoBerichtDialog({ open, onClose }: Props) {
  const [template, setTemplate] = useState<DemoTemplate>('bdsk-sparse')
  const [karpiGln, setKarpiGln] = useState(KARPI_GLN_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DemoResult | null>(null)

  const qc = useQueryClient()

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await genereerDemoBerichten(template, { karpiGln })
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
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">Demo-bericht maken</h2>
            <p className="text-sm text-slate-500">
              Simuleert een binnenkomende EDI-order + automatisch gegenereerde orderbevestiging.
              Geen echte Transus-API-call.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Sluiten">
            <X size={18} />
          </button>
        </header>

        {!result ? (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 text-sm">
            <div>
              <div className="font-medium text-slate-800 mb-2">Template</div>
              <label className="flex items-start gap-2 py-1 cursor-pointer">
                <input
                  type="radio"
                  name="template"
                  value="bdsk-sparse"
                  checked={template === 'bdsk-sparse'}
                  onChange={() => setTemplate('bdsk-sparse')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">BDSK (slank)</span>
                  <span className="block text-slate-500 text-xs">
                    1 regel, alleen GLN's + GTIN + aantal. XXXLUTZ Wuerselen → BDSK HQ Würzburg.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 py-1 cursor-pointer">
                <input
                  type="radio"
                  name="template"
                  value="ostermann-rich"
                  checked={template === 'ostermann-rich'}
                  onChange={() => setTemplate('ostermann-rich')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Ostermann (rijk)</span>
                  <span className="block text-slate-500 text-xs">
                    3 regels met artikelcodes. Filiaal Leverkusen → HQ Witten.
                  </span>
                </span>
              </label>
            </div>

            <div>
              <label className="block font-medium text-slate-800 mb-1">Karpi-GLN (afzender)</label>
              <input
                type="text"
                value={karpiGln}
                onChange={(e) => setKarpiGln(e.target.value)}
                className="w-full py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="text-xs text-slate-500 mt-1">
                Standaardwaarde uit <code className="bg-slate-100 px-1 rounded">app_config.bedrijfsgegevens.gln_eigen</code>.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 text-rose-700 text-xs">
                {error}
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
                disabled={busy}
                className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Genereer demo-bericht
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5 space-y-4 text-sm">
            <div className="p-3 rounded-[var(--radius-sm)] border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm flex items-start gap-2">
              <Check size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium">Demo-bericht aangemaakt</div>
                <div className="text-xs text-emerald-600 mt-1">
                  {result.orderId
                    ? `Inkomend bericht + order in RugFlow gegenereerd. Open het bericht en klik "Bevestig + verstuur orderbev" om de orderbevestiging op de wachtrij te zetten.`
                    : 'Inkomend bericht aangemaakt. Order-creatie overgeslagen — zie reden hieronder.'}
                </div>
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
                  <div className="text-xs text-slate-500">Inkomend bericht (gefingeerd)</div>
                  <div className="font-medium text-slate-800">Order in — {result.inkomendPayload.length} bytes</div>
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
                    <div className="text-xs text-slate-500 mt-1">
                      bron_systeem=<code>edi</code>, bron_order_id=TransactionID
                    </div>
                  </Link>
                </li>
              )}
            </ul>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50"
              >
                Nog een
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
