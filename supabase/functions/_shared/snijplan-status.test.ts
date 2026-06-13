import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ROL_FYSIEK_BEZET, SNIJPLAN_STATUSSEN } from './snijplan-status.ts'

Deno.test('ROL_FYSIEK_BEZET is deelverzameling van de enum', () => {
  for (const s of ROL_FYSIEK_BEZET) {
    assert((SNIJPLAN_STATUSSEN as readonly string[]).includes(s))
  }
})
