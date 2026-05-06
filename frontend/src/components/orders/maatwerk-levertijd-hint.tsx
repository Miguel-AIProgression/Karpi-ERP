import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { fetchMaatwerkLevertijdHint } from '@/lib/supabase/queries/op-maat'

interface Props {
  kwaliteitCode: string | null | undefined
  kleurCode: string | null | undefined
}

/**
 * Toont een inline hint onder een maatwerk-orderregel als er geen eigen rol op
 * voorraad is. Drie varianten:
 * - uitwisselbare partner-rol op voorraad → groen "leverbaar via omsticker" (issue #37)
 * - openstaande inkoop bekend             → eerstvolgende leverweek (neutraal grijs)
 * - geen openstaande inkoop               → expliciete waarschuwing in amber (issue #32)
 *
 * V1: alleen indicator (geen claim op rol-IO).
 */
export function MaatwerkLevertijdHint({ kwaliteitCode, kleurCode }: Props) {
  const { data } = useQuery({
    queryKey: ['maatwerk-levertijd-hint', kwaliteitCode, kleurCode],
    queryFn: () => fetchMaatwerkLevertijdHint(kwaliteitCode!, kleurCode!),
    enabled: !!kwaliteitCode && !!kleurCode,
  })

  if (!data) return null

  if (data.status === 'voorraad_uitwisselbaar') {
    return (
      <div className="text-xs text-emerald-700 mt-1 inline-flex items-center gap-1">
        <ArrowRightLeft size={12} />
        <span>
          Geen eigen rol op voorraad — leverbaar via uitwisselbare kwaliteit{' '}
          <span className="font-mono font-medium text-emerald-800">
            {data.partner_kwaliteit}-{data.partner_kleur}
          </span>
          {' '}({data.partner_rollen} rol{data.partner_rollen !== 1 ? 'len' : ''}, {data.partner_m2} m²) — wordt omgestickerd.
        </span>
      </div>
    )
  }

  if (data.status === 'geen_inkoop') {
    return (
      <div className="text-xs text-amber-700 mt-1 inline-flex items-center gap-1">
        <AlertTriangle size={12} />
        <span>
          Niet op voorraad — geen lopende inkoop bekend.{' '}
          <span className="font-medium">Levertijd onbekend</span>, neem contact op met inkoop.
        </span>
      </div>
    )
  }

  return (
    <div className="text-xs text-slate-500 mt-1">
      Geen rol op voorraad. Eerstvolgende inkoop → leverbaar{' '}
      <span className="font-medium text-slate-700">{data.verwachte_leverweek}</span>
    </div>
  )
}
