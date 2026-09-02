import { getCurrentMember } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNavToggle } from '@/components/layout/mobile-nav-toggle'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember()

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
      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden pt-16 md:pt-0">
        <div className="flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
        <footer className="border-t border-border px-4 py-4 text-center text-[11px] text-muted-foreground sm:px-6 lg:px-8">
          Desenvolvido por L&apos;Engrenage | Inteligência de Varejo |{' '}
          <a href="https://lengrenage.com.br" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            lengrenage.com.br
          </a>
        </footer>
      </main>
    </div>
  )
}
