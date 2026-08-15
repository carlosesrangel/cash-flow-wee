import type { OrganizationRole } from '@/lib/validation/auth'

export function canManageUsers(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}

export function canManageIntegrations(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}

export function canEditForecast(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}

export function canCreateScenario(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}

export function canManageReconciliation(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}

export function canManageCashBalance(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}
