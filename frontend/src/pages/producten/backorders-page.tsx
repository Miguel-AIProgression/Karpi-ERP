import { PageHeader } from '@/components/layout/page-header'
import { BackorderTab } from './backorder-tab'

export function BackordersPage() {
  return (
    <>
      <PageHeader
        title="Backorders"
        description="Producten zonder voldoende voorraad of inkooporders"
      />
      <BackorderTab />
    </>
  )
}
