import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, PackageCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import {
  useZending,
  useMarkeerZendingAfgehandeld,
  useMarkeerZendingAfgehaald,
} from '@/modules/logistiek/hooks/use-zendingen'
import { ZendingStatusBadge } from '@/modules/logistiek/components/zending-status-badge'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import {
  HstTransportorderCard,
  type HstTransportorderRow,
} from '@/modules/logistiek/components/hst-transportorder-card'
import { ColliBundelSectie } from '@/modules/logistiek/components/colli-bundel-sectie'
import { AnnuleerPickrondeKnop } from '@/modules/logistiek/components/annuleer-pickronde-knop'
import { wachtOpDagbatch, DAGBATCH_LABEL } from '@/modules/logistiek/lib/dagbatch-status'
import { labelBarcode } from '@/lib/logistiek/labelbarcode'

interface ZendingColliRow {
  id: number
  colli_nr: number
  sscc: string | null
  omschrijving_snapshot: string | null
  bundel_colli_id: number | null
  is_bundel: boolean
}

interface BundelOrder {
  id: number
  order_nr: string
  debiteur_nr: number
  debiteuren?: {
    debiteur_nr: number
    naam: string
  } | null
}

interface ZendingRegelRow {
  id: number
  order_regel_id: number | null
  artikelnr: string | null
  rol_id: number | null
  aantal: number
  order_regels?: {
    id: number
    order_id: number
    regelnummer: number | null
    artikelnr: string | null
    omschrijving: string | null
  } | null
}

interface ZendingDetailShape {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  opmerkingen: string | null
  created_at: string
  orders: BundelOrder
  zending_orders?: Array<{
    order_id: number
    bundel_order: BundelOrder | null
  }>
  zending_regels: ZendingRegelRow[]
  /** Mig 209: fysieke colli met SSCC-barcode. */
  zending_colli?: ZendingColliRow[]
  /** Mig 424 (ADR-0038): geconsolideerde verzend-wachtrij-rijen voor deze zending. */
  verzend_wachtrij: HstTransportorderRow[]
}

