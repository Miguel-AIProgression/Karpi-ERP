import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { isoWeekJaar, isoWeekMaandag, maandagVanIsoWeek } from '@/lib/utils/iso-week'

interface KalenderRij {
  weekNr: number
  weekJaar: number
  dagen: Date[]
}

function getKalenderGrid(jaar: number, maand: number): KalenderRij[] {
  const eersteVanMaand = new Date(Date.UTC(jaar, maand, 1))
  const startMaandag = isoWeekMaandag(eersteVanMaand)

  const laatsVanMaand = new Date(Date.UTC(jaar, maand + 1, 0))
  const eindMaandag = isoWeekMaandag(laatsVanMaand)

  const rijen: KalenderRij[] = []
  const current = new Date(startMaandag)

  while (current <= eindMaandag) {
    const maandag = new Date(current)
    const { jaar: weekJaar, week: weekNr } = isoWeekJaar(maandag)
    const dagen: Date[] = []
    for (let d = 0; d < 7; d++) {
      dagen.push(new Date(current))
      current.setUTCDate(current.getUTCDate() + 1)
    }
    rijen.push({ weekNr, weekJaar, dagen })
  }

  return rijen
}

function vrijdagVanWeek(weekJaar: number, weekNr: number): string {
  const maandag = maandagVanIsoWeek(weekJaar, weekNr)
  const vrijdag = new Date(maandag)
  vrijdag.setUTCDate(maandag.getUTCDate() + 4)
  return vrijdag.toISOString().slice(0, 10)
}

function datumAlsIso(dag: Date): string {
  return dag.toISOString().slice(0, 10)
}

