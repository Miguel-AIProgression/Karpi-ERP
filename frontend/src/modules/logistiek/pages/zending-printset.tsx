import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Printer, Tags } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PakbonDocument } from '@/modules/logistiek/components/pakbon-document'
import { ShippingLabel } from '@/modules/logistiek/components/shipping-label'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import { useZendingPrintSet } from '@/modules/logistiek/hooks/use-zendingen'
import { generateSscc } from '@/modules/logistiek/lib/sscc'
import { getVervoerderDef } from '@/modules/logistiek/registry'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

type PrintMode = 'all' | 'labels' | 'pakbon'

interface LabelItem {
  regel: ZendingPrintRegel | null
  index: number
  sscc: string
}

function vervoerderInfo(zending: ZendingPrintSet) {
  const def = getVervoerderDef(zending.vervoerder_code)
  return {
    code: zending.vervoerder_code ?? null,
    naam: zending.vervoerders?.display_naam ?? def?.displayNaam ?? 'Geen vervoerder',
    actief: zending.vervoerders?.actief ?? null,
  }
}

function expandLabels(zending: ZendingPrintSet): LabelItem[] {
  const sortedRegels = [...zending.zending_regels].sort((a, b) => {
    const ar = a.order_regels?.regelnummer ?? 0
    const br = b.order_regels?.regelnummer ?? 0
    return ar - br
  })
  const expanded: Array<{ regel: ZendingPrintRegel | null }> = []

  for (const regel of sortedRegels) {
    const aantal = Math.max(0, Math.trunc(Number(regel.aantal ?? 1)))
    for (let i = 0; i < aantal; i += 1) expanded.push({ regel })
  }

  const targetTotal = Math.max(Number(zending.aantal_colli ?? 0), expanded.length, 1)
  while (expanded.length < targetTotal) {
    expanded.push({ regel: expanded.at(-1)?.regel ?? null })
  }

  return expanded.slice(0, targetTotal).map((item, index) => ({
    ...item,
    index: index + 1,
    sscc: generateSscc(zending.id, index + 1),
  }))
}

export function ZendingPrintSetPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const { data: zending, isLoading, error } = useZendingPrintSet(zending_nr)
  const [printMode, setPrintMode] = useState<PrintMode>('all')

  useEffect(() => {
    const reset = () => setPrintMode('all')
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])

  const labels = useMemo(() => (zending ? expandLabels(zending) : []), [zending])
  const vervoerder = zending ? vervoerderInfo(zending) : null

  function print(mode: PrintMode) {
    setPrintMode(mode)
    window.setTimeout(() => window.print(), 50)
  }

  if (isLoading) {
    return (
      <div className="print:hidden">
        <PageHeader title="Verzendset laden..." />
        <div className="text-slate-400">Even geduld...</div>
      </div>
    )
  }

  if (error || !zending || !vervoerder) {
    return (
      <div className="print:hidden">
        <PageHeader title="Verzendset niet gevonden" />
        <div className="mb-4 text-sm text-rose-600">
          {error instanceof Error ? error.message : 'Onbekende fout'}
        </div>
        <Link to="/pick-ship" className="text-terracotta-500 hover:underline">
          Terug naar Pick & Ship
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Verzendset - ${zending.zending_nr}`}
          description={
            <span className="inline-flex items-center gap-2">
              Order {zending.orders.order_nr}
              <VervoerderTag code={vervoerder.code} showLeeg />
              {vervoerder.actief === false && (
                <span className="text-xs text-amber-600">vervoerder staat nog inactief</span>
              )}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/pick-ship"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                <ArrowLeft size={16} />
                Pick & Ship
              </Link>
              <button
                onClick={() => print('labels')}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Tags size={16} />
                Stickers printen
              </button>
              <button
                onClick={() => print('pakbon')}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <FileText size={16} />
                Pakbon printen
              </button>
              <button
                onClick={() => print('all')}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-600"
              >
                <Printer size={16} />
                Alles
              </button>
            </div>
          }
        />
      </div>

      <div className="zending-printset space-y-8" data-print-mode={printMode}>
        <div className="shipping-labels flex flex-col items-start gap-4">
          {labels.map((label) => (
            <ShippingLabel
              key={label.index}
              zending={zending}
              regel={label.regel}
              colliIndex={label.index}
              colliTotal={labels.length}
              vervoerderNaam={vervoerder.naam}
              sscc={label.sscc}
            />
          ))}
        </div>

        <PakbonDocument
          zending={zending}
          vervoerderNaam={vervoerder.naam}
          colliTotal={labels.length}
        />
      </div>

      <style>{`
        @media screen {
          .shipping-label,
          .pakbon-page {
            box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
          }
        }

        @media print {
          body * { visibility: hidden; }
          .zending-printset,
          .zending-printset * { visibility: visible; }
          .zending-printset {
            position: absolute;
            inset: 0 auto auto 0;
            background: white;
          }
          .zending-printset[data-print-mode="labels"] .pakbon-page {
            display: none;
          }
          .zending-printset[data-print-mode="pakbon"] .shipping-labels {
            display: none;
          }
          .shipping-label {
            page: shipping-label;
            break-after: page;
            margin: 0;
            border: 0;
          }
          .pakbon-page {
            page: pakbon;
            break-after: page;
            margin: 0;
            border: 0;
            box-shadow: none;
          }
          @page shipping-label {
            size: 105mm 60mm;
            margin: 0;
          }
          @page pakbon {
            size: A4;
            margin: 10mm;
          }
        }
      `}</style>
    </>
  )
}
