import { Search } from 'lucide-react'

export function TopBar() {
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

      {/* User (placeholder) */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600">
          U
        </div>
      </div>
    </header>
  )
}
