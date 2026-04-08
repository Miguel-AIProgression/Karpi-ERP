import { useState } from 'react'
import { Search, Plus, Cylinder, Package, Scissors, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RollenGroepRow } from '@/components/rollen/rollen-groep-row'
import { useRollenStats, useRollenGegroepeerd } from '@/hooks/use-rollen'

function formatM2(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function RollenOverviewPage() {
  const [search, setSearch] = useState('')

  const { data: stats } = useRollenStats()
  const { data: groepen, isLoading } = useRollenGegroepeerd(search || undefined)

  const statCards = [
    {
      label: 'Totaal op voorraad',
      value: stats?.totaal ?? 0,
      sub: `${formatM2(stats?.totaal_m2 ?? 0)} m\u00B2`,
      icon: Cylinder,
      color: 'text-slate-700',
    },
    {
      label: 'Volle rollen',
      value: stats?.volle_rollen ?? 0,
      sub: `${formatM2(stats?.volle_m2 ?? 0)} m\u00B2`,
      icon: Package,
      color: 'text-emerald-600',
    },
    {
      label: 'Aangebroken rollen',
      value: stats?.aangebroken ?? 0,
      sub: `${formatM2(stats?.aangebroken_m2 ?? 0)} m\u00B2`,
      icon: Scissors,
      color: 'text-indigo-600',
    },
    {
      label: 'Reststukken',
      value: stats?.reststukken ?? 0,
      sub: `${formatM2(stats?.reststukken_m2 ?? 0)} m\u00B2`,
      icon: AlertCircle,
      color: 'text-orange-600',
    },
    {
      label: 'Leeg/Op',
      value: stats?.leeg_op ?? 0,
      sub: null,
      icon: Cylinder,
      color: 'text-slate-400',
    },
  ]

  return (
    <>
      <PageHeader
        title="Rollen & Reststukken"
        description="Overzicht van alle rollen en aangebroken rollen op voorraad"
        actions={
          <button className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors">
            <Plus size={16} />
            Rol opboeken
          </button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op product, kleur, rolnummer, locatie..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {/* Grouped rows */}
      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Rollen laden...
        </div>
      ) : !groepen || groepen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen rollen gevonden
        </div>
      ) : (
        <div className="space-y-3">
          {groepen.map((groep) => (
            <RollenGroepRow
              key={`${groep.kwaliteit_code}-${groep.kleur_code}`}
              groep={groep}
            />
          ))}
        </div>
      )}
    </>
  )
}
