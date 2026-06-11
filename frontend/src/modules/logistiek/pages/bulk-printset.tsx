// Bulk-printset-pagina: rendert N zendingen achter elkaar zodat één klik op
// "Print" het hele stapeltje in de browser-printdialog produceert. Wordt
// aangeroepen door <StartPickrondesButton> via querystring `?zendingen=Z1,Z2`.
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
import { useZendingStickerDataBulk } from '@/modules/logistiek/hooks/use-zending-stickers'
import {
  TapijtStickersSectie,
  totaalAantalTapijtStickers,
} from '@/modules/logistiek/components/tapijt-stickers-sectie'
import type { ZendingRegelStickerData } from '@/modules/logistiek/queries/zending-stickers'
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  expandLabels,
  labelFormaatVoor,
  vervoerderInfoVoor,
} from '@/modules/logistiek/lib/printset'
import type { ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

type PrintMode = 'all' | 'labels' | 'pakbon' | 'tapijt-stickers'

function parseZendingNrs(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface ZendingBlokProps {
  zending: ZendingPrintSet
  tapijtStickers: ZendingRegelStickerData[]
}

function ZendingBlok({ zending, tapijtStickers }: ZendingBlokProps) {
  const labels = useMemo(() => expandLabels(zending), [zending])
  const vervoerder = vervoerderInfoVoor(zending)
  const labelFormaat = useMemo(() => labelFormaatVoor(zending), [zending])
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
                labelFormaat={labelFormaat}
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

      {/* Mig 303: tapijt-stickers per zending (alleen niet-maatwerk regels).
          Verbergen / tonen via parent-CSS op `.zending-printset[data-include-
          tapijt-stickers="false"]` zodat de operator de checkbox per print
          kan flippen zonder re-render. */}
      <TapijtStickersSectie stickers={tapijtStickers} />
    </article>
  )
}

export function BulkPrintSetPage() {
  const [params] = useSearchParams()
  const zendingNrs = useMemo(() => parseZendingNrs(params.get('zendingen')), [params])
  const { data: zendingen, isLoading, hasError, errors } = useZendingPrintSets(zendingNrs)
  const zendingIds = useMemo(() => zendingen.map((z) => z.id), [zendingen])
  const { data: tapijtStickersAll = [] } = useZendingStickerDataBulk(zendingIds)
  const tapijtStickersByZending = useMemo(() => {
    const map = new Map<number, ZendingRegelStickerData[]>()
    for (const s of tapijtStickersAll) {
      const arr = map.get(s.zending_id) ?? []
      arr.push(s)
      map.set(s.zending_id, arr)
    }
    return map
  }, [tapijtStickersAll])
  const aantalTapijtStickers = totaalAantalTapijtStickers(tapijtStickersAll)
  const heeftTapijtStickers = aantalTapijtStickers > 0

  // Default uit klant-voorkeur: TRUE als min. 1 zending uit een klant komt
  // die de voorkeur aan heeft staan. null = nog niet geïnitialiseerd.
  const [includeTapijtStickers, setIncludeTapijtStickers] = useState<boolean | null>(null)
  useEffect(() => {
    if (includeTapijtStickers === null && zendingen.length > 0) {
      const anyOpt = zendingen.some(
        (z) => z.orders.debiteuren?.tapijt_sticker_bij_standaard === true,
      )
      setIncludeTapijtStickers(anyOpt)
    }
  }, [zendingen, includeTapijtStickers])
  const tapijtStickersMeeprinten = includeTapijtStickers === true && heeftTapijtStickers

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
                Pakbonnen printen
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

        {hasError && (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {errors.length} van {zendingNrs.length} zending(en) kon niet geladen worden — alleen succesvol geladen worden geprint.
          </div>
        )}
      </div>

      <div
        className="zending-printset space-y-12"
        data-print-mode={printMode}
        data-include-tapijt-stickers={tapijtStickersMeeprinten ? 'true' : 'false'}
      >
        {zendingen.map((z) => (
          <ZendingBlok
            key={z.id}
            zending={z}
            tapijtStickers={tapijtStickersByZending.get(z.id) ?? []}
          />
        ))}
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
          /* Lege vervolg-pagina's voorkomen: de app-layout (min-h-screen +
             main-marges) is in print onzichtbaar maar neemt wél ruimte in,
             waardoor de Zebra een leeg etiket uitvoert. */
          html, body { height: auto !important; }
          .min-h-screen { min-height: 0 !important; }
          main { margin: 0 !important; padding: 0 !important; }
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
          /* Tapijt-stickers — page-break per .sticker-wrapper (StickerLayout-
             root), niet per .sticker-label (die zit diep in wrappers). Belt-
             and-suspenders display:none op de screen-only sub-titel-span,
             want anders kost die 5mm extra wrapper-hoogte → 106mm @page-
             overflow → blanco vervolgpagina per sticker. */
          .tapijt-stickers { gap: 0 !important; }
          .tapijt-stickers .sticker-wrapper > span {
            display: none !important;
          }
          /* page: MOET ook op .sticker-wrapper (de box met de forced
             break) — stond hij alleen op het geneste .sticker-label, dan
             wisselt de page-naam (default ↔ tapijt-sticker) bij elke
             wrapper-grens en injecteert Chromium een blanco tussenpagina. */
          .tapijt-stickers .sticker-wrapper {
            page: tapijt-sticker;
            margin: 0 !important;
            padding: 0 !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .tapijt-stickers .sticker-wrapper:not(:last-child) {
            break-after: page !important;
            page-break-after: always !important;
          }
          /* 2mm kleiner dan de 148x106-page: een exact passende sticker
             overflowt bij sub-pixel-afronding of een onbedrukbare
             printerrand → blanco vervolgpagina per sticker. Onderkant van
             de sticker is witruimte, dus visueel geen verschil. */
          .tapijt-stickers .sticker-label {
            page: tapijt-sticker;
            width: 146mm !important;
            height: 104mm !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin: 0 !important;
            border: 0 !important;
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
