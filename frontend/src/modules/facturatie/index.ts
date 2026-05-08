// Facturatie Module — barrel export (ADR-0007)
//
// Bezit factuur-flow vanaf het Verzonden-event tot bezorgde PDF/EDI-INVOIC.
// Frontend: pages, components, hooks, queries onder modules/facturatie/.
// Backend: edge functions factuur-verzenden + factuur-pdf zijn fysiek in
// supabase/functions/ maar mentaal eigendom van deze Module.
// Trigger sinds mig 219: AFTER INSERT ON order_events
// (event_type='pickronde_voltooid' AND status_na='Verzonden').

// Inhoud volgt in tasks 2.2-2.7
export {}
