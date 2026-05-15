import { useMutation } from '@tanstack/react-query'
import { parseKlantPo } from '@/lib/supabase/queries/po-parsing'

export function usePoParsing() {
  return useMutation({
    mutationFn: (file: File) => parseKlantPo(file),
  })
}
