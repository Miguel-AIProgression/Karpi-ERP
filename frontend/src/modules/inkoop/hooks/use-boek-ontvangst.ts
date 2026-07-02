import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  boekOntvangst,
  boekVoorraadOntvangst,
  type OntvangstRol,
} from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

/**
 * RPC-wrapper voor de ontvangst-flow.
 * Roept de Inkoop-Module-RPC's aan: `boek_inkooporder_ontvangst_stuks`
 * (stuks-pad) en `boek_inkooporder_ontvangst_rollen` (rollen-pad, mig 271+).
 * Discriminator op input: `aantal` → stuks-pad; `rollen` → rollen-pad.
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
  staOverleveringToe?: boolean
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
      const rollen = await boekOntvangst(
        input.ioRegelId,
        input.rollen,
        input.medewerker,
        input.staOverleveringToe ?? false,
      )
      return { kind: 'rollen' as const, rollen }
    },
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}
