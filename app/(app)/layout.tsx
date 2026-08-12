import { getCurrentMember } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'
import { SignOutButton } from '@/components/layout/sign-out-button'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember()

  if (!member) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Sem acesso</h1>
          <p className="text-sm text-neutral-600">
            Sua conta está autenticada, mas ainda não está vinculada a nenhuma organização.
            Entre em contato com um administrador para receber acesso, ou saia e tente com outra
            conta.
          </p>
          <SignOutButton className="w-full rounded bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50" />
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
