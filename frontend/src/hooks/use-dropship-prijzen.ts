import { useQuery } from '@tanstack/react-query'
import { fetchDropshipPrijzen } from '@/lib/supabase/queries/dropshipment'

/**
 * Actuele dropship-prijzen uit `producten.verkoopprijs`. Lange staleTime —
 * prijzen wijzigen zelden; bij een DB-prijswijziging pikt een verse sessie
 * (of na invalidatie) de nieuwe waarde op. `data` is undefined tijdens laden of
 * bij een fout (ontbrekende prijs) — de selector blokkeert dan klein/groot.
 */
export function useDropshipPrijzen() {
  return useQuery({
    queryKey: ['dropship-prijzen'],
    queryFn: fetchDropshipPrijzen,
    staleTime: 1000 * 60 * 30,
  })
}
