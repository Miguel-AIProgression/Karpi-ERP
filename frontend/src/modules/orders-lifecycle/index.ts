// Order-lifecycle Module — barrel export (ADR-0006)
//
// Eigenaar van orders.status + verzonden_at + order_events. Alle UPDATE
// orders SET status loopt via deze RPCs (mig 218 _apply_transitie).

export {
  markeerVerzonden,
  markeerGeannuleerd,
  herberekenWachtStatus,
  type MarkeerVerzondenInput,
  type MarkeerGeannuleerdInput,
  type HerberekenWachtStatusInput,
} from './queries/transities'

// useMarkeerGeannuleerd hook volgt in Task 1.13.
