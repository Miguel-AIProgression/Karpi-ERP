import type React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KlantEdiTab } from './klant-edi-tab'
import { BERICHTTYPE_REGISTRY } from '../registry'

vi.mock('@/modules/edi/queries/edi', () => ({
  fetchHandelspartnerConfig: vi.fn(),
  upsertHandelspartnerConfig: vi.fn(),
}))

import {
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
} from '@/modules/edi/queries/edi'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const BASE_CONFIG = {
  debiteur_nr: 600556,
  transus_actief: true,
  order_in: true,
  orderbev_uit: true,
  factuur_uit: false,
  verzend_uit: false,
  test_modus: false,
  notities: null,
  created_at: '2026-04-30T10:00:00Z',
  updated_at: '2026-04-30T10:00:00Z',
}

const TOTAL_TYPES = Object.keys(BERICHTTYPE_REGISTRY).length
const TOTAL_TOGGLES = 2 + TOTAL_TYPES

beforeEach(() => {
  vi.clearAllMocks()
})

describe('KlantEdiTab', () => {
  it('toont alle berichttypen uit de registry met juiste toestand', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(BASE_CONFIG)

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    for (const def of Object.values(BERICHTTYPE_REGISTRY)) {
      expect(await screen.findByText(def.uiLabel)).toBeInTheDocument()
    }

    const toggles = screen.getAllByRole('switch')
    expect(toggles).toHaveLength(TOTAL_TOGGLES)
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true')
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false')
  })

  it('schakelt processen uit als hoofdschakelaar uit staat', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue({
      ...BASE_CONFIG,
      transus_actief: false,
    })

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.order.uiLabel)
    const toggles = screen.getAllByRole('switch')
    for (let i = 2; i < toggles.length; i++) {
      expect(toggles[i]).toBeDisabled()
    }
  })

  it('roept upsert aan bij toggle-klik op factuur_uit', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(BASE_CONFIG)
    vi.mocked(upsertHandelspartnerConfig).mockResolvedValue({
      ...BASE_CONFIG,
      factuur_uit: true,
    })

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.factuur.uiLabel)
    // Toggle-volgorde in DOM: [transus_actief, test_modus, ...INKOMEND, ...UITGAAND]
    // Met huidige registry: [transus, test, order, orderbev, factuur, verzendbericht]
    // Dus factuur zit op index 4. Bereken dynamisch op basis van registry-volgorde:
    const inkomend = Object.values(BERICHTTYPE_REGISTRY).filter((t) => t.richting === 'in')
    const uitgaand = Object.values(BERICHTTYPE_REGISTRY).filter((t) => t.richting === 'uit')
    const factuurIdxInUitgaand = uitgaand.findIndex((t) => t.code === 'factuur')
    const factuurToggleIdx = 2 + inkomend.length + factuurIdxInUitgaand
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[factuurToggleIdx])

    await waitFor(() => {
      expect(upsertHandelspartnerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          debiteur_nr: 600556,
          factuur_uit: true,
        }),
      )
    })
  })

  it('valt terug op default-config als geen rij bestaat', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(null)

    renderWithClient(<KlantEdiTab debiteurNr={999999} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.order.uiLabel)
    const toggles = screen.getAllByRole('switch')
    toggles.forEach((t) => expect(t).toHaveAttribute('aria-checked', 'false'))
    for (let i = 2; i < toggles.length; i++) {
      expect(toggles[i]).toBeDisabled()
    }
  })
})
