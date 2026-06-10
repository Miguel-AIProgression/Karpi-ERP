import { describe, it, expect } from 'vitest'
import { isTeKoppelen } from '../te-koppelen'

describe('isTeKoppelen', () => {
  it('true voor een inkomende order zonder gekoppelde order', () => {
    expect(isTeKoppelen({ richting: 'in', berichttype: 'order', order_id: null })).toBe(true)
  })
  it('false zodra er een order gekoppeld is', () => {
    expect(isTeKoppelen({ richting: 'in', berichttype: 'order', order_id: 42 })).toBe(false)
  })
  it('false voor uitgaande berichten of niet-orders', () => {
    expect(isTeKoppelen({ richting: 'out', berichttype: 'order', order_id: null })).toBe(false)
    expect(isTeKoppelen({ richting: 'in', berichttype: 'invoice', order_id: null })).toBe(false)
  })
})
