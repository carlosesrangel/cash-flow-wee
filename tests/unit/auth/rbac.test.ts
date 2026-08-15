import { describe, it, expect } from 'vitest'
import {
  canManageUsers,
  canManageIntegrations,
  canEditForecast,
  canCreateScenario,
  canManageReconciliation,
  canManageCashBalance,
} from '@/lib/auth/rbac'

describe('rbac predicates', () => {
  it('only OWNER_ADMIN can manage users', () => {
    expect(canManageUsers('OWNER_ADMIN')).toBe(true)
    expect(canManageUsers('MANAGER')).toBe(false)
    expect(canManageUsers('VIEWER')).toBe(false)
  })

  it('only OWNER_ADMIN can manage integrations', () => {
    expect(canManageIntegrations('OWNER_ADMIN')).toBe(true)
    expect(canManageIntegrations('MANAGER')).toBe(false)
    expect(canManageIntegrations('VIEWER')).toBe(false)
  })

  it('OWNER_ADMIN and MANAGER can edit forecast, VIEWER cannot', () => {
    expect(canEditForecast('OWNER_ADMIN')).toBe(true)
    expect(canEditForecast('MANAGER')).toBe(true)
    expect(canEditForecast('VIEWER')).toBe(false)
  })

  it('OWNER_ADMIN and MANAGER can create scenarios, VIEWER cannot', () => {
    expect(canCreateScenario('OWNER_ADMIN')).toBe(true)
    expect(canCreateScenario('MANAGER')).toBe(true)
    expect(canCreateScenario('VIEWER')).toBe(false)
  })

  it('OWNER_ADMIN and MANAGER can manage reconciliation, VIEWER cannot', () => {
    expect(canManageReconciliation('OWNER_ADMIN')).toBe(true)
    expect(canManageReconciliation('MANAGER')).toBe(true)
    expect(canManageReconciliation('VIEWER')).toBe(false)
  })

  it('only OWNER_ADMIN can manage cash balance and manual entries', () => {
    expect(canManageCashBalance('OWNER_ADMIN')).toBe(true)
    expect(canManageCashBalance('MANAGER')).toBe(false)
    expect(canManageCashBalance('VIEWER')).toBe(false)
  })
})
