import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, Mail, RotateCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDate, formatCurrency } from '@/lib/utils/formatters'
import { verzendWeekVoor, verzendWeekRelatief } from '@/lib/orders/verzendweek'
import { useMarkeerGeannuleerd, useBevestigConceptOrder } from '@/modules/orders-lifecycle'
import { LevertijdStatusBadge } from '@/modules/levertijd'
import { BevestigOrderDialog } from './bevestig-order-dialog'
import { BevestigOrderEdiDialog } from './bevestig-order-edi-dialog'
import { bepaalBevestigingKanaal, isOrderBevestigd } from '@/lib/orders/bevestiging-kanaal'
import { fetchHandelspartnerConfig } from '@/modules/edi'
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
  const [showBevestigDialog, setShowBevestigDialog] = useState(false)
  const annuleer = useMarkeerGeannuleerd()
  const bevestigConcept = useBevestigConceptOrder()

  const isEindstatus = (EINDSTATUSSEN as readonly string[]).includes(order.status)
  const isConcept = order.status === 'Concept'

  const isEdiOrder = order.bron_systeem === 'edi'
  const { data: ediConfig } = useQuery({
    queryKey: ['edi-handelspartner-config', order.debiteur_nr],
    queryFn: () => fetchHandelspartnerConfig(order.debiteur_nr),
    enabled: isEdiOrder,
    staleTime: 60_000,
  })
  const kanaal = bepaalBevestigingKanaal(
    order.bron_systeem,
    ediConfig ? { transus_actief: ediConfig.transus_actief, orderbev_uit: ediConfig.orderbev_uit } : null,
  )
  const bevestigd = isOrderBevestigd(order)

  function handleAnnuleer() {
    annuleer.mutate(
      { orderId: order.id, reden: 'Handmatig geannuleerd via UI' },
      { onSuccess: () => setShowAnnuleerConfirm(false) },
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
      {/* Concept-banner: e-mail order die nog bevestigd moet worden */}
      {isConcept && (
        <div className="flex items-center justify-between gap-4 mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)]">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Mail size={16} className="shrink-0" />
            <span>
              <strong>Concept-order</strong> — automatisch aangemaakt vanuit e-mail.
              Controleer de gegevens en bevestig om de order in verwerking te nemen.
            </span>
          </div>
          <button
            type="button"
            disabled={bevestigConcept.isPending}
            onClick={() => bevestigConcept.mutate({ orderId: order.id })}
            className="shrink-0 px-4 py-1.5 text-sm bg-amber-600 text-white rounded-[var(--radius-sm)] hover:bg-amber-700 font-medium transition-colors disabled:opacity-60"
          >
            {bevestigConcept.isPending ? 'Bezig…' : 'Bevestig concept'}
          </button>
        </div>
      )}
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
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Bevestig order — niet tonen voor concept-orders */}
          {!isConcept && bevestigd ? (
            <>
              <span
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-[var(--radius-sm)]"
                title={
                  isEdiOrder
                    ? `Bevestigd via EDI op ${formatDate(order.edi_bevestigd_op!)}`
                    : `Bevestigd op ${formatDate(order.bevestigd_at!)}${order.bevestiging_email ? ` → ${order.bevestiging_email}` : ''}`
                }
              >
                <CheckCircle size={14} />
                Bevestigd
              </span>
              {!isEdiOrder && (
                <button
                  type="button"
                  onClick={() => setShowBevestigDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 text-slate-600 rounded-[var(--radius-sm)] hover:bg-slate-50 transition-colors"
                  title="Orderbevestiging opnieuw versturen"
                >
                  <RotateCcw size={14} />
                  Opnieuw versturen
                </button>
              )}
            </>
          ) : !isConcept ? (
            <button
              type="button"
              onClick={() => setShowBevestigDialog(true)}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-[var(--radius-sm)] hover:bg-green-700 font-medium transition-colors"
            >
              Bevestig order
            </button>
          ) : null}
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

      {/* Bevestig-order dialog — dispatcht op kanaal */}
      {showBevestigDialog && (kanaal === 'email' ? (
        <BevestigOrderDialog
          orderId={order.id}
          orderNr={order.order_nr}
          defaultEmail={order.bevestiging_email ?? (order as any).klant_email ?? null}
          isHerversturing={!!order.bevestigd_at}
          onClose={() => setShowBevestigDialog(false)}
        />
      ) : (
        <BevestigOrderEdiDialog
          orderId={order.id}
          orderNr={order.order_nr}
          debiteurNr={order.debiteur_nr}
          gewenstIso={order.edi_gewenste_afleverdatum ?? null}
          afleverdatumIso={order.afleverdatum}
          orderStatus={order.status}
          onClose={() => setShowBevestigDialog(false)}
        />
      ))}

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
