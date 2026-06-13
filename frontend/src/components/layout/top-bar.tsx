import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, LogOut, ChevronDown, Bug, Bell } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { isBugBeheerder } from '@/lib/bug/beheerder'
import { useBugMeldingen, isVerwerktOngezien } from '@/hooks/use-bug-meldingen'
import { FeedbackWidget } from '@/components/feedback/feedback-widget'

export function TopBar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const name = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'User'
  const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
  const beheerder = isBugBeheerder(user)

  const { data: meldingen = [] } = useBugMeldingen()
  const verwerktOngezien = meldingen.filter((m) => isVerwerktOngezien(m, user?.id)).length

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

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

      <div className="flex items-center gap-1">
        {/* Feedback/bug melden — in de balk zodat hij geen pagina-knoppen overlapt */}
        <div className="mr-2">
          <FeedbackWidget />
        </div>

        {/* Meldingen-belletje met teller voor verwerkte-maar-ongeziene meldingen */}
        <button
          onClick={() => navigate('/meldingen')}
          className="relative rounded-[var(--radius-sm)] p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
          title={
            verwerktOngezien > 0
              ? `${verwerktOngezien} verwerkte melding${verwerktOngezien === 1 ? '' : 'en'} — bekijk de toelichting`
              : 'Mijn meldingen'
          }
          aria-label="Meldingen"
        >
          <Bell size={18} />
          {verwerktOngezien > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
              {verwerktOngezien > 9 ? '9+' : verwerktOngezien}
            </span>
          )}
        </button>

        {/* User-menu */}
        <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 transition-colors hover:bg-slate-50"
        >
          <div className="w-8 h-8 rounded-full bg-terracotta-100 flex items-center justify-center text-xs font-medium text-terracotta-600">
            {initials}
          </div>
          <span className="text-sm text-slate-600 hidden md:block">{name}</span>
          <ChevronDown size={15} className="text-slate-400" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-56 rounded-[var(--radius)] border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-4 py-2">
              <div className="truncate text-sm font-medium text-slate-700">{name}</div>
              <div className="truncate text-xs text-slate-400">{user?.email}</div>
            </div>

            <Link
              to="/meldingen"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Bug size={15} className="text-slate-400" />
              {beheerder ? 'Alle meldingen' : 'Mijn meldingen'}
            </Link>

            <button
              onClick={() => {
                setMenuOpen(false)
                void signOut()
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={15} className="text-slate-400" />
              Uitloggen
            </button>
          </div>
        )}
        </div>
      </div>
    </header>
  )
}
