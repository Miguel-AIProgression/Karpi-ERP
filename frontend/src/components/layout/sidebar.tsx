import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'
import { NAV_GROUPS } from '@/lib/utils/constants'
import * as Icons from 'lucide-react'
import { useHstMonitor } from '@/modules/logistiek/hooks/use-hst-monitor'
import { telHstAandacht } from '@/modules/logistiek/queries/hst-monitor'
import { useAuth } from '@/hooks/use-auth'
import { REP_TOEGESTANE_PADEN } from '@/lib/auth/rol'

type IconName = keyof typeof Icons

function NavIcon({ name }: { name: string }) {
  const Icon = Icons[name as IconName] as Icons.LucideIcon | undefined
  if (!Icon) return null
  return <Icon size={18} />
}

const REP_PADEN = new Set<string>(REP_TOEGESTANE_PADEN)

export function Sidebar() {
  // Proactieve rode badge op Logistiek: open HST-fouten + stilstaande cron.
  // De monitor zelf is een tab op /logistiek/vervoerders/hst_api/monitor.
  // Deelt queryKey ['hst-monitor'] met het monitor-panel/banner (geen dubbele fetch).
  const { data: hstM } = useHstMonitor()
  const hstAandacht = hstM ? telHstAandacht(hstM) : 0

  // Externe vertegenwoordiger (mig 489): alleen Dashboard/Orders/Klanten/Facturatie.
  const { isExternRep } = useAuth()
  const groups = isExternRep
    ? NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => REP_PADEN.has(i.path)),
      })).filter((g) => g.items.length > 0)
    : NAV_GROUPS

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-w)] bg-slate-900 text-slate-300 flex flex-col z-30">
      {/* Logo */}
      <div className="h-[var(--topbar-h)] flex items-center px-6 border-b border-slate-800">
        <span className="font-[family-name:var(--font-display)] text-2xl text-white">
          RugFlow
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3" style={{ direction: 'rtl' }}>
        {groups.map((group) => (
          <div key={group.label} className="mb-5" style={{ direction: 'ltr' }}>
            <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] text-sm transition-colors',
                    isActive
                      ? 'bg-terracotta-500/15 text-terracotta-400 font-medium'
                      : 'hover:bg-slate-800 hover:text-white'
                  )
                }
              >
                <NavIcon name={item.icon} />
                {item.label}
                {item.path === '/logistiek' && hstAandacht > 0 && (
                  <span className="ml-auto rounded-full bg-rose-600 px-1.5 text-xs font-medium text-white">
                    {hstAandacht}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
