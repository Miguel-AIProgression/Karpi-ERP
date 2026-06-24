// Supabase Edge Function: gebruikers-beheer
//
// Beheer van inlog-accounts (auth.users) voor het Karpi-portaal: lijst tonen,
// uitnodigen (invite-mail), wachtwoord-reset-mail sturen, blokkeren/deblokkeren
// en verwijderen. Er is GEEN aparte tabel — auth.users is de bron-van-waarheid,
// benaderd via de Supabase admin-API (SERVICE_ROLE).
//
// Beveiliging: verify_jwt = false op de gateway (zie config.toml — de
// sb_publishable_... key is geen JWT, dus de gateway-check zou de call afwijzen).
// We verifiëren daarom HIER zelf het bearer-token van de aanroeper: alleen een
// geldig ingelogde gebruiker mag deze admin-acties uitvoeren. Zo kan niemand met
// enkel de functie-URL anoniem accounts aanmaken of verwijderen.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface RequestBody {
  actie?: string
  email?: string
  id?: string
  redirect_to?: string
  // Optionele rol-toewijzing (externe vertegenwoordiger, mig 489). Wordt als
  // app_metadata gezet — alléén service-role kan dat, dus de gebruiker kan zijn
  // eigen rol/scope niet ophogen.
  rol?: string
  vertegenw_code?: string | null
}

const ROL_EXTERN_REP = 'vertegenwoordiger_extern'

/**
 * Zet de rol-claim op een account via app_metadata. Alleen de bekende rep-rol
 * wordt geaccepteerd; die vereist een vertegenw_code (anders ziet de rep niets).
 * Geeft een foutmelding-string terug bij een ongeldige combinatie, anders null.
 */
