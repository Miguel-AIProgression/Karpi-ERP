import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PackageX, RotateCcw, XCircle, ExternalLink } from 'lucide-react'
import { useMancoNietLeverbaar, useMancoRegels, useMancoTerugNaarPickship } from '../hooks/use-manco'
import type { MancoRegel } from '../queries/manco'

// Manco-werklijst (mig 516): regel-niveau. Toont orderregels die tijdens een
// Pickronde niet gevonden zijn. De binnendienst onderzoekt fysiek en kiest per
// regel: "Weer beschikbaar" (terug in Pick & Ship) of "Niet leverbaar" (voorraad
// corrigeren + NL → blijft backorder / DE → afsluiten). De claim staat tot dan
// bevroren op de voorraad (geen herverkoop).

function LandBadge({ land }: { land: string | null }) {
  const isNl = land === 'NL'
  const label = land ?? '??'
  return (
    <span
      className={
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ' +
        (isNl ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800')
      }
      title={isNl ? 'Nederland — blijft op backorder, komt terug zodra weer op voorraad' : 'Buitenland — binnendienst stemt af met de klant'}
    >
      {label}
    </span>
  )
}

export function MancoTab() {
  const { data: regels = [], isLoading } = useMancoRegels()
  const terug = useMancoTerugNaarPickship()
  const nietLeverbaar = useMancoNietLeverbaar()
  const [dialoog, setDialoog] = useState<MancoRegel | null>(null)
  const [corrigeerVoorraad, setCorrigeerVoorraad] = useState(false)
  const [reden, setReden] = useState('')

  function openDialoog(r: MancoRegel) {
    setDialoog(r)
    setCorrigeerVoorraad(false)
    setReden('')
  }

  if (isLoading) return <div className="text-sm text-slate-500">Manco-werklijst laden…</div>
  if (regels.length === 0)
    return (
      <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        <PackageX className="mx-auto mb-2 text-slate-300" size={28} />
        Geen openstaande manco's. Alles wat tijdens het picken niet gevonden werd verschijnt hier.
      </div>
    )

  const isNl = dialoog?.land === 'NL'

  return (
    <div className="space-y-2">
      {regels.map((r) => (
        <div
          key={r.order_regel_id}
          className="flex items-center gap-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50/50 px-4 py-3"
        >
          <PackageX size={18} className="shrink-0 text-amber-600" />
          <Link
            to={`/orders/${r.order_id}`}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-800 hover:underline"
          >
            {r.order_nr}
            <ExternalLink size={11} />
          </Link>
          <LandBadge land={r.land} />
          {r.klant_naam && <span className="shrink-0 text-sm text-slate-600">· {r.klant_naam}</span>}
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
            {r.omschrijving ?? '—'}
          </span>
          {r.pick_backorder_reden && (
            <span className="shrink-0 text-xs text-rose-600">⚠ {r.pick_backorder_reden}</span>
          )}
          <button
            onClick={() => terug.mutate({ orderRegelId: r.order_regel_id })}
            disabled={terug.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            title="Toch gevonden / weer op voorraad → terug naar Pick & Ship"
          >
            <RotateCcw size={13} /> Weer beschikbaar
          </button>
          <button
            onClick={() => openDialoog(r)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            <XCircle size={13} /> Niet leverbaar
          </button>
        </div>
      ))}

      {dialoog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <h3 className="mb-1 text-lg font-semibold">Niet leverbaar — {dialoog.order_nr}</h3>
            <p className="mb-3 text-sm text-slate-600">
              {isNl ? (
                <>
                  <strong>Nederland:</strong> de regel blijft als backorder op deze order staan en
                  duikt automatisch weer op in Pick &amp; Ship zodra het artikel weer op voorraad is.
                </>
              ) : (
                <>
                  <strong>Buitenland ({dialoog.land ?? '?'}):</strong> de regel wordt op deze order
                  afgesloten. De binnendienst stemt met de klant af of er een nieuwe order komt of dat
                  het product niet meer verzonden hoeft te worden.
                </>
              )}
            </p>

            <label className="mb-3 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
              <input
                type="checkbox"
                checked={corrigeerVoorraad}
                onChange={(e) => setCorrigeerVoorraad(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Ligt fysiek <strong>niet meer</strong> in het magazijn — corrigeer de voorraadtelling.
                <span className="mt-0.5 block text-xs text-slate-500">
                  Aanvinken alleen als het stuk echt weg is. Anders blijft de telling staan (bv. de
                  klant wil het niet meer, maar het product ligt er nog).
                </span>
              </span>
            </label>

            {!isNl && (
              <select
                value={reden}
                onChange={(e) => setReden(e.target.value)}
                className="mb-3 w-full rounded border border-slate-200 p-2 text-sm"
              >
                <option value="">Reden (binnendienst)…</option>
                <option value="nieuwe_order_gemaakt">Nieuwe order gemaakt voor de klant</option>
                <option value="niet_verzenden">Hoeft niet meer verzonden te worden</option>
              </select>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDialoog(null)}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                Terug
              </button>
              <button
                onClick={() =>
                  nietLeverbaar.mutate(
                    {
                      orderRegelId: dialoog.order_regel_id,
                      corrigeerVoorraad,
                      reden: reden || null,
                    },
                    { onSuccess: () => setDialoog(null) },
                  )
                }
                disabled={nietLeverbaar.isPending}
                className="rounded-[var(--radius-sm)] bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isNl ? 'Op backorder zetten' : 'Regel afsluiten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
