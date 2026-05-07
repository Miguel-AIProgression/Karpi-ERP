import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useMedewerkers } from '@/hooks/use-medewerkers'
import { PickersTab } from '@/components/instellingen/pickers-tab'

type Tab = 'vertegenwoordigers' | 'pickers'

const TABS: { key: Tab; label: string }[] = [
  { key: 'vertegenwoordigers', label: 'Vertegenwoordigers' },
  { key: 'pickers', label: 'Pickers' },
]

export function MedewerkersInstellingenPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'vertegenwoordigers'

  return (
    <>
      <PageHeader
        title="Medewerkers"
        description="Vertegenwoordigers (klant-facing) en pickers (magazijn). Eén tabel met rol-tags, beheerd hier."
      />

      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setParams({ tab: t.key })}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-terracotta-500 text-terracotta-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </nav>
      </div>

      {tab === 'vertegenwoordigers' && <VertegenwoordigersTab />}
      {tab === 'pickers' && <PickersTab />}
    </>
  )
}

function VertegenwoordigersTab() {
  const { data: vertegen, isLoading } = useMedewerkers('vertegenwoordiger')
  const [zoek, setZoek] = useState('')

  const filtered = (vertegen ?? []).filter((v) =>
    v.naam.toLowerCase().includes(zoek.toLowerCase()) ||
    (v.code ?? '').toLowerCase().includes(zoek.toLowerCase()),
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek op naam of code…"
          className="flex-1 max-w-xs px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
        <Link
          to="/vertegenwoordigers"
          className="inline-flex items-center gap-1.5 text-sm text-terracotta-700 hover:text-terracotta-800"
        >
          Volledig overzicht (omzet, tiers)
          <ExternalLink size={14} />
        </Link>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Laden…</div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500 bg-slate-50 rounded-[var(--radius-sm)] border border-slate-200">
          {zoek ? 'Geen vertegenwoordigers gevonden voor deze zoekterm.' : 'Geen vertegenwoordigers.'}
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Naam</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{v.code ?? '—'}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{v.naam}</td>
                  <td className="px-4 py-2 text-slate-600">{v.email ?? '—'}</td>
                  <td className="px-4 py-2">
                    {v.actief ? (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-50 text-emerald-700">
                        Actief
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-500">
                        Inactief
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {v.code && (
                      <Link
                        to={`/vertegenwoordigers/${v.code}`}
                        className="text-sm text-slate-600 hover:text-slate-900"
                      >
                        Bekijken
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
