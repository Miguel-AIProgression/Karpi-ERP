import { useQuery } from '@tanstack/react-query'
import { fetchMaatwerkLevertijdHint } from '@/lib/supabase/queries/op-maat'

interface Props {
  kwaliteitCode: string | null | undefined
  kleurCode: string | null | undefined
}

/**
 * Toont een inline hint onder een maatwerk-orderregel als er geen rol op
 * voorraad is, maar wel openstaande inkoop. V1: alleen indicator (geen claim).
 */
export function MaatwerkLevertijdHint({ kwaliteitCode, kleurCode }: Props) {
  const { data } = useQuery({
    queryKey: ['maatwerk-levertijd-hint', kwaliteitCode, kleurCode],
    queryFn: () => fetchMaatwerkLevertijdHint(kwaliteitCode!, kleurCode!),
    enabled: !!kwaliteitCode && !!kleurCode,
  })

  if (!data) return null

  return (
    <div className="text-xs text-slate-500 mt-1">
      Geen rol op voorraad. Eerstvolgende inkoop → leverbaar{' '}
      <span className="font-medium text-slate-700">{data.verwachte_leverweek}</span>
    </div>
  )
}
