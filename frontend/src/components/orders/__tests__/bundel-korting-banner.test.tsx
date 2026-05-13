import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/modules/facturatie', () => ({
  useBundelInfoVoorFactuur: vi.fn(),
}))

import { useBundelInfoVoorFactuur } from '@/modules/facturatie'
import { BundelKortingBanner } from '../bundel-korting-banner'

const mockedHook = vi.mocked(useBundelInfoVoorFactuur)

function renderBanner(orderId: number, factuurId: number, factuurNr: string) {
  return render(
    <MemoryRouter>
      <BundelKortingBanner orderId={orderId} factuurId={factuurId} factuurNr={factuurNr} />
    </MemoryRouter>,
  )
}

describe('BundelKortingBanner', () => {
  it('rendert niets voor solo-factuur (geen bundel)', () => {
    mockedHook.mockReturnValue({
      data: {
        isBundel: false,
        heeftDrempelKorting: false,
        verzendkostenBedrag: 35,
        andereOrders: [],
      },
      isLoading: false,
    } as any)
    const { container } = renderBanner(100, 1, 'FACT-2026-0017')
    expect(container.textContent).toBe('')
  })

  it('rendert scenario A: drempel-korting met "weggestreept"-framing', () => {
    mockedHook.mockReturnValue({
      data: {
        isBundel: true,
        heeftDrempelKorting: true,
        verzendkostenBedrag: 35,
        andereOrders: [
          { id: 100, nr: 'ORD-2026-2057' },
          { id: 101, nr: 'ORD-2026-2058' },
        ],
      },
      isLoading: false,
    } as any)
    const { getByText } = renderBanner(100, 1, 'FACT-2026-0017')
    expect(getByText(/Bundel-korting toegepast/i)).toBeTruthy()
    expect(getByText(/ORD-2026-2058/)).toBeTruthy()
    expect(getByText(/weggestreept/i)).toBeTruthy()
    expect(getByText(/€\s*35/)).toBeTruthy()
    expect(getByText(/FACT-2026-0017/)).toBeTruthy()
  })

  it('rendert scenario B: bundel zonder drempel-korting', () => {
    mockedHook.mockReturnValue({
      data: {
        isBundel: true,
        heeftDrempelKorting: false,
        verzendkostenBedrag: 35,
        andereOrders: [
          { id: 100, nr: 'ORD-2026-2057' },
          { id: 101, nr: 'ORD-2026-2058' },
        ],
      },
      isLoading: false,
    } as any)
    const { getByText } = renderBanner(100, 1, 'FACT-2026-0017')
    expect(getByText(/Gebundelde zending/i)).toBeTruthy()
    expect(getByText(/i\.p\.v\./)).toBeTruthy()
    expect(getByText(/bespaart/i)).toBeTruthy()
  })

  it('rendert scenario B met juiste besparing voor 3-order bundle', () => {
    mockedHook.mockReturnValue({
      data: {
        isBundel: true,
        heeftDrempelKorting: false,
        verzendkostenBedrag: 35,
        andereOrders: [
          { id: 100, nr: 'ORD-2026-0100' },
          { id: 101, nr: 'ORD-2026-0101' },
          { id: 102, nr: 'ORD-2026-0102' },
        ],
      },
      isLoading: false,
    } as any)
    const { getByText } = renderBanner(100, 1, 'FACT-2026-0019')
    // 3-order bundle: andere.length = 2, bespaart 2 × 35 = 70
    expect(getByText(/i\.p\.v\. 3×/)).toBeTruthy()
    expect(getByText(/bespaart €\s*70/)).toBeTruthy()
  })
})
