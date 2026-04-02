import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { useAuth } from './hooks/use-auth'
import { LoginPage } from './pages/login'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

function AuthGate() {
  const { user, loading, signIn } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white font-[family-name:var(--font-display)] text-2xl">
          RugFlow
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onLogin={signIn} />
  }

  return <RouterProvider router={router} />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  )
}
