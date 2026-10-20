import { vi } from 'vitest'
import type { VaultSync } from '../hooks/useVaultSync'
import { createEmptyVault, type VaultDocument } from '../lib/vault'

function makeDefaultSync(): VaultSync {
  return {
    draft: createEmptyVault(),
    serverVersion: 0,
    status: 'saved',
    connected: true,
    dirty: false,
    conflict: null,
    errorMessage: null,
    initialized: true,
    revision: 1,
    sessionExpired: false,
    setDraft: vi.fn(),
    mutate: vi.fn(),
    retryNow: vi.fn(),
    resolveConflict: vi.fn(),
    exportDraft: vi.fn(),
  }
}

let current: VaultSync = makeDefaultSync()

export function setVaultSyncMock(next: VaultSync): void {
  current = next
}

export function getVaultSyncMock(): VaultSync {
  return current
}

export function mockUseVaultSync(): VaultSync {
  return {
    ...current,
    setDraft: (next: VaultDocument) => {
      current = { ...current, draft: next }
    },
    mutate: (mutator: (draft: VaultDocument) => VaultDocument) => {
      current = { ...current, draft: mutator(current.draft) }
    },
    retryNow: vi.fn(),
    resolveConflict: vi.fn(),
    exportDraft: vi.fn(),
  }
}
