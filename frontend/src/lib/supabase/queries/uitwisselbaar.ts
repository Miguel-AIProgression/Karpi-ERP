import { supabase } from '../client'

/** Uitwisselbare groepen: collecties met 2+ kwaliteiten en hun kleuren */
export interface UitwisselbareKwaliteit {
  code: string
  omschrijving: string | null
  kleuren: string[]
}

export interface UitwisselbareGroep {
  collectie_id: number
  collectie_naam: string
  kwaliteiten: UitwisselbareKwaliteit[]
  gedeelde_kleuren: string[]
  niet_overeenkomende_kleuren: string[]
}

export async function fetchUitwisselbareGroepen(): Promise<UitwisselbareGroep[]> {
  // 1. Fetch collecties and kwaliteiten in parallel (independent queries)
  const [collectiesRes, kwaliteitenRes] = await Promise.all([
    supabase.from('collecties').select('id, naam').eq('actief', true).order('naam'),
    supabase.from('kwaliteiten').select('code, omschrijving, collectie_id').not('collectie_id', 'is', null).order('code'),
  ])

  if (collectiesRes.error) throw collectiesRes.error
  if (kwaliteitenRes.error) throw kwaliteitenRes.error

  const collecties = collectiesRes.data
  const kwaliteiten = kwaliteitenRes.data

  // 2. Fetch kleur_codes per kwaliteit in batches (Supabase default limit = 1000)
  const linkedCodes = kwaliteiten.map((k: { code: string }) => k.code)
  if (linkedCodes.length === 0) return []

  const producten: { kwaliteit_code: string; kleur_code: string }[] = []
  const PAGE_SIZE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('producten')
      .select('kwaliteit_code, kleur_code')
      .in('kwaliteit_code', linkedCodes)
      .eq('actief', true)
      .not('kleur_code', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    producten.push(...(data as { kwaliteit_code: string; kleur_code: string }[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // Build kleur sets per kwaliteit
  const kleurenPerKwaliteit = new Map<string, Set<string>>()
  for (const p of producten as { kwaliteit_code: string; kleur_code: string }[]) {
    if (!kleurenPerKwaliteit.has(p.kwaliteit_code)) {
      kleurenPerKwaliteit.set(p.kwaliteit_code, new Set())
    }
    kleurenPerKwaliteit.get(p.kwaliteit_code)!.add(p.kleur_code)
  }

  // Group kwaliteiten by collectie
  const kwalPerCollectie = new Map<number, { code: string; omschrijving: string | null }[]>()
  for (const k of kwaliteiten as { code: string; omschrijving: string | null; collectie_id: number }[]) {
    if (!kwalPerCollectie.has(k.collectie_id)) {
      kwalPerCollectie.set(k.collectie_id, [])
    }
    kwalPerCollectie.get(k.collectie_id)!.push({ code: k.code, omschrijving: k.omschrijving })
  }

  // Build groups (only collecties with 2+ kwaliteiten)
  const groepen: UitwisselbareGroep[] = []
  for (const c of collecties as { id: number; naam: string }[]) {
    const kwals = kwalPerCollectie.get(c.id)
    if (!kwals || kwals.length < 2) continue

    const kwaliteitKleuren = kwals.map((k) => ({
      ...k,
      kleuren: Array.from(kleurenPerKwaliteit.get(k.code) ?? []).sort(),
    }))

    // Calculate shared vs unique colors
    const allKleurSets = kwaliteitKleuren.map((k) => new Set(k.kleuren))
    const allKleuren = new Set(kwaliteitKleuren.flatMap((k) => k.kleuren))
    const gedeeld: string[] = []
    const nietOvereenkomend: string[] = []

    for (const kleur of allKleuren) {
      const inCount = allKleurSets.filter((s) => s.has(kleur)).length
      if (inCount >= 2) {
        gedeeld.push(kleur)
      } else {
        nietOvereenkomend.push(kleur)
      }
    }

    groepen.push({
      collectie_id: c.id,
      collectie_naam: c.naam,
      kwaliteiten: kwaliteitKleuren,
      gedeelde_kleuren: gedeeld.sort(),
      niet_overeenkomende_kleuren: nietOvereenkomend.sort(),
    })
  }

  return groepen
}

/** Eén kwaliteit, met kleuren en de naam van de groep waarin hij eventueel al zit — voor de koppel-dialoog. */
export interface KoppelbareKwaliteit {
  code: string
  omschrijving: string | null
  kleuren: string[]
  collectie_id: number | null
  collectie_naam: string | null
}

/** Alle kwaliteiten + hun kleuren + huidige groep (indien aanwezig), voor de leden-kiezer in groep-aanmaken/-bewerken. */
export async function fetchKoppelbareKwaliteiten(): Promise<KoppelbareKwaliteit[]> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, omschrijving, collectie_id, collecties ( naam )')
    .order('code')
  if (error) throw error

  const kwaliteiten = (data ?? []) as unknown as {
    code: string
    omschrijving: string | null
    collectie_id: number | null
    collecties: { naam: string } | { naam: string }[] | null
  }[]
  if (kwaliteiten.length === 0) return []

  // Kleuren per kwaliteit ophalen (gepagineerd, Supabase default limit = 1000)
  const codes = kwaliteiten.map((k) => k.code)
  const producten: { kwaliteit_code: string; kleur_code: string }[] = []
  const PAGE_SIZE = 1000
  let offset = 0
  while (true) {
    const { data: pData, error: pError } = await supabase
      .from('producten')
      .select('kwaliteit_code, kleur_code')
      .in('kwaliteit_code', codes)
      .eq('actief', true)
      .not('kleur_code', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)
    if (pError) throw pError
    if (!pData || pData.length === 0) break
    producten.push(...(pData as { kwaliteit_code: string; kleur_code: string }[]))
    if (pData.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const kleurenPerKwaliteit = new Map<string, Set<string>>()
  for (const p of producten) {
    if (!kleurenPerKwaliteit.has(p.kwaliteit_code)) kleurenPerKwaliteit.set(p.kwaliteit_code, new Set())
    kleurenPerKwaliteit.get(p.kwaliteit_code)!.add(p.kleur_code)
  }

  return kwaliteiten.map((r) => {
    const collectie = Array.isArray(r.collecties) ? r.collecties[0] : r.collecties
    return {
      code: r.code,
      omschrijving: r.omschrijving,
      kleuren: Array.from(kleurenPerKwaliteit.get(r.code) ?? []).sort(),
      collectie_id: r.collectie_id,
      collectie_naam: collectie?.naam ?? null,
    }
  })
}

/** Bulk-zet `collectie_id` op kwaliteiten — kern-mutatie voor groep-lidmaatschap. `null` ontkoppelt. */
export async function setKwaliteitenCollectie(codes: string[], collectieId: number | null) {
  if (codes.length === 0) return
  const { error } = await supabase
    .from('kwaliteiten')
    .update({ collectie_id: collectieId })
    .in('code', codes)
  if (error) throw error
}

/** Genereert een unieke `groep_code` voor handmatig aangemaakte groepen, afgeleid van de naam. */
async function genereerGroepCode(naam: string): Promise<string> {
  const basis = 'man_' + naam
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // diakritische tekens weg
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)

  let kandidaat = basis
  let suffix = 2
  while (true) {
    const { data, error } = await supabase
      .from('collecties')
      .select('id')
      .eq('groep_code', kandidaat)
      .maybeSingle()
    if (error) throw error
    if (!data) return kandidaat
    kandidaat = `${basis}_${suffix}`
    suffix += 1
  }
}

/** Maakt een nieuwe uitwisselbare groep (collectie) aan en koppelt direct de gekozen kwaliteiten eraan. */
export async function createUitwisselbareGroep(naam: string, kwaliteitCodes: string[]): Promise<number> {
  const trimmedNaam = naam.trim()
  if (!trimmedNaam) throw new Error('Naam is verplicht')
  if (kwaliteitCodes.length < 2) throw new Error('Een groep heeft minimaal 2 kwaliteiten nodig')

  const groepCode = await genereerGroepCode(trimmedNaam)

  const { data, error } = await supabase
    .from('collecties')
    .insert({ groep_code: groepCode, naam: trimmedNaam, actief: true })
    .select('id')
    .single()
  if (error) throw error

  const collectieId = data.id as number
  await setKwaliteitenCollectie(kwaliteitCodes, collectieId)
  return collectieId
}

/** Hernoemt een groep (collectie). */
export async function hernoemUitwisselbareGroep(collectieId: number, naam: string) {
  const trimmedNaam = naam.trim()
  if (!trimmedNaam) throw new Error('Naam is verplicht')
  const { error } = await supabase
    .from('collecties')
    .update({ naam: trimmedNaam })
    .eq('id', collectieId)
  if (error) throw error
}

/**
 * Werkt het lidmaatschap van een groep bij: voegt `toevoegen` toe (zet hun
 * `collectie_id`, eventueel verplaatst vanuit een andere groep) en ontkoppelt
 * `verwijderen` (zet `collectie_id` terug op NULL).
 */
export async function updateUitwisselbareGroepLeden(
  collectieId: number,
  toevoegen: string[],
  verwijderen: string[],
) {
  if (toevoegen.length > 0) await setKwaliteitenCollectie(toevoegen, collectieId)
  if (verwijderen.length > 0) await setKwaliteitenCollectie(verwijderen, null)
}
