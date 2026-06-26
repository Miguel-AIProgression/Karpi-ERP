import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { isPadGeblokkeerd } from '@/lib/auth/rol'

/**
 * Bewaakt een route op basis van pagina_restricties in app_metadata.
 * Als de ingelogde gebruiker dit pad niet mag zien, wordt hij teruggestuurd
 * naar het dashboard met een melding in de URL.
 */
export function PaginaGuard({ children }: { children: React.ReactNode }) {
  const { paginaRestricties, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) return null

  if (isPadGeblokkeerd(paginaRestricties, pathname)) {
    return <Navigate to="/?geblokkeerd=1" replace />
  }

  return <>{children}</>
}
