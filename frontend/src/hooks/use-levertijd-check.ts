// Dit bestand bevat twee gedaantes met VERSCHILLENDE levensduur — zie het
// Amendement in docs/adr/0020-levertijd-als-deep-module.md (2026-05-15):
//
//   1. `useLevertijdCheck` — wrapt de `check-levertijd` edge function
//      (kwaliteit/kleur/lengte/breedte/gewenste leverdatum). Dit is de
//      **permanente** bron voor de pre-persist maatwerk-config-flow van
//      `LevertijdSuggestie`: tijdens het samenstellen van een maatwerk-regel
//      is er per definitie nog géén orderregel-id, en de rijke scenario-UX
//      (scenario-badge, onderbouwing, rol-match, capaciteit, backlog) is een
//      productvereiste. Dit pad verdwijnt NIET — de Module-RPC's
//      (`levertijd_fit_check` + `levertijd_snelste_haalbaar`) bedienen een
//      andere vraag (gepersisteerde regel-id's, smalle output). Bewust twee
//      paden; geen tech-debt.
//
//   2. Een re-export van `useFitCheck` uit `@/modules/levertijd`. DIT deel is
//      een migratie-alias: nieuw werk importeert rechtstreeks uit
//      `@/modules/levertijd`, niet via dit pad. De ESLint-no-restricted-
//      imports-regel bewaakt dat (LevertijdSuggestie is de gedocumenteerde
//      uitzondering).

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkLevertijd } from '@/lib/supabase/queries/levertijd'
import type { CheckLevertijdRequest, CheckLevertijdResponse } from '@/lib/supabase/queries/levertijd'

/**
 * @deprecated Gebruik `useFitCheck` uit `@/modules/levertijd` (ADR-0020).
 *             Re-export voor migrerende callers — wijst naar de Module-API
 *             rond `levertijd_fit_check` (mig 277).
 */
export { useFitCheck } from '@/modules/levertijd'

const DEBOUNCE_MS = 350
const STALE_TIME_MS = 60_000

export interface UseLevertijdCheckArgs {
  kwaliteitCode?: string | null
  kleurCode?: string | null
  lengteCm?: number | null
  breedteCm?: number | null
  vorm?: string | null
  gewensteLeverdatum?: string | null
  debiteurNr?: number | null
  enabled?: boolean
}

interface DebouncedArgs {
  kwaliteit: string
  kleur: string
  lengte: number
  breedte: number
  vorm?: string | null
  gewensteLeverdatum?: string | null
  debiteurNr?: number | null
}

function isReady(args: UseLevertijdCheckArgs): DebouncedArgs | null {
  if (!args.kwaliteitCode || !args.kleurCode) return null
  if (!args.lengteCm || !args.breedteCm) return null
  if (args.lengteCm <= 0 || args.breedteCm <= 0) return null
  return {
    kwaliteit: args.kwaliteitCode,
    kleur: args.kleurCode,
    lengte: args.lengteCm,
    breedte: args.breedteCm,
    vorm: args.vorm ?? null,
    gewensteLeverdatum: args.gewensteLeverdatum ?? null,
    debiteurNr: args.debiteurNr ?? null,
  }
}

/**
 * Permanente bron voor de **pre-persist maatwerk-config-flow** van
 * `LevertijdSuggestie` (kwaliteit/kleur/maten, géén orderregel-id, rijke
 * scenario-UX). Bewust géén `@deprecated`: dit is geen migratie-restant maar
 * een apart, legitiem pad naast de Levertijd-Module-RPC's — zie het
 * Amendement in ADR-0020 (2026-05-15). Voor gepersisteerde regels:
 * `useFitCheck` / `useSnelsteHaalbaar` uit `@/modules/levertijd`.
 */
export function useLevertijdCheck(args: UseLevertijdCheckArgs) {
  const ready = isReady(args)
  const [debounced, setDebounced] = useState<DebouncedArgs | null>(ready)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(ready), DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready?.kwaliteit,
    ready?.kleur,
    ready?.lengte,
    ready?.breedte,
    ready?.vorm,
    ready?.gewensteLeverdatum,
    ready?.debiteurNr,
  ])

  return useQuery<CheckLevertijdResponse, Error>({
    queryKey: ['levertijd-check', debounced],
    queryFn: () => {
      if (!debounced) throw new Error('args niet klaar')
      const req: CheckLevertijdRequest = {
        kwaliteit_code: debounced.kwaliteit,
        kleur_code: debounced.kleur,
        lengte_cm: debounced.lengte,
        breedte_cm: debounced.breedte,
        ...(debounced.vorm ? { vorm: debounced.vorm } : {}),
        ...(debounced.gewensteLeverdatum ? { gewenste_leverdatum: debounced.gewensteLeverdatum } : {}),
        ...(debounced.debiteurNr != null ? { debiteur_nr: debounced.debiteurNr } : {}),
      }
      return checkLevertijd(req)
    },
    enabled: debounced !== null && (args.enabled ?? true),
    staleTime: STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
