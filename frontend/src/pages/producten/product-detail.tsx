import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { formatCurrency, formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { useProductDetail, useRollenVoorProduct, useReserveringenVoorProduct } from '@/hooks/use-producten'
import { ProductTypeBadge } from './producten-overview'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const artikelnr = id ?? ''

  const { data: product, isLoading } = useProductDetail(artikelnr)
  const { data: rollen } = useRollenVoorProduct(artikelnr)
  const { data: reserveringen } = useReserveringenVoorProduct(artikelnr)

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

      <div className="flex items-center gap-3 mb-1">
        <PageHeader title={product.omschrijving} description={`Artikelnr: ${product.artikelnr}`} />
        <ProductTypeBadge type={product.product_type} />
      </div>

      {/* Info card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField label="Karpi-code" value={product.karpi_code} />
          <InfoField label="EAN" value={product.ean_code} />
          <InfoField label="Kwaliteit" value={product.kwaliteit_code} />
          <InfoField label="Zoeksleutel" value={product.zoeksleutel} />
        </div>
      </div>

      {/* Voorraad card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <h3 className="font-medium mb-4">Voorraad</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <StockField label="Voorraad" value={product.voorraad} />
          <StockField label="Backorder" value={product.backorder} warning={product.backorder > 0} />
          <StockField label="Gereserveerd" value={product.gereserveerd} />
          <StockField label="Besteld (ink)" value={product.besteld_inkoop} />
          <StockField label="Vrije voorraad" value={product.vrije_voorraad}
            success={product.vrije_voorraad > 10}
            warning={product.vrije_voorraad > 0 && product.vrije_voorraad <= 10}
            danger={product.vrije_voorraad <= 0}
          />
        </div>
      </div>

      {/* Reserveringen */}
      {product.gereserveerd > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-medium">Reserveringen ({reserveringen?.length ?? 0})</h3>
          </div>
          {reserveringen && reserveringen.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Order</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Klant</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Te leveren</th>
                </tr>
              </thead>
              <tbody>
                {reserveringen.map((r) => (
                  <tr key={r.order_id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link to={`/orders/${r.order_id}`} className="text-terracotta-500 hover:underline font-mono text-xs">
                        {r.order_nr}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{r.klant_naam ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">{r.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{r.te_leveren}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5 text-sm text-slate-400">Reserveringen laden...</div>
          )}
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
