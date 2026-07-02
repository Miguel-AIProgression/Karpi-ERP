import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CombiLeveringBadge } from '../combi-levering-badge'

function renderBadge(order: Parameters<typeof CombiLeveringBadge>[0]['order']) {
  return render(
    <MemoryRouter>
      <CombiLeveringBadge order={order} />
    </MemoryRouter>,
  )
}

describe('CombiLeveringBadge', () => {
  it('rendert niets zonder groep', () => {
    const { container } = renderBadge({
      combi_levering_aantal_orders: null,
      combi_levering_andere_orders: null,
      wacht_op_combi_levering: null,
    })
    expect(container.textContent).toBe('')
  })

  it('rendert niets voor een "groep" van 1 (geen echte bundel)', () => {
    const { container } = renderBadge({
      combi_levering_aantal_orders: 1,
      combi_levering_andere_orders: [],
      wacht_op_combi_levering: false,
    })
    expect(container.textContent).toBe('')
  })

  it('toont het aantal en een wacht-tooltip zolang de drempel niet gehaald is', () => {
    const { getByText, getByTitle } = renderBadge({
      combi_levering_aantal_orders: 2,
      combi_levering_andere_orders: [{ id: 42, order_nr: 'ORD-2026-1263' }],
      wacht_op_combi_levering: true,
    })
    expect(getByText('Combi-levering (2)')).toBeTruthy()
    expect(getByTitle(/Wacht samen met ORD-2026-1263/)).toBeTruthy()
  })

  it('toont een andere tooltip zodra de drempel gehaald is', () => {
    const { getByTitle } = renderBadge({
      combi_levering_aantal_orders: 2,
      combi_levering_andere_orders: [{ id: 42, order_nr: 'ORD-2026-1263' }],
      wacht_op_combi_levering: false,
    })
    expect(getByTitle(/Wordt samen met ORD-2026-1263 verzonden/)).toBeTruthy()
  })
})
