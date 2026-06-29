// Edge function: herplan-sweep
// Draait auto-plan-groep voor een subset van actieve (kwaliteit, kleur) groepen.
//
// Elke run pakt MAX_GROEPEN willekeurige groepen. De cron draait elke 30 minuten;
// alle ~220 groepen zijn zo in ~2 uur doorlopen. De willekeurige volgorde
// zorgt dat elke groep gelijkmatig aan bod komt.
//
// Supabase rate-limit: ~55 auto-plan-groep aanroepen per 31 seconden.
// Met BATCH_SIZE=3 en MAX_GROEPEN=50 blijven we ruim binnen de tijdslimiet.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BATCH_SIZE  = 3   // parallel per batch
const BATCH_DELAY = 300 // ms pauze tussen batches (rate-limit buffer)
const MAX_GROEPEN = 50  // max groepen per run (past ruim binnen 150s timeout)

serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceKey)
  const start = Date.now()

  // Haal actieve groepen op; DB-functie sorteert al determinisch (kw/kl volgorde)
  const { data: groepen, error } = await supabase.rpc('actieve_snijgroepen')
  if (error) {
    console.error('actieve_snijgroepen fout:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Schud de volgorde willekeurig zodat elke run een andere subset dekt
  const alle = (groepen ?? []) as { kwaliteit_code: string; kleur_code: string }[]
  for (let i = alle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[alle[i], alle[j]] = [alle[j], alle[i]]
  }
  const lijst = alle.slice(0, MAX_GROEPEN)
  console.log(`herplan-sweep: ${alle.length} groepen beschikbaar, ${lijst.length} gepland voor deze run`)

  const autoplanUrl = `${supabaseUrl}/functions/v1/auto-plan-groep`
  const authHeader  = `Bearer ${serviceKey}`

  type Resultaat = { groep: string; ok: boolean; geplaatst: number; niet_geplaatst: number; error?: string }
  const resultaten: Resultaat[] = []

  for (let i = 0; i < lijst.length; i += BATCH_SIZE) {
    const batch = lijst.slice(i, i + BATCH_SIZE)

    const batchRes = await Promise.all(batch.map(async ({ kwaliteit_code, kleur_code }) => {
      try {
        const res = await fetch(autoplanUrl, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ kwaliteit_code, kleur_code }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 120)}`)
        return {
          groep: `${kwaliteit_code}/${kleur_code}`,
          ok: data?.success === true,
          geplaatst: data?.samenvatting?.geplaatst ?? 0,
          niet_geplaatst: data?.samenvatting?.niet_geplaatst ?? 0,
        }
      } catch (e) {
        console.warn(`herplan-sweep: fout bij ${kwaliteit_code}/${kleur_code}:`, e)
        return {
          groep: `${kwaliteit_code}/${kleur_code}`,
          ok: false,
          geplaatst: 0,
          niet_geplaatst: 0,
          error: String(e).slice(0, 200),
        }
      }
    }))

    resultaten.push(...batchRes)

    if (i + BATCH_SIZE < lijst.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY))
    }
  }

  const duurMs = Date.now() - start
  const totaalGeplaatst     = resultaten.reduce((s, r) => s + r.geplaatst, 0)
  const totaalNietGeplaatst = resultaten.reduce((s, r) => s + r.niet_geplaatst, 0)
  // ok=true: daadwerkelijk iets herverdeeld; ok=false zonder error: no-op (verwacht)
  const echtefouten = resultaten.filter(r => r.error !== undefined)
  const gewijzigd   = resultaten.filter(r => r.ok).length
  const noop        = resultaten.filter(r => !r.ok && r.error === undefined).length

  console.log(
    `herplan-sweep klaar: ${lijst.length}/${alle.length} groepen verwerkt — ` +
    `${gewijzigd} gewijzigd, ${noop} no-op, ${echtefouten.length} fouten — ` +
    `${totaalGeplaatst} geplaatst, ${totaalNietGeplaatst} tekort — ${duurMs}ms`,
  )

  return new Response(JSON.stringify({
    success: true,
    totaal_groepen: alle.length,
    verwerkt: lijst.length,
    gewijzigd,
    noop,
    geplaatst: totaalGeplaatst,
    niet_geplaatst: totaalNietGeplaatst,
    fouten: echtefouten.length,
    duur_ms: duurMs,
    fout_detail: echtefouten.length > 0 ? echtefouten : undefined,
  }), { headers: { 'Content-Type': 'application/json' } })
})
