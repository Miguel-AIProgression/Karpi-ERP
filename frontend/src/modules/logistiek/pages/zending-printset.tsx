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
import { useZendingStickerData } from '@/modules/logistiek/hooks/use-zending-stickers'
import {
  TapijtStickersSectie,
  totaalAantalTapijtStickers,
} from '@/modules/logistiek/components/tapijt-stickers-sectie'

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

type PrintMode = 'all' | 'labels' | 'pakbon' | 'tapijt-stickers'

export function ZendingPrintSetPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const { data: zending, isLoading, error } = useZendingPrintSet(zending_nr)
  const { data: tapijtStickers = [] } = useZendingStickerData(zending?.id)
  const [printMode, setPrintMode] = useState<PrintMode>('all')
  // Mig 303: klant-voorkeur bepaalt of "Alles" ook tapijt-stickers print.
  // Operator kan dit per-print overrijden via de checkbox in de actions-balk.
  // null = nog niet geïnitialiseerd (wachten op zending-data).
  const [includeTapijtStickers, setIncludeTapijtStickers] = useState<boolean | null>(null)
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

  // Default-pre-fill voor de tapijt-sticker-checkbox uit de klant-voorkeur.
  useEffect(() => {
    if (zending && includeTapijtStickers === null) {
      setIncludeTapijtStickers(
        zending.orders.debiteuren?.tapijt_sticker_bij_standaard === true,
      )
    }
  }, [zending, includeTapijtStickers])

  const labels = useMemo(() => (zending ? expandLabels(zending) : []), [zending])
  const vervoerder = zending ? vervoerderInfoVoor(zending) : null
  const labelFormaat = zending ? labelFormaatVoor(zending) : null
  const isPrintType = zending?.vervoerders?.type === 'print'
  const aantalTapijtStickers = totaalAantalTapijtStickers(tapijtStickers)
  const heeftTapijtStickers = aantalTapijtStickers > 0
  const tapijtStickersMeeprinten = includeTapijtStickers === true && heeftTapijtStickers

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
              {heeftTapijtStickers && (
                <label className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeTapijtStickers === true}
                    onChange={(e) => setIncludeTapijtStickers(e.target.checked)}
                    className="accent-terracotta-500"
                  />
                  Tapijt-stickers meeprinten ({aantalTapijtStickers})
                </label>
              )}
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
              {heeftTapijtStickers && (
                <button
                  onClick={() => print('tapijt-stickers')}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Tags size={16} />
                  Tapijt-stickers
                </button>
              )}
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

        <div className="mb-4 rounded-[var(--radius-sm)] border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">⚠️ In de print-dialoog (Ctrl+P) — anders breekt het label over 2 pagina's:</div>
          <ul className="ml-5 list-disc space-y-0.5 text-xs">
            <li>
              <strong>Printer:</strong> Vervoerderslabels (Zebra) — of bij PDF-export: <strong>papierformaat = Custom {(labelFormaat?.breedteMm ?? 76.2)}×{(labelFormaat?.hoogteMm ?? 50.8)} mm</strong>
            </li>
            <li>
              <strong>Marges = Geen</strong> (onder "Meer instellingen")
            </li>
            <li>
              <strong>Schaal = 100% / Ware grootte</strong>
            </li>
          </ul>
        </div>

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

      <div
        className="zending-printset space-y-8"
        data-print-mode={printMode}
        data-include-tapijt-stickers={tapijtStickersMeeprinten ? 'true' : 'false'}
      >
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
                labelFormaat={labelFormaat ?? undefined}
              />
            ),
          )}
        </div>

        <PakbonDocument
          zending={zending}
          vervoerderNaam={vervoerder.naam}
          colliTotal={labels.length}
        />

        {/* Mig 303: optionele tapijt-stickers voor standaard-artikelen.
            Altijd in DOM zodat de checkbox + CSS-rules zonder re-render
            kunnen schakelen tussen 'alles met sticker' / 'alles zonder'. */}
        <TapijtStickersSectie stickers={tapijtStickers} />
      </div>

      <style>{`
        @media screen {
          .shipping-label,
          .pakbon-page {
            box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
          }
          .tapijt-stickers .sticker-label {
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
          .zending-printset[data-print-mode="labels"] .pakbon-page,
          .zending-printset[data-print-mode="labels"] .tapijt-stickers {
            display: none;
          }
          .zending-printset[data-print-mode="pakbon"] .shipping-labels,
          .zending-printset[data-print-mode="pakbon"] .tapijt-stickers {
            display: none;
          }
          .zending-printset[data-print-mode="tapijt-stickers"] .shipping-labels,
          .zending-printset[data-print-mode="tapijt-stickers"] .pakbon-page {
            display: none;
          }
          /* In 'all'-modus alleen tapijt-stickers tonen als de checkbox aan
             staat. Klant zonder voorkeur → checkbox uit → sectie verborgen. */
          .zending-printset[data-print-mode="all"][data-include-tapijt-stickers="false"] .tapijt-stickers {
            display: none;
          }
          .shipping-labels { gap: 0 !important; }
          .shipping-label {
            page: shipping-label;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            display: block !important;
          }
          /* Page-break TUSSEN labels, niet ná het laatste — anders ontstaat
             een lege vervolgpagina op de Zebra-rol. */
          .shipping-label + .shipping-label {
            break-before: page !important;
            page-break-before: always !important;
          }
          .shipping-label * {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .pakbon-page {
            page: pakbon;
            break-after: page;
            margin: 0;
            border: 0;
            box-shadow: none;
          }
          /* Tapijt-stickers — 148×106mm, zelfde page-break-discipline als de
             maatwerk-bulk-pagina. Scoped via .tapijt-stickers zodat een
             eventuele andere .sticker-label-render geen page-rule erft. */
          .tapijt-stickers { gap: 0 !important; }
          .tapijt-stickers .sticker-label {
            page: tapijt-sticker;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin: 0 !important;
            border: 0 !important;
          }
          .tapijt-stickers .sticker-label + .sticker-label {
            break-before: page !important;
            page-break-before: always !important;
          }
          @page shipping-label {
            size: ${labelFormaat?.breedteMm ?? DEFAULT_LABEL_BREEDTE_MM}mm ${labelFormaat?.hoogteMm ?? DEFAULT_LABEL_HOOGTE_MM}mm;
            margin: 0;
          }
          @page pakbon {
            size: A4;
            margin: 10mm;
          }
          @page tapijt-sticker {
            size: 148mm 106mm;
            margin: 0;
          }
        }
      `}</style>
    </>
  )
}