export function ZendingDetailPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const { data: zending, isLoading } = useZending(zending_nr)
  const afhandelMutation = useMarkeerZendingAfgehandeld()
  const afgehaaldMutation = useMarkeerZendingAfgehaald()

  if (isLoading) return <div className="p-8 text-slate-500">Laden…</div>
  if (!zending) return <div className="p-8 text-rose-600">Zending niet gevonden.</div>

  const z = zending as unknown as ZendingDetailShape

  // Mig 222: bundel-orders uit M2M `zending_orders`. Voor solo-zendingen zit
  // de primaire order ook in de M2M (backfill); fallback op `z.orders` als de
  // M2M leeg blijkt zodat oude rijen nog renderen.
  const bundelOrdersRaw = (z.zending_orders ?? [])
    .map((row) => row.bundel_order)
    .filter((o): o is BundelOrder => o != null)
  const bundelOrders: BundelOrder[] =
    bundelOrdersRaw.length > 0 ? bundelOrdersRaw : z.orders ? [z.orders] : []
  const bundelOrdersGesorteerd = [...bundelOrders].sort((a, b) =>
    a.order_nr.localeCompare(b.order_nr),
  )
  const isBundel = bundelOrdersGesorteerd.length > 1

  // Afhaal-zending: zonder vervoerder kan een 'Klaar voor verzending'-zending
  // alleen een afhaal-order zijn (carrier-orders krijgen altijd een vervoerder;
  // 'geen vervoerder' kan niet starten). Operator markeert 'm afgehaald zodra de
  // klant het ophaalt (mig 482-483).
  const isAfhaalKlaar = z.status === 'Klaar voor verzending' && !z.vervoerder_code

  // Spiegelt het overzicht: een dagbatch-zending (Rhenus 16:00) staat onder water
  // op 'Klaar voor verzending' maar toont 'Aangemeld' zodra hij in de wachtrij staat
  // (mig 484). De echte status blijft 'Klaar voor verzending' → bundelen kan nog.
  const wachtBatch = wachtOpDagbatch(z.status, z.verzend_wachtrij)

  // Colli met barcode, op colli_nr. De op het label gedrukte/aangemelde barcode
  // is labelBarcode(sscc) = AI(00) + SSCC (20 cijfers) — exact wat de vervoerder
  // in een manco-melding doorgeeft.
  const colli = [...(z.zending_colli ?? [])].sort((a, b) => a.colli_nr - b.colli_nr)

  // Groepeer regels op bron-order via order_regels.order_id. Onbekende order
  // (legacy of corrupte rij) komt onder een aparte sleutel `null`.
  const regelsPerOrder = new Map<number | null, ZendingRegelRow[]>()
  for (const r of z.zending_regels ?? []) {
    const orderId = r.order_regels?.order_id ?? null
    const bestaand = regelsPerOrder.get(orderId) ?? []
    bestaand.push(r)
    regelsPerOrder.set(orderId, bestaand)
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/logistiek"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> Terug naar zendingen
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {z.zending_nr}
            <ZendingStatusBadge status={z.status} label={wachtBatch ? DAGBATCH_LABEL : undefined} />
            <VervoerderTag code={z.vervoerder_code} showLeeg />
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {isAfhaalKlaar && (
              <button
                type="button"
                onClick={() => afgehaaldMutation.mutate(z.id)}
                disabled={afgehaaldMutation.isPending}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                <PackageCheck size={16} />
                {afgehaaldMutation.isPending ? 'Bezig…' : 'Markeer als afgehaald'}
              </button>
            )}
            <Link
              to={`/logistiek/${z.zending_nr}/printset`}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              <Printer size={16} />
              Verzendset printen
            </Link>
          </div>
        }
        description={
          bundelOrdersGesorteerd.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <span>{isBundel ? `Bundel van ${bundelOrdersGesorteerd.length} orders:` : 'Order'}</span>
              {bundelOrdersGesorteerd.map((o, i) => (
                <span key={o.id} className="inline-flex items-center">
                  <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                    {o.order_nr}
                  </Link>
                  {i < bundelOrdersGesorteerd.length - 1 ? <span>,</span> : null}
                </span>
              ))}
            </span>
          ) : null
        }
      />

      {afgehaaldMutation.isError && (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Afgehaald markeren mislukt: {String((afgehaaldMutation.error as Error).message)}
        </div>
      )}

      {/* Sectie 1 — zending-info */}
      <Section titel="Zending">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Field label="Verzenddatum">{z.verzenddatum ?? '—'}</Field>
          <Field label="Aantal colli">{z.aantal_colli ?? '—'}</Field>
          <Field label="Gewicht">{z.totaal_gewicht_kg != null ? `${z.totaal_gewicht_kg} kg` : '—'}</Field>
          <Field label="Track & Trace">
            <span className="font-mono text-xs">{z.track_trace ?? '—'}</span>
          </Field>
          <Field label="Afleveradres">
            {z.afl_naam}<br />
            {z.afl_adres}<br />
            {z.afl_postcode} {z.afl_plaats}{z.afl_land ? `, ${z.afl_land}` : ''}
          </Field>
          {z.opmerkingen && (
            <Field label="Opmerkingen">
              <span className="whitespace-pre-wrap">{z.opmerkingen}</span>
            </Field>
          )}
        </div>
        {/* Correctie-actie (per ongeluk gestart), bewust subtiel — zelfde knop
            als op de printset-pagina, hier ook bereikbaar zonder eerst door te
            klikken naar "Verzendset printen". */}
        <div className="mt-4 flex justify-end">
          <AnnuleerPickrondeKnop zendingId={z.id} zendingStatus={z.status} />
        </div>
      </Section>

      {/* Colli-bundeling (mig 418) — alleen Rhenus + 'Klaar voor verzending' + >=2 colli. */}
      <ColliBundelSectie
        zendingId={z.id}
        zendingNr={z.zending_nr}
        vervoerderCode={z.vervoerder_code}
        status={z.status}
        aantalColli={z.aantal_colli}
      />

      {/* Sectie 2 — order-koppeling (mig 222: kan een bundel zijn). */}
      <Section titel={isBundel ? `Orders (${bundelOrdersGesorteerd.length})` : 'Order'}>
        {bundelOrdersGesorteerd.length === 0 ? (
          <div className="text-sm text-slate-400">Geen order gekoppeld.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ordernummer</th>
                <th className="px-3 py-2 text-left font-medium">Klant</th>
                <th className="px-3 py-2 text-left font-medium">Debiteur-nr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bundelOrdersGesorteerd.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2">
                    <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                      {o.order_nr}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/klanten/${o.debiteur_nr}`} className="text-terracotta-600 hover:underline">
                      {o.debiteuren?.naam ?? `#${o.debiteur_nr}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{o.debiteur_nr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Barcodes — de SSCC-labelbarcode per collo. Hiermee koppelt de operator
          een door de vervoerder gemelde barcode (manco) aan dit karpet. */}
      <Section titel={`Barcodes (${colli.length})`}>
        {colli.length === 0 ? (
          <div className="text-sm text-slate-400">
            Nog geen colli geregistreerd. Barcodes verschijnen zodra de pickronde is afgerond.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-16">Colli</th>
                <th className="px-3 py-2 text-left font-medium">Barcode</th>
                <th className="px-3 py-2 text-left font-medium">Omschrijving</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {colli.map((c) => (
                <tr key={c.id} className={c.bundel_colli_id != null ? 'text-slate-400' : undefined}>
                  <td className="px-3 py-2 text-slate-700">
                    {c.colli_nr}
                    {c.is_bundel && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">
                        bundel
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-800 select-all">
                    {labelBarcode(c.sscc) ?? <span className="text-slate-400">—</span>}
                    {c.bundel_colli_id != null && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                        in bundel
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{c.omschrijving_snapshot ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Sectie 3 — regels, gegroepeerd per bron-order bij bundels. */}
      <Section titel={`Zending-regels (${z.zending_regels?.length ?? 0})`}>
        {!z.zending_regels || z.zending_regels.length === 0 ? (
          <div className="text-sm text-slate-400">Geen regels.</div>
        ) : (
          <div className="space-y-4">
            {bundelOrdersGesorteerd.map((o) => {
              const regels = regelsPerOrder.get(o.id) ?? []
              if (regels.length === 0 && !isBundel) {
                // Solo-zending zonder order-match — val terug op alle regels.
                return (
                  <RegelTabel key={o.id} titel={null} regels={z.zending_regels} />
                )
              }
              if (regels.length === 0) return null
              return (
                <div key={o.id}>
                  {isBundel && (
                    <div className="text-xs font-semibold text-slate-600 mb-1.5">
                      <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                        {o.order_nr}
                      </Link>
                    </div>
                  )}
                  <RegelTabel titel={null} regels={regels} />
                </div>
              )
            })}
            {(() => {
              const wezen = regelsPerOrder.get(null) ?? []
              if (wezen.length === 0) return null
              return (
                <div>
                  <div className="text-xs font-semibold text-amber-600 mb-1.5">
                    Regels zonder bron-order
                  </div>
                  <RegelTabel titel={null} regels={wezen} />
                </div>
              )
            })()}
          </div>
        )}
      </Section>

      {/* Sectie 4 — transportorders-historie (mig 424: geconsolideerde verzend_wachtrij) */}
      <Section titel={`Transportorders (${z.verzend_wachtrij?.length ?? 0})`}>
        {!z.verzend_wachtrij || z.verzend_wachtrij.length === 0 ? (
          <div className="text-sm text-slate-400">
            Nog geen transportorder. Wordt automatisch aangemaakt door de trigger zodra de
            klant een vervoerder heeft.
          </div>
        ) : (
          <div className="space-y-4">
            {z.verzend_wachtrij.map((t) => (
              <HstTransportorderCard
                key={t.id}
                row={t}
                onAfgehandeld={() => afhandelMutation.mutate({ id: t.id, externRef: t.extern_referentie, vervoerderCode: z.vervoerder_code })}
                afhandelBusy={afhandelMutation.isPending && afhandelMutation.variables?.id === t.id}
              />
            ))}
          </div>
        )}
        {afhandelMutation.isError && (
          <div className="mt-3 text-xs text-rose-600">
            Afhandelen mislukt: {String((afhandelMutation.error as Error).message)}
          </div>
        )}
      </Section>
    </>
  )
}

function RegelTabel({
  titel,
  regels,
}: {
  titel: string | null
  regels: ZendingRegelRow[]
}) {
  return (
    <div>
      {titel && <div className="text-xs font-semibold text-slate-600 mb-1.5">{titel}</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-right font-medium w-20">Aantal</th>
            <th className="px-3 py-2 text-left font-medium">Artikelnr</th>
            <th className="px-3 py-2 text-left font-medium">Omschrijving</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {regels.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-right text-slate-700">{r.aantal}</td>
              <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                {r.artikelnr ?? r.order_regels?.artikelnr ?? '—'}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {r.order_regels?.omschrijving ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{titel}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  )
}
