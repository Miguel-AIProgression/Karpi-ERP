import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, CheckCircle, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { useState } from 'react'
import { useFactuurDetail, useMarkeerBetaald } from '../hooks/use-facturen'
import { getFactuurPdfSignedUrl, renderFactuurPdfBlobUrl } from '@/lib/supabase/queries/facturen'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'

export function FactuurDetailPage() {
  const { id } = useParams<{ id: string }>()
  const factuurId = Number(id)

  const { data, isLoading } = useFactuurDetail(factuurId)
  const markeerBetaald = useMarkeerBetaald()
  const [pdfBezig, setPdfBezig] = useState(false)
  const [pdfFout, setPdfFout] = useState<string | null>(null)

  if (isLoading) {
    return (
      <>
        <PageHeader title="Factuur laden..." />
        <div className="text-slate-400">Even geduld…</div>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Factuur niet gevonden" />
        <Link to="/facturatie" className="text-terracotta-500 hover:underline">
          Terug naar facturen
        </Link>
      </>
    )
  }

  const { factuur, regels } = data

  async function handleDownloadPdf() {
    setPdfFout(null)
    setPdfBezig(true)
    try {
      let url: string
      if (factuur.pdf_storage_path) {
        url = await getFactuurPdfSignedUrl(factuur.pdf_storage_path)
      } else {
        url = await renderFactuurPdfBlobUrl(factuur.id)
      }
      window.open(url, '_blank')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF kon niet worden gemaakt'
      console.error('PDF downloaden mislukt', err)
      setPdfFout(msg)
    } finally {
      setPdfBezig(false)
    }
  }

  function handleMarkeerBetaald() {
    markeerBetaald.mutate(factuur.id)
  }

  const isBetaald = factuur.status === 'Betaald'

  const heeftAdres = Boolean(factuur.fact_adres || factuur.fact_postcode || factuur.fact_plaats)
  const pdfLabel = pdfBezig
    ? 'PDF maken…'
    : factuur.pdf_storage_path
      ? 'Download PDF'
      : 'Bekijk PDF (preview)'
  const pdfTooltip = factuur.pdf_storage_path
    ? 'Open de verzonden factuur-PDF in een nieuw tabblad'
    : 'Genereert een live preview-PDF op basis van de huidige factuurdata'

  return (
    <>
      {/* Terug-link */}
      <div className="mb-4">
        <Link
          to="/facturatie"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar facturen
        </Link>
      </div>

      {pdfFout && (
        <div className="mb-4 px-4 py-3 rounded-[var(--radius-sm)] border border-red-200 bg-red-50 text-sm text-red-700">
          PDF kon niet worden gemaakt: {pdfFout}
        </div>
      )}

      <PageHeader
        title={factuur.factuur_nr}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={pdfBezig}
              title={pdfTooltip}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={15} />
              {pdfLabel}
            </button>
            <button
              onClick={handleMarkeerBetaald}
              disabled={isBetaald || markeerBetaald.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCircle size={15} />
              Markeer als betaald
            </button>
          </div>
        }
      />

      {/* Info-blok */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        {/* Klant / adres */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <div className="flex items-start justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Klant
            </h2>
            <Link
              to={`/klanten/${factuur.debiteur_nr}`}
              className="inline-flex items-center gap-1 text-xs text-terracotta-500 hover:text-terracotta-600 hover:underline"
            >
              Klantkaart
              <ExternalLink size={12} />
            </Link>
          </div>

          <p className="font-medium text-slate-800">{factuur.fact_naam ?? '—'}</p>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Klantnr {factuur.debiteur_nr}
          </p>

          {heeftAdres ? (
            <div className="mt-3 text-sm text-slate-600 space-y-0.5">
              {factuur.fact_adres && <p>{factuur.fact_adres}</p>}
              {(factuur.fact_postcode || factuur.fact_plaats) && (
                <p>{[factuur.fact_postcode, factuur.fact_plaats].filter(Boolean).join('  ')}</p>
              )}
              {factuur.fact_land && <p>{factuur.fact_land}</p>}
            </div>
          ) : (
            <p className="mt-3 text-sm italic text-amber-600">
              Geen factuuradres bekend
              {factuur.fact_land ? ` — alleen land: ${factuur.fact_land}` : ''}
            </p>
          )}

          {factuur.btw_nummer && (
            <p className="text-xs text-slate-400 mt-3">BTW-nr: {factuur.btw_nummer}</p>
          )}
        </div>

        {/* Factuurgegevens */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Factuurgegevens
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd><StatusBadge status={factuur.status} type="factuur" /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Factuurdatum</dt>
              <dd className="text-slate-700">{formatDate(factuur.factuurdatum)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Vervaldatum</dt>
              <dd className="text-slate-700">{formatDate(factuur.vervaldatum)}</dd>
            </div>
            {factuur.verstuurd_op && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Verstuurd op</dt>
                <dd className="text-slate-700">{formatDate(factuur.verstuurd_op)}</dd>
              </div>
            )}
            {factuur.verstuurd_naar && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Verstuurd naar</dt>
                <dd className="text-slate-700 truncate max-w-[200px]">{factuur.verstuurd_naar}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Regels-tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Factuurregels</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-5 py-3 font-medium text-slate-500 w-10">#</th>
                <th className="px-5 py-3 font-medium text-slate-500">Order</th>
                <th className="px-5 py-3 font-medium text-slate-500">Uw ref.</th>
                <th className="px-5 py-3 font-medium text-slate-500">Artikel</th>
                <th className="px-5 py-3 font-medium text-slate-500">Omschrijving</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Aantal</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Prijs</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {regels.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                    Geen regels
                  </td>
                </tr>
              ) : (
                regels.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-400">{r.regelnummer}</td>
                    <td className="px-5 py-3 font-mono text-xs">
                      {r.order_id ? (
                        <Link
                          to={`/orders/${r.order_id}`}
                          className="text-terracotta-500 hover:text-terracotta-600 hover:underline"
                        >
                          {r.order_nr ?? `#${r.order_id}`}
                        </Link>
                      ) : (
                        <span className="text-slate-600">{r.order_nr ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{r.uw_referentie ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {r.artikelnr ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {r.omschrijving ?? '—'}
                      {r.omschrijving_2 && (
                        <span className="block text-xs text-slate-400">{r.omschrijving_2}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700">{r.aantal}</td>
                    <td className="px-5 py-3 text-right text-slate-700 whitespace-nowrap">
                      {formatCurrency(r.prijs)}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                      {formatCurrency(r.bedrag)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totalen-blok */}
      <div className="flex justify-end mb-8">
        <div className="w-full max-w-xs bg-white rounded-[var(--radius)] border border-slate-200 p-5 space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotaal</span>
            <span className="font-medium">{formatCurrency(factuur.subtotaal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>BTW ({factuur.btw_percentage}%)</span>
            <span className="font-medium">{formatCurrency(factuur.btw_bedrag)}</span>
          </div>
          <div className="flex justify-between text-slate-800 font-semibold border-t border-slate-200 pt-2 mt-2 text-base">
            <span>Totaal</span>
            <span>{formatCurrency(factuur.totaal)}</span>
          </div>
        </div>
      </div>

      {/* Opmerkingen */}
      {factuur.opmerkingen && (
        <div className="bg-slate-50 rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Opmerkingen
          </h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{factuur.opmerkingen}</p>
        </div>
      )}
    </>
  )
}
