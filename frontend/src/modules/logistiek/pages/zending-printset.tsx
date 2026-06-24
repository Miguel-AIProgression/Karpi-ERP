import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Boxes, FileText, Tags } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PakbonDocument } from '@/modules/logistiek/components/pakbon-document'
import { ShippingLabel } from '@/modules/logistiek/components/shipping-label'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import { ColliPickVinkjes } from '@/modules/logistiek/components/colli-pick-vinkjes'
import { VoltooiPickrondeKnop } from '@/modules/logistiek/components/voltooi-pickronde-knop'
import { AnnuleerPickrondeKnop } from '@/modules/logistiek/components/annuleer-pickronde-knop'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { useZendingPrintSet } from '@/modules/logistiek/hooks/use-zendingen'
import { useZendingStickerData } from '@/modules/logistiek/hooks/use-zending-stickers'
import {
  TapijtStickersSectie,
  totaalAantalTapijtStickers,
} from '@/modules/logistiek/components/tapijt-stickers-sectie'
import { loadLastPicker, saveLastPicker } from '@/lib/orders/last-picker'
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  expandLabels,
  labelFormaatVoor,
  vervoerderInfoVoor,
} from '@/modules/logistiek/lib/printset'
import { isHandmatigAanmeldenVervoerder } from '@/modules/logistiek/lib/handmatig-aanmelden'
import { ColliBundelDialog } from '@/modules/logistiek/components/colli-bundel-dialog'

type PrintMode = 'all' | 'labels' | 'pakbon' | 'tapijt-stickers'

