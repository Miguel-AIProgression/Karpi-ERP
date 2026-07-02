import { Link } from 'react-router-dom'
import { useHstMonitor, useHstFouten } from '@/modules/logistiek/hooks/use-hst-monitor'
import { cronVermoedelijkStil } from '@/modules/logistiek/queries/hst-monitor'
import { useMarkeerZendingAfgehandeld } from '@/modules/logistiek/hooks/use-zendingen'

/**
 * Live status van de HST-koppeling: KPI's + open fouten met retry-knop.
 * Wordt getoond als tab "Verzendmonitor" op de vervoerder-detailpagina van HST.
 */
export function HstMonitorPanel() {
  const { data: m, isLoading } = useHstMonitor()
  const { data: fouten = [] } = useHstFouten()
  const afhandelen = useMarkeerZendingAfgehandeld()

  if (isLoading || !m) return <div className="p-8 text-slate-500">Laden…</div>

  const cronStil = cronVermoedelijkStil(m)

  return (
    <>
      {cronStil && (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Let op:</span> de wachtrij loopt op
          (oudste {m.oudste_wachtrij_minuten} min) — de verzend-cron staat mogelijk stil.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Verstuurd vandaag" waarde={m.verstuurd_vandaag} kleur="groen" />
        <Kpi label="Open fouten" waarde={m.fout_open} kleur={m.fout_open > 0 ? 'rood' : 'grijs'} />
        <Kpi label="In wachtrij" waarde={m.wachtrij} kleur="grijs" />
        <Kpi label="Bezig" waarde={m.bezig} kleur="grijs" />
      </div>

      <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Open fouten ({fouten.length})</h3>
        {fouten.length > 0 && (
          <p className="mb-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Een HST-foutmelding betekent dat de zending tóch al in de HST-portal staat.
            Corrigeer de fout in HST en klik dan op <span className="font-medium">Afgehandeld</span> —
            niet opnieuw versturen (dat maakt een dubbele transportorder).
          </p>
        )}
        {fouten.length === 0 ? (
          <div className="text-sm text-slate-400">Geen open fouten. 🎉</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zending</th>
                <th className="px-3 py-2 text-left font-medium">Fout</th>
                <th className="px-3 py-2 text-right font-medium">Retries</th>
                <th className="px-3 py-2 text-right font-medium">Actie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fouten.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">
                    <Link to={`/logistiek/${f.zending_nr ?? ''}`} className="text-terracotta-600 hover:underline">
                      {f.zending_nr ?? `#${f.zending_id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{f.error_msg ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{f.retry_count}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => afhandelen.mutate({ id: f.id, externRef: f.extern_referentie, vervoerderCode: 'hst_api' })}
                      disabled={afhandelen.isPending}
                      className="rounded-[var(--radius-sm)] bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Afgehandeld
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Kpi({ label, waarde, kleur }: { label: string; waarde: number; kleur: 'groen' | 'rood' | 'grijs' }) {
  const ring = kleur === 'rood' ? 'border-rose-200 bg-rose-50' : kleur === 'groen' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
  return (
    <div className={`rounded-[var(--radius)] border p-4 ${ring}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{waarde}</div>
    </div>
  )
}
