// Inkoop-Module — bezit inkooporders, inkooporder_regels, leveranciers,
// ontvangst-RPC's (stuks + rollen) en de claim-popover/rol-sticker-runtime.
// Medium scope (ADR-0016): logica-laag + 6 components + 5 pages leven hier.
// Cross-Module-imports gaan via deze barrel; directe imports uit subfolders
// worden door ESLint geblokkeerd (zie Stap 10 van het migratiepad).
//
// Geen barrel-exports van losse query-functies — alleen hooks naar buiten,
// conform Snijplanning- en Reservering-precedent.

// ---------------------------------------------------------------------------
// Hooks (queries) — komen in Stap 3
// ---------------------------------------------------------------------------
// export {
//   useInkooporders,
//   useInkooporder,
//   useInkooporderRegels,
//   useInkoopRegelSamenvatting,
// } from './hooks/use-inkooporders'
// export {
//   useLeveranciers,
//   useLeverancier,
//   useLeverancierStats,
// } from './hooks/use-leveranciers'
// export { useBoekOntvangst } from './hooks/use-boek-ontvangst'

// ---------------------------------------------------------------------------
// Cache seam (cross-Module invalidation — ADR-0016, Ingreep 4)
// ---------------------------------------------------------------------------
export { invalidateNaInkoopMutatie } from './cache'

// ---------------------------------------------------------------------------
// Components — komen in Stap 6 / 7 / 9
// ---------------------------------------------------------------------------
// export { InkooporderFormDialog } from './components/inkooporder-form-dialog'
// export { InkooporderStatusBadge } from './components/inkooporder-status-badge'
// export { OntvangstBoekenDialog } from './components/ontvangst-boeken-dialog'
// export { IORegelClaimsPopover } from './components/io-regel-claims-popover'
// export { VoorraadOntvangstDialog } from './components/voorraad-ontvangst-dialog'
// export { RolStickerLayout } from './components/rol-sticker-layout'
// export { LeverancierStatsCard } from './components/leverancier-stats-card'
// export { InkoopRegelSamenvatting } from './components/inkoop-regel-samenvatting'

// ---------------------------------------------------------------------------
// Types — komen mee met queries-verhuizing in Stap 2
// ---------------------------------------------------------------------------
// export type {
//   Inkooporder,
//   InkooporderRegel,
//   InkooporderStatus,
//   OntvangstResultaat,
//   BoekOntvangstStuksInput,
//   BoekOntvangstRollenInput,
//   InkoopRegelSamenvatting,
// } from './queries/inkooporders'
// export type { Leverancier } from './queries/leveranciers'
