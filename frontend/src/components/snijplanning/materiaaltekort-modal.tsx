import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { X, PackageX } from 'lucide-react'
import { formatDate } from '@/lib/utils/formatters'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { useTekortAnalyse } from '@/modules/snijplanning'
import type { TekortAnalyseRow } from '@/modules/snijplanning'
import type { MasterPlanningRij } from '@/pages/snijplanning/master-planning-overview'

interface Props {
  rijen: MasterPlanningRij[]
  onClose: () => void
}

interface Reden {
  tekst: string
  /** True als er rollen bestaan die op papier groot genoeg zijn, maar al door
   *  andere stukken belegd zijn — dan is "bekijk de huidige verdeling" een
   *  zinvolle, controleerbare vervolgstap. Bij 0 rollen of een rol die simpelweg
   *  te klein is, is er niets te bekijken. */
  klikbaar: boolean
}

/** Mens-leesbare reden waarom dit stuk geen rol vond — uit dezelfde
 *  groep-aggregaat als de Tekort-tab op de Snijplanning-pagina
 *  (`snijplanning_tekort_analyse`, mig 439), zodat de twee schermen nooit
 *  een andere verklaring geven voor hetzelfde stuk. */
function bepaalReden(analyse: TekortAnalyseRow | undefined, lengteCm: number, breedteCm: number): Reden {
  if (!analyse) return { tekst: 'Geen rollen-data beschikbaar voor deze kwaliteit', klikbaar: false }
  if (analyse.aantal_beschikbaar === 0) {
    if (analyse.aantal_fysiek_bezet > 0) {
      // Rollen bestaan fysiek, alleen al ingedeeld bij andere orders —
      // klikbaar zodat de planner kan zien welke orders dat zijn.
      return {
        tekst: `${analyse.aantal_fysiek_bezet} ${analyse.aantal_fysiek_bezet === 1 ? 'rol bestaat' : 'rollen bestaan'} wel, maar ${analyse.aantal_fysiek_bezet === 1 ? 'is' : 'zijn'} volledig ingedeeld bij andere orders`,
        klikbaar: true,
      }
    }
    return {
      tekst: analyse.uitwisselbare_codes.length > 0
        ? `0 rollen beschikbaar (ook niet bij uitwisselbaar: ${analyse.uitwisselbare_codes.join(', ')})`
        : '0 rollen beschikbaar',
      klikbaar: false,
    }
  }
  const passtLengte = analyse.max_lange_zijde_cm >= Math.max(lengteCm, breedteCm)
  const pastBreedte = analyse.max_korte_zijde_cm >= Math.min(lengteCm, breedteCm)
  if (!passtLengte || !pastBreedte) {
    return {
      tekst: `Grootste beschikbare rol is ${analyse.max_lange_zijde_cm}×${analyse.max_korte_zijde_cm} cm — dit stuk past daar niet op`,
      klikbaar: false,
    }
  }
  return {
    tekst: `${analyse.aantal_beschikbaar} ${analyse.aantal_beschikbaar === 1 ? 'rol' : 'rollen'} beschikbaar, maar al volledig belegd door eerder geplaatste stukken`,
    klikbaar: true,
  }
}

interface RegelGroep {
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string
  kwaliteit_code: string | null
  kleur_code: string | null
  snij_lengte_cm: number
  snij_breedte_cm: number
  maatwerk_vorm: string | null
  afleverdatum: string | null
  /** Aantal stukken van déze regel dat nog geen rol én geen inkoop heeft —
   *  niet het orderaantal van de regel (die kan deels al wel gedekt zijn). */
  aantalTekort: number
}

/** Eén regel kan in N losse snijplan-stukken zijn opgesplitst (orderaantal>1)
 *  — elk stuk is hier een eigen rij met identieke regel-gegevens. Zonder
 *  aggregatie lijkt een regel met 4 stukken 4× "materiaaltekort", elk met de
 *  volledige orderaantal in de Aantal-kolom (zou 16 i.p.v. 4 suggereren). */
function groepeerPerRegel(rijen: MasterPlanningRij[]): RegelGroep[] {
  const map = new Map<number, RegelGroep>()
  for (const r of rijen) {
    const bestaand = map.get(r.order_regel_id)
    if (bestaand) {
      bestaand.aantalTekort += 1
      continue
    }
    map.set(r.order_regel_id, {
      order_regel_id: r.order_regel_id,
      order_id: r.order_id,
      order_nr: r.order_nr,
      klant_naam: r.klant_naam,
      kwaliteit_code: r.kwaliteit_code,
      kleur_code: r.kleur_code,
      snij_lengte_cm: r.snij_lengte_cm,
      snij_breedte_cm: r.snij_breedte_cm,
      maatwerk_vorm: r.maatwerk_vorm,
      afleverdatum: r.afleverdatum,
      aantalTekort: 1,
    })
  }
  return Array.from(map.values())
}

export function MateriaaltekortModal({ rijen, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groepen = useMemo(() => groepeerPerRegel(rijen), [rijen])
  const { data: tekortAnalyse } = useTekortAnalyse()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[80vh] bg-white rounded-[var(--radius)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <PackageX size={18} className="text-purple-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Materiaaltekort</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {groepen.length} {groepen.length === 1 ? 'regel' : 'regels'} zonder rol én zonder inkoop — echt materiaaltekort
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Order</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Klant</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Kwaliteit · Kleur</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Afmeting</th>
                <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Aantal</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Leverdatum</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Reden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groepen.map((g) => {
                const vorm = getVormDisplay(g.maatwerk_vorm)
                const kleurNormalised = (g.kleur_code ?? '').replace(/\.0$/, '')
                const analyse = tekortAnalyse?.get(`${g.kwaliteit_code}_${kleurNormalised}`)
                const reden = bepaalReden(analyse, g.snij_lengte_cm, g.snij_breedte_cm)
                return (
                  <tr key={g.order_regel_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link to={`/orders/${g.order_id}`} className="font-medium text-terracotta-600 hover:underline">
                        {g.order_nr}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{g.klant_naam}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">{g.kwaliteit_code} · {g.kleur_code}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                      {g.snij_lengte_cm}×{g.snij_breedte_cm} cm
                      {vorm.label && <span className="block text-xs text-slate-400">{vorm.label}</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-700">{g.aantalTekort}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                      {g.afleverdatum ? formatDate(g.afleverdatum) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs max-w-xs">
                      {reden.klikbaar ? (
                        <Link
                          to={`/snijplanning/productie?kwaliteit=${encodeURIComponent(g.kwaliteit_code ?? '')}&kleur=${encodeURIComponent(kleurNormalised)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-terracotta-600 hover:underline"
                        >
                          {reden.tekst} — bekijk verdeling →
                        </Link>
                      ) : (
                        <span className="text-slate-500">{reden.tekst}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
