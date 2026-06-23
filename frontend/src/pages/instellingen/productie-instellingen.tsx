import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Settings, Save, CheckCircle2, Clock, Truck } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { usePlanningConfig, useUpdatePlanningConfig } from '@/hooks/use-planning-config'
import { ConfectieTijdenConfig } from '@/components/confectie/confectie-tijden-config'
import { WerktijdenConfig, useWerktijden } from '@/components/werkagenda/werktijden-config'
import { VrijeDagenConfig } from '@/components/werkagenda/vrije-dagen-config'
import { fetchOrderConfig, updateOrderConfig } from '@/lib/supabase/queries/order-config'
import {
  fetchSnijplanningFifoConfig,
  updateSnijplanningFifoConfig,
  DEFAULT_FIFO_CONFIG,
  type SnijplanningFifoConfig,
} from '@/lib/supabase/queries/snijplanning-fifo-config'
import type { PlanningConfig } from '@/lib/types/productie'

export function ProductieInstellingenPage() {
  const { data: config, isLoading } = usePlanningConfig()
  const updateMutation = useUpdatePlanningConfig()
  const [form, setForm] = useState<PlanningConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [werktijden, setWerktijden] = useWerktijden()

  const queryClient = useQueryClient()
  const { data: orderConfig } = useQuery({ queryKey: ['order-config'], queryFn: fetchOrderConfig })
  const [standaardDagen, setStandaardDagen] = useState<number>(5)
  const [maatwerkWeken, setMaatwerkWeken] = useState<number>(4)
  const [orderCfgSaved, setOrderCfgSaved] = useState(false)
  useEffect(() => {
    if (orderConfig) {
      setStandaardDagen(orderConfig.standaard_maat_werkdagen)
      setMaatwerkWeken(orderConfig.maatwerk_weken)
    }
  }, [orderConfig])
  const orderCfgDirty =
    !!orderConfig &&
    (standaardDagen !== orderConfig.standaard_maat_werkdagen ||
      maatwerkWeken !== orderConfig.maatwerk_weken)
  const orderMutation = useMutation({
    mutationFn: () => updateOrderConfig({ standaard_maat_werkdagen: standaardDagen, maatwerk_weken: maatwerkWeken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-config'] })
      setOrderCfgSaved(true)
      setTimeout(() => setOrderCfgSaved(false), 3000)
    },
  })

  // FIFO-magazijnleeftijd-criteria (ADR-0021) — los app_config-record.
  const { data: fifoConfig } = useQuery({
    queryKey: ['snijplanning-fifo-config'],
    queryFn: fetchSnijplanningFifoConfig,
  })
  const [fifoForm, setFifoForm] = useState<SnijplanningFifoConfig>(DEFAULT_FIFO_CONFIG)
  const [fifoSaved, setFifoSaved] = useState(false)
  useEffect(() => {
    if (fifoConfig) setFifoForm(fifoConfig)
  }, [fifoConfig])
  const fifoDirty =
    !!fifoConfig &&
    (Object.keys(fifoForm) as Array<keyof SnijplanningFifoConfig>).some(
      (k) => fifoForm[k] !== fifoConfig[k],
    )
  const fifoMutation = useMutation({
    mutationFn: () => updateSnijplanningFifoConfig(fifoForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snijplanning-fifo-config'] })
      setFifoSaved(true)
      setTimeout(() => setFifoSaved(false), 3000)
    },
  })
  function updateFifo<K extends keyof SnijplanningFifoConfig>(key: K, value: number) {
    setFifoForm((prev) => ({ ...prev, [key]: value }))
  }

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
                  Streefwaarde per week
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.capaciteit_per_week_streef}
                  onChange={(e) => update('capaciteit_per_week_streef', Number(e.target.value))}
                  className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
                <p className="mt-1 text-xs text-slate-400">Streefcapaciteit per week (bv. 350 tapijten)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Maximum per week (bij drukte)
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.capaciteit_per_week_max}
                  onChange={(e) => update('capaciteit_per_week_max', Number(e.target.value))}
                  className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
                <p className="mt-1 text-xs text-slate-400">Wordt automatisch gebruikt als de streefwaarde een levertijd-belofte anders niet haalbaar maakt</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Max. rolwissels per dag
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.max_rollen_per_dag_streef}
                  onChange={(e) => update('max_rollen_per_dag_streef', Number(e.target.value))}
                  className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
                <p className="mt-1 text-xs text-slate-400">Streefwaarde — mag overschreden worden als de levertijd anders niet haalbaar is</p>
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

        {/* Card: FIFO-magazijnleeftijd (ADR-0021) */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">FIFO-magazijnleeftijd</h2>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Oudere rollen krijgen voorrang bij het snijden om kleurverschil te voorkomen.
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Modus</label>
            <div className="flex gap-3">
              {([
                ['simpel', 'Eenvoudig'],
                ['geavanceerd', 'Geavanceerd'],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setFifoForm((prev) => ({ ...prev, modus: m }))}
                  className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
                    fifoForm.modus === m
                      ? 'bg-terracotta-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {fifoForm.modus === 'simpel'
                ? 'Eenvoudig (huidig): altijd de oudst-binnengekomen rol eerst. Geen extra snijverlies, geen badge, geen handmatige goedkeuring. De geavanceerde afweging hieronder staat dan uit.'
                : 'Geavanceerd: weegt magazijnleeftijd tegen snijverlies, toont een badge en houdt rode voorstellen tegen voor handmatige goedkeuring. Pas live zetten als de rol-data op orde is.'}
            </p>
          </div>

          <div
            className={
              fifoForm.modus === 'simpel'
                ? 'opacity-50 pointer-events-none select-none'
                : ''
            }
            aria-disabled={fifoForm.modus === 'simpel'}
          >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Drempel (dagen)
              </label>
              <input
                type="number" min={0} step={1}
                value={fifoForm.drempel_dagen}
                onChange={(e) => updateFifo('drempel_dagen', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Leeftijd telt pas mee boven deze grens. Default: 90.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Harde bovengrens (dagen)
              </label>
              <input
                type="number" min={0} step={1}
                value={fifoForm.harde_bovengrens_dagen}
                onChange={(e) => updateFifo('harde_bovengrens_dagen', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Daarboven absolute snij-voorrang. Default: 180.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Alpha (m² per dag boven drempel)
              </label>
              <input
                type="number" min={0} step={0.01}
                value={fifoForm.alpha}
                onChange={(e) => updateFifo('alpha', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">
                Hoeveel extra snijafval (m²) acceptabel is per dag dat een rol ouder is dan de drempel. Default: 0,05.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700 mb-2">Badge-drempels (extra afval t.o.v. efficiëntst)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Geel vanaf (m²)</label>
                <input
                  type="number" min={0} step={0.5}
                  value={fifoForm.badge_geel_m2}
                  onChange={(e) => updateFifo('badge_geel_m2', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Geel vanaf (%)</label>
                <input
                  type="number" min={0} step={1}
                  value={fifoForm.badge_geel_pct}
                  onChange={(e) => updateFifo('badge_geel_pct', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Rood vanaf (m²)</label>
                <input
                  type="number" min={0} step={0.5}
                  value={fifoForm.badge_rood_m2}
                  onChange={(e) => updateFifo('badge_rood_m2', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Rood vanaf (%)</label>
                <input
                  type="number" min={0} step={1}
                  value={fifoForm.badge_rood_pct}
                  onChange={(e) => updateFifo('badge_rood_pct', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Een rode badge wordt niet automatisch goedgekeurd — het voorstel blijft concept voor handmatige beoordeling.
            </p>
          </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => fifoMutation.mutate()}
              disabled={fifoMutation.isPending || !fifoDirty}
              className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
            >
              {fifoSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {fifoMutation.isPending ? 'Opslaan...' : fifoSaved ? 'Opgeslagen!' : 'Opslaan'}
            </button>
            {fifoMutation.isError && (
              <p className="text-xs text-red-600">
                Fout: {(fifoMutation.error as Error).message}
              </p>
            )}
            <p className="text-xs text-slate-400">Direct actief — geen deploy nodig.</p>
          </div>
        </div>

        {/* Card 3: Snijtijden */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">Snijtijden</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Wisseltijd per rol (minuten)
              </label>
              <input
                type="number"
                min={0}
                max={120}
                value={form.wisseltijd_minuten}
                onChange={(e) => update('wisseltijd_minuten', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Tijd om een nieuwe rol op de machine te leggen</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Snijtijd per karpet
              </label>
              <p className="text-sm text-slate-500">
                Sinds mig 460 per vorm ingesteld (Rechthoek, Rond, Ovaal, ...) i.p.v. één vlak tarief — beheer dit op{' '}
                <Link to="/instellingen/vormen" className="text-terracotta-600 hover:underline">de Vormen-pagina</Link>.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confectie-buffer na afronden rol (minuten)
              </label>
              <input
                type="number"
                min={0}
                max={240}
                step={1}
                value={form.confectie_buffer_minuten}
                onChange={(e) => update('confectie_buffer_minuten', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">
                Wachttijd na afronden rol voordat gesneden stukken in de confectie-planning verschijnen.
                Standaard: 15 min.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Automatische verzendweek bij materiaal op voorraad (weken)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.maatwerk_voorraad_levertijd_weken}
                onChange={(e) => update('maatwerk_voorraad_levertijd_weken', Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">
                Zodra een maatwerk-stuk een echte rol toegewezen krijgt (materiaal is dus op voorraad, geen
                wachten op inkoop) wordt de verzendweek van die regel eenmalig op &quot;vandaag + dit aantal
                weken&quot; gezet — per regel handmatig aan te passen. Standaard: 7.
              </p>
            </div>
          </div>
        </div>

        {/* Card 4: Werktijden (gedeeld snij + confectie) */}
        <WerktijdenConfig werktijden={werktijden} onChange={setWerktijden} />

        {/* Card 5: Vrije dagen / feestdagen */}
        <VrijeDagenConfig werktijden={werktijden} onChange={setWerktijden} />

        {/* Card 6: Confectietijden per type */}
        <ConfectieTijdenConfig />

        {/* Card: Order-instellingen */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Truck size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">Order-instellingen</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Standaard-maat levertermijn (werkdagen)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={standaardDagen}
                onChange={(e) => setStandaardDagen(Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Uit voorraad leverbaar. Default: 5.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Maatwerk levertermijn (weken)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={maatwerkWeken}
                onChange={(e) => setMaatwerkWeken(Number(e.target.value))}
                className="w-32 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
              <p className="mt-1 text-xs text-slate-400">Gesneden + geconfectioneerd. Default: 4.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => orderMutation.mutate()}
              disabled={orderMutation.isPending || !orderCfgDirty}
              className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
            >
              {orderCfgSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {orderMutation.isPending ? 'Opslaan...' : orderCfgSaved ? 'Opgeslagen!' : 'Opslaan'}
            </button>
            <p className="text-xs text-slate-400">
              Wordt automatisch ingevuld bij nieuwe orders. Per klant overschrijfbaar.
            </p>
          </div>
        </div>

        {/* Card 5: A/B Groepen (placeholder) */}
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
