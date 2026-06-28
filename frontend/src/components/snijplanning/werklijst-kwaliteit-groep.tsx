import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { WerklijstRolSectie } from './werklijst-rol-sectie'
import { WerklijstOrderregelRij } from './werklijst-orderregel-rij'
import type { WerklijstKwaliteitGroep } from '@/modules/snijplanning/lib/werklijst-groepering'

function verzendweekLabel(week: string | null): string {
  if (!week) return ''
  const m = week.match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return week
  return `Wk ${parseInt(m[2])}/${m[1].slice(2)}`
}

function RegelTabel({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full border border-slate-200 rounded overflow-hidden">
      <colgroup>
        <col className="w-[160px]" />
        <col className="w-[130px]" />
        <col className="w-[70px]" />
        <col className="w-[90px]" />
        <col />
        <col className="w-[80px]" />
        <col className="w-[120px]" />
      </colgroup>
      <tbody>{children}</tbody>
    </table>
  )
}

interface Props {
  groep: WerklijstKwaliteitGroep
  defaultOpen?: boolean
}

export function WerklijstKwaliteitGroepItem({ groep, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  const heeftProblemen = groep.aantalWachtOpInkoop > 0 || groep.aantalTekort > 0

  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden',
        heeftProblemen ? 'border-amber-200' : 'border-slate-200',
      )}
    >
      {/* Groep-header */}
      <button
        type="button"
        className={cn(
          'w-full flex items-center gap-2.5 px-4 py-3 text-left',
          heeftProblemen ? 'bg-amber-50 hover:bg-amber-100/50' : 'bg-slate-50 hover:bg-slate-100',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} className="text-slate-400 shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-slate-400 shrink-0" />
        )}
        <span className="font-semibold text-slate-900 text-sm min-w-[80px]">
          {groep.productNaam}
        </span>

        {/* Badges: op rol / IO / tekort */}
        <div className="flex items-center gap-1.5">
          {groep.aantalOpRol > 0 && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              {groep.aantalOpRol} op rol
            </span>
          )}
          {groep.aantalWachtOpInkoop > 0 && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {groep.aantalWachtOpInkoop} inkoop
            </span>
          )}
          {groep.aantalTekort > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
              {groep.aantalTekort} tekort
            </span>
          )}
        </div>

        {/* Vroegste verzendweek */}
        {groep.vroegsteVerzendweek && (
          <span className="ml-auto text-xs text-slate-400 tabular-nums">
            vroegste {verzendweekLabel(groep.vroegsteVerzendweek)}
          </span>
        )}
      </button>

      {open && (
        <div className="bg-white divide-y divide-slate-100">
          {/* Rollen */}
          {groep.rollen.length > 0 && (
            <div className="p-4 space-y-3">
              {groep.rollen.map((rol) => (
                <WerklijstRolSectie key={rol.rolId} rol={rol} />
              ))}
            </div>
          )}

          {/* Wacht op inkoop */}
          {groep.wachtOpInkoop.length > 0 && (
            <div className="p-4">
              <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide mb-2">
                Wacht op inkoop ({groep.wachtOpInkoop.length}{' '}
                {groep.wachtOpInkoop.length === 1 ? 'regel' : 'regels'})
              </div>
              <RegelTabel>
                {groep.wachtOpInkoop.map((r) => (
                  <WerklijstOrderregelRij key={r.orderRegelId} regel={r} />
                ))}
              </RegelTabel>
            </div>
          )}

          {/* Tekort */}
          {groep.tekort.length > 0 && (
            <div className="p-4">
              <div className="text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-2">
                Tekort — geen rol beschikbaar ({groep.tekort.length}{' '}
                {groep.tekort.length === 1 ? 'regel' : 'regels'})
              </div>
              <RegelTabel>
                {groep.tekort.map((r) => (
                  <WerklijstOrderregelRij key={r.orderRegelId} regel={r} />
                ))}
              </RegelTabel>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
