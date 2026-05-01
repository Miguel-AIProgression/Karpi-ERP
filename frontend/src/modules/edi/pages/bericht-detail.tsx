import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, AlertCircle, Check, Download, Send, Loader2, FileCode,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useEdiBericht } from '@/modules/edi/hooks/use-edi'
import { bevestigOrderViaEdi } from '@/modules/edi/lib/bevestig-helper'
import { downloadOrderbevAlsXml } from '@/modules/edi/lib/download-orderbev-xml'
import type { KarpiOrder } from '@/modules/edi/lib/karpi-fixed-width'
import type { EdiBerichtStatus, EdiBerichtType } from '@/modules/edi/queries/edi'
import { cn } from '@/lib/utils/cn'

const KARPI_GLN_DEFAULT = '8715954999998'

const STATUS_KLEUREN: Record<EdiBerichtStatus, { bg: string; text: string }> = {
  Wachtrij:    { bg: 'bg-amber-100',  text: 'text-amber-700' },
  Bezig:       { bg: 'bg-blue-100',   text: 'text-blue-700' },
  Verstuurd:   { bg: 'bg-green-100',  text: 'text-green-700' },
  Verwerkt:    { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  Fout:        { bg: 'bg-rose-100',   text: 'text-rose-700' },
  Geannuleerd: { bg: 'bg-gray-100',   text: 'text-gray-500' },
}

export function EdiBerichtDetailPage() {
  const { id } = useParams<{ id: string }>()
  const idNum = id ? parseInt(id, 10) : undefined
  const { data: bericht, isLoading } = useEdiBericht(idNum)

  const qc = useQueryClient()
  const [bevestigBusy, setBevestigBusy] = useState(false)
  const [bevestigError, setBevestigError] = useState<string | null>(null)
  const [bevestigResult, setBevestigResult] = useState<{ uitgaandId: number; reedsEerderBevestigd: boolean } | null>(null)
  const [xmlBusy, setXmlBusy] = useState(false)
  const [xmlError, setXmlError] = useState<string | null>(null)

  if (isLoading) return <div className="p-8 text-slate-500">Laden…</div>
  if (!bericht) return <div className="p-8 text-rose-600">Bericht niet gevonden.</div>

  const kleur = STATUS_KLEUREN[bericht.status]
  const isInkomendeOrder = bericht.richting === 'in' && bericht.berichttype === 'order'
  const isUitgaandeOrderbev = bericht.richting === 'uit' && bericht.berichttype === 'orderbev'
  const heeftOrder = bericht.order_id != null
  const kanBevestigen = isInkomendeOrder && heeftOrder
  const kanXmlDownloaden = isUitgaandeOrderbev && heeftOrder

  async function handleXmlDownload() {
    if (!bericht || !bericht.order_id) return
    setXmlBusy(true)
    setXmlError(null)
    try {
      await downloadOrderbevAlsXml({
        id: bericht.id,
        order_id: bericht.order_id,
        payload_parsed: bericht.payload_parsed as Record<string, unknown> | null,
        is_test: bericht.is_test ?? false,
        order_response_seq: (bericht as unknown as { order_response_seq: number | null }).order_response_seq ?? null,
      })
    } catch (err) {
      setXmlError(err instanceof Error ? err.message : String(err))
    } finally {
      setXmlBusy(false)
    }
  }

  async function handleBevestig() {
    if (!bericht || !bericht.order_id || !bericht.payload_parsed) return
    setBevestigBusy(true)
    setBevestigError(null)
    setBevestigResult(null)
    try {
      const result = await bevestigOrderViaEdi(
        bericht.order_id,
        bericht.id,
        bericht.payload_parsed as unknown as KarpiOrder,
        KARPI_GLN_DEFAULT,
        { isTest: bericht.is_test ?? false },
      )
      setBevestigResult({
        uitgaandId: result.uitgaandId,
        reedsEerderBevestigd: result.reedsEerderBevestigd,
      })
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
    } catch (err) {
      setBevestigError(err instanceof Error ? err.message : String(err))
    } finally {
      setBevestigBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {bericht.richting === 'in' ? <ArrowDownCircle size={20} /> : <ArrowUpCircle size={20} />}
            EDI-bericht #{bericht.id}
          </span>
        }
        description={
          <span className="flex items-center gap-3">
            <Link to="/edi/berichten" className="text-slate-500 hover:text-terracotta-500 inline-flex items-center gap-1">
              <ArrowLeft size={14} /> terug naar overzicht
            </Link>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {bericht.payload_raw && (() => {
              const payloadIsXml = bericht.payload_raw.trimStart().startsWith('<')
              return (
                <button
                  onClick={() => downloadPayload(bericht.id, bericht.berichttype, bericht.payload_raw!)}
                  className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-2"
                  title={
                    payloadIsXml
                      ? 'Download de opgeslagen TransusXML payload (.xml). Upload dit bestand in Transus "Bekijken en testen".'
                      : 'Download de opgeslagen Karpi-fixed-width payload (.inh).'
                  }
                >
                  <Download size={14} />
                  Download payload {payloadIsXml ? '(.xml)' : '(.inh)'}
                </button>
              )
            })()}
            {kanXmlDownloaden && (
              <button
                onClick={handleXmlDownload}
                disabled={xmlBusy}
                className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
                title="Bouw TransusXML uit order + regels en download. Upload dit bestand in Transus' 'Bekijken en testen'-tab van proces 'Orderbevestiging versturen'."
              >
                {xmlBusy ? <Loader2 size={14} className="animate-spin" /> : <FileCode size={14} />}
                TransusXML
              </button>
            )}
            {kanBevestigen && (
              <button
                onClick={handleBevestig}
                disabled={bevestigBusy}
                className="px-3 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 inline-flex items-center gap-2"
                title="Genereer orderbevestiging en plaats op uitgaande wachtrij"
              >
                {bevestigBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Bevestig + verstuur orderbev
              </button>
            )}
          </div>
        }
      />

      {/* Bevestig-feedback */}
      {bevestigResult && (
        <div className="mb-6 p-4 rounded-[var(--radius)] border border-emerald-200 bg-emerald-50">
          <div className="font-medium text-emerald-800 mb-1 flex items-center gap-2">
            <Check size={16} />
            {bevestigResult.reedsEerderBevestigd
              ? 'Order was al bevestigd — bestaande orderbev getoond.'
              : 'Orderbevestiging geplaatst op uitgaande wachtrij.'}
          </div>
          <Link
            to={`/edi/berichten/${bevestigResult.uitgaandId}`}
            className="text-sm text-emerald-700 hover:underline inline-flex items-center gap-1"
          >
            Bekijk uitgaand bericht #{bevestigResult.uitgaandId} <ArrowUpCircle size={14} />
          </Link>
        </div>
      )}
      {bevestigError && (
        <div className="mb-6 p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 text-rose-700 text-xs">
          Bevestigen mislukt: {bevestigError}
        </div>
      )}
      {xmlError && (
        <div className="mb-6 p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 text-rose-700 text-xs">
          TransusXML genereren mislukt: {xmlError}
        </div>
      )}

      {/* Meta-blok */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetaCell label="Status">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', kleur.bg, kleur.text)}>
            {bericht.status === 'Fout' && <AlertCircle size={12} className="mr-1" />}
            {bericht.status === 'Verwerkt' && <Check size={12} className="mr-1" />}
            {bericht.status}
          </span>
          {bericht.is_test && <span className="ml-2 text-xs text-amber-600 font-medium">TEST</span>}
        </MetaCell>

        <MetaCell label="Type">{labelType(bericht.berichttype)}</MetaCell>

        <MetaCell label="Klant">
          {bericht.klant_naam ?? <span className="text-slate-400">—</span>}
          {bericht.debiteur_nr && <span className="ml-1 text-xs text-slate-400">#{bericht.debiteur_nr}</span>}
        </MetaCell>

        <MetaCell label="TransactionID">
          <span className="font-mono text-xs">{bericht.transactie_id ?? '—'}</span>
        </MetaCell>

        <MetaCell label="Aangemaakt">{formatDateTime(bericht.created_at)}</MetaCell>
        <MetaCell label="Verstuurd">{bericht.sent_at ? formatDateTime(bericht.sent_at) : '—'}</MetaCell>
        <MetaCell label="Bevestigd">{bericht.acked_at ? formatDateTime(bericht.acked_at) : '—'}</MetaCell>
        <MetaCell label="Retry">{bericht.retry_count}</MetaCell>
      </div>

      {/* Inkomende order zonder klant-koppeling */}
      {isInkomendeOrder && !bericht.debiteur_nr && (
        <div className="mb-6 p-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50">
          <div className="font-medium text-amber-800 mb-1 flex items-center gap-2">
            <AlertCircle size={16} /> Geen debiteur gekoppeld
          </div>
          <p className="text-xs text-amber-700">
            De GLN's in dit bericht matchen niet met een bestaande debiteur. Voeg het GLN
            toe aan de debiteur via Klanten → klant-detail → veld <code>gln_bedrijf</code>,
            en herhaal de demo. Order-creatie is voor dit bericht overgeslagen.
          </p>
        </div>
      )}

      {isInkomendeOrder && bericht.debiteur_nr && !heeftOrder && (
        <div className="mb-6 p-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50">
          <div className="font-medium text-amber-800 mb-1 flex items-center gap-2">
            <AlertCircle size={16} /> Geen order aangemaakt
          </div>
          <p className="text-xs text-amber-700">
            Debiteur is gevonden maar order-creatie via <code>create_edi_order</code> is
            niet uitgevoerd of mislukt. Run migratie 158 of bekijk de logs.
          </p>
        </div>
      )}

      {/* Foutmelding */}
      {bericht.error_msg && (
        <div className="mb-6 p-4 rounded-[var(--radius)] border border-rose-200 bg-rose-50">
          <div className="font-medium text-rose-800 mb-1 flex items-center gap-2">
            <AlertCircle size={16} /> Foutmelding
          </div>
          <pre className="text-xs text-rose-700 whitespace-pre-wrap">{bericht.error_msg}</pre>
        </div>
      )}

      {/* Gerelateerd order/factuur — verplaatst naar boven want belangrijk */}
      {(bericht.order_id || bericht.factuur_id) && (
        <div className="mb-6 p-4 rounded-[var(--radius)] border border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Gerelateerd</h3>
          <ul className="space-y-1 text-sm">
            {bericht.order_id && (
              <li>
                Order:{' '}
                <Link to={`/orders/${bericht.order_id}`} className="text-terracotta-600 hover:underline font-medium">
                  {bericht.order_nr ?? `#${bericht.order_id}`}
                </Link>
                {isInkomendeOrder && (
                  <span className="ml-2 text-xs text-slate-500">
                    — automatisch aangemaakt door <code>create_edi_order</code>
                  </span>
                )}
              </li>
            )}
            {bericht.factuur_id && (
              <li>
                Factuur:{' '}
                <Link to={`/facturatie/${bericht.factuur_id}`} className="text-terracotta-600 hover:underline">
                  {bericht.factuur_nr ?? `#${bericht.factuur_id}`}
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Geparseerde inhoud */}
      {bericht.payload_parsed && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Geparseerde inhoud</h3>
          <pre className="bg-slate-50 border border-slate-200 rounded-[var(--radius-sm)] p-4 text-xs text-slate-800 overflow-auto max-h-[480px]">
            {JSON.stringify(bericht.payload_parsed, null, 2)}
          </pre>
        </div>
      )}

      {/* Ruwe payload */}
      {bericht.payload_raw && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Ruwe payload</h3>
          <pre className="bg-slate-900 text-slate-100 rounded-[var(--radius-sm)] p-4 text-xs font-mono overflow-auto max-h-[480px]">
            {bericht.payload_raw}
          </pre>
        </div>
      )}
    </>
  )
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function labelType(t: string): string {
  switch (t) {
    case 'order': return 'Order in'
    case 'orderbev': return 'Orderbevestiging'
    case 'factuur': return 'Factuur'
    case 'verzendbericht': return 'Verzendbericht'
    default: return t
  }
}

function downloadPayload(id: number, type: EdiBerichtType, payload: string): void {
  // Content-detectie zodat Transus' "Bekijken en testen"-tab de juiste mime/extensie ziet.
  const isXml = payload.trimStart().startsWith('<?xml') || payload.trimStart().startsWith('<')
  const ext = isXml ? 'xml' : 'inh'
  const mime = isXml ? 'application/xml;charset=utf-8' : 'application/octet-stream'

  const blob = new Blob([payload], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `edi-${type}-${id}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
