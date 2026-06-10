import { Outlet } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { FeedbackWidget } from '@/components/feedback/feedback-widget'

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <TopBar />
      <main className="ml-[var(--sidebar-w)] mt-[var(--topbar-h)] p-6">
        <Outlet />
      </main>
      <FeedbackWidget />
    </div>
  )
}
