import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { formatCurrency, formatNumber } from '@/lib/utils/formatters'
import { berekenProductGewichtKg } from '@/lib/utils/gewicht'
import { cn } from '@/lib/utils/cn'
import { useQuery } from '@tanstack/react-query'
import { useProductDetail, useRollenVoorProduct, useClaimsVoorProduct, useEquivalenteProducten } from '@/hooks/use-producten'
import { useOpenstaandeInkoopVoorArtikel } from '@/hooks/use-inkooporders'
import { useVoorraadpositie } from '@/modules/voorraadpositie'
import { ProductTypeBadge } from './producten-overview'
import { GewichtBronBadge } from '@/components/kwaliteiten/gewicht-bron-badge'
import { fetchKwaliteitInfo } from '@/lib/supabase/queries/kwaliteiten'
import { isoWeekFromString } from '@/lib/utils/iso-week'

const INKOOP_STATUS_COLORS: Record<string, string> = {
  Concept: 'bg-slate-100 text-slate-600',
  Besteld: 'bg-blue-100 text-blue-700',
  'Deels ontvangen': 'bg-amber-100 text-amber-700',
  Ontvangen: 'bg-emerald-100 text-emerald-700',
  Geannuleerd: 'bg-rose-100 text-rose-700',
}

function formatLeverweek(leverweek: string | null, verwacht: string | null): string {
  if (leverweek) return `wk ${leverweek}`
  if (verwacht) {
    const d = new Date(verwacht)
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }
  }
  return '—'
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const artikelnr = id ?? ''

  const { data: product, isLoading } = useProductDetail(artikelnr)
  const { data: rollen } = useRollenVoorProduct(artikelnr)
  const { data: claims } = useClaimsVoorProduct(artikelnr)
  const { data: equivalenten } = useEquivalenteProducten(artikelnr)
  const { data: inkoopregels } = useOpenstaandeInkoopVoorArtikel(artikelnr)
  // Voorraadpositie-Module seam (T001 tracer-bullet, mig 179) — levert
  // de aggregate "Openstaande inkooporders"-totaal m¹ via voorraadpositie.besteld.
  // De per-IO-regel-detail blijft uit useOpenstaandeInkoopVoorArtikel komen
  // (aggregate kent geen regel-niveau leverancier/status/leverweek).
  const { data: voorraadpositie } = useVoorraadpositie(
    product?.kwaliteit_code ?? '',
    product?.kleur_code ?? '',
  )
  const { data: kwaliteitInfo } = useQuery({
    queryKey: ['kwaliteit-info', product?.kwaliteit_code],
    queryFn: () => fetchKwaliteitInfo(product?.kwaliteit_code ?? null),
    enabled: !!product?.kwaliteit_code,
  })

  if (isLoading) return <PageHeader title="Product laden..." />

  if (!product) {
    return (
      <>
        <PageHeader title="Product niet gevonden" />
        <Link to="/producten" className="text-terracotta-500 hover:underline">Terug</Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link to="/producten" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Terug naar producten
        </Link>
      </div>

      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-3">
          <PageHeader title={product.omschrijving} description={`Artikelnr: ${product.artikelnr}`} />
          <ProductTypeBadge type={product.product_type} />
        </div>
        <Link
          to={`/producten/${product.artikelnr}/bewerken`}
          className="px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-50 shrink-0"
        >
          Bewerken
        </Link>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField label="Karpi-code" value={product.karpi_code} />
          <InfoField label="EAN" value={product.ean_code} />
          <InfoField label="Kwaliteit" value={product.kwaliteit_code} />
          <InfoField label="Zoeksleutel" value={product.zoeksleutel} />
          {product.lengte_cm != null && product.breedte_cm != null && (
            <InfoField label="Maat" value={`${product.lengte_cm} × ${product.breedte_cm} cm`} />
          )}
          {kwaliteitInfo?.gewicht_per_m2_kg != null && (
            <InfoField
              label="Gewicht per m² (kwaliteit)"
              value={`${formatNumber(kwaliteitInfo.gewicht_per_m2_kg, 3)} kg/m²`}
            />
          )}
          {(() => {
            const berekend = berekenProductGewichtKg({
              lengte_cm: product.lengte_cm,
              breedte_cm: product.breedte_cm,
              vorm: product.vorm,
              gewichtPerM2Kg: kwaliteitInfo?.gewicht_per_m2_kg ?? null,
            })
            const effectief = berekend ?? product.gewicht_kg
            if (effectief == null) return null
            return (
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Totaal gewicht (deze afmeting)</div>
                <div className="flex items-center gap-2">
                  <span>{formatNumber(effectief, 2)} kg</span>
                  <GewichtBronBadge gewichtUitKwaliteit={berekend != null || product.gewicht_uit_kwaliteit} />
                </div>
              </div>
            )
          })()}
          {kwaliteitInfo?.standaard_breedte_cm != null && product.product_type === 'rol' && (
            <InfoField label="Standaard rolbreedte" value={`${kwaliteitInfo.standaard_breedte_cm} cm`} />
          )}
        </div>
        {product.kwaliteit_code && kwaliteitInfo?.gewicht_per_m2_kg == null && (
          <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-amber-700 flex items-start gap-2">
            <span>⚠</span>
            <span>
              Kwaliteit <span className="font-mono">{product.kwaliteit_code}</span> heeft nog geen gewicht/m² ingevuld —
              <Link to="/instellingen/kwaliteiten" className="underline ml-1">
                vul aan op instellingen-pagina
              </Link>.
            </span>
          </div>
        )}
      </div>

      {/* Voorraad card */}
      {(() => {
        const ioClaimAantal = (claims ?? [])
          .filter(c => c.bron === 'inkooporder_regel')
          .reduce((s, c) => s + (c.aantal || 0), 0)
        return (
          <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
            <h3 className="font-medium mb-4">Voorraad</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <StockField label="Voorraad" value={product.voorraad} />
              <StockField label="Gereserveerd" value={product.gereserveerd} />
              <StockField
                label="Wacht op inkoop"
                value={ioClaimAantal}
                warning={ioClaimAantal > 0}
              />
              <StockField label="Besteld (ink)" value={product.besteld_inkoop} />
              <StockField label="Vrije voorraad" value={product.vrije_voorraad}
                success={product.vrije_voorraad > 10}
                warning={product.vrije_voorraad > 0 && product.vrije_voorraad <= 10}
                danger={product.vrije_voorraad <= 0}
              />
            </div>
            {product.backorder > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-amber-700">
                <span className="font-medium">Backorder (legacy):</span> {formatNumber(product.backorder)} — handmatig openstaand saldo uit oud systeem
              </div>
            )}
          </div>
        )
      })()}

      {/* Uitwisselbare producten */}
      {equivalenten && equivalenten.filter(e => e.artikelnr !== artikelnr).length > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-medium">Uitwisselbare producten ({equivalenten.filter(e => e.artikelnr !== artikelnr).length})</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Artikelnr</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Omschrijving</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Vrije voorraad</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Besteld (ink)</th>
              </tr>
            </thead>
            <tbody>
              {equivalenten
                .filter(e => e.artikelnr !== artikelnr)
                .map((e) => (
                  <tr key={e.artikelnr} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link to={`/producten/${e.artikelnr}`} className="text-terracotta-500 hover:underline font-mono text-xs">
                        {e.artikelnr}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{e.omschrijving}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn(
                        'font-semibold',
                        e.vrije_voorraad > 10 && 'text-emerald-600',
                        e.vrije_voorraad > 0 && e.vrije_voorraad <= 10 && 'text-amber-500',
                        e.vrije_voorraad <= 0 && 'text-rose-500',
                      )}>
                        {formatNumber(e.vrije_voorraad)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{formatNumber(e.besteld_inkoop)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Openstaande inkooporders */}
      {inkoopregels && inkoopregels.length > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-medium flex items-center gap-2">
              <Truck size={16} className="text-indigo-500" />
              Openstaande inkooporders ({inkoopregels.length})
            </h3>
            <span className="text-sm text-slate-500">
              Totaal te leveren:{' '}
              <span className="font-semibold text-slate-700">
                {formatNumber(
                  voorraadpositie?.besteld?.besteld_m ??
                    inkoopregels.reduce((s, r) => s + r.te_leveren_m, 0),
                )} m
              </span>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Inkooporder</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Leverancier</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Verwachte levering</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Besteld</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Geleverd</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Te leveren</th>
              </tr>
            </thead>
            <tbody>
              {inkoopregels.map((r) => (
                <tr key={r.regel_id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link
                      to={`/inkooporders/${r.inkooporder_id}`}
                      className="text-terracotta-500 hover:underline font-mono text-xs"
                    >
                      {r.inkooporder_nr}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.leverancier_naam ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs',
                        INKOOP_STATUS_COLORS[r.order_status] ?? 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {r.order_status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700 font-medium">
                    {formatLeverweek(r.leverweek, r.verwacht_datum)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">{formatNumber(r.besteld_m)}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{formatNumber(r.geleverd_m)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-indigo-700">
                    {formatNumber(r.te_leveren_m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Claims op voorraad */}
      {claims && claims.filter(c => c.bron === 'voorraad').length > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-medium">
              Op voorraad gereserveerd ({claims.filter(c => c.bron === 'voorraad').length})
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Order</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Klant</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Aantal</th>
              </tr>
            </thead>
            <tbody>
              {claims.filter(c => c.bron === 'voorraad').map((c) => (
                <tr key={c.claim_id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/orders/${c.order_id}`} className="text-terracotta-500 hover:underline font-mono text-xs">
                      {c.order_nr}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{c.klant_naam ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">{c.order_status}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{c.aantal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Claims op inkoop */}
      {claims && claims.filter(c => c.bron === 'inkooporder_regel').length > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-medium">
              Wacht op inkoop ({claims.filter(c => c.bron === 'inkooporder_regel').length})
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Order</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Klant</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Inkooporder</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Lever wk</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Aantal</th>
              </tr>
            </thead>
            <tbody>
              {claims.filter(c => c.bron === 'inkooporder_regel').map((c) => (
                <tr key={c.claim_id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/orders/${c.order_id}`} className="text-terracotta-500 hover:underline font-mono text-xs">
                      {c.order_nr}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{c.klant_naam ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.inkooporder_nr ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {c.verwacht_datum ? `wk ${isoWeekFromString(c.verwacht_datum)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{c.aantal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rollen */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-medium">Rollen ({rollen?.length ?? 0})</h3>
        </div>
        {rollen && rollen.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Rolnummer</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Lengte</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Breedte</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">m2</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Waarde</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {rollen.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs">{r.rolnummer}</td>
                  <td className="px-4 py-2 text-right">{r.lengte_cm ? `${r.lengte_cm} cm` : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.breedte_cm ? `${r.breedte_cm} cm` : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.oppervlak_m2?.toFixed(2) ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(r.waarde)}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs',
                      r.status === 'beschikbaar' && 'bg-emerald-100 text-emerald-700',
                      r.status === 'gereserveerd' && 'bg-amber-100 text-amber-700',
                      r.status === 'verkocht' && 'bg-slate-100 text-slate-500',
                      r.status === 'gesneden' && 'bg-blue-100 text-blue-700',
                      r.status === 'reststuk' && 'bg-purple-100 text-purple-700',
                    )}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-5 text-sm text-slate-400">Geen rollen beschikbaar</div>
        )}
      </div>
    </>
  )
}

function StockField({ label, value, success, warning, danger }: {
  label: string; value: number
  success?: boolean; warning?: boolean; danger?: boolean
}) {
  return (
    <div>
      <span className="text-slate-500">{label}</span>
      <p className={cn(
        'text-lg font-semibold',
        success && 'text-emerald-600',
        warning && 'text-amber-500',
        danger && 'text-rose-500',
      )}>
        {formatNumber(value)}
      </p>
    </div>
  )
}
