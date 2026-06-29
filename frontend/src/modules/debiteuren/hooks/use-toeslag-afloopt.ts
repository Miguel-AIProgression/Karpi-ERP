import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

interface ToeslagAflooptDebiteur {
  debiteur_nr: number
  naam: string
  toeslag_einddatum: string
  einddatum_formatted: string
}

async function fetchToeslagAflooptDebiteuren(): Promise<ToeslagAflooptDebiteur[]> {
  const vandaag = new Date().toISOString().slice(0, 10)
  const over31Dagen = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam, toeslag_einddatum')
    .eq('toeslag_actief', true)
    .gte('toeslag_einddatum', vandaag)
    .lte('toeslag_einddatum', over31Dagen)
    .order('toeslag_einddatum', { ascending: true })

  if (error) throw error

  return (data ?? []).map((d) => ({
    debiteur_nr: d.debiteur_nr,
    naam: d.naam,
    toeslag_einddatum: d.toeslag_einddatum,
    einddatum_formatted: d.toeslag_einddatum
      ? d.toeslag_einddatum.split('-').reverse().join('-')
      : '?',
  }))
}

export function useToeslagAflooptCount() {
  return useQuery({
    queryKey: ['toeslag-afloopt'],
    queryFn: fetchToeslagAflooptDebiteuren,
    staleTime: 5 * 60 * 1000,
  })
}
