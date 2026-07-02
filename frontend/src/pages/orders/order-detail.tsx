import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, Mail } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderHeader } from '@/components/orders/order-header'
import { OrderAddresses } from '@/components/orders/order-addresses'
import { OrderRegelsTable } from '@/components/orders/order-regels-table'
import { OrderFacturen } from '@/components/orders/order-facturen'
import { OrderLogboek } from '@/components/orders/order-logboek'
import { OrderEmails } from '@/components/orders/order-emails'
import { ZendingAanmakenKnop } from '@/components/orders/zending-aanmaken-knop'
import { useOrderDetail, useOrderRegels } from '@/hooks/use-orders'
import { useLevertijdVoorOrder, useClaimsVoorOrder } from '@/modules/reserveringen'
import { useSnijHaalbaarheid } from '@/modules/snijplanning'
import { computeOrderLock } from '@/lib/utils/order-lock'
import { DocumentenCompact } from '@/components/documenten/documenten-compact'
import { EdiLeverweekBevestigen } from '@/components/orders/edi-leverweek-bevestigen'
import { isLeverweekTeBevestigen } from '@/lib/orders/edi-leverweek'
import { isDebiteurTeBevestigen } from '@/lib/orders/intake-predicaten'
import { DebiteurBevestigenWidget } from '@/components/orders/debiteur-bevestigen-widget'
import { BastaAfhandelingPaneel } from '@/components/orders/basta-afhandeling-paneel'
import { LevertijdWijzigingBanner } from '@/components/orders/levertijd-wijziging-banner'
import { VerzendFoutBanner } from '@/components/orders/verzend-fout-banner'
import { OrderZendingen } from '@/components/orders/order-zendingen'
import { useVerzondenPerRegel } from '@/components/orders/regel-verzendstatus'
import { isLevertijdWijzigingTeBevestigen } from '@/lib/orders/levertijd-wijziging'
import { isAfleveradresIncompleet } from '@/lib/orders/afleveradres-gate'
import { AfleveradresIncompleetBanner } from '@/components/orders/afleveradres-incompleet-banner'
import { isPrijsOntbreekt } from '@/lib/orders/prijs-ontbreekt'
import { PrijsOntbreektBanner } from '@/components/orders/prijs-ontbreekt-banner'
import { isAfleveradresGlnGeblokkeerd } from '@/lib/orders/afleveradres-gln-gate'
import { AfleveradresGlnBanner } from '@/components/orders/afleveradres-gln-banner'
import { MancoMarkerBanner } from '@/components/orders/manco-marker-banner'
import { isMancoMarker } from '@/lib/orders/manco-marker'
import { heeftDropshipRegel } from '@/lib/orders/dropshipment-regel'
import { dropshipAflEmailProbleem } from '@/lib/orders/dropship-email'
import { useAuth } from '@/hooks/use-auth'
import { CombiLeveringInWachtKnop } from '@/components/orders/combi-levering-in-wacht-knop'

