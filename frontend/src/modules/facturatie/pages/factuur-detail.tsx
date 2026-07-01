import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, CheckCircle, ExternalLink, Send, CreditCard, Mail } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Fragment, useState, useEffect } from 'react'
import {
  useFactuurDetail,
  useMarkeerBetaald,
  useEdiFactuurConfig,
  useVerstuurFactuurViaEdi,
  useCreditnotasVoorFactuur,
  useDebiteurEmailFactuur,
  useVerstuurFactuurHandmatig,
} from '../hooks/use-facturen'
import { FactuurStatusSelect } from '../components/factuur-status-select'
import { BtwControleNodigBanner } from '../components/btw-controle-nodig-banner'
import { CreditfactuurDialog } from '../components/creditfactuur-dialog'
import {
  getFactuurPdfSignedUrl,
  renderFactuurPdfBlobUrl,
  isFactuurCreditnota,
  type FactuurRegel,
} from '../queries/facturen'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { downloadUrl } from '@/lib/utils/download'
import { useAuth } from '@/hooks/use-auth'

export function FactuurDetailPage() {
  const { id } = useParams<{ id: string }>()
  const factuurId = Number(id)
  const navigate = useNavigate()

  const { data, isLoading } = useFactuurDetail(factuurId)
  const markeerBetaald = useMarkeerBetaald()
  const ediConfig = useEdiFactuurConfig(data?.factuur.debiteur_nr)
  const verstuurEdi = useVerstuurFactuurViaEdi()
  const { data: creditnotas } = useCreditnotasVoorFactuur(
    data && !isFactuurCreditnota(data.factuur) ? factuurId : undefined,
  )
  const debiteurEmailQuery = useDebiteurEmailFactuur(data?.factuur.debiteur_nr)
  const verstuurHandmatig = useVerstuurFactuurHandmatig()
  // Externe vertegenwoordiger (mig 489): read-only — geen muteer-affordances.
  const { isExternRep } = useAuth()
  const [pdfBezig, setPdfBezig] = useState(false)
  const [pdfFout, setPdfFout] = useState<string | null>(null)
  const [ediMelding, setEdiMelding] = useState<{ type: 'ok' | 'fout'; tekst: string } | null>(null)
  const [showCreditDialog, setShowCreditDialog] = useState(false)
  const [showEmailPanel, setShowEmailPanel] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailMelding, setEmailMelding] = useState<{ type: 'ok' | 'fout'; tekst: string } | null>(null)

  // Vul het e-mailadres in zodra de debiteur-query klaar is (ook als het paneel
  // al open was voor de query resolved). Behoudt wat de gebruiker al getypt heeft.
  useEffect(() => {
    if (showEmailPanel && debiteurEmailQuery.data !== undefined) {
      setEmailInput((prev) => prev || debiteurEmailQuery.data || '')
    }
  }, [showEmailPanel, debiteurEmailQuery.data])

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
    const filename = `Factuur-${factuur.factuur_nr}.pdf`
    try {
      let url: string
      if (factuur.pdf_storage_path) {
        url = await getFactuurPdfSignedUrl(factuur.pdf_storage_path, filename)
      } else {
        url = await renderFactuurPdfBlobUrl(factuur.id)
      }
      downloadUrl(url, filename)
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

  const aantalOrders = new Set(
    regels.map((r) => r.order_id).filter((v): v is number => v != null),
  ).size
  const isPerOrder = aantalOrders === 1
  const toonEdiKnop = ediConfig.data?.beschikbaar === true

  function handleVerstuurEdi() {
    setEdiMelding(null)
    verstuurEdi.mutate(factuur.id, {
      onSuccess: (res) => {
        setEdiMelding({
          type: 'ok',
          tekst: res.reedsAanwezig
            ? `Factuur stond al op de EDI-wachtrij (status ${res.status}).`
            : 'Factuur op de EDI-wachtrij gezet — wordt binnen een minuut verstuurd.',
        })
      },
      onError: (err) => {
        setEdiMelding({
          type: 'fout',
          tekst: err instanceof Error ? err.message : 'Verzenden via EDI mislukt',
        })
      },
    })
  }

  function handleOpenEmailPanel() {
    setEmailInput(debiteurEmailQuery.data ?? '')
    setEmailMelding(null)
    setShowEmailPanel(true)
  }

  function handleVerstuurPerEmail() {
    setEmailMelding(null)
    verstuurHandmatig.mutate(
      { factuurId: factuur.id, email: emailInput.trim() },
      {
        onSuccess: (res) => {
          setEmailMelding({ type: 'ok', tekst: `Verstuurd naar ${res.verstuurd_naar}` })
          setShowEmailPanel(false)
        },
        onError: (err) => {
          setEmailMelding({
            type: 'fout',
            tekst: err instanceof Error ? err.message : 'Versturen mislukt',
          })
        },
      },
    )
  }

  const isBetaald = factuur.status === 'Betaald'
  const isCreditnota = isFactuurCreditnota(factuur)

  // Creditnota aanmaken mag alleen op een debetfactuur die niet volledig gecrediteerd is.
  const reedsGecrediteerd = (creditnotas ?? []).reduce((sum, c) => sum + Math.abs(c.totaal), 0)
  const kanCrediteren = !isExternRep && !isCreditnota && reedsGecrediteerd < Math.abs(factuur.totaal) - 0.01

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
        title={
          <div className="flex items-center gap-3">
            <span>{factuur.factuur_nr}</span>
            {isCreditnota && (
              <span className="inline-flex items-center rounded-md bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700 uppercase tracking-wide">
                Creditnota
              </span>
            )}
          </div>
        }
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
            {!isExternRep && (
              <button
                onClick={handleOpenEmailPanel}
                title="Verstuur deze factuur handmatig per e-mail"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Mail size={15} />
                Verstuur per e-mail
              </button>
            )}
            {!isExternRep && toonEdiKnop && (
              <button
                onClick={handleVerstuurEdi}
                disabled={verstuurEdi.isPending || !isPerOrder}
                title={
                  isPerOrder
                    ? 'Zet deze factuur op de uitgaande EDI-wachtrij (Transus INVOIC)'
                    : 'EDI-factuur ondersteunt in V1 alleen facturen die één order dekken'
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={15} />
                {verstuurEdi.isPending ? 'Versturen…' : 'Verstuur via EDI'}
              </button>
            )}
            {kanCrediteren && (
              <button
                onClick={() => setShowCreditDialog(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-purple-300 text-sm font-medium text-purple-700 hover:bg-purple-50 transition-colors"
              >
                <CreditCard size={15} />
                Creditnota aanmaken
              </button>
            )}
            {!isExternRep && (
              <button
                onClick={handleMarkeerBetaald}
                disabled={isBetaald || markeerBetaald.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle size={15} />
                Markeer als betaald
              </button>
            )}
          </div>
        }
      />

      {/* Banner: dit is een creditnota — link naar de originele debetfactuur */}
      {isCreditnota && factuur.credit_voor_factuur_id && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
          <CreditCard className="h-4 w-4 shrink-0" />
          <span>
            Dit is een creditnota voor{' '}
            <Link
              to={`/facturatie/${factuur.credit_voor_factuur_id}`}
              className="font-semibold underline hover:text-purple-600"
            >
              debetfactuur #{factuur.credit_voor_factuur_id}
            </Link>
          </span>
        </div>
      )}

      {!isExternRep && factuur.btw_controle_nodig_sinds && (
        <BtwControleNodigBanner
          factuurId={factuur.id}
          debiteurNr={factuur.debiteur_nr}
          controleNodigSinds={factuur.btw_controle_nodig_sinds}
          btwRegeling={factuur.btw_regeling}
        />
      )}

      {ediMelding && (
        <div
          className={`mb-4 px-4 py-3 rounded-[var(--radius-sm)] border text-sm ${
            ediMelding.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {ediMelding.tekst}
        </div>
      )}

      {/* E-mail verstuurpaneel */}
      {showEmailPanel && (
        <div className="mb-4 rounded-[var(--radius)] border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Mail size={15} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Verstuur per e-mail</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            De factuur-PDF wordt opnieuw gegenereerd en als bijlage meegestuurd. Na verzending wordt het vinkje groen.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="E-mailadres"
              className="flex-1 rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !verstuurHandmatig.isPending) handleVerstuurPerEmail()
              }}
            />
            <button
              type="button"
              onClick={handleVerstuurPerEmail}
              disabled={verstuurHandmatig.isPending || !emailInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <Mail size={14} />
              {verstuurHandmatig.isPending ? 'Versturen…' : 'Versturen'}
            </button>
            <button
              type="button"
              onClick={() => { setShowEmailPanel(false); setEmailMelding(null) }}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Annuleer
            </button>
          </div>
          {emailMelding && (
            <div
              className={`mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-sm ${
                emailMelding.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {emailMelding.tekst}
            </div>
          )}
        </div>
      )}

      {emailMelding && !showEmailPanel && (
        <div
          className={`mb-4 px-4 py-3 rounded-[var(--radius-sm)] border text-sm ${
            emailMelding.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {emailMelding.tekst}
        </div>
      )}

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
            <div className="flex justify-between items-center">
              <dt className="text-slate-500">Status</dt>
              <dd><FactuurStatusSelect factuurId={factuur.id} status={factuur.status} /></dd>
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

      {/* Regels-tabel — gegroepeerd per order, gelijk aan PDF */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Factuurregels</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-5 py-3 font-medium text-slate-500 w-10">#</th>
                <th className="px-5 py-3 font-medium text-slate-500">Artikel</th>
                <th className="px-5 py-3 font-medium text-slate-500">Omschrijving</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Aantal</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Prijs</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {regels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                    Geen regels
                  </td>
                </tr>
              ) : (
                groepeerPerOrder(regels).map((groep) => (
                  <Fragment key={groep.order_id ?? `geen-order-${groep.order_nr ?? 'x'}`}>
                    <tr className="bg-slate-50 border-y border-slate-200">
                      <td colSpan={6} className="px-5 py-2.5">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-semibold text-slate-500 uppercase tracking-wider">
                            Order
                          </span>
                          {groep.order_id ? (
                            <Link
                              to={`/orders/${groep.order_id}`}
                              className="font-mono font-medium text-terracotta-500 hover:text-terracotta-600 hover:underline"
                            >
                              {groep.order_nr ?? `#${groep.order_id}`}
                            </Link>
                          ) : (
                            <span className="font-mono font-medium text-slate-700">
                              {groep.order_nr ?? '—'}
                            </span>
                          )}
                          {groep.uw_referentie && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="text-slate-500">Uw ref.</span>
                              <span className="text-slate-700">{groep.uw_referentie}</span>
                            </>
                          )}
                          <span className="ml-auto text-slate-500">
                            Subtotaal{' '}
                            <span className="font-medium text-slate-700">
                              {formatCurrency(groep.subtotaal)}
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                    {groep.regels.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-slate-400">{r.regelnummer}</td>
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
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totalen-blok — Optie II: subtotaal → toeslag → grondslag → BTW → totaal */}
      <div className="flex justify-end mb-8">
        <div className="w-full max-w-xs bg-white rounded-[var(--radius)] border border-slate-200 p-5 space-y-2 text-sm">
          {(() => {
            const toeslagBedrag = factuur.toeslag_bedrag ?? 0
            const heeftToeslag = toeslagBedrag > 0
            const verlegd = factuur.btw_verlegd === true
            const grondslag = factuur.subtotaal + toeslagBedrag

            return (
              <>
                {heeftToeslag ? (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotaal</span>
                      <span className="font-medium">{formatCurrency(factuur.subtotaal)}</span>
                    </div>
                    <div className="flex justify-between text-amber-700">
                      <span
                        className="truncate max-w-[180px]"
                        title={factuur.toeslag_omschrijving ?? undefined}
                      >
                        {factuur.toeslag_omschrijving ?? 'Toeslag'}
                      </span>
                      <span className="font-medium whitespace-nowrap pl-2">
                        + {formatCurrency(toeslagBedrag)}
                      </span>
                    </div>
                    {!verlegd && (
                      <div className="flex justify-between text-slate-600">
                        <span>BTW-grondslag</span>
                        <span className="font-medium">{formatCurrency(grondslag)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotaal</span>
                    <span className="font-medium">{formatCurrency(factuur.subtotaal)}</span>
                  </div>
                )}
                {!verlegd && (
                  <div className="flex justify-between text-slate-600">
                    <span>BTW ({factuur.btw_percentage}%)</span>
                    <span className="font-medium">{formatCurrency(factuur.btw_bedrag)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-800 font-semibold border-t border-slate-200 pt-2 mt-2 text-base">
                  <span>Totaal</span>
                  <span>{formatCurrency(factuur.totaal)}</span>
                </div>
              </>
            )
          })()}
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

      {/* Gekoppelde creditnotas */}
      {!isCreditnota && creditnotas && creditnotas.length > 0 && (
        <div className="bg-white rounded-[var(--radius)] border border-purple-200 mb-6">
          <div className="p-5 border-b border-purple-100">
            <h2 className="text-sm font-semibold text-purple-800 flex items-center gap-2">
              <CreditCard size={15} />
              Gekoppelde creditnotas
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-purple-100 text-left">
                <th className="px-5 py-3 font-medium text-slate-500">Creditnota nr</th>
                <th className="px-5 py-3 font-medium text-slate-500">Datum</th>
                <th className="px-5 py-3 font-medium text-slate-500">Status</th>
                <th className="px-5 py-3 font-medium text-slate-500 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {creditnotas.map((cn) => (
                <tr key={cn.id} className="border-b border-purple-50 last:border-0 hover:bg-purple-50 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      to={`/facturatie/${cn.id}`}
                      className="font-mono text-terracotta-500 hover:underline"
                    >
                      {cn.factuur_nr}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(cn.factuurdatum)}</td>
                  <td className="px-5 py-3 text-slate-600">{cn.status}</td>
                  <td className="px-5 py-3 text-right font-medium text-red-600 tabular-nums">
                    − {formatCurrency(Math.abs(cn.totaal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Creditfactuur dialog */}
      {showCreditDialog && (
        <CreditfactuurDialog
          factuur={factuur}
          regels={regels}
          onClose={() => setShowCreditDialog(false)}
          onCreated={(creditId) => {
            setShowCreditDialog(false)
            navigate(`/facturatie/${creditId}`)
          }}
        />
      )}
    </>
  )
}

interface FactuurRegelGroep {
  order_id: number | null
  order_nr: string | null
  uw_referentie: string | null
  regels: FactuurRegel[]
  subtotaal: number
}

function groepeerPerOrder(regels: FactuurRegel[]): FactuurRegelGroep[] {
  const groepen = new Map<string, FactuurRegelGroep>()
  for (const r of regels) {
    const key = r.order_id != null ? `id-${r.order_id}` : `nr-${r.order_nr ?? 'leeg'}`
    let groep = groepen.get(key)
    if (!groep) {
      groep = {
        order_id: r.order_id ?? null,
        order_nr: r.order_nr,
        uw_referentie: r.uw_referentie,
        regels: [],
        subtotaal: 0,
      }
      groepen.set(key, groep)
    }
    groep.regels.push(r)
    groep.subtotaal += Number(r.bedrag)
  }
  return Array.from(groepen.values())
}
