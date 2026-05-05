import { useMemo } from 'react'
import { AlertTriangle, Calendar } from 'lucide-react'
import { useAlleSnijden } from '@/hooks/use-snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { berekenTotDatum } from '@/components/snijplanning/week-filter'
import { berekenAgenda, type RolBlok, type Werktijden } from '@/lib/utils/bereken-agenda'
import { WerktijdenConfig, useWerktijden } from '@/components/werkagenda/werktijden-config'
import { cn } from '@/lib/utils/cn'

const DAG_LABELS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']

function fmtTijd(d: Date): string {
  return d.toTimeString().slice(0, 5)
}
function fmtDatum(d: Date): string {
  return `${DAG_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function AgendaWeergave() {
  const [werktijden, setWerktijden] = useWerktijden()
  const { data: planningConfig } = usePlanningConfig()
  const totDatum = berekenTotDatum(planningConfig?.weken_vooruit ?? null)
  const { data: alleSnijden, isLoading } = useAlleSnijden(totDatum)

  const blokken = useMemo(() => {
    if (!alleSnijden || !planningConfig) return []
    return berekenAgenda(alleSnijden, werktijden, planningConfig)
  }, [alleSnijden, planningConfig, werktijden])

  return (
    <>
      <WerktijdenConfig werktijden={werktijden} onChange={setWerktijden} />
      <SamenvattingBalk blokken={blokken} werktijden={werktijden} />
      {isLoading || !planningConfig ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Agenda berekenen...
        </div>
      ) : blokken.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          <Calendar size={32} className="mx-auto mb-3 opacity-30" />
          <p>Geen rollen om te plannen</p>
          <p className="text-sm mt-1">Maak eerst een snijvoorstel zodat rollen toegewezen worden</p>
        </div>
      ) : (
        <AgendaLijst blokken={blokken} />
      )}
    </>
  )
}

function SamenvattingBalk({ blokken, werktijden }: { blokken: RolBlok[]; werktijden: Werktijden }) {
  const laatste = blokken[blokken.length - 1]
  const teLaatAantal = blokken.filter((b) => b.teLaat).length
  const totMinuten = blokken.reduce((s, b) => s + b.duurMinuten, 0)
  const uren = Math.floor(totMinuten / 60)
  const min = totMinuten % 60

  return (
    <div className="flex flex-wrap items-center gap-4 mb-4 px-4 py-3 bg-white rounded-[var(--radius)] border border-slate-200 text-sm">
      <div>
        <span className="text-slate-500">Rollen:</span>{' '}
        <strong>{blokken.length}</strong>
      </div>
      <div>
        <span className="text-slate-500">Totale snijtijd:</span>{' '}
        <strong>{uren > 0 ? `${uren} uur ` : ''}{min} min</strong>
      </div>
      {laatste && (
        <div>
          <span className="text-slate-500">Klaar op:</span>{' '}
          <strong>{fmtDatum(laatste.eind)} om {fmtTijd(laatste.eind)}</strong>
        </div>
      )}
      {teLaatAantal > 0 && (
        <div className="flex items-center gap-1.5 ml-auto text-red-700">
          <AlertTriangle size={14} />
          <strong>{teLaatAantal}</strong> {teLaatAantal === 1 ? 'rol' : 'rollen'} later dan leverdatum
        </div>
      )}
      {werktijden.werkdagen.length === 0 && (
        <div className="text-amber-700">⚠ geen werkdagen ingesteld</div>
      )}
    </div>
  )
}

function AgendaLijst({ blokken }: { blokken: RolBlok[] }) {
  // Groepeer per dag
  const perDag = useMemo(() => {
    const map = new Map<string, RolBlok[]>()
    for (const b of blokken) {
      // Een rol kan over meerdere dagen lopen — toon op startdag
      const key = isoDay(b.start)
      const lijst = map.get(key) ?? []
      lijst.push(b)
      map.set(key, lijst)
    }
    return Array.from(map.entries())
  }, [blokken])

  return (
    <div className="space-y-4">
      {perDag.map(([iso, rollen]) => {
        const datum = new Date(iso + 'T00:00:00')
        const totMin = rollen.reduce((s, b) => s + b.duurMinuten, 0)
        return (
          <div key={iso} className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800">{fmtDatum(datum)}</span>
              <span className="text-xs text-slate-500">
                {rollen.length} {rollen.length === 1 ? 'rol' : 'rollen'} · {Math.floor(totMin / 60)}u {totMin % 60}m
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 px-4">Tijd</th>
                  <th className="py-2 px-4">Rol</th>
                  <th className="py-2 px-4">Kwaliteit / Kleur</th>
                  <th className="py-2 px-4">Stuks</th>
                  <th className="py-2 px-4">Duur</th>
                  <th className="py-2 px-4">Leverdatum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rollen.map((b) => {
                  const uren = Math.floor(b.duurMinuten / 60)
                  const min = b.duurMinuten % 60
                  return (
                    <tr key={b.rolId} className={cn('hover:bg-slate-50', b.teLaat && 'bg-red-50/50')}>
                      <td className="py-2 px-4 tabular-nums">
                        {fmtTijd(b.start)} – {fmtTijd(b.eind)}
                        {isoDay(b.start) !== isoDay(b.eind) && (
                          <span className="text-xs text-slate-400 ml-1">(→ {fmtDatum(b.eind)})</span>
                        )}
                      </td>
                      <td className="py-2 px-4 font-medium">{b.rolnummer}</td>
                      <td className="py-2 px-4 text-slate-700">{b.kwaliteitCode} {b.kleurCode}</td>
                      <td className="py-2 px-4 tabular-nums">{b.stukken.length}</td>
                      <td className="py-2 px-4 tabular-nums">{uren > 0 ? `${uren}u ` : ''}{min}m</td>
                      <td className={cn('py-2 px-4', b.teLaat && 'text-red-700 font-medium')}>
                        {b.vroegsteLeverdatum ? (
                          <span className="inline-flex items-center gap-1">
                            {b.teLaat && <AlertTriangle size={12} />}
                            {b.vroegsteLeverdatum.split('-').reverse().join('-')}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
