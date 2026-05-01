import { useQuery } from '@tanstack/react-query'
import { fetchMaatwerkLevertijdHint } from '@/lib/supabase/queries/op-maat'

interface Props {
  kwaliteitCode: string | null | undefined
  kleurCode: string | null | undefined
  vormCode?: string | null
}

/**
 * Toont een inline hint onder een maatwerk-orderregel als er geen rol op
 * voorraad is, maar wel openstaande inkoop. V1: alleen indicator (geen claim).
 * Voor niet-rechthoek vormen wordt de langere vormwerk-buffer gebruikt (6 weken).
 */
export function MaatwerkLevertijdHint({ kwaliteitCode, kleurCode, vormCode = null }: Props) {
  const { data } = useQuery({
    queryKey: ['maatwerk-levertijd-hint', kwaliteitCode, kleurCode, vormCode ?? null],
    queryFn: () => fetchMaatwerkLevertijdHint(kwaliteitCode!, kleurCode!, vormCode ?? null),
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