function formatDisplay(mode: 'week' | 'datum', waarde?: string): string {
  if (!waarde) return ''
  const d = new Date(waarde + 'T00:00:00Z')
  if (mode === 'week') {
    const { jaar, week } = isoWeekJaar(d)
    return `Wk ${week} · ${jaar}`
  }
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getUTCFullYear()}`
}

const MAAND_NAMEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]
const DAG_HEADERS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

interface WeekDatumPickerProps {
  mode: 'week' | 'datum'
  waarde?: string
  onChange: (datum: string) => void
  className?: string
}

export function WeekDatumPicker({ mode, waarde, onChange, className }: WeekDatumPickerProps) {
  const [open, setOpen] = useState(false)
  const [viewJaar, setViewJaar] = useState(() => {
    if (waarde) return new Date(waarde + 'T00:00:00Z').getUTCFullYear()
    return new Date().getUTCFullYear()
  })
  const [viewMaand, setViewMaand] = useState(() => {
    if (waarde) return new Date(waarde + 'T00:00:00Z').getUTCMonth()
    return new Date().getUTCMonth()
  })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function openPicker() {
    if (waarde) {
      const d = new Date(waarde + 'T00:00:00Z')
      setViewJaar(d.getUTCFullYear())
      setViewMaand(d.getUTCMonth())
    }
    setOpen(o => !o)
  }

  function prevMaand() {
    if (viewMaand === 0) { setViewMaand(11); setViewJaar(y => y - 1) }
    else setViewMaand(m => m - 1)
  }
  function nextMaand() {
    if (viewMaand === 11) { setViewMaand(0); setViewJaar(y => y + 1) }
    else setViewMaand(m => m + 1)
  }

  const rijen = getKalenderGrid(viewJaar, viewMaand)

  const vandaagIso = datumAlsIso(new Date(
    Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  ))

  const geselecteerdeWeek = waarde
    ? isoWeekJaar(new Date(waarde + 'T00:00:00Z'))
    : null

  function handleRijKlik(rij: KalenderRij) {
    onChange(vrijdagVanWeek(rij.weekJaar, rij.weekNr))
    setOpen(false)
  }

  function handleDagKlik(dag: Date) {
    onChange(datumAlsIso(dag))
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={openPicker}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm text-left focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white flex items-center justify-between gap-2"
      >
        <span className={waarde ? 'text-slate-900' : 'text-slate-400'}>
          {formatDisplay(mode, waarde) || 'Kies een datum…'}
        </span>
        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-lg p-3 select-none"
          style={{ minWidth: '260px' }}
        >
          {/* Maand-navigatie */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMaand}
              className="p-1 rounded hover:bg-slate-100 text-slate-500"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-slate-700 capitalize">
              {MAAND_NAMEN[viewMaand]} {viewJaar}
            </span>
            <button
              type="button"
              onClick={nextMaand}
              className="p-1 rounded hover:bg-slate-100 text-slate-500"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Kalender-grid */}
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="text-right pr-2 pb-1 text-slate-400 font-normal w-7">Wk</th>
                {DAG_HEADERS.map(d => (
                  <th key={d} className="text-center pb-1 text-slate-400 font-normal w-8">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rijen.map((rij) => {
                const rijGeselecteerd =
                  geselecteerdeWeek !== null &&
                  rij.weekNr === geselecteerdeWeek.week &&
                  rij.weekJaar === geselecteerdeWeek.jaar

                return (
                  <tr
                    key={`${rij.weekJaar}-${rij.weekNr}`}
                    className={
                      mode === 'week'
                        ? `cursor-pointer group ${rijGeselecteerd ? '' : 'hover:bg-terracotta-50'}`
                        : ''
                    }
                    onClick={mode === 'week' ? () => handleRijKlik(rij) : undefined}
                  >
                    {/* Weeknummer */}
                    <td
                      className={`text-right pr-2 font-semibold rounded-l
                        ${rijGeselecteerd
                          ? 'bg-terracotta-500 text-white'
                          : mode === 'week'
                            ? 'text-slate-400 group-hover:text-terracotta-600'
                            : 'text-slate-400'
                        }`}
                    >
                      {rij.weekNr}
                    </td>

                    {/* Dagen */}
                    {rij.dagen.map((dag, j) => {
                      const dagIso = datumAlsIso(dag)
                      const inMaand = dag.getUTCFullYear() === viewJaar && dag.getUTCMonth() === viewMaand
                      const isVandaag = dagIso === vandaagIso
                      const isDagGeselecteerd = mode === 'datum' && dagIso === waarde
                      const isInGeselecteerdeWeek = mode === 'week' && rijGeselecteerd
                      const isLaatsteInRij = j === 6

                      let cellClass = 'text-center h-7 w-8 '

                      if (isDagGeselecteerd) {
                        cellClass += 'bg-terracotta-500 text-white rounded-full font-semibold'
                      } else if (isInGeselecteerdeWeek) {
                        cellClass += `bg-terracotta-500 text-white ${isLaatsteInRij ? 'rounded-r' : ''}`
                      } else if (isVandaag) {
                        cellClass += 'font-bold text-terracotta-600'
                        if (!inMaand) cellClass += ' opacity-50'
                      } else if (!inMaand) {
                        cellClass += 'text-slate-300'
                      } else {
                        cellClass += 'text-slate-700'
                      }

                      if (mode === 'datum' && !isDagGeselecteerd) {
                        cellClass += ' cursor-pointer hover:bg-slate-100 rounded-full'
                      }

                      return (
                        <td
                          key={j}
                          className={cellClass}
                          onClick={mode === 'datum' ? (e) => { e.stopPropagation(); handleDagKlik(dag) } : undefined}
                        >
                          {dag.getUTCDate()}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Vandaag-knop */}
          <div className="mt-2 pt-2 border-t border-slate-100 text-center">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-terracotta-600 hover:underline"
              onClick={() => {
                const vandaag = new Date()
                const vandaagDate = new Date(Date.UTC(vandaag.getFullYear(), vandaag.getMonth(), vandaag.getDate()))
                if (mode === 'week') {
                  const { jaar, week } = isoWeekJaar(vandaagDate)
                  onChange(vrijdagVanWeek(jaar, week))
                } else {
                  onChange(datumAlsIso(vandaagDate))
                }
                setOpen(false)
              }}
            >
              Vandaag
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
