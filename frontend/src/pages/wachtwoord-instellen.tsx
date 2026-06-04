import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'

// Landings-pagina voor de invite-/recovery-link uit de e-mail. Supabase verwerkt
// het token in de URL en maakt een (tijdelijke) sessie aan; hier kiest de
// gebruiker een nieuw wachtwoord via supabase.auth.updateUser.

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function WachtwoordInstellenPage() {
  const navigate = useNavigate()
  const [sessieKlaar, setSessieKlaar] = useState(false)
  const [geldigeSessie, setGeldigeSessie] = useState(false)
  const [wachtwoord, setWachtwoord] = useState('')
  const [herhaling, setHerhaling] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    // Geef supabase-js de kans het token uit de URL te verwerken, en check
    // daarna of er een sessie is.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setGeldigeSessie(!!session)
      setSessieKlaar(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setGeldigeSessie(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (wachtwoord.length < 8) {
      setError('Kies een wachtwoord van minimaal 8 tekens.')
      return
    }
    if (wachtwoord !== herhaling) {
      setError('De wachtwoorden komen niet overeen.')
      return
    }
    setBezig(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: wachtwoord })
      if (updErr) throw updErr
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wachtwoord instellen mislukt')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-[family-name:var(--font-display)] text-4xl text-white mb-2">
            RugFlow
          </h1>
          <p className="text-slate-400 text-sm">Karpi ERP Portaal</p>
        </div>

        <div className="bg-white rounded-[var(--radius)] p-6 shadow-xl">
          <h2 className="text-lg font-medium mb-4">Wachtwoord instellen</h2>

          {!sessieKlaar ? (
            <p className="text-sm text-slate-500">Even geduld…</p>
          ) : !geldigeSessie ? (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm text-amber-800">
                Deze link is verlopen of ongeldig. Vraag een nieuwe uitnodiging of
                wachtwoord-reset aan bij de beheerder.
              </div>
              <button
                onClick={() => navigate('/', { replace: true })}
                className="w-full py-2.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors"
              >
                Naar inloggen
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] text-sm text-rose-700">
                  {error}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nieuw wachtwoord
                </label>
                <input
                  type="password"
                  value={wachtwoord}
                  onChange={(e) => setWachtwoord(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
                  className={inputClasses}
                  placeholder="Minimaal 8 tekens"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Herhaal wachtwoord
                </label>
                <input
                  type="password"
                  value={herhaling}
                  onChange={(e) => setHerhaling(e.target.value)}
                  required
                  className={inputClasses}
                />
              </div>

              <button
                type="submit"
                disabled={bezig}
                className="w-full py-2.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
              >
                {bezig ? 'Bezig…' : 'Wachtwoord opslaan'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
