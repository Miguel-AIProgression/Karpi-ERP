import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Package, LogIn } from 'lucide-react'

const PORTAL_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supplier-portal`

async function doLogin(email: string, wachtwoord: string): Promise<string> {
  const res = await fetch(PORTAL_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), wachtwoord }),
  })
  const body = await res.json().catch(() => ({})) as { token?: string; error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  if (!body.token) throw new Error('No token in response')
  return body.token
}

export function PortalLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [wachtwoord, setWachtwoord] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !wachtwoord) return
    setLoading(true)
    setError(null)
    try {
      const token = await doLogin(email, wachtwoord)
      navigate(`/portal/${token}`, { replace: true })
    } catch (err) {
      setError((err as Error).message === 'Invalid email or password'
        ? 'Incorrect email or password. Please try again.'
        : 'Login failed. Please try again or contact Karpi.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-3 shadow-sm">
            <Package size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Karpi Supplier Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to manage your delivery schedule</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={wachtwoord}
                  onChange={(e) => setWachtwoord(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !wachtwoord}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn size={15} />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Need access? Contact Karpi to request login credentials.
        </p>
      </div>
    </div>
  )
}
