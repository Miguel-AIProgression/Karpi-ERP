// Facturatie Module — barrel export (ADR-0007)
//
// Bezit factuur-flow vanaf het Verzonden-event tot bezorgde PDF/EDI-INVOIC.
// Frontend: pages, components, hooks, queries onder modules/facturatie/.
// Backend: edge functions factuur-verzenden + factuur-pdf zijn fysiek in
// supabase/functions/ maar mentaal eigendom van deze Module.
// Trigger sinds mig 219: AFTER INSERT ON order_events
// (event_type='pickronde_voltooid' AND status_na='Verzonden').

// Pages — geconsumeerd door router
export { FactuurDetailPage } from './pages/factuur-detail'
export { FacturatieOverviewPage } from './pages/facturatie-overview'

// Components
export { FactuurLijst } from './components/factuur-lijst'

// Hooks
export * from './hooks/use-facturen'

// Types (for external consumers)
export type { FactuurVoorOrder } from './queries/facturen'

// Klant-factuur-instellingen
export {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
  type KlantFactuurInstellingen,
} from './queries/klant-factuur-instellingen'
// FactuurVoorkeur-type vervalt per ADR-0010.
export {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from './hooks/use-klant-factuur-instellingen'