async function zetRolClaim(
  admin: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  rol: string | undefined,
  code: string | null | undefined,
): Promise<string | null> {
  if (!rol) return null
  if (rol !== ROL_EXTERN_REP) return `Onbekende rol: ${rol}`
  const c = (code ?? '').trim()
  if (!c) return 'Vertegenwoordiger-code is verplicht bij de vertegenwoordiger-rol'
  if (!userId) return 'Geen gebruikers-id om de rol op te zetten'
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { rol, vertegenw_code: c },
  })
  if (error) return error.message
  // Bron-van-waarheid voor de RLS (mig 491): de helpers lezen de koppeling uit
  // vertegenwoordiger_login op auth.uid(), niet uit het JWT (custom app_metadata-
  // claims komen in deze setup niet in het token). Zonder deze rij filtert de RLS
  // niet → de rep zou alles zien. service_role bypasst RLS, dus de upsert mag.
  const { error: linkError } = await admin
    .from('vertegenwoordiger_login')
    .upsert({ user_id: userId, vertegenw_code: c }, { onConflict: 'user_id' })
  if (linkError) return linkError.message
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!url || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'Supabase-omgevingsvariabelen ontbreken in de functie' }, 500)
  }

  // ---- AuthN: aanroeper moet een ingelogde gebruiker zijn ----
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return jsonResponse({ error: 'Niet geautoriseerd — log opnieuw in.' }, 401)
  }
  const authClient = createClient(url, anonKey)
  const { data: { user: aanroeper }, error: aanroeperFout } = await authClient.auth.getUser(token)
  if (aanroeperFout || !aanroeper) {
    return jsonResponse({ error: 'Niet geautoriseerd — log opnieuw in.' }, 401)
  }

  // ---- AuthZ: de externe vertegenwoordiger (read-only, mig 489) mag dit
  // account-beheer NOOIT aanroepen. Anders kon een externe login via een rauwe
  // invoke collega-accounts verwijderen/uitnodigen — die rol deelt namelijk de
  // `authenticated`-rol met het personeel, dus de UI-rem (RoleGuard) is hier geen
  // beveiliging. Fail-closed op de rol-claim. (Bredere "alleen-beheerder"-gate =
  // bestaande backlog, los van deze feature.)
  if (((aanroeper.app_metadata ?? {}) as Record<string, unknown>).rol === ROL_EXTERN_REP) {
    return jsonResponse({ error: 'Geen toegang tot gebruikersbeheer.' }, 403)
  }

  // ---- Body ----
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return jsonResponse({ error: 'Ongeldige request-body (verwacht JSON)' }, 400)
  }
  const actie = body.actie

  // Admin-client (service-role) voor de daadwerkelijke gebruikersacties.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    switch (actie) {
      case 'lijst': {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        if (error) throw error
        const nu = new Date()
        const gebruikers = data.users.map((u) => {
          // banned_until zit wel in de runtime-respons maar niet in de TS-typing.
          const bannedUntil = (u as unknown as { banned_until?: string | null }).banned_until ?? null
          return {
            id: u.id,
            email: u.email ?? null,
            aangemaakt_op: u.created_at ?? null,
            laatste_login: u.last_sign_in_at ?? null,
            email_bevestigd: !!u.email_confirmed_at,
            // Uitgenodigd maar nog nooit ingelogd / wachtwoord gezet.
            uitnodiging_openstaand: !u.last_sign_in_at,
            geblokkeerd: bannedUntil ? new Date(bannedUntil) > nu : false,
          }
        })
        // Nieuwste eerst.
        gebruikers.sort((a, b) => (b.aangemaakt_op ?? '').localeCompare(a.aangemaakt_op ?? ''))
        return jsonResponse({ gebruikers }, 200)
      }

      case 'uitnodigen': {
        const email = (body.email ?? '').trim().toLowerCase()
        if (!email) return jsonResponse({ error: 'E-mailadres is verplicht' }, 400)
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: body.redirect_to,
        })
        if (error) throw error
        const rolFout = await zetRolClaim(admin, data.user?.id, body.rol, body.vertegenw_code)
        if (rolFout) return jsonResponse({ error: rolFout }, 400)
        return jsonResponse({ ok: true, id: data.user?.id ?? null }, 200)
      }

      case 'genereer-link': {
        // Maakt een deelbare actie-link aan ZONDER een mail te sturen — de
        // operator kopieert de link en stuurt 'm zelf naar de collega. Zo is
        // geen SMTP-configuratie nodig. Nieuw account → invite-link (maakt de
        // gebruiker meteen aan); bestaand account → recovery-link.
        const email = (body.email ?? '').trim().toLowerCase()
        if (!email) return jsonResponse({ error: 'E-mailadres is verplicht' }, 400)

        const inviteRes = await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: { redirectTo: body.redirect_to },
        })
        if (!inviteRes.error) {
          const rolFout = await zetRolClaim(
            admin, inviteRes.data.user?.id, body.rol, body.vertegenw_code,
          )
          if (rolFout) return jsonResponse({ error: rolFout }, 400)
          return jsonResponse(
            { link: inviteRes.data.properties?.action_link ?? null, type: 'invite' },
            200,
          )
        }

        // Bestaat de gebruiker al? Val terug op een recovery-link.
        const recoveryRes = await admin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: body.redirect_to },
        })
        if (recoveryRes.error) throw recoveryRes.error
        const rolFout = await zetRolClaim(
          admin, recoveryRes.data.user?.id, body.rol, body.vertegenw_code,
        )
        if (rolFout) return jsonResponse({ error: rolFout }, 400)
        return jsonResponse(
          { link: recoveryRes.data.properties?.action_link ?? null, type: 'recovery' },
          200,
        )
      }

      case 'wachtwoord-reset': {
        const email = (body.email ?? '').trim().toLowerCase()
        if (!email) return jsonResponse({ error: 'E-mailadres is verplicht' }, 400)
        // resetPasswordForEmail stuurt de recovery-mail; staat op de gewone client.
        const pub = createClient(url, anonKey)
        const { error } = await pub.auth.resetPasswordForEmail(email, {
          redirectTo: body.redirect_to,
        })
        if (error) throw error
        return jsonResponse({ ok: true }, 200)
      }

      case 'blokkeren':
      case 'deblokkeren': {
        const id = (body.id ?? '').trim()
        if (!id) return jsonResponse({ error: 'Gebruikers-id is verplicht' }, 400)
        if (id === aanroeper.id && actie === 'blokkeren') {
          return jsonResponse({ error: 'Je kunt je eigen account niet blokkeren' }, 400)
        }
        // '876000h' ≈ 100 jaar = effectief permanent geblokkeerd; 'none' heft op.
        const ban_duration = actie === 'blokkeren' ? '876000h' : 'none'
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration })
        if (error) throw error
        return jsonResponse({ ok: true }, 200)
      }

      case 'verwijderen': {
        const id = (body.id ?? '').trim()
        if (!id) return jsonResponse({ error: 'Gebruikers-id is verplicht' }, 400)
        if (id === aanroeper.id) {
          return jsonResponse({ error: 'Je kunt je eigen account niet verwijderen' }, 400)
        }
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error) throw error
        return jsonResponse({ ok: true }, 200)
      }

      default:
        return jsonResponse({ error: `Onbekende actie: ${actie ?? '(geen)'}` }, 400)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Onbekende fout'
    return jsonResponse({ error: msg }, 500)
  }
})
