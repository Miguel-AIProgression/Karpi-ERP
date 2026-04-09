import { useState } from 'react'
import { CheckCircle2, XCircle, Printer, Package } from 'lucide-react'

interface ReststukBevestigingModalProps {
  berekendeLengte: number
  rolBreedte: number
  kwaliteit: string
  kleur: string
  rolnummer: string
  onBevestig: (lengte: number) => void
  onGeenReststuk: () => void
  onAnnuleer: () => void
}

export function ReststukBevestigingModal({
  berekendeLengte,
  rolBreedte,
  kwaliteit,
  kleur,
  rolnummer,
  onBevestig,
  onGeenReststuk,
  onAnnuleer,
}: ReststukBevestigingModalProps) {
  const [lengte, setLengte] = useState(berekendeLengte)
  const oppervlak = Math.round((lengte * rolBreedte) / 10000 * 100) / 100

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 shadow-xl w-full max-w-md mx-4">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center gap-2 mb-4">
            <Package size={20} className="text-terracotta-500" />
            <h2 className="text-lg font-semibold text-slate-900">Reststuk bevestigen</h2>
          </div>

          <div className="text-sm text-slate-600 mb-4">
            Na het snijden van <span className="font-medium">{rolnummer}</span> ({kwaliteit} {kleur}) blijft er een reststuk over.
          </div>

          <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4 mb-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Restlengte (cm)
              </label>
              <input
                type="number"
                min={0}
                max={9999}
                value={lengte}
                onChange={(e) => setLengte(Math.max(0, Number(e.target.value)))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              {lengte !== berekendeLengte && (
                <button
                  onClick={() => setLengte(berekendeLengte)}
                  className="ml-2 text-xs text-terracotta-500 hover:underline"
                >
                  Reset ({berekendeLengte} cm)
                </button>
              )}
            </div>
            <div className="flex gap-6 text-sm text-slate-500">
              <span>Breedte: {rolBreedte} cm</span>
              <span>Oppervlak: {oppervlak} m²</span>
            </div>
          </div>

          {lengte <= 50 && lengte > 0 && (
            <div className="text-xs text-amber-600 mb-3">
              Reststukken van 50 cm of minder worden niet opgeslagen (te klein).
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 rounded-b-[var(--radius)] flex items-center gap-3">
          <button
            onClick={() => onBevestig(lengte)}
            disabled={lengte <= 50}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <Printer size={14} />
            Opslaan & print sticker
          </button>
          <button
            onClick={onGeenReststuk}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-white transition-colors"
          >
            <XCircle size={14} />
            Geen reststuk
          </button>
          <button
            onClick={onAnnuleer}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600"
          >
            Annuleer
          </button>
        </div>
      </div>
    </div>
  )
}
