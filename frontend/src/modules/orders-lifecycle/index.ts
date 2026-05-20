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

export { useMarkeerGeannuleerd } from './hooks/use-markeer-geannuleerd'

export { useOrderEvents } from './hooks/use-order-events'
export {
  fetchOrderEvents,
  type OrderEvent,
  type OrderEventType,
  type ClaimGeswaptWegMetadata,
  type ClaimGeswaptNaarMetadata,
  type DeadlineConflictNaSwapMetadata,
} from './queries/order-events'
