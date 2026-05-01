import { useEffect, useState } from 'react'
import type { Vervoerder, VervoerderUpdateInput } from '@/modules/logistiek/queries/vervoerders'

export interface VervoerderFormState {
  api_endpoint: string
  api_customer_id: string
  account_nummer: string
  kontakt_naam: string
  kontakt_email: string
  kontakt_telefoon: string
  tarief_notities: string
  notities: string
}

const EMPTY_FORM: VervoerderFormState = {
  api_endpoint: '',
  api_customer_id: '',
  account_nummer: '',
  kontakt_naam: '',
  kontakt_email: '',
  kontakt_telefoon: '',
  tarief_notities: '',
  notities: '',
}

function nullToEmpty(value: string | null | undefined): string {
  return value ?? ''
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function fromVervoerder(v: Vervoerder): VervoerderFormState {
  return {
    api_endpoint: nullToEmpty(v.api_endpoint),
    api_customer_id: nullToEmpty(v.api_customer_id),
    account_nummer: nullToEmpty(v.account_nummer),
    kontakt_naam: nullToEmpty(v.kontakt_naam),
    kontakt_email: nullToEmpty(v.kontakt_email),
    kontakt_telefoon: nullToEmpty(v.kontakt_telefoon),
    tarief_notities: nullToEmpty(v.tarief_notities),
    notities: nullToEmpty(v.notities),
  }
}

/**
 * Stuurt het edit-form van de vervoerder-detailpagina aan.
 *
 * - Vult de form-state telkens als de Supabase-query met nieuwe data terugkomt.
 * - Levert `update`, `dirty`, `reset` en `toUpdateInput` aan de pagina.
 */
export function useVervoerderForm(vervoerder: Vervoerder | null | undefined) {
  const [form, setForm] = useState<VervoerderFormState>(EMPTY_FORM)

  useEffect(() => {
    if (!vervoerder) return
    setForm(fromVervoerder(vervoerder))
  }, [vervoerder])

  const update = <K extends keyof VervoerderFormState>(
    key: K,
    value: VervoerderFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  const reset = () => {
    if (!vervoerder) return
    setForm(fromVervoerder(vervoerder))
  }

  const dirty = vervoerder
    ? (Object.keys(form) as (keyof VervoerderFormState)[]).some(
        (k) => form[k] !== nullToEmpty(vervoerder[k as keyof Vervoerder] as string | null),
      )
    : false

  const toUpdateInput = (isApi: boolean): VervoerderUpdateInput => ({
    api_endpoint: isApi ? emptyToNull(form.api_endpoint) : null,
    api_customer_id: isApi ? emptyToNull(form.api_customer_id) : null,
    account_nummer: emptyToNull(form.account_nummer),
    kontakt_naam: emptyToNull(form.kontakt_naam),
    kontakt_email: emptyToNull(form.kontakt_email),
    kontakt_telefoon: emptyToNull(form.kontakt_telefoon),
    tarief_notities: emptyToNull(form.tarief_notities),
    notities: emptyToNull(form.notities),
  })

  return { form, update, reset, dirty, toUpdateInput }
}
