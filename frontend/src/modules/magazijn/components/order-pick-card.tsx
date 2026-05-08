import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  Ruler,
  Scale,
} from 'lucide-react'
import { LocatieEdit } from './locatie-edit'
import {
  VerzendsetButton,
  VervoerderInlineSelect,
  VervoerderOrderregelPill,
} from '@/modules/logistiek'
import { cn } from '@/lib/utils/cn'
import { ORDER_STATUS_COLORS } from '@/lib/utils/constants'
import { iso2NaarVlag, landNaarIso2 } from '@/lib/utils/land-vlag'
import type { PickShipOrder, PickShipRegel, PickShipWachtOp } from '../lib/types'

const WACHT_OP_LABEL: Record<NonNullable<PickShipWachtOp>, string> = {
  snijden: 'Wacht op snijden',
  confectie: 'Wacht op confectie',
  inpak: 'Wacht op inpak',
  inkoop: 'Wacht op inkoop',
}

function formatLand(land: string | null): string | null {
  if (!land) return null
  const trimmed = land.trim()
  if (!trimmed) return null
  // Korte ISO/landcodes (NL, BE, DE) helemaal kapitaal; langere namen blijven zoals ze zijn.
  return trimmed.length <= 3 ? trimmed.toUpperCase() : trimmed
}

function formatBestemming(order: PickShipOrder): string {
  const parts = [
    order.afl_naam,
    [order.afl_postcode, order.afl_plaats].filter(Boolean).join(' '),
  ].filter((s) => s && s.trim().length > 0) as string[]
  return parts.join(' · ') || '—'
}

type OrderType = 'maatwerk' | 'std' | 'combi'

function bepaalOrderType(regels: PickShipRegel[]): OrderType | null {
  if (regels.length === 0) return null
  let heeftMaatwerk = false
  let heeftStd = false
  for (const r of regels) {
    if (r.is_maatwerk) heeftMaatwerk = true
    else heeftStd = true
    if (heeftMaatwerk && heeftStd) return 'combi'
  }
  return heeftMaatwerk ? 'maatwerk' : 'std'
}

// Tinten in plaats van een type-badge: de hele card krijgt een achtergrond
// zodat de magazijnier in één oogopslag std vs. maatwerk vs. combi kan
// onderscheiden zonder extra label-ruis. Bewust de 100/300-stap (i.p.v. 50/200)
// zodat std echt los staat van witte achtergrond — eerdere lichte tinten waren
// op het overzichtsscherm nauwelijks te zien. De hover-kleur blijft binnen
// hetzelfde tint-thema, anders flikkert hij grijs bij mouseover.
const ORDER_TYPE_TINT: Record<OrderType, { card: string; row: string; title: string }> = {
  maatwerk: {
    card: 'bg-orange-100 border-orange-300',
    row: 'hover:bg-orange-200/70',
    title: 'Alle regels zijn maatwerk (op maat gesneden)',
  },
  std: {
    card: 'bg-sky-100 border-sky-300',
    row: 'hover:bg-sky-200/70',
    title: 'Alle regels zijn standaard tapijt (vaste maten / stuks)',
  },
  combi: {
    card: 'bg-violet-100 border-violet-300',
    row: 'hover:bg-violet-200/70',
    title: 'Order bevat zowel maatwerk- als standaard-regels',
  },
}

interface Props {
  order: PickShipOrder
}

