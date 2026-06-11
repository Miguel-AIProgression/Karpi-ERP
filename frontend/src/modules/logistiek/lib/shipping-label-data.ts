// Pure data-helpers voor het verzendlabel — gedeeld door het compacte
// (liggende) en het staande 3×6-ontwerp zodat beide exact dezelfde
// product-/referentie-logica tonen.
import type { ZendingPrintRegel } from '@/modules/logistiek/queries/zendingen'

export interface RegelNamen {
  klantNaam: string
  karpiNaam: string | null
}

export function productNamen(regel: ZendingPrintRegel | null): RegelNamen {
  const orderRegel = regel?.order_regels
  if (!orderRegel) {
    return { klantNaam: regel?.artikelnr ?? 'Artikel', karpiNaam: null }
  }
  const klantNaam = [orderRegel.omschrijving, orderRegel.omschrijving_2].filter(Boolean).join(' ')
  const karpiNaam = orderRegel.producten?.omschrijving ?? null
  return { klantNaam: klantNaam || (regel?.artikelnr ?? 'Artikel'), karpiNaam }
}

export function productMaat(regel: ZendingPrintRegel | null): string {
  const orderRegel = regel?.order_regels
  if (!orderRegel?.is_maatwerk) return ''
  const lengte = orderRegel.maatwerk_lengte_cm
  const breedte = orderRegel.maatwerk_breedte_cm
  if (!lengte || !breedte) return ''
  return `${breedte}x${lengte} cm`
}

export function datumKort(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yy = String(now.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}
