import { useState } from 'react'
import { Loader2, RefreshCw, Play } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { PageHeader } from '@/components/layout/page-header'
import { useWerklijst } from '@/modules/snijplanning/hooks/use-werklijst'
import { WerklijstKwaliteitGroepItem } from '@/components/snijplanning/werklijst-kwaliteit-groep'
import { PlanningTab } from '@/components/snijplanning/planning-tab'
import { supabase } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

// ─── Herplan-knop ────────────────────────────────────────────────────────────

function HerplanNuKnop() {
  const [bezig, setBezig] = useState(false)
  const [bericht, setBericht] = useState<string | null>(null)
  const qc = useQueryClient()

  const herplan = async () => {
    setBezig(true)
    setBericht(null)
    try {
      const { data, error } = await supabase.functions.invoke('herplan-sweep')
      if (error) throw error
      const r = data as { verwerkt?: number; gewijzigd?: number; noop?: number; duur_ms?: number }
      setBericht(
        `${r.verwerkt ?? 0} groepen verwerkt — ${r.gewijzigd ?? 0} gewijzigd, ${r.noop ?? 0} no-op (${Math.round((r.duur_ms ?? 0) / 1000)}s)`,
      )
      qc.invalidateQueries({ queryKey: ['werklijst-stukken'] })
    } catch (e) {
      setBericht(`Fout: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {bericht && (
        <span className="text-xs text-slate-500 max-w-xs truncate">{bericht}</span>
      )}
      <button
        type="button"
        onClick={herplan}
        disabled={bezig}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] border text-sm transition-colors',
          bezig
            ? 'border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
        )}
      >
        <Play size={13} className={bezig ? 'animate-pulse' : ''} />
        {bezig ? 'Herplannen…' : 'Herplan nu'}
      </button>
    </div>
  )
}

// ─── Tab-types ────────────────────────────────────────────────────────────────

type Tab = 'werklijst' | 'planning'

// ─── Hoofd-pagina ─────────────────────────────────────────────────────────────

export function WerklijstPage() {
  const [actieveTab, setActieveTab] = useState<Tab>('werklijst')
  const { groepen, isLoading, isFetching, error, ververs, rawStukken } = useWerklijst()

  const totaalStukken = groepen.reduce(
    (s, g) => s + g.aantalOpRol + g.aantalWachtOpInkoop + g.aantalTekort,
    0,
  )
  const totaalTekort = groepen.reduce((s, g) => s + g.aantalTekort, 0)
  const totaalInkoop = groepen.reduce((s, g) => s + g.aantalWachtOpInkoop, 0)

  const beschrijving = isLoading
    ? 'Laden...'
    : `${totaalStukken} stukken in ${groepen.length} kwaliteiten` +
      (totaalTekort > 0 ? ` — ${totaalTekort} tekort` : '') +
      (totaalInkoop > 0 ? ` — ${totaalInkoop} wacht op inkoop` : '')

  return (
    <div>
      <PageHeader
        title="Snijderij werklijst"
        description={beschrijving}
        actions={
          <div className="flex items-center gap-2">
            <HerplanNuKnop />
            <button
              type="button"
              onClick={ververs}
              disabled={isFetching}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors',
                isFetching && 'opacity-60 cursor-not-allowed',
              )}
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Ververs
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 mb-4">
        {(['werklijst', 'planning'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActieveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              actieveTab === tab
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {tab === 'werklijst' ? 'Werklijst' : 'Planning'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={22} className="animate-spin mr-3" />
          Werklijst laden…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Fout bij laden: {error.message}
        </div>
      )}

      {!isLoading && !error && actieveTab === 'werklijst' && (
        <>
          {groepen.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center">
              <p className="text-slate-400 text-sm">Geen openstaande maatwerk-stukken gevonden.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groepen.map((groep, i) => (
                <WerklijstKwaliteitGroepItem
                  key={groep.sleutel}
                  groep={groep}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!error && actieveTab === 'planning' && (
        <PlanningTab
          groepen={groepen}
          rawStukken={rawStukken ?? []}
          isWerklijstLoading={isLoading}
        />
      )}
    </div>
  )
}
