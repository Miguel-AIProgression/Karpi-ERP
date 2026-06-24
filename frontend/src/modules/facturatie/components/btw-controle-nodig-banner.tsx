import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Globe2, Loader2, Check } from 'lucide-react'
import { useMarkeerBtwRegelingGeaccepteerd } from '../hooks/use-facturen'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  factuurId: number
  debiteurNr: number
  /** facturen.btw_controle_nodig_sinds (ISO). */
  controleNodigSinds: string
  /** facturen.btw_regeling — snapshot van de regeling-code. */
  btwRegeling: string | null
}

// Spiegelt BtwRegeling uit _shared/btw.ts (mig 454/455/456).
const REGELING_LABEL: Record<string, string> = {
  eu_b2b_binnenland_afwijking: 'Afwijkend EU-afleverland',
  export_buiten_eu: 'Exportlevering buiten de EU',
  eu_b2b_icl: 'EU-intracommunautair zonder btw-nummer',
}

/**
 * Mig 456: banner op factuur-detail als bepaal_btw_regeling een afwijkende of
 * onzekere regeling signaleerde. Twee uitwegen: het btw-nummer/de klant-
 * instelling corrigeren (gate verdwijnt automatisch bij her-projectie), of
 * bewust bevestigen dat het tarief klopt. Patroon: LevertijdWijzigingBanner /
 * PrijsOntbreektBanner.
 */
export function BtwControleNodigBanner({ factuurId, debiteurNr, controleNodigSinds, btwRegeling }: Props) {
  const mutatie = useMarkeerBtwRegelingGeaccepteerd()
  const [fout, setFout] = useState<string | null>(null)
  // Externe vertegenwoordiger (mig 489): read-only — deze banner is puur een muteer-actie.
  const { isExternRep } = useAuth()

  function handleBevestig() {
    setFout(null)
    mutatie.mutate(factuurId, {
      onError: (err) => setFout(err instanceof Error ? err.message : String(err)),
    })
  }

  // Read-only: deze banner bestaat uitsluitend om een muteer-actie aan te bieden.
  if (isExternRep) return null

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
        <Globe2 size={18} />
        BTW controle nodig — {btwRegeling ? REGELING_LABEL[btwRegeling] ?? btwRegeling : ''}
      </div>
      <div className="mb-3 text-sm text-amber-800">
        Open sinds {new Date(controleNodigSinds).toLocaleString('nl-NL')}. Controleer het
        afleverland en de klant-instelling (
        <Link to={`/klanten/${debiteurNr}`} className="underline hover:text-amber-700">
          klantpagina
        </Link>
        ) voordat je deze factuur verzendt.
      </div>
      <button
        onClick={handleBevestig}
        disabled={mutatie.isPending}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        title="Bevestigt dat het BTW-tarief op deze factuur klopt."
      >
        {mutatie.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        BTW-tarief klopt — bevestigen
      </button>
      {fout && <div className="mt-2 text-sm text-rose-600">{fout}</div>}
    </div>
  )
}
