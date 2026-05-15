import { CheckCircle2, AlertTriangle, Zap, X } from 'lucide-react'
import type { PoPrefillSamenvatting } from '@/lib/orders/po-prefill'

interface Props {
  bestandsnaam: string
  samenvatting: PoPrefillSamenvatting
  onClose: () => void
}

export function PoPrefillBanner({ bestandsnaam, samenvatting: s, onClose }: Props) {
  return (
    <div className="mb-4 rounded-[var(--radius)] border border-terracotta-200 bg-terracotta-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={18} className="text-terracotta-600 mt-0.5 shrink-0" />
        <div className="flex-1 text-sm text-slate-700">
          <div className="font-medium text-slate-900">
            Order voorgevuld uit "{bestandsnaam}"
          </div>
          <ul className="mt-1 space-y-0.5">
            <li>
              Debiteur:{' '}
              {s.debiteurZeker
                ? `herkend (#${s.debiteurNr})`
                : 'niet zeker — kies handmatig'}
            </li>
            <li>
              Regels: {s.regelsGematcht} gematcht
              {s.regelsConcept > 0 && `, ${s.regelsConcept} als concept (controleer artikel)`}
            </li>
            <li>Leverweek: {s.weekBekend ? 'overgenomen' : 'onbekend — vul handmatig'}</li>
            {s.spoed && (
              <li className="flex items-center gap-1 text-amber-700 font-medium">
                <Zap size={13} /> Spoed gedetecteerd — zet de spoed-toggle aan indien nodig
              </li>
            )}
            {!s.debiteurZeker && (
              <li className="flex items-center gap-1 text-amber-700">
                <AlertTriangle size={13} /> Controleer alle voorgevulde velden vóór opslaan
              </li>
            )}
          </ul>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0"
          title="Sluiten"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
