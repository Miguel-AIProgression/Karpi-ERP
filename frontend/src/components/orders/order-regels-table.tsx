import { Link } from 'react-router-dom'
import { Scissors, ArrowRight } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/formatters'
import { SNIJPLAN_STATUS_COLORS, AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { isoWeekFromString } from '@/lib/utils/iso-week'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import type { OrderRegelLevertijd, OrderClaim } from '@/lib/supabase/queries/reserveringen'
import { LevertijdBadge } from './levertijd-badge'

function formatMaat(regel: OrderRegel): string {
  const l = regel.maatwerk_lengte_cm
  const b = regel.maatwerk_breedte_cm
  if (!l || !b) return ''
  return `${l}×${b} cm`
}

function SnijplanStatusBadge({ status }: { status: string }) {
  const colors = SNIJPLAN_STATUS_COLORS[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      {status}
    </span>
  )
}

interface SubRow {
  key: string
  label: React.ReactNode
  aantal: number
  tone: 'neutraal' | 'omsticker' | 'wacht'
}

/** Bouwt sub-rijen voor een orderregel: eigen voorraad → omsticker → IO → wacht. */
function buildSubRows(regel: OrderRegel, claims: OrderClaim[]): SubRow[] {
  const eigen: SubRow[] = []
  const omsticker: SubRow[] = []
  const io: SubRow[] = []

  for (const c of claims) {
    if (c.bron === 'voorraad') {
      const isOmsticker = !!c.fysiek_artikelnr && c.fysiek_artikelnr !== regel.artikelnr
      if (isOmsticker) {
        omsticker.push({
          key: `c${c.id}`,
          tone: 'omsticker',
          aantal: c.aantal,
          label: (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="text-amber-700 font-medium">Omstickeren uit</span>
              <Link
                to={`/producten/${c.fysiek_artikelnr}`}
                className="font-mono text-xs text-terracotta-500 hover:underline"
              >
                {c.fysiek_artikelnr}
              </Link>
              <span className="text-slate-600">{c.fysiek_omschrijving ?? ''}</span>
              {c.fysiek_locatie && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[11px]">
                  Locatie {c.fysiek_locatie}
                </span>
              )}
              <ArrowRight size={11} className="text-slate-400" />
              <span className="text-slate-500">stickeren naar {regel.artikelnr}</span>
            </span>
          ),
        })
      } else {
        eigen.push({
          key: `c${c.id}`,
          tone: 'neutraal',
          aantal: c.aantal,
          label: <span className="text-slate-600">Uit eigen voorraad</span>,
        })
      }
    } else if (c.bron === 'inkooporder_regel') {
      io.push({
        key: `c${c.id}`,
        tone: 'neutraal',
        aantal: c.aantal,
        label: (
          <span className="inline-flex items-center gap-2 flex-wrap text-slate-600">
            <span>Op inkooporder</span>
            {c.inkooporder_id ? (
              <Link
                to={`/inkoop/${c.inkooporder_id}`}
                className="font-mono text-xs text-terracotta-500 hover:underline"
              >
                {c.inkooporder_nr ?? `IO #${c.inkooporder_regel_id}`}
              </Link>
            ) : (
              <span className="font-mono text-xs">
                {c.inkooporder_nr ?? `IO #${c.inkooporder_regel_id}`}
              </span>
            )}
            {c.verwacht_datum && (
              <span className="text-slate-500">wk {isoWeekFromString(c.verwacht_datum)}</span>
            )}
          </span>
        ),
      })
    }
  }

  // Synthetische "wacht"-rij voor het ondekte deel
  const totaalGeclaimd = claims.reduce((s, c) => s + c.aantal, 0)
  const tekort = regel.te_leveren - totaalGeclaimd
  const wacht: SubRow[] = []
  if (tekort > 0) {
    wacht.push({
      key: 'wacht',
      tone: 'wacht',
      aantal: tekort,
      label: <span className="text-rose-700 font-medium">Wacht op nieuwe inkoop</span>,
    })
  }

  return [...eigen, ...omsticker, ...io, ...wacht]
}

const TONE_BG: Record<SubRow['tone'], string> = {
  neutraal: 'bg-slate-50/60',
  omsticker: 'bg-amber-50/40',
  wacht: 'bg-rose-50/40',
}

function SubRowTr({ sub }: { sub: SubRow }) {
  return (
    <tr className={`border-b border-slate-50 ${TONE_BG[sub.tone]}`}>
      <td className="px-4 py-1.5"></td>
      <td colSpan={2} className="px-4 py-1.5 text-xs">
        <span className="inline-flex items-center gap-2 pl-3 border-l-2 border-slate-200">
          {sub.label}
        </span>
      </td>
      <td className="px-4 py-1.5"></td>
      <td className="px-4 py-1.5 text-right text-xs font-medium text-slate-700">{sub.aantal}</td>
      <td colSpan={5} className="px-4 py-1.5"></td>
    </tr>
  )
}

interface RegelRowProps {
  regel: OrderRegel
  levertijd?: OrderRegelLevertijd
  claims: OrderClaim[]
}

