import { MagazijnLocatieEdit } from './magazijn-locatie-edit'
import { useUpdateMaatwerkLocatie, useUpdateRolLocatie } from '@/hooks/use-pick-ship'
import type { PickShipRegel } from '@/lib/types/pick-ship'

interface Props {
  regel: PickShipRegel
}

export function LocatieEdit({ regel }: Props) {
  const maatwerkMut = useUpdateMaatwerkLocatie()
  const rolMut = useUpdateRolLocatie()

  if (!regel.is_pickbaar && !regel.fysieke_locatie) {
    return <span className="text-slate-300 text-xs">-</span>
  }

  const onSave = async (code: string) => {
    if (regel.is_maatwerk) {
      await maatwerkMut.mutateAsync({ orderRegelId: regel.order_regel_id, code })
    } else {
      if (!regel.artikelnr) throw new Error('Standaard regel zonder artikelnr')
      await rolMut.mutateAsync({ artikelnr: regel.artikelnr, code })
    }
  }

  return <MagazijnLocatieEdit huidigeCode={regel.fysieke_locatie} onSave={onSave} />
}