export function OrderPickCard({ order }: Props) {
  const [open, setOpen] = useState(false)

  const statusColor = ORDER_STATUS_COLORS[order.status] ?? {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
  }
  const land = formatLand(order.afl_land)
  const iso2 = landNaarIso2(order.afl_land)
  const vlag = iso2NaarVlag(iso2)
  const landTitle = iso2 && land && iso2 !== land ? `${land} (${iso2})` : land ?? ''
  const bestemming = formatBestemming(order)
  const heeftGewicht = order.totaal_gewicht_kg > 0
  const heeftM2 = order.totaal_m2 > 0
  const orderType = bepaalOrderType(order.regels)
  const tint = orderType ? ORDER_TYPE_TINT[orderType] : null

  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border',
        tint ? tint.card : 'bg-white border-slate-200'
      )}
      title={tint?.title}
    >
      {/* Compacte 1-regel pakbon-rij */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none rounded-t-[var(--radius)]',
          tint ? tint.row : 'hover:bg-slate-50/60',
          !open && 'rounded-b-[var(--radius)]'
        )}
      >
        {/* Toggle */}
        <span className="text-slate-400 flex-shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Order + klant — wat het is */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            to={`/orders/${order.order_id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline whitespace-nowrap"
          >
            {order.order_nr}
            <ExternalLink size={11} />
          </Link>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
              statusColor.bg,
              statusColor.text
            )}
          >
            {order.status}
          </span>
          <span className="text-sm text-slate-700 truncate">{order.klant_naam}</span>
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {order.aantal_regels} regel{order.aantal_regels === 1 ? '' : 's'}
          </span>
        </div>

        {/* Maten */}
        <div
          className="hidden md:inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap min-w-[5rem] justify-end"
          title="Totale m² over alle regels"
        >
          <Ruler size={12} className="text-slate-400" />
          {heeftM2 ? `${order.totaal_m2.toFixed(2)} m²` : <span className="text-slate-300">— m²</span>}
        </div>

        {/* Kilo's */}
        <div
          className="hidden md:inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap min-w-[4.5rem] justify-end"
          title="Totaal gewicht (som van orderregels). Definitief gewicht wordt op de zending bepaald."
        >
          <Scale size={12} className="text-slate-400" />
          {heeftGewicht
            ? `${order.totaal_gewicht_kg.toFixed(1)} kg`
            : <span className="text-slate-300">— kg</span>}
        </div>

        {/* Land + adres */}
        <div className="hidden lg:flex items-center gap-1 text-xs text-slate-600 max-w-[18rem] min-w-[10rem]">
          {(vlag || land) && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-700 flex-shrink-0"
              title={landTitle}
            >
              {vlag && <span className="text-sm leading-none">{vlag}</span>}
              {iso2 ?? land}
            </span>
          )}
          <MapPin size={12} className="text-slate-400 flex-shrink-0" />
          <span className="truncate" title={bestemming}>
            {bestemming}
          </span>
        </div>

        {/* Verzendweek */}
        <div
          className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap"
          title="Verzendweek — orders worden verzonden in de week ván de afleverdatum"
        >
          <CalendarDays size={12} className="text-slate-400" />
          {order.verzend_week_kort}
        </div>

        {/* Vervoerder-selector */}
        <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          <VervoerderInlineSelect
            debiteurNr={order.debiteur_nr}
            afhalen={order.afhalen}
            orderId={order.order_id}
          />
        </div>

        {/* Actieknop — als er al een pickronde loopt, toon "Open printset"-link
            in plaats van een nieuwe Verzendset starten. */}
        <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          {order.actieve_pickronde ? (
            <Link
              to={`/logistiek/${order.actieve_pickronde.zending_nr}/printset`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
              title={
                order.actieve_pickronde.picker_naam
                  ? `Pickronde gestart door ${order.actieve_pickronde.picker_naam} — open printset om te voltooien`
                  : 'Pickronde loopt — open printset om te voltooien'
              }
            >
              <Clock size={13} />
              {order.actieve_pickronde.picker_naam
                ? `In pickronde · ${order.actieve_pickronde.picker_naam}`
                : 'In pickronde'}
            </Link>
          ) : (
            <VerzendsetButton order={order} />
          )}
        </div>
      </div>

      {/* Inklapbare regel-details — voorheen het kaartmidden, nu onder de samenvattingsrij */}
      {open && (
        <div className="border-t border-slate-200 rounded-b-[var(--radius)] overflow-hidden">
          {/* Mobiel-fallback voor kolommen die op de samenvattingsrij verstopt zijn */}
          <div className="md:hidden px-3 py-2 text-xs text-slate-500 flex flex-wrap gap-3 border-b border-slate-100 bg-slate-50">
            {heeftM2 && <span>{order.totaal_m2.toFixed(2)} m²</span>}
            {heeftGewicht && <span>{order.totaal_gewicht_kg.toFixed(1)} kg</span>}
            <span className="truncate">
              {vlag && <span className="mr-1">{vlag}</span>}
              {land ? `[${iso2 ?? land}] ` : ''}
              {bestemming}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="py-1.5 px-3 font-medium w-8"></th>
                <th className="py-1.5 px-3 font-medium">Product</th>
                <th className="py-1.5 px-3 font-medium">Type · Maat</th>
                <th className="py-1.5 px-3 font-medium">Status</th>
                <th className="py-1.5 px-3 font-medium">Locatie</th>
                <th className="py-1.5 px-3 font-medium">Vervoerder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.regels.map((r) => (
                <tr
                  key={r.order_regel_id}
                  className={cn('hover:bg-slate-50', !r.is_pickbaar && 'opacity-70')}
                >
                  <td className="py-2 px-3">
                    {r.is_pickbaar ? (
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    ) : (
                      <Clock size={16} className="text-amber-500" />
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-slate-700">{r.product}</span>
                    {r.kleur && <span className="text-slate-400 ml-1 text-xs">({r.kleur})</span>}
                    {r.artikelnr && !r.is_maatwerk && (
                      <span className="text-slate-400 ml-1 text-xs">{r.artikelnr}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-slate-600">
                    {r.is_maatwerk ? (
                      <>
                        <span className="text-orange-600 font-medium">Op maat</span> · {r.maat_cm}
                        {r.totaal_stuks != null && r.totaal_stuks > 1 && (
                          <span className="ml-1 text-slate-400">
                            ({r.pickbaar_stuks}/{r.totaal_stuks} stuks)
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-blue-600 font-medium">Standaard</span> ·{' '}
                        {r.orderaantal} stuk(s)
                      </>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {r.is_pickbaar ? (
                      <span className="text-emerald-600">Klaar om te picken</span>
                    ) : r.wacht_op ? (
                      <span className="text-amber-600">{WACHT_OP_LABEL[r.wacht_op]}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {r.is_pickbaar || r.fysieke_locatie ? (
                      <LocatieEdit regel={r} />
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {order.afhalen ? (
                      <span className="text-slate-300 text-xs">—</span>
                    ) : (
                      <VervoerderOrderregelPill
                        orderId={order.order_id}
                        orderregelId={r.order_regel_id}
                        locked={order.actieve_pickronde !== null}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
