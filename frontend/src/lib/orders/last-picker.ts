// Onthoudt de laatst gekozen picker over de sessie heen in localStorage, zodat
// de magazijnier 'm niet bij elke pickronde opnieuw hoeft te kiezen. Gedeelde
// bron-van-waarheid: zowel de zending-printset-pagina als de multi-select-
// actiebalk (PickSelectieBalk) lezen/schrijven dezelfde sleutel, dus een keuze
// op de ene plek verschijnt ook op de andere.
export const LAST_PICKER_KEY = 'rugflow.last-picker-id'

export function loadLastPicker(): number | null {
  try {
    const v = localStorage.getItem(LAST_PICKER_KEY)
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function saveLastPicker(id: number | null): void {
  try {
    if (id) localStorage.setItem(LAST_PICKER_KEY, String(id))
    else localStorage.removeItem(LAST_PICKER_KEY)
  } catch {
    // localStorage onbeschikbaar (private mode / quota) — geen blokkade.
  }
}
