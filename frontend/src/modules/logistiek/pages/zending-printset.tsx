import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Printer, Tags } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PakbonDocument } from '@/modules/logistiek/components/pakbon-document'
import { ShippingLabel } from '@/modules/logistiek/components/shipping-label'
import { DpdShippingLabel } from '@/modules/logistiek/components/dpd-shipping-label'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import { ColliPickVinkjes } from '@/modules/logistiek/components/colli-pick-vinkjes'
import { VoltooiPickrondeKnop } from '@/modules/logistiek/components/voltooi-pickronde-knop'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { useZendingPrintSet } from '@/modules/logistiek/hooks/use-zendingen'

const LAST_PICKER_KEY = 'rugflow.last-picker-id'

function loadLastPicker(): number | null {
  try {
    const v = localStorage.getItem(LAST_PICKER_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function saveLastPicker(id: number) {
  try {
    localStorage.setItem(LAST_PICKER_KEY, String(id))
  } catch {
    /* ignore */
  }
}
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  expandLabels,
  labelFormaatVoor,
  vervoerderInfoVoor,
} from '@/modules/logistiek/lib/printset'

type PrintMode = 'all' | 'labels' | 'pakbon'

export function ZendingPrintSetPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const { data: zending, isLoading, error } = useZendingPrintSet(zending_nr)
  const [printMode, setPrintMode] = useState<PrintMode>('all')
  // Picker-state: gestart door deze persoon. Pre-fill: zending.picker_id (van
  // start_pickronde) → localStorage last-picker → null. Operator kan wisselen
  // bij shift-overgang. Wordt gepersisteerd zodra hij voltooi/markeer doet.
  const [pickerId, setPickerId] = useState<number | null>(null)

  useEffect(() => {
    const reset = () => setPrintMode('all')
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])

  useEffect(() => {
    if (zending && pickerId === null) {
      const fromZending = (zending as unknown as { picker_id: number | null }).picker_id ?? null
      setPickerId(fromZending ?? loadLastPicker())
    }
  }, [zending, pickerId])

  useEffect(() => {
    if (pickerId) saveLastPicker(pickerId)
  }, [pickerId])

  const labels = useMemo(() => (zending ? expandLabels(zending) : []), [zending])
  const vervoerder = zending ? vervoerderInfoVoor(zending) : null
  const labelFormaat = zending ? labelFormaatVoor(zending) : null
  const isPrintType = zending?.vervoerders?.type === 'print'

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

        {zending.status === 'Picken' && (
          <div className="mb-4 space-y-3">
            <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Picker (verplicht voor voltooi + niet-gevonden audit)
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Wie verzamelt deze order? Default: degene die de pickronde startte.
                Mag gewijzigd worden bij shift-overgang.
              </p>
              <PickerDropdown
                value={pickerId}
                onChange={setPickerId}
                placeholder="Kies picker…"
              />
            </div>
            <ColliPickVinkjes
              zendingId={zending.id}
              leverModus={
                (zending.orders.lever_modus as 'deelleveringen' | 'in_een_keer' | null) ?? null
              }
              pickerId={pickerId}
            />
            <div className="flex justify-end">
              <VoltooiPickrondeKnop
                zendingId={zending.id}
                zendingStatus={zending.status}
                pickerId={pickerId}
              />
            </div>
          </div>
        )}
      </div>

      <div className="zending-printset space-y-8" data-print-mode={printMode}>
        <div className="shipping-labels flex flex-col items-start gap-4">
          {labels.map((label) =>
            isPrintType ? (
              <DpdShippingLabel
                key={label.index}
                zending={zending}
                regel={label.regel}
                colliIndex={label.index}
                colliTotal={labels.length}
                serviceCode={zending.service_code}
                sscc={label.sscc}
              />
            ) : (
              <ShippingLabel
                key={label.index}
                zending={zending}
                regel={label.regel}
                colliIndex={label.index}
                colliTotal={labels.length}
                vervoerderNaam={vervoerder.naam}
                sscc={label.sscc}
              />
            ),
          )}
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
            size: ${labelFormaat?.breedteMm ?? DEFAULT_LABEL_BREEDTE_MM}mm ${labelFormaat?.hoogteMm ?? DEFAULT_LABEL_HOOGTE_MM}mm;
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
