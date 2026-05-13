import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDate, formatCurrency } from '@/lib/utils/formatters'
import { verzendWeekVoor, verzendWeekRelatief } from '@/lib/orders/verzendweek'
import { useMarkeerGeannuleerd } from '@/modules/orders-lifecycle'
import { LevertijdStatusBadge } from '@/modules/levertijd'
import type { OrderDetail } from '@/lib/supabase/queries/orders'

const EINDSTATUSSEN = ['Verzonden', 'Geannuleerd'] as const

interface OrderHeaderProps {
  order: OrderDetail
  locked?: boolean
}

export function OrderHeader({ order, locked = false }: OrderHeaderProps) {
  const verzendweek = verzendWeekVoor(order.afleverdatum)
  const relatief = verzendWeekRelatief(order.afleverdatum)
  const [showAnnuleerConfirm, setShowAnnuleerConfirm] = useState(false)
  const annuleer = useMarkeerGeannuleerd()

  const isEindstatus = (EINDSTATUSSEN as readonly string[]).includes(order.status)

  function handleAnnuleer() {
    annuleer.mutate(
      { orderId: order.id, reden: 'Handmatig geannuleerd via UI' },
      { onSuccess: () => setShowAnnuleerConfirm(false) },
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              {order.order_nr}
            </h2>
            <StatusBadge status={order.status} />
            <LevertijdStatusBadge orderId={order.id} />
            {order.status === 'Verzonden' && order.verzonden_at && (
              <span
                className="text-xs text-slate-500"
                title="Moment waarop voltooi_pickronde de laatste zending sloot — factuur is hierna verzonden"
              >
                op {formatDate(order.verzonden_at)}
              </span>
            )}
          </div>
          {order.oud_order_nr && (
            <p className="text-sm text-slate-400">
              Oud systeem: {order.oud_order_nr}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {locked ? (
            <span
              className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] text-slate-400 cursor-not-allowed bg-slate-50"
              title="Order is al (deels) gesneden en kan niet meer worden bewerkt"
            >
              Bewerken
            </span>
          ) : (
            <Link
              to={`/orders/${order.id}/bewerken`}
              className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50"
            >
              Bewerken
            </Link>
          )}
          {!isEindstatus && (
            <button
              type="button"
              onClick={() => setShowAnnuleerConfirm(true)}
              className="px-4 py-2 text-sm border border-rose-200 text-rose-600 rounded-[var(--radius-sm)] hover:bg-rose-50 transition-colors"
            >
              Annuleer order
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="text-slate-500">Klant</span>
          <Link
            to={`/klanten/${order.debiteur_nr}`}
            className="block font-medium text-terracotta-500 hover:underline"
          >
            {order.klant_naam}
          </Link>
        </div>
        <div>
          <span className="text-slate-500">Orderdatum</span>
          <p className="font-medium">{formatDate(order.orderdatum)}</p>
        </div>
        <div>
          <span className="text-slate-500">
            {order.lever_type === 'datum' ? 'Leverdatum' : 'Verzendweek'}
          </span>
          {order.lever_type === 'datum' && order.afleverdatum ? (
            <p className="flex items-center gap-1.5">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-terracotta-50 text-terracotta-700 text-xs font-semibold">
                Specifieke dag
              </span>
              <span className="font-semibold text-terracotta-700">{formatDate(order.afleverdatum)}</span>
              {relatief && (
                <span className="text-xs font-normal text-slate-400">({relatief})</span>
              )}
            </p>
          ) : (
            <p className="font-medium">
              {verzendweek ? (
                <>
                  Wk {verzendweek.week} · {verzendweek.jaar}
                  {relatief && (
                    <span className="ml-1 text-xs font-normal text-slate-400">({relatief})</span>
                  )}
                </>
              ) : (
                '—'
              )}
            </p>
          )}
        </div>
        <div>
          <span className="text-slate-500">Vertegenwoordiger</span>
          <p className="font-medium">{order.vertegenw_naam ?? '—'}</p>
        </div>
        <div>
          <span className="text-slate-500">Referentie</span>
          <p className="font-medium">{order.klant_referentie ?? '—'}</p>
        </div>
        <div>
          <span className="text-slate-500">Totaal bedrag</span>
          <p className="font-medium">{formatCurrency(order.totaal_bedrag)}</p>
        </div>
        <div>
          <span className="text-slate-500">Regels</span>
          <p className="font-medium">{order.aantal_regels}</p>
        </div>
        <div>
          <span className="text-slate-500">Gewicht</span>
          <p className="font-medium">{order.totaal_gewicht ? `${order.totaal_gewicht} kg` : '—'}</p>
        </div>
      </div>

      {/* Annuleer bevestiging */}
      {showAnnuleerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Order annuleren?</h3>
            <p className="text-sm text-slate-600 mb-6">
              Weet je zeker dat je order <strong>{order.order_nr}</strong> wilt annuleren?
              Dit kan niet ongedaan worden gemaakt. Reserveringen worden vrijgegeven.
            </p>
            {annuleer.error && (
              <p className="text-sm text-rose-600 mb-4">
                {annuleer.error instanceof Error ? annuleer.error.message : 'Annuleren mislukt'}
              </p>
            )}
            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowAnnuleerConfirm(false)}
                disabled={annuleer.isPending}
                className="px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
              >
                Terug
              </button>
              <button
                type="button"
                onClick={handleAnnuleer}
                disabled={annuleer.isPending}
                className="px-4 py-2 bg-rose-600 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {annuleer.isPending ? 'Bezig...' : 'Ja, annuleer order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
