import type { SnijplanRow, SnijStuk, SnijvoorstelResponse, SnijvoorstelRol } from '@/lib/types/productie'
import { computeReststukken } from './compute-reststukken'

export interface RolGroep {
  rolId: number
  rolnummer: string
  rolBreedte: number
  rolLengte: number
  stukken: SnijplanRow[]
  vroegsteLeverdatum: string | null
  aantalTeSnijden: number
}

/**
 * Groepeer snijplan-stukken per rol_id.
 * Stukken zonder rol_id worden overgeslagen — de caller handelt die apart af.
 *
 * Sortering: vroegste leverdatum eerst; bij gelijke datum meeste aantal-te-snijden eerst;
 * rollen zonder leverdatum achteraan.
 */
export function groepeerStukkenPerRol(stukken: SnijplanRow[]): RolGroep[] {
  const map = new Map<number, RolGroep>()
  for (const s of stukken) {
    if (s.rol_id == null) continue
    let groep = map.get(s.rol_id)
    if (!groep) {
      groep = {
        rolId: s.rol_id,
        rolnummer: s.rolnummer ?? 'Onbekend',
        rolBreedte: s.rol_breedte_cm ?? 400,
        rolLengte: s.rol_lengte_cm ?? 2000,
        stukken: [],
        vroegsteLeverdatum: null,
        aantalTeSnijden: 0,
      }
      map.set(s.rol_id, groep)
    }
    groep.stukken.push(s)
    if (s.status === 'Snijden') groep.aantalTeSnijden += 1
    if (s.afleverdatum && (!groep.vroegsteLeverdatum || s.afleverdatum < groep.vroegsteLeverdatum)) {
      groep.vroegsteLeverdatum = s.afleverdatum
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const aD = a.vroegsteLeverdatum
    const bD = b.vroegsteLeverdatum
    if (aD !== bD) {
      if (!aD) return 1
      if (!bD) return -1
      const cmp = aD.localeCompare(bD)
      if (cmp !== 0) return cmp
    }
    // Tiebreaker: meeste te-snijden eerst
    return b.aantalTeSnijden - a.aantalTeSnijden
  })
}

/**
 * Map SnijplanRow items naar SnijStuk array.
 *
 * Optimizer convention: lengte_cm = X (across roll width), breedte_cm = Y (along roll length).
 * Uses the stored `geroteerd` flag to determine placed dimensions.
 */
export function mapSnijplannenToStukken(
  stukken: SnijplanRow[],
  rolBreedte: number,
  rolLengte: number,
): { snijStukken: SnijStuk[]; gebruikteLengte: number; afvalPct: number; reststukBruikbaar: boolean } {
  const placed = stukken.filter(s => s.positie_x_cm != null && s.positie_y_cm != null)

  const snijStukken: SnijStuk[] = placed.map(s => {
    const x = s.positie_x_cm!
    const y = s.positie_y_cm!
    const isRotated = s.geroteerd === true

    // Rotated: X = snij_breedte, Y = snij_lengte (dimensions swap)
    // Default: X = snij_lengte, Y = snij_breedte
    const lengte_cm = isRotated ? s.snij_breedte_cm : s.snij_lengte_cm  // X dimension
    const breedte_cm = isRotated ? s.snij_lengte_cm : s.snij_breedte_cm // Y dimension

    return {
      snijplan_id: s.id,
      order_regel_id: s.order_regel_id,
      order_nr: s.order_nr,
      klant_naam: s.klant_naam,
      lengte_cm,
      breedte_cm,
      vorm: s.maatwerk_vorm ?? 'rechthoek',
      afwerking: s.maatwerk_afwerking,
      x_cm: x,
      y_cm: y,
      geroteerd: isRotated,
      afleverdatum: s.afleverdatum,
    }
  })

  // Calculate stats
  const gebruikteLengte = snijStukken.length > 0
    ? Math.max(...snijStukken.map(s => s.y_cm + s.breedte_cm))
    : 0
  const usedArea = rolBreedte * gebruikteLengte
  const pieceArea = snijStukken.reduce((sum, p) => sum + p.lengte_cm * p.breedte_cm, 0)
  const afvalPct = usedArea > 0 ? Math.round((1 - pieceArea / usedArea) * 1000) / 10 : 0
  const restLengte = rolLengte - gebruikteLengte
  const reststukBruikbaar = restLengte > 100

  return { snijStukken, gebruikteLengte, afvalPct, reststukBruikbaar }
}

/**
 * Reconstruct a SnijvoorstelResponse from loaded snijplannen data.
 * Fallback when no approved voorstel record exists.
 */
export function buildPlanFromStukken(stukken: SnijplanRow[]): SnijvoorstelResponse | null {
  const gepland = stukken.filter(s => s.status === 'Snijden' && s.rolnummer)
  if (gepland.length === 0) return null

  const rolMap = new Map<string, { stukken: SnijplanRow[]; rol_lengte_cm: number; rol_breedte_cm: number; rol_status: string }>()
  for (const s of gepland) {
    const key = s.rolnummer!
    if (!rolMap.has(key)) {
      rolMap.set(key, {
        stukken: [],
        rol_lengte_cm: s.rol_lengte_cm ?? 0,
        rol_breedte_cm: s.rol_breedte_cm ?? 0,
        rol_status: s.rol_status ?? 'in_snijplan',
      })
    }
    rolMap.get(key)!.stukken.push(s)
  }

  const rollen: SnijvoorstelRol[] = Array.from(rolMap.entries()).map(([rolnummer, info]) => {
    const { snijStukken, gebruikteLengte, afvalPct } = mapSnijplannenToStukken(
      info.stukken, info.rol_breedte_cm, info.rol_lengte_cm,
    )

    const plaatsingen = snijStukken.map(s => ({
      snijplan_id: s.snijplan_id!,
      positie_x_cm: s.x_cm,
      positie_y_cm: s.y_cm,
      lengte_cm: s.lengte_cm,
      breedte_cm: s.breedte_cm,
      geroteerd: s.geroteerd ?? false,
    }))

    return {
      rol_id: 0,
      rolnummer,
      rol_lengte_cm: info.rol_lengte_cm,
      rol_breedte_cm: info.rol_breedte_cm,
      rol_status: info.rol_status as SnijvoorstelRol['rol_status'],
      plaatsingen,
      gebruikte_lengte_cm: gebruikteLengte,
      afval_percentage: afvalPct,
      restlengte_cm: info.rol_lengte_cm - gebruikteLengte,
      reststukken: computeReststukken(info.rol_lengte_cm, info.rol_breedte_cm, plaatsingen),
    }
  })

  const totaalGeplaatst = rollen.reduce((s, r) => s + r.plaatsingen.length, 0)
  const totaalM2Gebruikt = rollen.reduce((s, r) => s + (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000, 0)
  const totaalM2Afval = rollen.reduce((s, r) => {
    const used = (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000
    return s + used * (r.afval_percentage / 100)
  }, 0)
  const gemAfval = rollen.length > 0
    ? Math.round(rollen.reduce((s, r) => s + r.afval_percentage, 0) / rollen.length * 10) / 10
    : 0

  return {
    voorstel_id: 0,
    voorstel_nr: 'Huidig plan',
    rollen,
    niet_geplaatst: [],
    samenvatting: {
      totaal_stukken: gepland.length,
      geplaatst: totaalGeplaatst,
      niet_geplaatst: 0,
      totaal_rollen: rollen.length,
      gemiddeld_afval_pct: gemAfval,
      totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 10) / 10,
      totaal_m2_afval: Math.round(totaalM2Afval * 10) / 10,
    },
  }
}
