import { describe, it, expect } from 'vitest'
import { isAdminPseudo } from '../admin-pseudo'

describe('isAdminPseudo', () => {
  it('returns true voor regel met is_pseudo=true', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: true } })).toBe(true)
  })

  it('returns false voor regel met is_pseudo=false', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: false } })).toBe(false)
  })

  it('returns false voor regel zonder producten-join', () => {
    expect(isAdminPseudo({ producten: null })).toBe(false)
    expect(isAdminPseudo({})).toBe(false)
  })

  it('returns false voor null/undefined regel', () => {
    expect(isAdminPseudo(null)).toBe(false)
    expect(isAdminPseudo(undefined)).toBe(false)
  })

  it('returns false als is_pseudo expliciet null is (DB-default voor pre-mig-272 oude rijen)', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: null } })).toBe(false)
  })

  it('returns true voor form-data shape met is_pseudo=true top-level (OrderRegelFormData)', () => {
    expect(isAdminPseudo({ is_pseudo: true })).toBe(true)
  })

  it('returns false voor form-data shape met is_pseudo=false top-level', () => {
    expect(isAdminPseudo({ is_pseudo: false })).toBe(false)
  })

  it('returns true wanneer top-level FALSE maar producten.is_pseudo TRUE (query-resultaat wint)', () => {
    expect(isAdminPseudo({ is_pseudo: false, producten: { is_pseudo: true } })).toBe(true)
  })
})
