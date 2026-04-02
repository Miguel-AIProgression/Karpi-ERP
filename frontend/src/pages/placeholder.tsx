import { PageHeader } from '@/components/layout/page-header'
import { Construction } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <Construction size={48} className="mb-4" />
        <p className="text-lg font-medium">Binnenkort beschikbaar</p>
        <p className="text-sm mt-1">Deze module wordt stap voor stap uitgebouwd.</p>
      </div>
    </>
  )
}
