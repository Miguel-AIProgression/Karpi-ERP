import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'
import { ROL_STATUS_COLORS, ROL_TYPE_COLORS, ROL_TYPE_LABELS } from '@/lib/utils/constants'
import { useReserveringenVoorProduct } from '@/hooks/use-producten'
import { useRolSnijstukken } from '@/hooks/use-snijplanning'
import type { RolRow } from '@/lib/types/productie'
import type {
  BesteldInkoop,
  UitwisselbarePartner,
  Voorraadpositie,
} from '@/modules/voorraadpositie'

interface RollenGroepRowProps {
  positie: Voorraadpositie
}

const STATUS_LABELS: Record<string, string> = {
  beschikbaar: 'BESCHIKBAAR',
  gereserveerd: 'GERESERVEERD',
  in_snijplan: 'IN SNIJPLAN',
  gesneden: 'GESNEDEN',
  reststuk: 'RESTSTUK',
  verkocht: 'VERKOCHT',
}

function StatusBadge({ rolType, count }: { rolType: string; count: number }) {
  if (count === 0) return null
  const colors = ROL_TYPE_COLORS[rolType] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  const label = ROL_TYPE_LABELS[rolType] ?? rolType
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colors.bg, colors.text)}>
      {count}&times; {label}
    </span>
  )
}

function formatLeverweek(info: BesteldInkoop): string | null {
  if (info.eerstvolgende_leverweek) return `wk ${info.eerstvolgende_leverweek}`
  if (info.eerstvolgende_verwacht_datum) {
    const d = new Date(info.eerstvolgende_verwacht_datum)
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' })
    }
  }
  return null
}

function BesteldChip({ info }: { info: BesteldInkoop }) {
  const weekLabel = formatLeverweek(info)
  const hasSplit =
    info.eerstvolgende_m2 > 0 && info.eerstvolgende_m2 < info.besteld_m2
  const title = hasSplit
    ? `${info.besteld_m2.toFixed(1)} m² besteld (${info.orders_count} ${info.orders_count === 1 ? 'order' : 'orders'}), waarvan ${info.eerstvolgende_m2.toFixed(1)} m² in ${weekLabel ?? 'eerstvolgende levering'}`
    : `${info.besteld_m2.toFixed(1)} m² besteld (${info.orders_count} ${info.orders_count === 1 ? 'order' : 'orders'})${weekLabel ? ` · ${weekLabel}` : ''}`
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
    >
      <Truck size={11} />
      {info.besteld_m2.toFixed(1)} m&sup2; besteld
      {weekLabel && <span className="text-indigo-500">· {weekLabel}</span>}
    </span>
  )
}

function PartnerChip({ partner }: { partner: UitwisselbarePartner }) {
  const hasStock = partner.m2 > 0
  const title = hasStock
    ? `${partner.kwaliteit_code} ${partner.kleur_code} — ${partner.rollen} ${partner.rollen === 1 ? 'rol' : 'rollen'}, ${partner.m2.toFixed(1)} m²`
    : `${partner.kwaliteit_code} ${partner.kleur_code} — geen voorraad`
  return (
    <Link
      to={`/rollen?kwaliteit=${encodeURIComponent(partner.kwaliteit_code)}&kleur=${encodeURIComponent(partner.kleur_code)}`}
      onClick={(e) => e.stopPropagation()}
      title={title}
      className={cn(
        'text-xs px-2 py-0.5 rounded-full font-medium border',
        hasStock
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
      )}
    >
      &#8646; {partner.kwaliteit_code} {partner.kleur_code}
    </Link>
  )
}

const SNIJPLAN_STATUS_COLORS: Record<string, string> = {
  Wacht: 'bg-slate-100 text-slate-600',
  Gepland: 'bg-blue-100 text-blue-700',
  'In productie': 'bg-amber-100 text-amber-700',
  Gesneden: 'bg-emerald-100 text-emerald-700',
  'In confectie': 'bg-purple-100 text-purple-700',
  Gereed: 'bg-green-100 text-green-700',
  Ingepakt: 'bg-teal-100 text-teal-700',
}

