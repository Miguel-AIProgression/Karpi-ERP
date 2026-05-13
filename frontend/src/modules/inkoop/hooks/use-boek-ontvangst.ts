import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  boekOntvangst,
  boekVoorraadOntvangst,
  type OntvangstRol,
} from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

/**
 * RPC-wrapper voor de ontvangst-flow.
 *
 * In Task 4 (mig 271) worden de onderliggende RPCs hernoemd naar
 * `boek_inkooporder_ontvangst_stuks` (stuks-pad) en `_rollen` (rollen-pad);
 * de queries-functies `boekOntvangst` / `boekVoorraadOntvangst` blijven
 * voorlopig de OUDE RPC-namen (`boek_ontvangst` / `boek_voorraad_ontvangst`)
 * aanroepen tot Task 4 ook hen omzet.
 *
 * Discriminator op input: `aantal` → stuks-pad; `rollen` → rollen-pad.
 * Het publieke contract (`BoekOntvangstStuksInput` / `BoekOntvangstRollenInput`)
 * blijft stabiel over de Task 4-rename heen.
 */

export interface BoekOntvangstStuksInput {
  ioRegelId: number
  aantal: number
  medewerker?: string
}

export interface BoekOntvangstRollenInput {
  ioRegelId: number
  rollen: OntvangstRol[]
  medewerker?: string
}

export type BoekOntvangstInput = BoekOntvangstStuksInput | BoekOntvangstRollenInput

export function useBoekOntvangst() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: BoekOntvangstInput) => {
      if ('aantal' in input) {
        await boekVoorraadOntvangst(input.ioRegelId, input.aantal, input.medewerker)
        return { kind: 'stuks' as const }
      }
      const rollen = await boekOntvangst(input.ioRegelId, input.rollen, input.medewerker)
      return { kind: 'rollen' as const, rollen }
    },
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}
