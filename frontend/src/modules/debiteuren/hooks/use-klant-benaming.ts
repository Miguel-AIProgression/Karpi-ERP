import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

interface UseKlantBenamingArgs {
  debiteurNr: number | null | undefined
  kwaliteitCode: string | null | undefined
  kleurCode?: string | null
  enabled?: boolean
}

export function useKlantBenaming({
  debiteurNr,
  kwaliteitCode,
  kleurCode,
  enabled = true,
}: UseKlantBenamingArgs) {
  return useQuery({
    queryKey: ['klanteigen-namen', 'resolve', debiteurNr, kwaliteitCode, kleurCode ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_klanteigen_naam', {
        p_debiteur_nr: debiteurNr,
        p_kwaliteit_code: kwaliteitCode,
        p_kleur_code: kleurCode ?? null,
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
    enabled: enabled && !!debiteurNr && !!kwaliteitCode,
    staleTime: 60_000,
  })
}
