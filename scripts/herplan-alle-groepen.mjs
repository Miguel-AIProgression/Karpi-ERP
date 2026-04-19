/**
 * Herplan ALLE kwaliteit/kleur-groepen met 'Snijden'-stukken.
 *
 * Verschil met eenmalig-auto-plan-alle-groepen.mjs: dat script sloeg
 * groepen over waar álle stukken al een rol_id hadden. Dit script draait
 * voor elke groep met >0 Snijden-stukken, zodat suboptimaal geplande
 * rollen herverdeeld worden (gap-filling, reststuk-bescherming).
 *
 * `release_gepland_stukken` raakt alléén rollen zonder `snijden_gestart_op`
 * aan — rollen die fysiek in productie zijn blijven onaangeroerd.
 *
 * Gebruik:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/herplan-alle-groepen.mjs
 *   # Optioneel 1 specifieke groep:
 *   ... node scripts/herplan-alle-groepen.mjs OASI_11 11
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn vereist.')
  process.exit(1)
}

const [kwaliteitArg, kleurArg] = process.argv.slice(2)

async function main() {
  console.log('Groepen ophalen...')

  const groepenRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/snijplanning_groepen_gefilterd`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ p_tot_datum: null }),
    },
  )

  if (!groepenRes.ok) {
    console.error('Fout bij ophalen groepen:', await groepenRes.text())
    process.exit(1)
  }

  const groepen = await groepenRes.json()

  // Herplan alle groepen met 'Snijden'-stukken (ongeacht of ze al een rol hebben).
  let doelGroepen = groepen.filter((g) => (g.totaal_snijden ?? 0) > 0)

  if (kwaliteitArg && kleurArg) {
    doelGroepen = doelGroepen.filter(
      (g) => g.kwaliteit_code === kwaliteitArg && g.kleur_code === kleurArg,
    )
    if (doelGroepen.length === 0) {
      console.error(`Geen match voor ${kwaliteitArg} / ${kleurArg}`)
      process.exit(1)
    }
  }

  console.log(`${groepen.length} totale groepen, ${doelGroepen.length} te herplannen`)

  if (doelGroepen.length === 0) {
    console.log('Niets te herplannen.')
    return
  }

  let succes = 0
  let overgeslagen = 0
  let fouten = 0
  let totaalM2Gebruikt = 0
  let totaalRollen = 0

  for (let i = 0; i < doelGroepen.length; i++) {
    const g = doelGroepen[i]
    const label = `${g.kwaliteit_code} ${g.kleur_code}`
    const snijdenCount = g.totaal_snijden ?? 0
    process.stdout.write(`[${i + 1}/${doelGroepen.length}] ${label} (${snijdenCount} stukken)... `)

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/auto-plan-groep`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            kwaliteit_code: g.kwaliteit_code,
            kleur_code: g.kleur_code,
          }),
        },
      )

      const data = await res.json()

      if (data.success) {
        const s = data.samenvatting ?? {}
        console.log(`OK ${s.geplaatst ?? '?'}/${s.totaal_stukken ?? '?'} op ${s.totaal_rollen ?? '?'} rol(len), ${s.gemiddeld_afval_pct ?? '?'}% afval`)
        succes++
        totaalRollen += s.totaal_rollen ?? 0
        totaalM2Gebruikt += s.totaal_m2_gebruikt ?? 0
      } else if (data.skipped) {
        console.log(`skip: ${data.reason}`)
        overgeslagen++
      } else if (data.error) {
        console.log(`FOUT: ${data.error}`)
        if (data.detail || data.hint || data.code) {
          console.log(`   ${JSON.stringify({ code: data.code, detail: data.detail, hint: data.hint })}`)
        }
        fouten++
      } else {
        console.log(`onbekende respons: ${JSON.stringify(data).slice(0, 300)}`)
        fouten++
      }
    } catch (err) {
      console.log(`FOUT: ${err.message}`)
      fouten++
    }
  }

  console.log('')
  console.log('====================================')
  console.log(`Succes:       ${succes}`)
  console.log(`Overgeslagen: ${overgeslagen}`)
  console.log(`Fouten:       ${fouten}`)
  console.log(`Totaal:       ${doelGroepen.length}`)
  console.log(`Rollen gebruikt: ${totaalRollen}`)
  console.log(`M² gebruikt:  ${totaalM2Gebruikt.toFixed(1)}`)
}

main().catch((err) => {
  console.error('Onverwachte fout:', err)
  process.exit(1)
})
