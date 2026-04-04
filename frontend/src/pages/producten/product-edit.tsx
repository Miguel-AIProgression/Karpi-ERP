import { useParams, Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/page-header'
import { useProductDetail } from '@/hooks/use-producten'
import { ProductFormPage } from './product-form'

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>()
  const artikelnr = id ?? ''
  const { data: product, isLoading } = useProductDetail(artikelnr)

  if (isLoading) return <PageHeader title="Product laden..." />

  if (!product) {
    return (
      <>
        <PageHeader title="Product niet gevonden" />
        <Link to="/producten" className="text-terracotta-500 hover:underline">Terug</Link>
      </>
    )
  }

  return <ProductFormPage product={product} />
}