export function ZendingPrintSetPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Optioneel: herprint van één losse sticker via `?colli=<colli_nr>`. Zonder
  // filter toont de pagina álle verzendstickers (losse colli + bundel-rij; de
  // gebundelde kind-colli vallen weg via expandLabels). De bundel-sectie linkt
  // bewust zónder filter zodat de operator alle te verzenden stickers ziet.
  const colliFilter = searchParams.get('colli')
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
  // Mig 421: colli-bundel-pop-up tijdens de pickronde (Rhenus + ≥2 colli).
  const [bundelOpen, setBundelOpen] = useState(false)

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

  // Te printen labels: één per niet-gebundelde colli (`expandLabels` filtert de
  // gebundelde kind-colli al weg) plus de bundel-rij zelf.
  const alleLabels = useMemo(() => (zending ? expandLabels(zending) : []), [zending])
  // `?colli=` (bundelsticker apart printen) filtert WELKE labels we tonen.
  const labels = useMemo(
    () => (colliFilter ? alleLabels.filter((l) => String(l.colliNr) === colliFilter) : alleLabels),
    [alleLabels, colliFilter],
  )
  // "X VAN Y": een eenmaal geprint colli-label mag NOOIT van nummer wisselen —
  // de fysieke sticker op het tapijt blijft plakken (we overstickeren niet bij
  // bundelen). Daarom = X het opgeslagen `colli_nr` en Y het aantal ORIGINELE
  // colli (`is_bundel=false`), beide stabiel. Gevolg: de originelen behouden hun
  // nummer (bijv. "2 VAN 4") en de bundel is een EXTRA sticker bovenop dat aantal
  // ("5 VAN 4"). Legacy-zendingen zonder colli-registratie → val terug op het
  // aantal labels (colli_nr is daar de lopende index, dus nog steeds consistent).
  const origineelColliTotaal =
    (zending?.zending_colli ?? []).filter((c) => !c.is_bundel).length || alleLabels.length
  const vervoerder = zending ? vervoerderInfoVoor(zending) : null
  const labelFormaat = zending ? labelFormaatVoor(zending) : null
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

  // Mig 484: een Rhenus-zending wordt na voltooien AUTOMATISCH aangemeld in de
  // dagbatch om 16:00 (geen handmatige aanmeld-stap meer). isRhenus stuurt de
  // 16:00-copy voor élke Rhenus-zending; isRhenusBundel (>=2 niet-gebundelde colli)
  // voegt daar de bundelen-instructie aan toe. Tel niet-gebundelde colli (tijdens
  // 'Picken' bestaan er nog geen bundels, dus = het fysieke aantal).
  const losseColliAantal = (zending.zending_colli ?? []).filter(
    (c) => c.bundel_colli_id == null && !c.is_bundel,
  ).length
  const isRhenus = isHandmatigAanmeldenVervoerder(zending.vervoerder_code)
  const isRhenusBundel = isRhenus && losseColliAantal >= 2

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
              {heeftTapijtStickers && (
                <button
                  onClick={() => print('tapijt-stickers')}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Tags size={16} />
                  Tapijt-stickers
                </button>
              )}
            </div>
          }
        />

        {zending.status === 'Gepland' ? (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="mb-1 font-semibold">Deze deelzending is nog niet gestart</div>
            <p>
              De regels zijn alleen gereserveerd — er is nog niets gepickt en er zijn nog geen labels
              geprint. Ga naar{' '}
              <Link to="/pick-ship" className="font-medium underline hover:text-amber-900">
                Pick &amp; Ship
              </Link>
              {' '}(tab <strong>Picken starten</strong>) om de labels te printen en de pickronde echt te
              starten.
            </p>
          </div>
        ) : zending.status === 'Picken' ? (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="mb-2 font-semibold text-slate-800">Zo werk je deze zending af — 3 stappen</div>
            <ol className="space-y-2.5">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">1</span>
                <span>
                  <strong>Print de labels en de pakbon.</strong> Klik rechtsboven op{' '}
                  <strong>Stickers printen</strong> en <strong>Pakbon printen</strong> — elk gaat naar
                  zijn eigen printer. Plak op elke colli (elk pak / elke rol) het bijbehorende label.
                  <span className="mt-1 block rounded bg-white px-2 py-1.5 text-xs text-slate-500 ring-1 ring-slate-200">
                    Print-instellingen (venster Ctrl+P), anders breekt het label over 2 pagina's:
                    printer = <strong>Vervoerderslabels (Zebra)</strong> — of bij PDF papierformaat{' '}
                    <strong>Custom {(labelFormaat?.breedteMm ?? 76.2)}×{(labelFormaat?.hoogteMm ?? 50.8)} mm</strong>;
                    oriëntatie <strong>{(labelFormaat?.hoogteMm ?? 50.8) > (labelFormaat?.breedteMm ?? 76.2) ? 'staand' : 'liggend'}</strong>,
                    marges = <strong>Geen</strong>, schaal = <strong>100%</strong>.
                  </span>
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">2</span>
                <span>
                  <strong>Verzamel de colli en vink ze hieronder af.</strong> De vinkjes staan al aan —
                  laat ze aan voor wat je gevonden hebt. Kun je iets <em>niet</em> vinden? Zet dat colli
                  op <strong>Niet gevonden</strong>. Voltooien kan dan pas als de chef dat heeft opgelost.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">3</span>
                <span>
                  {isRhenus ? (
                    <>
                      <strong>Klik op de groene knop "Voltooi pickronde".</strong>{' '}
                      Een picker kiezen mag, maar hoeft niet. Deze <strong>Rhenus</strong>-zending wordt
                      automatisch in de <strong>dagbatch om 16:00</strong> aangemeld — je hoeft niet meer
                      handmatig aan te melden.
                      {isRhenusBundel ? (
                        <>
                          {' '}Na het voltooien ga je naar de zending-pagina, waar je tot 16:00 nog colli
                          kunt <strong>samenpakken (bundelen)</strong> onder één nieuwe sticker.
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <strong>Klik op de groene knop "Voltooi pickronde".</strong>{' '}
                      Een picker kiezen mag, maar hoeft niet. Daarna gaat alles vanzelf: de order wordt{' '}
                      <em>Verzonden</em>, de factuur volgt, en de
                      zending wordt automatisch bij de vervoerder aangemeld. Je hoeft hier verder niets te
                      doen — de track &amp; trace komt binnen zodra de vervoerder reageert.
                    </>
                  )}
                </span>
              </li>
            </ol>
          </div>
        ) : isRhenus && zending.status === 'Klaar voor verzending' ? (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-terracotta-200 bg-white px-4 py-3 text-sm text-slate-700">
            Deze <strong>Rhenus</strong>-zending is voltooid en wordt <strong>automatisch om 16:00</strong>{' '}
            in de dagbatch bij Rhenus aangemeld.
            {isRhenusBundel ? (
              <>
                {' '}Tot dan kun je nog colli samenpakken (bundelen) op de{' '}
                <Link
                  to={`/logistiek/${zending.zending_nr}`}
                  className="font-medium text-terracotta-700 underline hover:text-terracotta-800"
                >
                  zending-pagina
                </Link>
                .
              </>
            ) : null}{' '}
            Labels en pakbon kun je hier opnieuw printen.
          </div>
        ) : (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Deze zending is al voltooid en aangemeld bij de vervoerder (status{' '}
            <strong>{zending.status}</strong>). Je kunt hier alleen nog de labels of de pakbon
            opnieuw printen — afvinken en voltooien is niet meer nodig.
          </div>
        )}

        {zending.status === 'Picken' && (
          <div className="mb-4 space-y-3">
            <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Picker (optioneel)
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Wie verzamelt deze order? Optioneel — alleen voor de audit-trail. Default:
                degene die de pickronde startte. Mag gewijzigd worden bij shift-overgang.
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
            {/* Mig 421: Rhenus-zending met meerdere colli — pak colli samen in één zak
                onder één nieuwe sticker, al tijdens het verzamelen. */}
            {isRhenusBundel && (
              <div className="rounded-[var(--radius)] border border-terracotta-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">Colli bundelen (Rhenus)</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Pak meerdere colli samen in één zak onder één nieuwe sticker. De losse
                      stickers gooi je dan weg.
                    </p>
                  </div>
                  <button
                    onClick={() => setBundelOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-600 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-700"
                  >
                    <Boxes size={15} /> Colli bundelen
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => navigate('/pick-ship')}
                title="Terug naar het Pick & Ship-overzicht — de pickronde blijft gewoon open staan"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                <ArrowLeft size={16} />
                Terug uit pickronde
              </button>
              <VoltooiPickrondeKnop
                zendingId={zending.id}
                zendingStatus={zending.status}
                pickerId={pickerId}
                navigeerNaVoltooienNaar={
                  isRhenusBundel ? `/logistiek/${zending.zending_nr}` : undefined
                }
              />
            </div>
            {/* Correctie-actie (per ongeluk gestart), bewust subtiel en los van de
                hoofd-flow zodat hij niet met de navigatie-knop verward wordt. */}
            <div className="flex justify-end">
              <AnnuleerPickrondeKnop zendingId={zending.id} zendingStatus={zending.status} />
            </div>
          </div>
        )}

        {bundelOpen && isRhenusBundel && (
          <ColliBundelDialog
            zendingId={zending.id}
            zendingNr={zending.zending_nr}
            onClose={() => setBundelOpen(false)}
          />
        )}
      </div>

      <div
        className="zending-printset space-y-8"
        data-print-mode={printMode}
        data-include-tapijt-stickers={tapijtStickersMeeprinten ? 'true' : 'false'}
      >
        {/* Eén canonieke ShippingLabel voor álle vervoerders. De vroegere
            DPD-render (`vervoerders.type==='print'`) is verwijderd: er is geen
            actieve 'print'-vervoerder meer. Her-introduceren van een afwijkend
            labelformaat = een nieuwe adapter, niet een tak hier. */}
        <div className="shipping-labels flex flex-col items-start gap-4">
          {labels.map((label) => (
            <ShippingLabel
              key={label.index}
              zending={zending}
              regel={label.regel}
              colliIndex={label.colliNr}
              colliTotal={origineelColliTotaal}
              vervoerderNaam={vervoerder.naam}
              sscc={label.sscc}
              omschrijvingSnapshot={label.omschrijvingSnapshot}
              klantOmschrijvingSnapshot={label.klantOmschrijvingSnapshot}
              klanteigenNaamSnapshot={label.klanteigenNaamSnapshot}
              omstickerSnapshot={label.omstickerSnapshot}
              labelFormaat={labelFormaat ?? undefined}
            />
          ))}
        </div>

        <PakbonDocument
          zending={zending}
          vervoerderNaam={vervoerder.naam}
          colliTotal={origineelColliTotaal}
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
          /* Tapijt-stickers — 148x106mm, zelfde page-break-discipline als de
             maatwerk-bulk-pagina. Scoped via .tapijt-stickers zodat een
             eventuele andere .sticker-label-render geen page-rule erft.
             Page-break loopt PER .sticker-wrapper (StickerLayout-root) i.p.v.
             per .sticker-label, want die laatste zit diep in wrapper-divs. */
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
