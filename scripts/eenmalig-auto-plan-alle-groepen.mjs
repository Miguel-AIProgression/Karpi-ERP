/**
 * Eenmalig script: genereer en keur automatisch snijplannen goed voor ALLE groepen.
 *
 * Gebruik: node scripts/eenmalig-auto-plan-alle-groepen.mjs
 *
 * Vereist: SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY als environment variables,
 * of pas de waarden hieronder aan.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn vereist.')
  console.error('   Gebruik: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/eenmalig-auto-plan-alle-groepen.mjs')
  process.exit(1)
}

async function main() {
  // Stap 1: Haal alle kwaliteit/kleur groepen op met wachtende stukken
  console.log('📋 Groepen ophalen...')

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
    const err = await groepenRes.text()
    console.error('❌ Fout bij ophalen groepen:', err)
    process.exit(1)
  }

  const groepen = await groepenRes.json()

  // Filter: alleen groepen met wachtende stukken
  const wachtGroepen = groepen.filter(g => (g.totaal_wacht ?? 0) > 0)

  console.log(`   ${groepen.length} totale groepen, ${wachtGroepen.length} met wachtende stukken`)

  if (wachtGroepen.length === 0) {
    console.log('✅ Geen wachtende stukken gevonden. Niets te doen.')
    return
  }

  // Stap 2: Per groep auto-plan triggeren (sequentieel)
  let succes = 0
  let overgeslagen = 0
  let fouten = 0

  for (let i = 0; i < wachtGroepen.length; i++) {
    const g = wachtGroepen[i]
    const label = `${g.kwaliteit_code} ${g.kleur_code}`
    process.stdout.write(`[${i + 1}/${wachtGroepen.length}] ${label} (${g.totaal_wacht} wacht)... `)

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
        console.log(`✅ ${data.samenvatting?.geplaatst ?? '?'}/${data.samenvatting?.totaal_stukken ?? '?'} geplaatst, ${data.samenvatting?.totaal_rollen ?? '?'} rollen, ${data.samenvatting?.gemiddeld_afval_pct ?? '?'}% afval`)
        succes++
      } else if (data.skipped) {
        console.log(`⏭️  ${data.reason}`)
        overgeslagen++
      } else if (data.error) {
        console.log(`❌ ${data.error}`)
        fouten++
      }
    } catch (err) {
      console.log(`❌ ${err.message}`)
      fouten++
    }
  }

  console.log('')
  console.log('═══════════════════════════════════')
  console.log(`✅ Succes:       ${succes}`)
  console.log(`⏭️  Overgeslagen: ${overgeslagen}`)
  console.log(`❌ Fouten:       ${fouten}`)
  console.log(`   Totaal:       ${wachtGroepen.length}`)
}

main().catch(err => {
  console.error('Onverwachte fout:', err)
  process.exit(1)
})
