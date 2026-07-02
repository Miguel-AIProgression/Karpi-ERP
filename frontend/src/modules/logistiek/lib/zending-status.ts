// Zending-status-predicaten. 'Gepland' is een overladen string ('Gepland'
// bestaat óók als snijplan_status met een andere betekenis) — check zending-
// status daarom via deze helpers, nooit via een kale stringvergelijking.
// Semantiek sinds mig 477: 'Gepland' = deelzending aangemaakt maar pickronde
// nog niet gestart; 'Picken' = pickronde loopt.
export const ZENDING_LOPEND = ['Gepland', 'Picken'] as const

export function isZendingGepland(status: string | null | undefined): boolean {
  return status === 'Gepland'
}

export function isZendingLopend(status: string | null | undefined): boolean {
  return status === 'Gepland' || status === 'Picken'
}
