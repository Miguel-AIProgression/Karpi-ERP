import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { useAuth } from '@/hooks/use-auth'
import { repMagPad } from '@/lib/auth/rol'

export function AppLayout() {
  const { isExternRep } = useAuth()
  const { pathname } = useLocation()

  // Externe vertegenwoordiger (mig 489): read-only. Schrijf-/buiten-scope-paden
  // worden teruggestuurd naar /orders. Dit is óók de rem op de SECURITY DEFINER-
  // schrijf-RPC's (/orders/nieuw, /bewerken) die RLS niet vangt — zie het plan.
  const geweerd = isExternRep && !repMagPad(pathname)

  return (
    <div className="min-h-screen">
      <Sidebar />
      <TopBar />
      <main className="ml-[var(--sidebar-w)] mt-[var(--topbar-h)] p-6">
        {geweerd ? <Navigate to="/orders" replace /> : <Outlet />}
      </main>
    </div>
  )
}