function RolDetails({ rolId, artikelnr, rolOppervlak }: { rolId: number; artikelnr: string; rolOppervlak: number }) {
  const { data: snijstukken, isLoading: snijLoading } = useRolSnijstukken(rolId)
  const { data: reserveringen, isLoading: resLoading } = useReserveringenVoorProduct(artikelnr)

  const isLoading = snijLoading || resLoading

  if (isLoading) {
    return (
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 size={12} className="animate-spin" />
        Laden...
      </div>
    )
  }

  const hasSnijstukken = snijstukken && snijstukken.length > 0
  const hasReserveringen = reserveringen && reserveringen.length > 0

  if (!hasSnijstukken && !hasReserveringen) {
    return (
      <div className="px-6 py-3 text-xs text-slate-400">
        Geen geplande snijstukken of reserveringen op deze rol.
      </div>
    )
  }

  // Bereken gereserveerd m² uit snijstukken
  const gereserveerdM2 = hasSnijstukken
    ? snijstukken.reduce((sum, s) => sum + (s.snij_lengte_cm * s.snij_breedte_cm) / 10000, 0)
    : 0
  const vrijM2 = Math.max(0, rolOppervlak - gereserveerdM2)

  return (
    <div className="px-6 py-3 bg-slate-50/50 space-y-4">
      {/* Snijplannen op deze rol */}
      {hasSnijstukken && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-500">
              Geplande snijstukken ({snijstukken.length})
            </p>
            <p className="text-xs text-slate-500">
              <span className="font-medium text-amber-600">{gereserveerdM2.toFixed(1)} m²</span>
              {' gereserveerd · '}
              <span className="font-medium text-emerald-600">{vrijM2.toFixed(1)} m²</span>
              {' vrij'}
            </p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 pr-3 font-medium">Maat</th>
                <th className="py-1 pr-3 font-medium text-right">m²</th>
                <th className="py-1 pr-3 font-medium">Klant</th>
                <th className="py-1 pr-3 font-medium">Order</th>
                <th className="py-1 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {snijstukken.map((s) => {
                const stukM2 = (s.snij_lengte_cm * s.snij_breedte_cm) / 10000
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-700 font-mono">
                      {s.snij_breedte_cm}&times;{s.snij_lengte_cm} cm
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{stukM2.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{s.klant_naam}</td>
                    <td className="py-1.5 pr-3">
                      <Link to={`/orders/${s.order_id}`} className="text-terracotta-500 hover:underline font-mono">
                        {s.order_nr}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={cn('px-1.5 py-0.5 rounded-full', SNIJPLAN_STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600')}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Product-level reserveringen (nog niet gepland) */}
      {hasReserveringen && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">
            Openstaande reserveringen op product ({reserveringen.length})
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 pr-3 font-medium">Order</th>
                <th className="py-1 pr-3 font-medium">Klant</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium text-right">Te leveren</th>
              </tr>
            </thead>
            <tbody>
              {reserveringen.map((r) => (
                <tr key={r.order_id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">
                    <Link to={`/orders/${r.order_id}`} className="text-terracotta-500 hover:underline font-mono">
                      {r.order_nr}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{r.klant_naam ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{r.status}</span>
                  </td>
                  <td className="py-1.5 text-right font-medium text-slate-700">{r.te_leveren}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RolTabel({ rollen }: { rollen: RolRow[] }) {
  const [expandedRolId, setExpandedRolId] = useState<number | null>(null)

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
          <th className="py-2 px-3 font-medium">Rolnummer</th>
          <th className="py-2 px-3 font-medium">Afmetingen</th>
          <th className="py-2 px-3 font-medium text-right">Oppervlak</th>
          <th className="py-2 px-3 font-medium">Status</th>
          <th className="py-2 px-3 font-medium">Locatie</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rollen.map((rol) => {
          const colors = ROL_STATUS_COLORS[rol.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
          const isExpanded = expandedRolId === rol.id
          return (
            <>
              <tr
                key={rol.id}
                onClick={() => setExpandedRolId(isExpanded ? null : rol.id)}
                className="hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <td className="py-2 px-3 font-mono text-xs">{rol.rolnummer}</td>
                <td className="py-2 px-3 text-slate-600">
                  {rol.lengte_cm} &times; {rol.breedte_cm} cm
                </td>
                <td className="py-2 px-3 text-right">{Number(rol.oppervlak_m2).toFixed(1)} m&sup2;</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', colors.bg, colors.text)}>
                      {STATUS_LABELS[rol.status] ?? rol.status}
                    </span>
                    {rol.rol_type && (
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                          (ROL_TYPE_COLORS[rol.rol_type] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }).bg,
                          (ROL_TYPE_COLORS[rol.rol_type] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }).text,
                        )}
                      >
                        {ROL_TYPE_LABELS[rol.rol_type] ?? rol.rol_type}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 text-slate-500">{rol.locatie ?? '—'}</td>
              </tr>
              {isExpanded && (
                <tr key={`${rol.id}-details`}>
                  <td colSpan={5} className="p-0">
                    <RolDetails rolId={rol.id} artikelnr={rol.artikelnr} rolOppervlak={rol.oppervlak_m2} />
                  </td>
                </tr>
              )}
            </>
          )
        })}
      </tbody>
    </table>
  )
}

export function RollenGroepRow({ positie }: RollenGroepRowProps) {
  const [open, setOpen] = useState(false)

  // Aggregaten afgeleid uit Voorraadpositie. Lege groepen ('ghost'-paren met
  // alleen besteld) komen door de view-laag op page-niveau hier binnen met
  // voorraad-tellingen op 0.
  const totaalRollen =
    positie.voorraad.volle_rollen +
    positie.voorraad.aangebroken_rollen +
    positie.voorraad.reststuk_rollen
  const totaalM2 = positie.voorraad.totaal_m2
  const isEmpty = totaalM2 === 0

  // Beste partner (alleen wanneer eigen=0 en partners[0].m²>0 — invariant 1).
  const bestePartner = positie.beste_partner
  const heeftBestePartner = !!bestePartner && bestePartner.rollen > 0

  // Inkoop is altijd aanwezig als object met 0-defaults; toon BesteldChip
  // alleen wanneer er werkelijk besteld is.
  const heeftBesteld = positie.besteld.besteld_m > 0

  const vollePct = totaalRollen > 0
    ? Math.round((positie.voorraad.volle_rollen / totaalRollen) * 100)
    : 0

  const productLabel = positie.product_naam ?? `${positie.kwaliteit_code} ${positie.kleur_code}`

  return (
    <div
      className={cn(
        'bg-white rounded-[var(--radius)] border overflow-hidden',
        isEmpty ? 'border-slate-200/70' : 'border-slate-200',
      )}
    >
      <button
        onClick={() => !isEmpty && setOpen(!open)}
        disabled={isEmpty}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
          isEmpty ? 'cursor-default' : 'hover:bg-slate-50',
        )}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {isEmpty ? (
            <span className="w-4" />
          ) : open ? (
            <ChevronDown size={16} className="text-slate-400" />
          ) : (
            <ChevronRight size={16} className="text-slate-400" />
          )}
          <span className={cn('font-medium', isEmpty ? 'text-slate-500' : 'text-slate-900')}>
            {productLabel}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {isEmpty ? (
              <>
                {heeftBestePartner ? (
                  <Link
                    to={`/rollen?kwaliteit=${encodeURIComponent(bestePartner!.kwaliteit_code)}&kleur=${encodeURIComponent(bestePartner!.kleur_code)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    Leverbaar via {bestePartner!.kwaliteit_code} {bestePartner!.kleur_code}
                    {' — '}
                    {bestePartner!.rollen} {bestePartner!.rollen === 1 ? 'rol' : 'rollen'}
                    {', '}
                    {bestePartner!.m2.toFixed(1)} m&sup2;
                  </Link>
                ) : heeftBesteld ? null : (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                    Geen voorraad
                  </span>
                )}
                {/* Andere uitwisselbare partners (de beste is al als "Leverbaar via" getoond) */}
                {positie.partners
                  .filter(
                    (p) =>
                      !(
                        bestePartner &&
                        p.kwaliteit_code === bestePartner.kwaliteit_code &&
                        p.kleur_code === bestePartner.kleur_code
                      ),
                  )
                  .map((p) => (
                    <PartnerChip key={`${p.kwaliteit_code}|${p.kleur_code}`} partner={p} />
                  ))}
                {heeftBesteld && <BesteldChip info={positie.besteld} />}
              </>
            ) : (
              <>
                <StatusBadge rolType="volle_rol" count={positie.voorraad.volle_rollen} />
                <StatusBadge rolType="aangebroken" count={positie.voorraad.aangebroken_rollen} />
                <StatusBadge rolType="reststuk" count={positie.voorraad.reststuk_rollen} />
                {positie.partners.map((p) => (
                  <PartnerChip key={`${p.kwaliteit_code}|${p.kleur_code}`} partner={p} />
                ))}
                {heeftBesteld && <BesteldChip info={positie.besteld} />}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-slate-500">
            {totaalRollen} {totaalRollen === 1 ? 'rol' : 'rollen'}
          </span>
          <div className="flex items-center gap-2 min-w-[140px]">
            <span
              className={cn(
                'text-sm font-medium whitespace-nowrap',
                isEmpty ? 'text-slate-400' : 'text-slate-700',
              )}
            >
              {totaalM2.toFixed(1)} m&sup2;
            </span>
            <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${vollePct}%` }}
              />
            </div>
          </div>
        </div>
      </button>

      {open && !isEmpty && (
        <div className="border-t border-slate-100 px-2 py-2">
          <RolTabel rollen={positie.rollen} />
        </div>
      )}
    </div>
  )
}
