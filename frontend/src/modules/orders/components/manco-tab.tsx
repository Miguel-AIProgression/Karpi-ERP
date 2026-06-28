import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PackageX, RotateCcw, XCircle, Clock, ExternalLink } from 'lucide-react'
import { useMancoNietLeverbaar, useMancoRegels, useMancoTerugNaarPickship } from '../hooks/use-manco'
import type { MancoActie, MancoRegel } from '../queries/manco'

// Manco-werklijst (mig 518 + 522): regel-niveau. Toont orderregels die tijdens
// een Pickronde niet gevonden zijn. De binnendienst onderzoekt fysiek en kiest
// per regel één van drie expliciete uitkomsten (CONTEXT.md → Manco-resolutie):
//   • Opnieuw leveren  — tóch gevonden → terug in Pick & Ship (raakt voorraad niet)
//   • Wacht op voorraad — backorder op dezelfde order
//   • Annuleren        — regel afsluiten
// Land (NL/DE) bepaalt alleen de voorgeselecteerde default, niet de keuze. De
// voorraadcorrectie staat standaard AAN (haalt de spookvoorraad weg die anders de
// volgende order opnieuw manco laat lopen); opt-out alleen als het stuk er nog ligt.

function LandBadge({ land }: { land: string | null }) {
  const isNl = land === 'NL'
  const label = land ?? '??'
  return (
    <span
      className={
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ' +
        (isNl ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800')
      }
      title={isNl ? 'Nederland — advies: wacht op voorraad' : 'Buitenland — advies: annuleren'}
    >
      {label}
    </span>
  )
}

/** Land-gestuurde voorselectie: NL → backorder, anders → annuleren (mig 522). */
function defaultActie(land: string | null): MancoActie {
  return land === 'NL' ? 'backorder' : 'annuleren'
}

export function MancoTab() {
  const { data: regels = [], isLoading } = useMancoRegels()
  const terug = useMancoTerugNaarPickship()
  const nietLeverbaar = useMancoNietLeverbaar()
  const [dialoog, setDialoog] = useState<{ regel: MancoRegel; actie: MancoActie } | null>(null)
  const [ligtErNog, setLigtErNog] = useState(false)
  const [reden, setReden] = useState('')

  function openDialoog(regel: MancoRegel, actie: MancoActie) {
    setDialoog({ regel, actie })
    setLigtErNog(false)
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

  const isBackorder = dialoog?.actie === 'backorder'

  return (
    <div className="space-y-2">
      {regels.map((r) => {
        const advies = defaultActie(r.land)
        return (
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
              <RotateCcw size={13} /> Opnieuw leveren
            </button>
            <button
              onClick={() => openDialoog(r, 'backorder')}
              className={
                'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-medium ' +
                (advies === 'backorder'
                  ? 'border-amber-400 bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                  : 'border-amber-300 text-amber-700 hover:bg-amber-50')
              }
              title="Blijft als backorder op de order, komt terug zodra er weer voorraad is"
            >
              <Clock size={13} /> Wacht op voorraad
            </button>
            <button
              onClick={() => openDialoog(r, 'annuleren')}
              className={
                'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-medium ' +
                (advies === 'annuleren'
                  ? 'border-rose-400 bg-rose-100 text-rose-800 ring-1 ring-rose-300'
                  : 'border-rose-300 text-rose-700 hover:bg-rose-50')
              }
              title="Sluit de regel af op deze order"
            >
              <XCircle size={13} /> Annuleren
            </button>
          </div>
        )
      })}

      {dialoog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <h3 className="mb-1 text-lg font-semibold">
              {isBackorder ? 'Wacht op voorraad' : 'Annuleren'} — {dialoog.regel.order_nr}
            </h3>
            <p className="mb-3 text-sm text-slate-600">
              {isBackorder ? (
                <>
                  De regel blijft als <strong>backorder</strong> op deze order staan en duikt
                  automatisch weer op in Pick &amp; Ship zodra het artikel weer op voorraad is.
                </>
              ) : (
                <>
                  De regel wordt op deze order <strong>afgesloten</strong>. Is dit de laatste open
                  regel: een al verzonden deel blijft staan (order → Verzonden), anders wordt de
                  order geannuleerd.
                </>
              )}
            </p>

            <label className="mb-3 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
              <input
                type="checkbox"
                checked={ligtErNog}
                onChange={(e) => setLigtErNog(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Het ligt er fysiek <strong>nog wél</strong> — telling niet afboeken.
                <span className="mt-0.5 block text-xs text-slate-500">
                  Standaard wordt 1 uit de voorraadtelling gehaald: een niet-gevonden stuk is meestal
                  echt weg, en blijft de telling staan dan loopt de volgende order opnieuw manco. Vink
                  dit alleen aan als het stuk er nog ligt (bv. de klant wil het niet meer).
                </span>
              </span>
            </label>

            <input
              type="text"
              value={reden}
              onChange={(e) => setReden(e.target.value)}
              placeholder="Reden (optioneel)…"
              className="mb-3 w-full rounded border border-slate-200 p-2 text-sm"
            />

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
                      orderRegelId: dialoog.regel.order_regel_id,
                      actie: dialoog.actie,
                      corrigeerVoorraad: !ligtErNog,
                      reden: reden || null,
                    },
                    { onSuccess: () => setDialoog(null) },
                  )
                }
                disabled={nietLeverbaar.isPending}
                className={
                  'rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ' +
                  (isBackorder ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700')
                }
              >
                {isBackorder ? 'Op backorder zetten' : 'Regel afsluiten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
