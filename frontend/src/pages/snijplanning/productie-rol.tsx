import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Scissors, Printer, CheckCircle2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { SnijVisualisatie } from '@/components/snijplanning/snij-visualisatie'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { ReststukStickerLayout } from '@/components/snijplanning/reststuk-sticker-layout'
import { useRolSnijstukken, useVoltooiSnijplanRol } from '@/hooks/use-snijplanning'
import type { ReststukResult } from '@/hooks/use-snijplanning'
import { mapSnijplannenToStukken } from '@/lib/utils/snijplan-mapping'
import { computeReststukkenFromStukken } from '@/lib/utils/compute-reststukken'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'

export function ProductieRolPage() {
  const { rolId } = useParams<{ rolId: string }>()
  const navigate = useNavigate()
  const rolIdNum = rolId ? Number(rolId) : null
  const { data: stukken, isLoading } = useRolSnijstukken(
    rolIdNum && Number.isFinite(rolIdNum) ? rolIdNum : null
  )
  const voltooiRol = useVoltooiSnijplanRol()
  const [voltooid, setVoltooid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showStickers, setShowStickers] = useState(false)
  const [reststukResults, setReststukResults] = useState<ReststukResult[]>([])

  if (isLoading) {
    return <PageHeader title="Laden..." />
  }

  if (!stukken || stukken.length === 0) {
    return (
      <>
        <PageHeader title="Geen stukken gevonden" />
        <Link to="/snijplanning" className="text-terracotta-500 hover:underline">
          Terug naar snijplanning
        </Link>
      </>
    )
  }

  const eerste = stukken[0]
  const rolnummer = eerste.rolnummer ?? 'Onbekend'
  const rolBreedte = eerste.rol_breedte_cm ?? 400
  const rolLengte = eerste.rol_lengte_cm ?? 2000
  const kwaliteit = eerste.kwaliteit_code ?? ''
  const kleur = eerste.kleur_code ?? ''

  const teSnijden = stukken.filter(s => s.status === 'Gepland' || s.status === 'Snijden')
  const alGesneden = stukken.filter(s => s.status === 'Gesneden' || s.status === 'In confectie' || s.status === 'Gereed')

  const { snijStukken, gebruikteLengte, afvalPct, reststukBruikbaar } =
    mapSnijplannenToStukken(stukken, rolBreedte, rolLengte)

  const restLengte = rolLengte - gebruikteLengte
  const reststukken = computeReststukkenFromStukken(rolLengte, rolBreedte, snijStukken)

  const handleVoltooiRol = () => {
    if (!rolIdNum) return
    setError(null)
    voltooiRol.mutate(
      { rolId: rolIdNum, reststukken },
      {
        onSuccess: (data) => {
          setVoltooid(true)
          setShowStickers(true)
          const results = (Array.isArray(data) ? data : [data]).filter(
            (r): r is ReststukResult => !!r && r.reststuk_id !== null,
          )
          setReststukResults(results)
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Productie — ${rolnummer}`}
          description={`${kwaliteit} ${kleur} · ${teSnijden.length} te snijden · ${alGesneden.length} gesneden`}
          actions={
            <div className="flex items-center gap-3">
              <Link
                to="/snijplanning"
                className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft size={16} />
                Terug
              </Link>
              {!voltooid && teSnijden.length > 0 && (
                <button
                  onClick={handleVoltooiRol}
                  disabled={voltooiRol.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {voltooiRol.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Scissors size={16} />
                  )}
                  Rol gesneden ({teSnijden.length} stuks)
                </button>
              )}
              {(voltooid || alGesneden.length > 0) && (
                <button
                  onClick={() => setShowStickers(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50 transition-colors"
                >
                  <Printer size={16} />
                  Stickers
                </button>
              )}
            </div>
          }
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
            {error}
          </div>
        )}

        {voltooid && (
          <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-[var(--radius-sm)] text-sm text-emerald-700 flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              Rol is gesneden! Stukken zijn gemarkeerd als "Gesneden".
              {reststukResults.length > 0 && (
                <div className="mt-1">
                  <strong>{reststukResults.length} reststuk{reststukResults.length > 1 ? 'ken' : ''}</strong>{' '}
                  aangemaakt:{' '}
                  {reststukResults.map((r, i) => (
                    <span key={r.reststuk_id ?? i}>
                      {i > 0 && ', '}
                      {r.reststuk_rolnummer}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reststuk stickers — header/knop hier (print:hidden via parent);
            daadwerkelijke stickers staan buiten de print:hidden wrapper,
            zie reststuk-print-area verderop */}
        {reststukResults.length > 0 && (
          <div className="mb-4 bg-white rounded-[var(--radius)] border border-emerald-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-slate-700">
                Reststuk stickers ({reststukResults.length})
              </h2>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-emerald-500 text-white text-sm hover:bg-emerald-600 transition-colors"
              >
                <Printer size={14} />
                Print alle reststuk stickers
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reststukResults.map((r, i) => {
                const rect = reststukken[i]
                return (
                  <ReststukStickerLayout
                    key={`preview-${r.reststuk_id ?? i}`}
                    rolnummer={r.reststuk_rolnummer ?? ''}
                    kwaliteit={kwaliteit}
                    kleur={kleur}
                    lengte_cm={r.reststuk_lengte_cm ?? 0}
                    breedte_cm={rect?.breedte_cm ?? rolBreedte}
                    datum={new Date().toLocaleDateString('nl-NL')}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Rol visualisatie */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            Snijplan — {rolnummer} ({rolBreedte} × {rolLengte} cm)
          </h2>
          <div className="flex justify-center">
            <SnijVisualisatie
              rolBreedte={rolBreedte}
              rolLengte={rolLengte}
              stukken={snijStukken}
              restLengte={restLengte}
              afvalPct={afvalPct}
              reststukBruikbaar={reststukBruikbaar}
              reststukken={reststukken}
              className="max-w-3xl"
            />
          </div>
        </div>

        {/* Stukken tabel */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            Stukken ({stukken.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3">Nr</th>
                <th className="py-2 pr-3">Maat</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Afwerking</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Sticker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stukken.map((stuk) => (
                <tr key={stuk.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-3 text-xs text-slate-500">{stuk.snijplan_nr}</td>
                  <td className="py-2 pr-3 font-medium">
                    {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
                  </td>
                  <td className="py-2 pr-3">{stuk.klant_naam}</td>
                  <td className="py-2 pr-3">
                    <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
                      {stuk.order_nr}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
                      <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.maatwerk_afwerking].bg, AFWERKING_MAP[stuk.maatwerk_afwerking].text)}>
                        {stuk.maatwerk_afwerking}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      stuk.status === 'Gepland' ? 'bg-slate-100 text-slate-700'
                        : stuk.status === 'Snijden' ? 'bg-blue-100 text-blue-700'
                        : stuk.status === 'Gesneden' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    )}>
                      {stuk.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      to={`/snijplanning/${stuk.id}/stickers`}
                      className="text-xs text-terracotta-500 hover:underline"
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stickers sectie */}
      {showStickers && (
        <div className="print:hidden mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-slate-700">
              Stickers ({stukken.length * 2})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigate(`/snijplanning/stickers?kwaliteit=${kwaliteit}&kleur=${kleur}&rol=${rolIdNum}`)
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm hover:bg-terracotta-600 transition-colors"
              >
                <Printer size={14} />
                Print alle stickers
              </button>
              <button
                onClick={() => setShowStickers(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Verbergen
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stukken.slice(0, 4).map((stuk) => (
              <StickerLayout key={stuk.id} snijplan={stuk} />
            ))}
          </div>
          {stukken.length > 4 && (
            <p className="text-xs text-slate-400 mt-2">
              + {stukken.length - 4} meer stickers. Klik "Print alle stickers" om alles te printen.
            </p>
          )}
        </div>
      )}

      {/* Print-only area voor reststuk stickers — buiten print:hidden wrappers
          zodat window.print() ze daadwerkelijk meeneemt. Hidden op scherm. */}
      {reststukResults.length > 0 && (
        <div className="reststuk-print-area hidden print:block">
          {reststukResults.map((r, i) => {
            const rect = reststukken[i]
            return (
              <ReststukStickerLayout
                key={`print-${r.reststuk_id ?? i}`}
                rolnummer={r.reststuk_rolnummer ?? ''}
                kwaliteit={kwaliteit}
                kleur={kleur}
                lengte_cm={r.reststuk_lengte_cm ?? 0}
                breedte_cm={rect?.breedte_cm ?? rolBreedte}
                datum={new Date().toLocaleDateString('nl-NL')}
              />
            )
          })}
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .reststuk-print-area,
          .reststuk-print-area * { visibility: visible; }
          .reststuk-print-area {
            position: absolute;
            top: 0;
            left: 0;
          }
          .reststuk-print-area .sticker-label {
            page-break-after: always;
            margin: 0;
            border: none;
          }
          @page {
            size: 100mm 60mm;
            margin: 0;
          }
        }
      `}</style>
    </>
  )
}
