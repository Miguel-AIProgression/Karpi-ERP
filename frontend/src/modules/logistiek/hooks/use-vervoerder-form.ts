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
  // Print-config (mig 207)
  printer_naam: string
  printer_ip: string
  label_breedte_mm: string
  label_hoogte_mm: string
  service_codes: string // comma-separated input
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
  printer_naam: '',
  printer_ip: '',
  label_breedte_mm: '',
  label_hoogte_mm: '',
  service_codes: '',
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
    printer_naam: nullToEmpty(v.printer_naam),
    printer_ip: nullToEmpty(v.printer_ip),
    label_breedte_mm: v.label_breedte_mm == null ? '' : String(v.label_breedte_mm),
    label_hoogte_mm: v.label_hoogte_mm == null ? '' : String(v.label_hoogte_mm),
    service_codes: (v.service_codes ?? []).join(', '),
  }
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function parseServiceCodes(value: string): string[] | null {
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return items.length === 0 ? null : items
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

  const dirty = vervoerder ? !shallowFormEquals(form, fromVervoerder(vervoerder)) : false

  const toUpdateInput = (type: 'api' | 'edi' | 'print'): VervoerderUpdateInput => ({
    api_endpoint: type === 'api' ? emptyToNull(form.api_endpoint) : null,
    api_customer_id: type === 'api' ? emptyToNull(form.api_customer_id) : null,
    account_nummer: emptyToNull(form.account_nummer),
    kontakt_naam: emptyToNull(form.kontakt_naam),
    kontakt_email: emptyToNull(form.kontakt_email),
    kontakt_telefoon: emptyToNull(form.kontakt_telefoon),
    tarief_notities: emptyToNull(form.tarief_notities),
    notities: emptyToNull(form.notities),
    printer_naam: type === 'print' ? emptyToNull(form.printer_naam) : null,
    printer_ip: type === 'print' ? emptyToNull(form.printer_ip) : null,
    label_breedte_mm: type === 'print' ? parsePositiveInt(form.label_breedte_mm) : null,
    label_hoogte_mm: type === 'print' ? parsePositiveInt(form.label_hoogte_mm) : null,
    service_codes: type === 'print' ? parseServiceCodes(form.service_codes) : null,
  })

  return { form, update, reset, dirty, toUpdateInput }
}

function shallowFormEquals(a: VervoerderFormState, b: VervoerderFormState): boolean {
  return (Object.keys(a) as (keyof VervoerderFormState)[]).every((k) => a[k] === b[k])
}
