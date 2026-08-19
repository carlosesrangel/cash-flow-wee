import { getCurrentMember } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'
import { SignOutButton } from '@/components/layout/sign-out-button'
import { MobileNavToggle } from '@/components/layout/mobile-nav-toggle'
import { Card, CardContent } from '@/components/ui/card'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember()

  if (!member) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 pt-6 text-center">
            <h1 className="font-heading text-xl font-semibold text-foreground">Sem acesso</h1>
            <p className="text-sm text-muted-foreground">
              Sua conta está autenticada, mas ainda não está vinculada a nenhuma organização.
              Entre em contato com um administrador para receber acesso, ou saia e tente com outra
              conta.
            </p>
            <SignOutButton className="w-full rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" />
          </CardContent>
        </Card>
      </main>
    )
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
