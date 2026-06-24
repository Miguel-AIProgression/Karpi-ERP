import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { useAuth } from '@/hooks/use-auth'
import { repMagPad } from '@/lib/auth/rol'

export function AppLayout() {
  const { isExternRep } = useAuth()
  const { pathname } = useLocation()

  // Externe vertegenwoordiger (mig 490 e.v.): read-only, ziet alles behalve
  // systeembeheer. Geweerde paden (systeembeheer + /nieuw + /bewerken) gaan terug
  // naar /orders. Dit is óók de rem op de SECURITY DEFINER-schrijf-RPC's die RLS
  // niet vangt (zie repMagPad).
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
