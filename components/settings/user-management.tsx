'use client'

import { FormEvent, useEffect, useState } from 'react'

type Role = 'OWNER_ADMIN' | 'MANAGER' | 'VIEWER'
type Member = { id: string; profile_id: string; full_name: string | null; role: Role; active: boolean; created_at: string }
type Invitation = { id: string; email: string; role: Role; status: string; invited_at: string; expires_at: string }

const ROLE_LABEL: Record<Role, string> = {
  OWNER_ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  VIEWER: 'Visualizador',
}

export function UserManagement() {
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('VIEWER')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const response = await fetch('/api/organization/members', { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error ?? 'Falha ao carregar usuários')
    else {
      setMembers(data.members ?? [])
      setInvitations(data.invitations ?? [])
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('invite')
    setError(null)
    const response = await fetch('/api/organization/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error ?? 'Falha ao enviar convite')
    else { setEmail(''); await load() }
    setBusy(null)
  }

  async function updateMember(memberId: string, update: { role?: Role; active?: boolean }) {
    setBusy(memberId)
    setError(null)
    const response = await fetch(`/api/organization/members/${memberId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error ?? 'Falha ao atualizar membro')
    else await load()
    setBusy(null)
  }

  async function removeMember(memberId: string) {
    setBusy(memberId)
    setError(null)
    const response = await fetch(`/api/organization/members/${memberId}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error ?? 'Falha ao remover membro')
    else await load()
    setBusy(null)
  }

  async function updateInvitation(invitationId: string, method: 'POST' | 'DELETE') {
    setBusy(invitationId)
    setError(null)
    const response = await fetch(`/api/organization/invitations/${invitationId}`, { method })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error ?? 'Falha ao atualizar convite')
    else await load()
    setBusy(null)
  }

  return (
    <div className="space-y-5">
      <form onSubmit={invite} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <label className="text-sm font-medium">
          Convidar por e-mail
          <input aria-label="E-mail do convite" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
        </label>
        <label className="text-sm font-medium">
          Função
          <select aria-label="Função do convite" value={role} onChange={(event) => setRole(event.target.value as Role)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy === 'invite'} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy === 'invite' ? 'Enviando...' : 'Enviar convite'}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading ? <p className="text-sm text-muted-foreground">Carregando usuários...</p> : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr><th className="px-4 py-2 text-left">Nome</th><th className="px-4 py-2 text-left">Função</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-right">Ações</th></tr></thead>
              <tbody>
                {members.map((member) => <tr key={member.id} className="border-t">
                  <td className="px-4 py-2">{member.full_name || 'Sem nome cadastrado'}</td>
                  <td className="px-4 py-2"><select aria-label={`Função de ${member.full_name || member.profile_id}`} value={member.role} disabled={busy === member.id} onChange={(event) => void updateMember(member.id, { role: event.target.value as Role })} className="h-8 rounded-md border border-input bg-background px-2 text-sm">{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td className="px-4 py-2">{member.active ? 'Ativo' : 'Desativado'}</td>
                  <td className="space-x-2 px-4 py-2 text-right">
                    <button type="button" disabled={busy === member.id} onClick={() => void updateMember(member.id, { active: !member.active })} className="text-xs font-medium text-primary underline">{member.active ? 'Desativar' : 'Ativar'}</button>
                    <button type="button" disabled={busy === member.id} onClick={() => void removeMember(member.id)} className="text-xs font-medium text-destructive underline">Remover</button>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Convites pendentes</h3>
            {invitations.filter((invitation) => invitation.status === 'pending').length === 0 ? <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p> : <div className="space-y-2">{invitations.filter((invitation) => invitation.status === 'pending').map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"><span>{invitation.email} · {ROLE_LABEL[invitation.role]}</span><span className="space-x-2"><button type="button" disabled={busy === invitation.id} onClick={() => void updateInvitation(invitation.id, 'POST')} className="text-xs font-medium text-primary underline">Reenviar</button><button type="button" disabled={busy === invitation.id} onClick={() => void updateInvitation(invitation.id, 'DELETE')} className="text-xs font-medium text-destructive underline">Cancelar</button></span></div>)}</div>}
          </div>
        </>
      )}
    </div>
  )
}
