import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useAnnuleerRegel, useVerwijderRegel, useWijzigRegel } from '../hooks/use-regel-mutaties'
import { isClaimVloerFout } from '../queries/regel-mutaties'
import type { InkooporderRegel } from '../queries/inkooporders'

export type RegelBewerkModus = 'bewerken' | 'annuleren' | 'verwijderen'

interface Props {
  regel: InkooporderRegel
  modus: RegelBewerkModus
  onClose: () => void
}

const TITELS: Record<RegelBewerkModus, string> = {
  bewerken: 'Regel bewerken',
  annuleren: 'Regel annuleren (rest komt niet meer)',
  verwijderen: 'Regel verwijderen',
}

/**
 * Eén dialog voor de drie regel-mutaties (mig 602, besluit 2026-07-02).
 * Server-side guards zijn leidend: een 'Claim-vloer:'-fout wordt hier
 * omgezet in een expliciete bevestigings-checkbox (vrijgeven) i.p.v. een
 * dead-end-foutmelding.
 */
export function RegelBewerkenDialog({ regel, modus, onClose }: Props) {
  const { isExternRep } = useAuth()
  const [besteld, setBesteld] = useState(String(regel.besteld_m))
  const [prijs, setPrijs] = useState(regel.inkoopprijs_eur != null ? String(regel.inkoopprijs_eur) : '')
  const [error, setError] = useState<string | null>(null)
  const [claimVloerMelding, setClaimVloerMelding] = useState<string | null>(null)
  const [vrijgevenBevestigd, setVrijgevenBevestigd] = useState(false)

  const wijzig = useWijzigRegel()
  const annuleer = useAnnuleerRegel()
  const verwijder = useVerwijderRegel()
  const isPending = wijzig.isPending || annuleer.isPending || verwijder.isPending

  // Externe vertegenwoordiger (mig 489): read-only — regel-mutaties niet toegestaan.
  if (isExternRep) return null

  const voerUit = async (vrijgeven: boolean) => {
    if (modus === 'bewerken') {
      const b = Number(besteld)
      if (!Number.isFinite(b) || b <= 0) throw new Error('Besteld moet > 0 zijn')
      await wijzig.mutateAsync({
        regelId: regel.id,
        besteld: b !== regel.besteld_m ? b : null,
        inkoopprijsEur: prijs === '' ? null : Number(prijs),
        vrijgeven,
      })
    } else if (modus === 'annuleren') {
      await annuleer.mutateAsync({ regelId: regel.id, vrijgeven })
    } else {
      await verwijder.mutateAsync({ regelId: regel.id, vrijgeven })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await voerUit(claimVloerMelding != null && vrijgevenBevestigd)
      onClose()
    } catch (err) {
      if (isClaimVloerFout(err)) {
        setClaimVloerMelding((err as Error).message)
      } else {
        setError(err instanceof Error ? err.message : 'Mutatie mislukt')
      }
    }
  }

  const eh = regel.eenheid === 'stuks' ? 'st.' : 'm²'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">{TITELS[modus]}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-500">
            Regel {regel.regelnummer} · {regel.karpi_code ?? regel.artikelnr ?? '-'} · besteld{' '}
            {regel.besteld_m} {eh}, geleverd {regel.geleverd_m} {eh}
          </p>

          {modus === 'bewerken' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 text-slate-600">Besteld ({eh})</span>
                <input
                  type="number"
                  value={besteld}
                  onChange={(e) => setBesteld(e.target.value)}
                  className={inputClasses}
                  step="0.01"
                  min="0.01"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block mb-1 text-slate-600">Prijs (€)</span>
                <input
                  type="number"
                  value={prijs}
                  onChange={(e) => setPrijs(e.target.value)}
                  className={inputClasses}
                  step="0.01"
                  min="0"
                />
              </label>
            </div>
          )}

          {modus === 'annuleren' && (
            <p className="text-sm text-slate-700">
              Besteld wordt teruggezet naar wat al geleverd is ({regel.geleverd_m} {eh}); de
              openstaande {regel.te_leveren_m} {eh} vervalt.
            </p>
          )}
          {modus === 'verwijderen' && (
            <p className="text-sm text-slate-700">
              De regel wordt definitief verwijderd. Kan alleen zolang er niets op ontvangen is.
            </p>
          )}

          {claimVloerMelding && (
            <div className="text-sm bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] px-3 py-2 space-y-2">
              <p className="text-amber-800">{claimVloerMelding}</p>
              <label className="flex items-start gap-2 text-amber-900 font-medium">
                <input
                  type="checkbox"
                  checked={vrijgevenBevestigd}
                  onChange={(e) => setVrijgevenBevestigd(e.target.checked)}
                  className="mt-0.5"
                />
                Beloftes vrijgeven en doorgaan — getroffen orders vallen terug naar
                &ldquo;Wacht op inkoop&rdquo;
              </label>
            </div>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Sluiten
            </button>
            <button
              type="submit"
              disabled={isPending || (claimVloerMelding != null && !vrijgevenBevestigd)}
              className={`px-4 py-2 text-white rounded-[var(--radius-sm)] text-sm font-medium disabled:opacity-50 ${
                modus === 'bewerken' ? 'bg-terracotta-500 hover:bg-terracotta-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {isPending ? 'Bezig…' : TITELS[modus]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
