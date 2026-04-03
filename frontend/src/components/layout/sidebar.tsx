import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'
import { NAV_GROUPS } from '@/lib/utils/constants'
import * as Icons from 'lucide-react'

type IconName = keyof typeof Icons

function NavIcon({ name }: { name: string }) {
  const Icon = Icons[name as IconName] as Icons.LucideIcon | undefined
  if (!Icon) return null
  return <Icon size={18} />
}

export function Sidebar() {
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
        {NAV_GROUPS.map((group) => (
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
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
