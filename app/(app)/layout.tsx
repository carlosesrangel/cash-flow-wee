import { getCurrentMember } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNavToggle } from '@/components/layout/mobile-nav-toggle'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember()

  if (!member) {
    redirect('/criar-organizacao')
  }

  return (
    <div className="flex min-h-screen">
      <MobileNavToggle />
      {/* Sidebar - desktop visible, mobile collapsible */}
      <div className="hidden w-64 shrink-0 md:block">
        <Sidebar />
      </div>
      {/* Mobile sidebar modal - positioned fixed for modal effect */}
      <div className="fixed left-0 top-0 bottom-0 z-30 w-64 -translate-x-full transform transition-transform duration-200 md:hidden has-[div[data-mobile-nav-open='true']]:translate-x-0">
        <Sidebar />
      </div>
      {/* Main content */}
      <main className="flex-1 overflow-x-hidden pt-16 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  )
}
