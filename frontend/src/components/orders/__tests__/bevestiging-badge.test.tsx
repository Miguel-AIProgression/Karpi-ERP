import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BevestigingBadge } from '../orders-table'

describe('BevestigingBadge', () => {
  it('toont OB voor een EDI-order die via ORDRSP bevestigd is (edi_bevestigd_op gezet, bevestigd_at leeg)', () => {
    render(
      <BevestigingBadge
        order={{
          bron_systeem: 'edi',
          bevestigd_at: null,
          edi_bevestigd_op: '2026-06-30T10:00:00Z',
          status: 'Klaar voor picken',
        }}
      />,
    )
    expect(screen.getByText(/OB/)).toBeInTheDocument()
    expect(screen.queryByText(/Geen OB/)).toBeNull()
  })

  it('toont Geen OB voor een onbevestigde e-mail-order', () => {
    render(
      <BevestigingBadge
        order={{ bron_systeem: null, bevestigd_at: null, edi_bevestigd_op: null, status: 'Klaar voor picken' }}
      />,
    )
    expect(screen.getByText(/Geen OB/)).toBeInTheDocument()
  })
})
