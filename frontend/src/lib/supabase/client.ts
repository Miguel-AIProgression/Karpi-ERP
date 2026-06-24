import { createClient } from '@supabase/supabase-js'
import { ROL_EXTERN_REP } from '@/lib/auth/rol'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase URL en Anon Key zijn vereist. Maak een .env bestand aan met VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY.'
  )
}

const rawClient = createClient(supabaseUrl, supabaseAnonKey)

// ── Read-only data-vangnet voor de externe vertegenwoordiger (mig 490 e.v.) ──
// De rep mag overal LEZEN maar nergens schrijven. De rol staat in app_metadata
// (alleen service-role kan dat zetten → niet te vervalsen). We weigeren de
// directe table-writes (.insert/.update/.delete/.upsert) hard, vóór er een
// netwerkcall vertrekt. .rpc()/.select()/storage/auth blijven ongemoeid —
// schrijf-RPC's worden via de route-guard + verborgen knoppen afgevangen.
// Dit is een vangnet bovenop de UI-rem, geen vervanging ervan.
let huidigeRol: string | null = null
function onthoudRol(
  session: { user?: { app_metadata?: Record<string, unknown> } } | null,
) {
  const r = session?.user?.app_metadata?.rol
  huidigeRol = typeof r === 'string' ? r : null
}
rawClient.auth.getSession().then(({ data }) => onthoudRol(data.session))
rawClient.auth.onAuthStateChange((_event, session) => onthoudRol(session))

const isRepReadonly = () => huidigeRol === ROL_EXTERN_REP

// Tabellen waar de rep WEL naar mag schrijven (eigen RLS regelt de rest).
const SCHRIJF_TOEGESTAAN = new Set<string>(['bug_meldingen'])
const GEBLOKKEERDE_METHODES = new Set(['insert', 'update', 'delete', 'upsert'])

function readonlyFrom(table: string) {
  const qb = rawClient.from(table)
  if (!isRepReadonly() || SCHRIJF_TOEGESTAAN.has(table)) return qb
  return new Proxy(qb, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && GEBLOKKEERDE_METHODES.has(prop)) {
        return () => {
          throw new Error(
            'Geen schrijfrechten: je bent ingelogd als externe vertegenwoordiger (read-only).',
          )
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// Alleen `.from` wordt vervangen; rpc/auth/storage/functions/channel vallen door
// naar de echte client (met .bind zodat hun interne `this` klopt). De publieke
// type-signatuur blijft SupabaseClient, dus geen enkele consument verandert.
export const supabase = new Proxy(rawClient, {
  get(target, prop, receiver) {
    if (prop === 'from') return readonlyFrom
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
