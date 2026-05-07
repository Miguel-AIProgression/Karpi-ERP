// Bulk-printset-pagina: rendert N zendingen achter elkaar zodat één klik op
// "Print" het hele stapeltje in de browser-printdialog produceert. Wordt
// aangeroepen door <BulkVerzendsetButton> via querystring `?zendingen=Z1,Z2`.
//
// Per zending krijg je dezelfde labels + pakbon als op de single-zending
// printset-pagina (gedeelde helpers in `lib/printset.ts`). Het label-formaat
// voor `@page shipping-label` pakken we van de eerste zending — in de praktijk
// gebruikt één klant-cluster of één land vrijwel altijd dezelfde vervoerder,
// en dus hetzelfde label-formaat.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText, Printer, Tags } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PakbonDocument } from '@/modules/logistiek/components/pakbon-document'
import { ShippingLabel } from '@/modules/logistiek/components/shipping-label'
import { DpdShippingLabel } from '@/modules/logistiek/components/dpd-shipping-label'
import { useZendingPrintSets } from '@/modules/logistiek/hooks/use-zendingen'
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  expandLabels,
  labelFormaatVoor,
  vervoerderInfoVoor,
} from '@/modules/logistiek/lib/printset'
import type { ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

type PrintMode = 'all' | 'labels' | 'pakbon'

function parseZendingNrs(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface ZendingBlokProps {
  zending: ZendingPrintSet
}

function ZendingBlok({ zending }: ZendingBlokProps) {
  const labels = useMemo(() => expandLabels(zending), [zending])
  const vervoerder = vervoerderInfoVoor(zending)
  const isPrintType = zending.vervoerders?.type === 'print'
  // Afhaal-zendingen krijgen geen sticker — alleen een pakbon. We gebruiken
  // de orders.afhalen-flag direct (bron-van-waarheid) en niet bv. de
  // vervoerder-aan/afwezigheid, zodat dit ook werkt als er ooit een
  // 'AFHAAL'-vervoerder ingevoerd zou worden.
  const isAfhaal = zending.orders.afhalen === true
  const subLabel = isAfhaal
    ? `Order ${zending.orders.order_nr} · ${labels.length} colli · Afhalen`
    : `Order ${zending.orders.order_nr} · ${labels.length} colli · ${vervoerder.naam}`

  return (
    <article className="space-y-8" data-zending-nr={zending.zending_nr}>
      <header className="print:hidden flex items-center justify-between border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {zending.zending_nr}
            {isAfhaal && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 align-middle">
                Afhalen — geen sticker
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-500">{subLabel}</p>
        </div>
        <Link
          to={`/logistiek/${zending.zending_nr}/printset`}
          className="text-sm text-terracotta-500 hover:underline"
        >
          Open los
        </Link>
      </header>

      {!isAfhaal && (
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
      )}

      <PakbonDocument
        zending={zending}
        vervoerderNaam={isAfhaal ? 'Afhalen' : vervoerder.naam}
        colliTotal={labels.length}
      />
    </article>
  )
}

export function BulkPrintSetPage() {
  const [params] = useSearchParams()
  const zendingNrs = useMemo(() => parseZendingNrs(params.get('zendingen')), [params])
  const { data: zendingen, isLoading, hasError, errors } = useZendingPrintSets(zendingNrs)
  const [printMode, setPrintMode] = useState<PrintMode>('all')

  useEffect(() => {
    const reset = () => setPrintMode('all')
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])

  // Label-formaat van de eerste verzend-zending (afhaal heeft geen sticker
  // dus geen formaat). Fallback op default als de bundel puur afhaal is.
  const eersteVerzend = zendingen.find((z) => z.orders.afhalen !== true)
  const labelFormaat = eersteVerzend ? labelFormaatVoor(eersteVerzend) : null
  const verzendZendingen = zendingen.filter((z) => z.orders.afhalen !== true)
  const afhaalZendingen = zendingen.filter((z) => z.orders.afhalen === true)
  const totaalColli = useMemo(
    () => verzendZendingen.reduce((s, z) => s + expandLabels(z).length, 0),
    [verzendZendingen],
  )

  function print(mode: PrintMode) {
    setPrintMode(mode)
    window.setTimeout(() => window.print(), 50)
  }

  if (zendingNrs.length === 0) {
    return (
      <div className="print:hidden">
        <PageHeader title="Bulk-verzendset" />
        <div className="mb-4 text-sm text-rose-600">
          Geen zending-nummers in de URL — open de bulk-print via Pick & Ship.
        </div>
        <Link to="/pick-ship" className="text-terracotta-500 hover:underline">
          Terug naar Pick & Ship
        </Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="print:hidden">
        <PageHeader title={`Bulk-verzendset (${zendingNrs.length})`} />
        <div className="text-slate-400">Verzendsets laden...</div>
      </div>
    )
  }

  if (zendingen.length === 0) {
    return (
      <div className="print:hidden">
        <PageHeader title="Bulk-verzendset" />
        <div className="mb-4 text-sm text-rose-600">
          Geen zendingen gevonden voor: {zendingNrs.join(', ')}
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
          title={`Bulk-verzendset (${zendingen.length} zending${zendingen.length === 1 ? '' : 'en'})`}
          description={
            afhaalZendingen.length > 0
              ? `${verzendZendingen.length} verzend (${totaalColli} colli) + ${afhaalZendingen.length} afhalen — alles in één print-job`
              : `${totaalColli} colli totaal · alles in één print-job`
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
                Pakbonnen printen
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

        {hasError && (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {errors.length} van {zendingNrs.length} zending(en) kon niet geladen worden — alleen succesvol geladen worden geprint.
          </div>
        )}
      </div>

      <div className="zending-printset space-y-12" data-print-mode={printMode}>
        {zendingen.map((z) => (
          <ZendingBlok key={z.id} zending={z} />
        ))}
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