function RegelRow({ regel, levertijd, claims }: RegelRowProps) {
  const afwerkingInfo = regel.maatwerk_afwerking ? AFWERKING_MAP[regel.maatwerk_afwerking] : null
  const maat = formatMaat(regel)
  const subRows = !regel.is_maatwerk && regel.te_leveren > 0
    ? buildSubRows(regel, claims)
    : []

  return (
    <>
      <tr className={`${regel.is_maatwerk || subRows.length > 0 ? 'border-b-0' : 'border-b border-slate-50'} hover:bg-slate-50`}>
        <td className="px-4 py-2 text-slate-400">{regel.regelnummer}</td>
        <td className="px-4 py-2">
          {regel.artikelnr ? (
            <Link
              to={`/producten/${regel.artikelnr}`}
              className="text-terracotta-500 hover:underline font-mono text-xs"
            >
              {regel.artikelnr}
            </Link>
          ) : (
            '—'
          )}
          {regel.karpi_code && (
            <span className="block text-xs text-slate-400">{regel.karpi_code}</span>
          )}
          {regel.klant_artikelnr && (
            <span className="block text-xs text-blue-500" title="Klant artikelnr">
              {regel.klant_artikelnr}
            </span>
          )}
        </td>
        <td className="px-4 py-2">
          {regel.omschrijving}
          {regel.omschrijving_2 && !regel.is_maatwerk && (
            <span className="block text-xs text-slate-400">{regel.omschrijving_2}</span>
          )}
          {regel.klant_eigen_naam && (
            <span className="block text-xs text-blue-500" title="Klanteigen naam">
              {regel.klant_eigen_naam}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-right">{regel.orderaantal}</td>
        <td className="px-4 py-2 text-right">{regel.te_leveren}</td>
        <td className="px-4 py-2 text-right">
          {regel.backorder > 0 ? (
            <span className="text-amber-600">{regel.backorder}</span>
          ) : (
            '0'
          )}
        </td>
        <td className="px-4 py-2">
          {levertijd ? (
            <LevertijdBadge levertijd={levertijd} />
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-4 py-2 text-right">{formatCurrency(regel.prijs)}</td>
        <td className="px-4 py-2 text-right">
          {regel.korting_pct > 0 ? `${regel.korting_pct}%` : '—'}
        </td>
        <td className="px-4 py-2 text-right font-medium">
          {formatCurrency(regel.bedrag)}
        </td>
      </tr>
      {regel.is_maatwerk && (
        <tr className="border-b border-slate-50 bg-purple-50/30">
          <td colSpan={10} className="px-4 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-purple-600 font-medium">
                <Scissors size={12} />
                Maatwerk
              </span>
              {maat ? (
                <span className="text-slate-600 font-medium">{maat}</span>
              ) : regel.omschrijving_2 ? (
                <span className="text-slate-600">{regel.omschrijving_2}</span>
              ) : null}
              {regel.maatwerk_vorm && (
                <span className="text-xs text-purple-600">{getVormDisplay(regel.maatwerk_vorm).label}</span>
              )}
              {afwerkingInfo && (
                <span className={`px-1.5 py-0.5 rounded text-xs ${afwerkingInfo.bg} ${afwerkingInfo.text}`}>
                  {afwerkingInfo.code} — {afwerkingInfo.label}
                </span>
              )}
              {regel.maatwerk_band_kleur && (
                <span className="text-slate-500">Band: {regel.maatwerk_band_kleur}</span>
              )}
              {regel.maatwerk_instructies && (
                <span className="text-slate-500 italic">{regel.maatwerk_instructies}</span>
              )}

              {/* Productie status */}
              {regel.snijplannen && regel.snijplannen.length > 0 && (
                <span className="ml-auto flex items-center gap-2">
                  {regel.snijplannen.map((sp) => (
                    <Link
                      key={sp.id}
                      to="/productie/snijplanning"
                      className="inline-flex items-center gap-1.5 hover:opacity-80"
                      title={`Snijplan ${sp.snijplan_nr}`}
                    >
                      <SnijplanStatusBadge status={sp.status} />
                    </Link>
                  ))}
                </span>
              )}
              {regel.is_maatwerk && (!regel.snijplannen || regel.snijplannen.length === 0) && (
                <span className="ml-auto text-slate-400 text-xs">Geen snijplan</span>
              )}
            </div>
          </td>
        </tr>
      )}
      {subRows.map((s) => (
        <SubRowTr key={s.key} sub={s} />
      ))}
    </>
  )
}

interface OrderRegelsTableProps {
  regels: OrderRegel[]
  isLoading: boolean
  levertijden?: OrderRegelLevertijd[]
  claims?: OrderClaim[]
}

export function OrderRegelsTable({ regels, isLoading, levertijden, claims }: OrderRegelsTableProps) {
  const levertijdMap = new Map<number, OrderRegelLevertijd>(
    (levertijden ?? []).map(l => [l.order_regel_id, l]),
  )
  const claimsMap = new Map<number, OrderClaim[]>()
  for (const c of claims ?? []) {
    const arr = claimsMap.get(c.order_regel_id) ?? []
    arr.push(c)
    claimsMap.set(c.order_regel_id, arr)
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-8 text-center text-slate-400">
        Orderregels laden...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-medium text-slate-900">
          Orderregels ({regels.length})
        </h3>
      </div>

      {regels.length === 0 ? (
        <div className="p-8 text-center text-slate-400">Geen orderregels</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium text-slate-600">#</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Artikel</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Omschrijving</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Aantal</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Te leveren</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Backorder</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Levertijd</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Prijs</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Korting</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Bedrag</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel) => (
              <RegelRow
                key={regel.id}
                regel={regel}
                levertijd={levertijdMap.get(regel.id)}
                claims={claimsMap.get(regel.id) ?? []}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td colSpan={9} className="px-4 py-2 text-right text-slate-600">
                Totaal
              </td>
              <td className="px-4 py-2 text-right">
                {formatCurrency(regels.reduce((sum, r) => sum + (r.bedrag ?? 0), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
