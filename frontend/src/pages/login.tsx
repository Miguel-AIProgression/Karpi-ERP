import { useState } from 'react'
import type { FormEvent } from 'react'

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inloggen mislukt')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-[family-name:var(--font-display)] text-4xl text-white mb-2">
            RugFlow
          </h1>
          <p className="text-slate-400 text-sm">Karpi ERP Portaal</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-[var(--radius)] p-6 shadow-xl">
          <h2 className="text-lg font-medium mb-4">Inloggen</h2>

          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              E-mailadres
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              placeholder="naam@bedrijf.nl"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Wachtwoord
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Bezig...' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  )
}
