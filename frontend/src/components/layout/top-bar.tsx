import { Search, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'

export function TopBar() {
  const { user, signOut } = useAuth()

  const name = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'User'
  const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <header className="fixed top-0 left-[var(--sidebar-w)] right-0 h-[var(--topbar-h)] bg-white border-b border-slate-200 flex items-center justify-between px-6 z-20">
      {/* Search */}
      <div className="relative w-96">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Zoek op order, klant, product..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      {/* User */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-terracotta-100 flex items-center justify-center text-xs font-medium text-terracotta-600">
          {initials}
        </div>
        <span className="text-sm text-slate-600 hidden md:block">{name}</span>
        <button
          onClick={signOut}
          className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
          title="Uitloggen"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
