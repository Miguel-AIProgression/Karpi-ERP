import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapaciteitBalk } from '../capaciteit-balk'

describe('CapaciteitBalk', () => {
  it('toont groen bij <80% bezetting', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={100} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-emerald-500')).toBeTruthy()
    expect(screen.getByText(/10%/)).toBeTruthy()
  })

  it('toont amber bij 80-100% bezetting', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={900} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-amber-500')).toBeTruthy()
  })

  it('toont rood + percentage > 100 bij overload', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={1500} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-red-500')).toBeTruthy()
    expect(screen.getByText(/150%/)).toBeTruthy()
  })
})