function EmailInhoudPanel({ body }: { body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-[var(--radius)]"
      >
        <Mail size={14} className="text-slate-400" />
        <span className="flex-1">Originele e-mail</span>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-slate-100">
          <pre className="mt-3 text-xs text-slate-600 whitespace-pre-wrap font-mono bg-slate-50 rounded p-3 max-h-96 overflow-y-auto">
            {body}
          </pre>
        </div>
      )}
    </div>
  )
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)

  const { data: order, isLoading: orderLoading } = useOrderDetail(orderId)
  const { data: regels, isLoading: regelsLoading } = useOrderRegels(orderId)
  const { data: levertijden } = useLevertijdVoorOrder(orderId)
  const { data: claims } = useClaimsVoorOrder(orderId)
  const { data: verzondenPerRegel } = useVerzondenPerRegel(orderId)
  const { perStuk: snijHaalbaarheidPerStuk } = useSnijHaalbaarheid()
  const { isExternRep } = useAuth()

  if (orderLoading) {
    return (
      <>
        <PageHeader title="Order laden..." />
        <div className="text-slate-400">Even geduld...</div>
      </>
    )
  }

  if (!order) {
    return (
      <>
        <PageHeader title="Order niet gevonden" />
        <Link to="/orders" className="text-terracotta-500 hover:underline">
          Terug naar orders
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar orders
        </Link>
      </div>

      <PageHeader
        title={order.order_nr}
        actions={
          isExternRep ? undefined : (
            <ZendingAanmakenKnop
              order={{ id: order.id, status: order.status, debiteur_nr: order.debiteur_nr, afhalen: order.afhalen }}
            />
          )
        }
      />

      <DocumentenCompact kind="order" parentId={order.id} className="mb-3" />

      {/* R1: productie-only orders (Basta) tonen bovenaan een afhandeling-hint.
          Rendert null voor gewone orders (gouden regel). */}
      <BastaAfhandelingPaneel
        alleenProductie={order.alleen_productie}
        oudOrderNr={order.oud_order_nr ?? null}
        status={order.status}
      />

      {/* Mig 524: retroactieve order — direct als Verzonden aangemaakt, geen pick/zending-flow. */}
      {order.is_achteraf && order.verzonden_at && (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="mt-0.5 text-slate-400">📋</span>
          <span>
            <span className="font-medium">{order.afhalen ? 'Afgehaald' : 'Verzonden'} op </span>
            {new Date(order.verzonden_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}
            {' — retroactief geregistreerd'}
          </span>
        </div>
      )}

      <OrderHeader
        order={order}
        locked={computeOrderLock(regels) === 'full'}
        maatwerkMetVoorstelWeek={(regels ?? []).some(
          r => r.is_maatwerk && r.verzendweek_bron === 'automatisch_voorraad'
        )}
      />

      {/* Open HST-verzendfout: order kan al "Verzonden" tonen terwijl de
          transportorder naar de vervoerder faalde. Rendert null zonder fout. */}
      {order.status !== 'Geannuleerd' && <VerzendFoutBanner orderId={order.id} />}

      {/* Mig 392: onvolledig afleveradres — harde blokkade voor Pick & Ship. */}
      {isAfleveradresIncompleet(order) && (
        <AfleveradresIncompleetBanner
          orderId={order.id}
          afl_naam={order.afl_naam}
          afl_adres={order.afl_adres}
          afl_postcode={order.afl_postcode}
          afl_plaats={order.afl_plaats}
        />
      )}

      {/* Mig 535: aflever-GLN matcht geen vestiging (stille HQ-fallback) — harde
          blokkade tot koppelen of bewust vrijgeven. */}
      {isAfleveradresGlnGeblokkeerd(order) && (
        <AfleveradresGlnBanner
          orderId={order.id}
          sinds={order.afl_gln_ongekoppeld_sinds!}
          afleveradresGln={order.afleveradres_gln ?? null}
          aflNaam={order.afl_naam}
          aflAdres={order.afl_adres}
          aflPostcode={order.afl_postcode}
          aflPlaats={order.afl_plaats}
        />
      )}

      {/* Mig 393: ontbrekende prijs (€0) — harde blokkade tot corrigeren/bevestigen. */}
      {isPrijsOntbreekt(order) && (
        <PrijsOntbreektBanner
          orderId={order.id}
          debiteurNr={order.debiteur_nr}
          teBevestigenSinds={order.prijs_ontbreekt_sinds!}
          regels={regels}
        />
      )}

      {/* Mig 518: permanente manco-markering (historisch, ook na Verzonden). */}
      {isMancoMarker(order) && <MancoMarkerBanner mancoSinds={order.manco_sinds!} />}

      {order.bron_systeem === 'email' && order.opmerkingen && (
        <EmailInhoudPanel body={order.opmerkingen} />
      )}

      {isLeverweekTeBevestigen(order) && (
        <EdiLeverweekBevestigen
          orderId={order.id}
          debiteurNr={order.debiteur_nr}
          gewenstIso={order.edi_gewenste_afleverdatum ?? null}
          afleverdatumIso={order.afleverdatum}
          orderStatus={order.status}
        />
      )}

      {isLevertijdWijzigingTeBevestigen(order) && order.status !== 'Geannuleerd' && (
        <LevertijdWijzigingBanner
          orderId={order.id}
          teBevestigenSinds={order.levertijd_wijziging_te_bevestigen_sinds!}
        />
      )}

      {/* Mig 322: onzekere (fuzzy) debiteur-match → bevestigen of corrigeren.
          env_fallback (verzameldebiteur) is bewust geen fout en valt af. */}
      {isDebiteurTeBevestigen(order) && (
          <DebiteurBevestigenWidget
            orderId={order.id}
            klantNaam={order.klant_naam ?? `Debiteur ${order.debiteur_nr}`}
            debiteurNr={order.debiteur_nr}
            matchBron={order.debiteur_match_bron}
          />
        )}

      {/* Mig 554/ADR-0039: klant belt na de orderbevestiging alsnog om te
          wachten op Combi-levering i.p.v. verzendkosten te betalen. De
          component bewaakt zelf volledig wanneer hij zichtbaar is (klant al
          op combi_levering, of order al Geannuleerd/Verzonden/In pickronde/
          Deels verzonden — code-review-fix). */}
      <CombiLeveringInWachtKnop orderId={order.id} orderNr={order.order_nr} />

      <OrderAddresses
        order={order}
        dropshipEmailProbleem={
          heeftDropshipRegel(regels ?? [])
            ? dropshipAflEmailProbleem({
                aflEmail: order.afl_email,
                factEmail: order.fact_email,
                debiteurEmails: [order.klant_email],
              })
            : null
        }
      />
      <OrderRegelsTable
        regels={regels ?? []}
        isLoading={regelsLoading}
        levertijden={levertijden}
        claims={claims}
        orderStatus={order.status}
        orderId={order.id}
        orderNr={order.order_nr}
        orderdatum={order.orderdatum}
        orderAfleverdatum={order.afleverdatum}
        verzondenPerRegel={verzondenPerRegel}
        snijHaalbaarheidPerStuk={snijHaalbaarheidPerStuk}
      />
      <OrderZendingen orderId={order.id} />
      <OrderLogboek orderId={order.id} />
      <OrderFacturen orderId={order.id} />
      <OrderEmails orderId={order.id} />
    </>
  )
}
