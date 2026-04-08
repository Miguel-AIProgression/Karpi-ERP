import { useState, useEffect } from 'react'
import { Settings, Save, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { usePlanningConfig, useUpdatePlanningConfig } from '@/hooks/use-planning-config'
import type { PlanningConfig } from '@/lib/types/productie'

export function ProductieInstellingenPage() {
  const { data: config, isLoading } = usePlanningConfig()
  const updateMutation = useUpdatePlanningConfig()
  const [form, setForm] = useState<PlanningConfig | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config && !form) setForm(config)
  }, [config, form])

  function update<K extends keyof PlanningConfig>(key: K, value: PlanningConfig[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  async function handleSave() {
    if (!form) return
    await updateMutation.mutateAsync(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (isLoading || !form) {
    return (
      <>
        <PageHeader title="Productie Instellingen" />
        <div className="text-slate-400">Laden...</div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Productie Instellingen"
        description="Configuratie voor snijplanning en capaciteit"
        actions={
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
          >
            {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {updateMutation.isPending ? 'Opslaan...' : saved ? 'Opgeslagen!' : 'Opslaan'}
          </button>
        }
      />

      {updateMutation.isError && (
        <div className="mb-4 p-3 rounded-[var(--radius-sm)] bg-red-50 text-red-700 text-sm">
          Fout bij opslaan: {(updateMutation.error as Error).message}
        </div>
      )}

      {saved && (
        <div className="mb-4 p-3 rounded-[var(--radius-sm)] bg-emerald-50 text-emerald-700 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} />
          Instellingen succesvol opgeslagen.
        </div>
      )}

      <div className="space-y-6 max-w-2xl">
        {/* Card 1: Planning modus */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">Planning modus</h2>
          </div>

          <div className="flex gap-3 mb-4">
            {(['weken', 'capaciteit'] as const).map((modus) => (
              <button
                key={modus}
                onClick={() => update('planning_modus', modus)}
                className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
                  form.planning_modus === modus
                    ? 'bg-terracotta-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {modus === 'weken' ? 'Weken' : 'Capaciteit'}
              </button>
            ))}
          </div>

          {form.planning_modus === 'weken' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Weken vooruit
              </label>
              <input
                type="number"
                min={1}
                max={52}
                value={form.weken_vooruit}
                onChange={(e) => update('weken_vooruit', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Hoeveel weken vooruit inplannen</p>
            </div>
          )}

          {form.planning_modus === 'capaciteit' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Tapijten per week
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.capaciteit_per_week}
                  onChange={(e) => update('capaciteit_per_week', Number(e.target.value))}
                  className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
                <p className="mt-1 text-xs text-slate-400">Maximale snijcapaciteit per week</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Marge %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.capaciteit_marge_pct}
                  onChange={(e) => update('capaciteit_marge_pct', Number(e.target.value))}
                  className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
                <p className="mt-1 text-xs text-slate-400">Buffer boven capaciteit (voor spoedorders)</p>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Reststukken */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Reststukken</h2>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Max verspilling %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.max_reststuk_verspilling_pct}
              onChange={(e) => update('max_reststuk_verspilling_pct', Number(e.target.value))}
              className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
            <p className="mt-1 text-xs text-slate-400">
              Reststukken met meer verspilling dan dit percentage worden niet gesuggereerd
            </p>
          </div>
        </div>

        {/* Card 3: A/B Groepen (placeholder) */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">A/B Groepen</h2>
          <p className="text-sm text-slate-500">
            Handmatige toewijzing van kwaliteit+kleur combinaties aan productiegroepen.
            Komt in een volgende versie.
          </p>
        </div>
      </div>
    </>
  )
}
