const STORAGE_KEY = 'order_list_ctx'

interface OrderListContext {
  orderIds: number[]
  totalCount: number
  page: number
  pageSize: number
  statusFilter: string
}

export function saveOrderListContext(ctx: OrderListContext): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx))
  } catch { /* quota/security — fail silently */ }
}

export interface OrderNavigation {
  prev: number | null
  next: number | null
  position: number | null
  totalCount: number
  backUrl: string
}

export function getOrderNavigation(orderId: number): OrderNavigation {
  const fallback: OrderNavigation = { prev: null, next: null, position: null, totalCount: 0, backUrl: '/orders' }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback

    const ctx = JSON.parse(raw) as OrderListContext
    const backUrl = ctx.statusFilter && ctx.statusFilter !== 'Alle'
      ? `/orders?status=${encodeURIComponent(ctx.statusFilter)}`
      : '/orders'

    const idx = ctx.orderIds.indexOf(orderId)
    if (idx === -1) return { ...fallback, backUrl }

    return {
      prev: idx > 0 ? (ctx.orderIds[idx - 1] ?? null) : null,
      next: idx < ctx.orderIds.length - 1 ? (ctx.orderIds[idx + 1] ?? null) : null,
      position: ctx.page * ctx.pageSize + idx + 1,
      totalCount: ctx.totalCount,
      backUrl,
    }
  } catch {
    return fallback
  }
}
